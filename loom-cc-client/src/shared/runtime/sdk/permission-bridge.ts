/**
 * Permission bridge: connects SDK's canUseTool callback to the SSE stream
 * and the frontend's permission decision endpoint.
 *
 * Flow:
 * 1. SDK calls canUseTool(toolName, input)
 * 2. Bridge emits 'permission_request' via SSE to frontend
 * 3. Frontend shows modal, user clicks allow/deny
 * 4. Frontend POSTs to /api/runtime/permission
 * 5. resolvePermission() resolves the Promise
 * 6. canUseTool returns PermissionResult to SDK
 */

import crypto from 'crypto'
import type { CanUseTool, PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import type { SseEvent } from '@/shared/runtime/sdk/message-mapper'
import { logger } from '@/shared/logging/logger'
import type { ConfirmationContentBlock } from '@/shared/runtime/confirmation-block-store'

export type PermissionDecision = 'allow' | 'allow_session' | 'deny' | 'timeout'

interface PendingRequest {
  resolve: (decision: PermissionDecision) => void
  toolName: string
  toolInput: Record<string, unknown>
  sessionId: string
  createdAt: number
  suggestions?: PermissionUpdate[]
}

type PermissionRequestBlock = Extract<ConfirmationContentBlock, { type: 'permission_request' }>

interface PermissionBridgePersistence {
  onPermissionRequest?: (block: PermissionRequestBlock) => void | Promise<void>
  onPermissionResolved?: (requestId: string, decision: PermissionDecision) => void | Promise<void>
}

// globalThis ensures state is shared across /api/runtime/chat and /api/runtime/permission route handlers
// (Turbopack creates separate module instances per route handler)
const g = globalThis as unknown as {
  __loom_pendingRequests?: Map<string, PendingRequest>
  __loom_sessionAllowances?: Map<string, Set<string>>
  __loom_sessionActivity?: Map<string, number>
}

if (!g.__loom_pendingRequests) g.__loom_pendingRequests = new Map()
if (!g.__loom_sessionAllowances) g.__loom_sessionAllowances = new Map()
if (!g.__loom_sessionActivity) g.__loom_sessionActivity = new Map()

const pendingRequests = g.__loom_pendingRequests
const sessionAllowances = g.__loom_sessionAllowances
const sessionActivity = g.__loom_sessionActivity

const PERMISSION_TIMEOUT_MS = 120_000

export function createPermissionBridge(
  sessionId: string,
  emit: (event: SseEvent) => void | Promise<void>,
  persistence?: PermissionBridgePersistence,
): CanUseTool {
  return async (
    toolName: string,
    input: Record<string, unknown>,
    options: { signal: AbortSignal; suggestions?: PermissionUpdate[]; toolUseID: string; agentID?: string; blockedPath?: string; decisionReason?: string },
  ): Promise<PermissionResult> => {
    const updatedPermissions: PermissionUpdate[] = options.suggestions ?? [{
      type: 'addRules',
      rules: [{ toolName }],
      behavior: 'allow',
      destination: 'session',
    } as PermissionUpdate]

    if (isToolAllowedForSession(sessionId, toolName)) {
      touchSessionActivity(sessionId)
      return { behavior: 'allow', updatedInput: input, updatedPermissions }
    }

    const requestId = crypto.randomUUID()
    const requestBlock: PermissionRequestBlock = {
      type: 'permission_request',
      requestId,
      toolName,
      toolInput: input,
      status: 'pending',
      toolUseId: options.toolUseID,
    }

    try {
      await Promise.resolve(persistence?.onPermissionRequest?.(requestBlock))
    } catch (err) {
      logger.warn('runtime.permission.persist_request_failed', {
        sessionId,
        requestId,
        toolName,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    try {
      await Promise.resolve(emit(requestBlock))
    } catch (err) {
      logger.warn('runtime.permission.emit_failed', {
        sessionId,
        requestId,
        toolName,
        error: err instanceof Error ? err.message : String(err),
      })
      try {
        await Promise.resolve(persistence?.onPermissionResolved?.(requestId, 'deny'))
      } catch { /* best effort */ }
      return { behavior: 'deny', message: `Permission request failed: SSE connection lost` }
    }

    const decision = await waitForDecision(requestId, sessionId, toolName, input, options.suggestions)

    try {
      await Promise.resolve(persistence?.onPermissionResolved?.(requestId, decision))
    } catch (err) {
      logger.warn('runtime.permission.persist_resolution_failed', {
        sessionId,
        requestId,
        toolName,
        decision,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    try {
      await Promise.resolve(emit({ type: 'permission_resolved', requestId, decision }))
    } catch {
      // Client may have disconnected
    }

    if (decision === 'allow' || decision === 'allow_session') {
      touchSessionActivity(sessionId)
      return { behavior: 'allow', updatedInput: input, updatedPermissions }
    }
    return { behavior: 'deny', message: `Permission denied for ${toolName}` }
  }
}

function isToolAllowedForSession(sessionId: string, toolName: string): boolean {
  return sessionAllowances.get(sessionId)?.has(toolName) ?? false
}

function waitForDecision(
  requestId: string,
  sessionId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  suggestions?: PermissionUpdate[],
): Promise<PermissionDecision> {
  return new Promise<PermissionDecision>((resolve) => {
    pendingRequests.set(requestId, { resolve, toolName, toolInput, sessionId, createdAt: Date.now(), suggestions })
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId)
        resolve('timeout')
      }
    }, PERMISSION_TIMEOUT_MS)
  })
}

export function resolvePermission(requestId: string, decision: PermissionDecision): boolean {
  const pending = pendingRequests.get(requestId)
  if (!pending) return false
  pendingRequests.delete(requestId)

  if (decision === 'allow_session') {
    let allowed = sessionAllowances.get(pending.sessionId)
    if (!allowed) { allowed = new Set(); sessionAllowances.set(pending.sessionId, allowed) }
    allowed.add(pending.toolName)

    for (const [id, req] of pendingRequests) {
      if (req.sessionId === pending.sessionId && req.toolName === pending.toolName) {
        pendingRequests.delete(id)
        req.resolve('allow_session')
      }
    }
  }

  pending.resolve(decision)
  return true
}

export function clearSessionAllowances(sessionId: string): void {
  sessionAllowances.delete(sessionId)
  sessionActivity.delete(sessionId)
}

const SESSION_STALE_MS = 30 * 60 * 1000

function touchSessionActivity(sessionId: string): void {
  sessionActivity.set(sessionId, Date.now())
}

export function cleanupStaleSessionAllowances(): number {
  const now = Date.now()
  let cleaned = 0
  for (const [sid, lastActive] of sessionActivity) {
    if (now - lastActive > SESSION_STALE_MS) {
      sessionAllowances.delete(sid)
      sessionActivity.delete(sid)
      cleaned++
    }
  }
  for (const sid of sessionAllowances.keys()) {
    if (!sessionActivity.has(sid)) { sessionAllowances.delete(sid); cleaned++ }
  }
  return cleaned
}

/**
 * Tools that are safe to auto-allow in "Accept Edits" mode.
 * Covers read/write/edit file operations only.
 * Anything involving code execution or network goes through the bridge.
 */
const ACCEPT_EDITS_AUTO_ALLOW = new Set([
  // Claude Code built-in file tools
  'str_replace_based_edit_tool',
  'create',
  'write_file',
  'read_file',
  'list_directory',
  'find_files',
  'grep',
  'glob',
  // Generic names (lowercase + PascalCase variants)
  'Edit',    'edit',
  'Write',   'write',
  'Read',    'read',
  'Glob',    'glob_tool',
  'Grep',    'grep_tool',
  'MultiEdit', 'multi_edit',
  'NotebookEdit', 'notebook_edit',
  // Memory / task tools (no execution risk)
  'TodoWrite', 'TodoRead',
])

/**
 * Accept-Edits bridge: auto-allows file read/write/edit tools,
 * and routes all execution/network tools through the normal permission bridge.
 */
export function createAcceptEditsCanUseTool(
  sessionId: string,
  emit: (event: SseEvent) => void | Promise<void>,
  persistence?: PermissionBridgePersistence,
): CanUseTool {
  const bridge = createPermissionBridge(sessionId, emit, persistence)

  return async (
    toolName: string,
    input: Record<string, unknown>,
    options: { signal: AbortSignal; suggestions?: PermissionUpdate[]; toolUseID: string; agentID?: string; blockedPath?: string; decisionReason?: string },
  ): Promise<PermissionResult> => {
    if (ACCEPT_EDITS_AUTO_ALLOW.has(toolName)) {
      touchSessionActivity(sessionId)
      const updatedPermissions: PermissionUpdate[] = options.suggestions ?? [{
        type: 'addRules',
        rules: [{ toolName }],
        behavior: 'allow',
        destination: 'session',
      } as PermissionUpdate]
      return { behavior: 'allow', updatedInput: input, updatedPermissions }
    }
    // Execution / network tools -> ask user
    return bridge(toolName, input, options)
  }
}

export { PERMISSION_TIMEOUT_MS }
