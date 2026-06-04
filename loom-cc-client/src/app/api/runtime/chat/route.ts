import { getDb } from '@/shared/db/db'
import { getUploadsDir } from '@/shared/db/paths'
import crypto from 'crypto'
import path from 'path'
import { GLOBAL_CHAT_PROJECT_ID } from '@/shared/db/db'
import { getGlobalChatWorkspaceDir } from '@/shared/db/paths'
import { createLoomQuery } from '@/shared/runtime/sdk/client'
import type { LoomAttachment } from '@/shared/runtime/sdk/client'
import { MessageMapper } from '@/shared/runtime/sdk/message-mapper'
import type { SseEvent } from '@/shared/runtime/sdk/message-mapper'
import { createPermissionBridge, createAcceptEditsCanUseTool, cleanupStaleSessionAllowances } from '@/shared/runtime/sdk/permission-bridge'
import { createAskUserQuestionBridge } from '@/shared/runtime/sdk/ask-user-question-bridge'
import { ConfirmationDraftStore } from '@/shared/runtime/confirmation-block-store'
import { buildLoomMemoryContext } from '@/shared/memory/retriever'
import { extractExplicitMemoryCandidates, isExplicitMemoryReferenceRequest } from '@/shared/memory/extractor'
import { resolveExplicitMemoryReferenceWithLlm } from '@/shared/memory/auto-extractor'
import { messageContentToText } from '@/shared/memory/session-messages'
import { resolveProvider } from '@/shared/runtime/provider'
import type { ContextBudgetSnapshot } from '@/shared/runtime/context-budget'
import {
  buildFallbackHistory,
  summarizeAttachments,
  summarizeMemoryContext,
  summarizeToolResultStorage,
  STORED_TOOL_RESULT_MAX_CHARS,
} from '@/shared/runtime/context-budget'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { SDKControlGetContextUsageResponse } from '@anthropic-ai/claude-agent-sdk'
import { logger } from '@/shared/logging/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function drainQuery(
  q: Query,
  mapper: MessageMapper,
  emit: (data: Record<string, unknown>) => void | Promise<void>,
  onEvent?: (data: Record<string, unknown>) => void | Promise<void>,
  onMessage?: (msg: Record<string, unknown>) => void | Promise<void>,
) {
  for await (const msg of q) {
    const events = mapper.mapMessage(msg)
    for (const event of events) {
      await onEvent?.(event as Record<string, unknown>)
      await emit(event as Record<string, unknown>)
    }
    await onMessage?.(msg as unknown as Record<string, unknown>)
  }
}

function sanitizeSdkContextUsage(
  usage: SDKControlGetContextUsageResponse | null,
): Record<string, unknown> | null {
  if (!usage) return null
  return {
    totalTokens: usage.totalTokens,
    maxTokens: usage.maxTokens,
    rawMaxTokens: usage.rawMaxTokens,
    percentage: usage.percentage,
    model: usage.model,
    isAutoCompactEnabled: usage.isAutoCompactEnabled,
    autoCompactThreshold: usage.autoCompactThreshold,
    categories: usage.categories?.map(category => ({
      name: category.name,
      tokens: category.tokens,
      color: category.color,
      isDeferred: category.isDeferred,
    })) ?? [],
    memoryFiles: usage.memoryFiles?.map(file => ({
      path: file.path,
      type: file.type,
      tokens: file.tokens,
    })) ?? [],
    mcpTools: usage.mcpTools?.map(tool => ({
      name: tool.name,
      serverName: tool.serverName,
      tokens: tool.tokens,
      isLoaded: tool.isLoaded,
    })) ?? [],
    deferredBuiltinTools: usage.deferredBuiltinTools?.map(tool => ({
      name: tool.name,
      tokens: tool.tokens,
      isLoaded: tool.isLoaded,
    })) ?? [],
    systemTools: usage.systemTools?.map(tool => ({
      name: tool.name,
      tokens: tool.tokens,
    })) ?? [],
    systemPromptSections: usage.systemPromptSections?.map(section => ({
      name: section.name,
      tokens: section.tokens,
    })) ?? [],
    agents: usage.agents?.map(agent => ({
      agentType: agent.agentType,
      source: agent.source,
      tokens: agent.tokens,
    })) ?? [],
    slashCommands: usage.slashCommands,
    skills: usage.skills
      ? {
          totalSkills: usage.skills.totalSkills,
          includedSkills: usage.skills.includedSkills,
          tokens: usage.skills.tokens,
          skillFrontmatter: usage.skills.skillFrontmatter?.map(skill => ({
            name: skill.name,
            source: skill.source,
            tokens: skill.tokens,
          })) ?? [],
        }
      : undefined,
    messageBreakdown: usage.messageBreakdown,
    apiUsage: usage.apiUsage,
  }
}

async function readSdkContextUsage(params: {
  q: Query
  traceId: string
  sessionId: string
  phase: string
}): Promise<Record<string, unknown> | null> {
  try {
    const usage = await params.q.getContextUsage()
    const sanitized = sanitizeSdkContextUsage(usage)
    logger.info('runtime.chat.sdk_context_usage', {
      traceId: params.traceId,
      sessionId: params.sessionId,
      phase: params.phase,
      totalTokens: usage.totalTokens,
      maxTokens: usage.maxTokens,
      percentage: usage.percentage,
      isAutoCompactEnabled: usage.isAutoCompactEnabled,
      autoCompactThreshold: usage.autoCompactThreshold,
      categoryCount: usage.categories?.length ?? 0,
      memoryFileCount: usage.memoryFiles?.length ?? 0,
      mcpToolCount: usage.mcpTools?.length ?? 0,
      skillCount: usage.skills?.includedSkills,
    })
    return sanitized
  } catch (err) {
    logger.warn('runtime.chat.sdk_context_usage_failed', {
      traceId: params.traceId,
      sessionId: params.sessionId,
      phase: params.phase,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

function createSdkContextUsageSampler(params: {
  traceId: string
  sessionId: string
  phase: string
  intervalMs?: number
}) {
  let latest: Record<string, unknown> | null = null
  let lastStartedAt = 0
  let inFlight: Promise<void> | null = null

  const sample = (q: Query | null, force = false) => {
    if (!q) return latest
    const now = Date.now()
    const intervalMs = params.intervalMs ?? 2500
    if (!force && (inFlight || now - lastStartedAt < intervalMs)) return latest
    lastStartedAt = now
    inFlight = readSdkContextUsage({
      q,
      traceId: params.traceId,
      sessionId: params.sessionId,
      phase: params.phase,
    })
      .then(usage => {
        if (usage) latest = usage
      })
      .finally(() => {
        inFlight = null
      })
    return latest
  }

  return {
    sample,
    flush: async () => {
      if (inFlight) await inFlight
      return latest
    },
    latest: () => latest,
  }
}

function parsePathList(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return [...new Set(parsed.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map(p => p.trim()))]
    }
  } catch { /* legacy single path */ }
  return [value]
}

function resolveSessionWorkspaces(session: {
  project_id: string
  workspace_path: string | null
  attached_folder_paths: string | null
  project_workspace_path: string | null
}) {
  const legacyWorkspacePaths = parsePathList(session.workspace_path)
  const workspacePath = session.workspace_path?.trim().startsWith('[')
    ? legacyWorkspacePaths[0] ?? null
    : session.workspace_path?.trim() || null
  const primaryWorkspacePath = workspacePath
    || session.project_workspace_path?.trim()
    || (session.project_id === GLOBAL_CHAT_PROJECT_ID ? getGlobalChatWorkspaceDir() : null)
  const attachedFolderPaths = session.workspace_path?.trim().startsWith('[')
    ? [...legacyWorkspacePaths.slice(1), ...parsePathList(session.attached_folder_paths)]
    : parsePathList(session.attached_folder_paths)

  return {
    primaryWorkspacePath,
    attachedFolderPaths: [...new Set(attachedFolderPaths.filter(p => p !== primaryWorkspacePath))],
  }
}

function withAdditionalWorkspaceContext(prompt: string, attachedFolderPaths: string[]): string {
  if (attachedFolderPaths.length === 0) return prompt
  return `<additional_workspaces>\n${attachedFolderPaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n</additional_workspaces>\n\n${prompt}`
}

function isSdkSkillCommand(prompt: string, enabledSkills?: string[]): boolean {
  if (!enabledSkills || enabledSkills.length === 0) return false
  const firstLine = prompt.trimStart().split(/\r?\n/, 1)[0]?.trim() || ''
  if (!firstLine.startsWith('/')) return false
  const commandName = firstLine.slice(1).split(/\s+/, 1)[0]?.trim()
  return Boolean(commandName && enabledSkills.includes(commandName))
}

export async function POST(req: Request) {
  let body: {
    sessionId?: string
    message?: string
    displayMessage?: string  // optional: what to store in DB / show in chat (defaults to message)
    resumePending?: boolean  // when true: use existing last user message instead of inserting a new one
    permissionMode?: string
    thinkingMode?: string
    planMode?: boolean
    enabledSkills?: string[]
    attachments?: Array<{ name: string; filename: string; originalFilename?: string; mimeType: string; tier: string }>
  }
  try {
    body = await req.json()
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const { message } = body

  const uploadsDir = getUploadsDir()
  const attachments: (LoomAttachment & { originalFilename?: string })[] = (body.attachments || []).map(a => {
    const safeFilename = a.filename.replace(/\.\./g, '').replace(/[/\\]/g, '_')
    const safeOriginalFilename = a.originalFilename?.replace(/\.\./g, '').replace(/[/\\]/g, '_')
    return {
      name: a.name,
      serverPath: path.join(uploadsDir, safeFilename),
      mimeType: a.mimeType,
      tier: a.tier as LoomAttachment['tier'],
      originalFilename: safeOriginalFilename,
    }
  })

  if (!body.resumePending && !message && attachments.length === 0) {
    return jsonError('message (or attachments) required', 400)
  }

  const db = getDb()

  const sessionId = body.sessionId
  if (!sessionId) return jsonError('sessionId required', 400)

  // Get session with effective workspace path. Project sessions inherit the
  // project workspace; standalone Chat sessions store their workspace on session.
  const session = db.prepare(
    `SELECT s.*, p.workspace_path AS project_workspace_path
     FROM sessions s
     JOIN projects p ON p.id = s.project_id
     WHERE s.id = ?`
  ).get(sessionId) as {
    id: string; model: string; project_id: string; context_version: number;
    runtime_session_id: string | null; runtime_provider_id?: string; runtime_model_id?: string; workspace_path: string | null; attached_folder_paths: string | null; use_worktree: number; project_workspace_path: string | null;
  } | undefined
  if (!session) return jsonError('Session not found', 404)
  const { primaryWorkspacePath, attachedFolderPaths } = resolveSessionWorkspaces(session)
  if (!primaryWorkspacePath) return jsonError('workspacePath is required for this session', 400)

  const resolvedModel = session.model

  // Project-level provider override
  const projectProviderRow = db.prepare(
    `SELECT value FROM project_settings WHERE project_id = ? AND key = 'provider_id'`
  ).get(session.project_id) as { value: string } | undefined
  const projectProviderId = projectProviderRow?.value ?? undefined
  const turnProvider = resolveProvider(resolvedModel, projectProviderId)
  const turnProviderId = turnProvider.providerId
  const turnModelId = turnProvider.resolvedModelId ?? resolvedModel
  const runtimeProviderChanged = Boolean(
    (session.runtime_provider_id && session.runtime_provider_id !== turnProviderId) ||
    (session.runtime_model_id && session.runtime_model_id !== turnModelId),
  )

  const permissionMode = body.permissionMode || 'confirm'
  const thinkingMode = body.thinkingMode || 'auto'
  const planMode = body.planMode === true
  const enabledSkills = Array.isArray(body.enabledSkills)
    ? [...new Set(body.enabledSkills
        .filter((skill): skill is string => typeof skill === 'string')
        .map(skill => skill.replace(/^\//, '').trim())
        .filter(Boolean))]
    : undefined
  const rawEffectiveMessage = message || (attachments.length > 0
    ? attachments.map(a => `[${a.name}]`).join(' ')
    : '')
  let sdkSkillCommand = isSdkSkillCommand(rawEffectiveMessage, enabledSkills)

  const currentContextVersion = session.context_version
  let memoryDebug: ReturnType<typeof buildLoomMemoryContext>['debug'] | null = null
  let contextBudgetSnapshot: ContextBudgetSnapshot | null = null
  const traceId = `chat_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`
  const latestBoundary = db.prepare(
    `SELECT summary, compact_source
     FROM session_boundaries
     WHERE session_id = ?
     ORDER BY created_at DESC
     LIMIT 1`
  ).get(sessionId) as { summary: string | null; compact_source: string | null } | undefined
  const shouldResumeSdkCompactedSession = latestBoundary?.compact_source === 'sdk' &&
    Boolean(session.runtime_session_id) &&
    currentContextVersion > 0

  const existingMsgCount = (db.prepare(
    'SELECT COUNT(*) as count FROM messages WHERE session_id = ? AND context_version = ?'
  ).get(sessionId, currentContextVersion) as { count: number }).count
  logger.info('runtime.chat.start', {
    traceId,
    sessionId,
    projectId: session.project_id,
    contextVersion: currentContextVersion,
    existingMsgCount,
    model: resolvedModel,
    providerId: turnProviderId,
    resolvedModelId: turnModelId,
    messageChars: message?.length ?? 0,
    attachmentCount: attachments.length,
  })

  // Don't resume stale sessions (last message > 2 hours ago)
  const STALE_MS = 2 * 3600 * 1000
  const lastMsgRow = existingMsgCount > 0
    ? db.prepare(
        'SELECT created_at FROM messages WHERE session_id = ? AND context_version = ? ORDER BY created_at DESC LIMIT 1'
      ).get(sessionId, currentContextVersion) as { created_at: string } | undefined
    : undefined
  const sessionAge = lastMsgRow ? Date.now() - new Date(lastMsgRow.created_at).getTime() : Infinity

  let effectiveMessage: string
  let userMsgId: string
  let userMsgInserted = false

  if (body.resumePending) {
    // Resume pending: use the existing last user message in DB, don't insert a new one
    const lastUserMsg = db.prepare(
      `SELECT id, content FROM messages
       WHERE session_id = ? AND context_version = ? AND role = 'user'
       ORDER BY created_at DESC LIMIT 1`
    ).get(sessionId, currentContextVersion) as { id: string; content: string } | undefined

    if (!lastUserMsg) return jsonError('No pending user message found', 400)

    // Guard against concurrent execution (e.g. cron executor already wrote a response)
    const hasAssistant = (db.prepare(
      `SELECT COUNT(*) as c FROM messages WHERE session_id = ? AND context_version = ? AND role = 'assistant'`
    ).get(sessionId, currentContextVersion) as { c: number }).c
    if (hasAssistant > 0) return jsonError('Session already has a response', 409)

    userMsgId = lastUserMsg.id
    try {
      const blocks = JSON.parse(lastUserMsg.content) as Array<{ type: string; text?: string }>
      effectiveMessage = blocks.filter(b => b.type === 'text' && b.text).map(b => b.text).join(' ')
    } catch {
      effectiveMessage = lastUserMsg.content
    }
    sdkSkillCommand = isSdkSkillCommand(effectiveMessage, enabledSkills)
  } else {
    effectiveMessage = rawEffectiveMessage
    if (!sdkSkillCommand) {
      effectiveMessage = withAdditionalWorkspaceContext(effectiveMessage, attachedFolderPaths)
    }

    // displayMessage: what is stored in DB / shown in chat.
    // The AI still receives `effectiveMessage`; SDK-managed skills are passed separately.
    const storedText = body.displayMessage?.trim() || message?.trim() || effectiveMessage

    // Build user message blocks for persistent storage
    const userMsgBlocks: Array<Record<string, unknown>> = []
    if (storedText) userMsgBlocks.push({ type: 'text', text: storedText })
    for (const a of attachments) {
      const fname = path.basename(a.serverPath)
      if (a.tier === 'image') {
        userMsgBlocks.push({ type: 'image_attachment', url: `/api/files/serve/${fname}`, name: a.name })
      } else {
        userMsgBlocks.push({
          type: 'file_attachment',
          url: `/api/files/serve/${fname}`,
          name: a.name,
          size: 0,
          mimeType: a.mimeType,
          ...(a.originalFilename ? { originalFilename: a.originalFilename } : {}),
        })
      }
    }
    if (userMsgBlocks.length === 0) userMsgBlocks.push({ type: 'text', text: effectiveMessage })

    userMsgId = crypto.randomUUID()
    db.prepare(
      'INSERT INTO messages (id, session_id, context_version, role, content) VALUES (?, ?, ?, ?, ?)'
    ).run(userMsgId, sessionId, currentContextVersion, 'user', JSON.stringify(userMsgBlocks))
    userMsgInserted = true
  }

  cleanupStaleSessionAllowances()

  const encoder = new TextEncoder()
  const abortController = new AbortController()
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()

  const emit = async (data: Record<string, unknown>) => {
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
    } catch { /* writer closed (client disconnected) */ }
  }

  ;(async () => {
    const requestStart = Date.now()
    let mapper = new MessageMapper()
    const confirmationStore = new ConfirmationDraftStore(db, sessionId, currentContextVersion)

    try {
      const permissionPersistence = {
        onPermissionRequest: (block: Parameters<typeof confirmationStore.upsertPermissionRequest>[0]) => {
          confirmationStore.upsertPermissionRequest(block)
        },
        onPermissionResolved: (requestId: string, decision: Parameters<typeof confirmationStore.resolvePermission>[1]) => {
          confirmationStore.resolvePermission(requestId, decision)
        },
      }
      const canUseTool =
        permissionMode === 'confirm'
          ? createPermissionBridge(sessionId, emit as (event: SseEvent) => void, permissionPersistence)
          : permissionMode === 'accept_edits'
            ? createAcceptEditsCanUseTool(sessionId, emit as (event: SseEvent) => void, permissionPersistence)
            : undefined
      const askUserQuestionHook = createAskUserQuestionBridge(sessionId, emit as (event: SseEvent) => void, {
        onAskUserQuestionRequest: (block) => confirmationStore.upsertAskUserQuestionRequest(block),
        onAskUserQuestionResolved: (requestId, response) => {
          confirmationStore.resolveAskUserQuestion(requestId, response)
        },
      })

      const runtimeSessionId = runtimeProviderChanged ? crypto.randomUUID() : (session.runtime_session_id || sessionId)
      // resumePending: we're starting a fresh AI call for a pre-existing user message
      // — never try to resume a SDK session that was never started
      const isResume = !runtimeProviderChanged &&
        !body.resumePending &&
        (
          (existingMsgCount > 0 && sessionAge < STALE_MS) ||
          (existingMsgCount === 0 && shouldResumeSdkCompactedSession)
        )
      logger.info('runtime.chat.resume_decision', {
        traceId,
        sessionId,
        runtimeSessionId,
        isResume,
        runtimeProviderChanged,
        existingMsgCount,
        sdkCompacted: shouldResumeSdkCompactedSession,
      })

      // On first message of a Loom-managed compact context, inject compact summary.
      // SDK-managed compact keeps its own compressed context, so injecting the same
      // summary again would duplicate context.
      let promptForQuery = effectiveMessage
      if (!sdkSkillCommand && existingMsgCount === 0 && latestBoundary?.summary && latestBoundary.compact_source !== 'sdk') {
        promptForQuery = `<context_summary>\n${latestBoundary.summary}\n</context_summary>\n\n${promptForQuery}`
      }
      const promptBeforeMemoryChars = promptForQuery.length
      const compactSummaryInjected = !sdkSkillCommand && existingMsgCount === 0 && Boolean(latestBoundary?.summary) && latestBoundary?.compact_source !== 'sdk'
      const memoryContext = buildLoomMemoryContext({
        userMessage: effectiveMessage,
        workspacePath: primaryWorkspacePath,
        mode: 'sdk',
      })
      memoryDebug = memoryContext.debug
      if (!sdkSkillCommand && memoryContext.evolutionSummary?.trim()) {
        promptForQuery = `<project_evolution_context>\n${memoryContext.evolutionSummary.trim()}\n</project_evolution_context>\n\n${promptForQuery}`
      }
      const attachmentSummary = summarizeAttachments(attachments)
      const textAttachmentChars = attachmentSummary.items.reduce((sum, item) => sum + (item.injectedChars ?? 0), 0)
      contextBudgetSnapshot = {
        traceId,
        sessionId,
        contextVersion: currentContextVersion,
        providerId: turnProviderId,
        model: resolvedModel,
        resolvedModelId: turnModelId,
        resumeSession: isResume,
        parts: [
          {
            key: 'system_project',
            label: '系统 / 项目 / 工作区上下文',
            chars: primaryWorkspacePath.length + attachedFolderPaths.join('\n').length,
            count: 1 + attachedFolderPaths.length,
            metadata: {
              workspacePath: primaryWorkspacePath,
              attachedFolderCount: attachedFolderPaths.length,
              useWorktree: session.use_worktree === 1,
              permissionMode,
              thinkingMode,
              planMode,
            },
          },
          {
            key: 'recent_messages',
            label: '会话历史 / SDK resume context',
            count: existingMsgCount,
            metadata: {
              resumeSession: isResume,
              fallbackHistoryChars: 0,
              fallbackHistoryMessageCount: 0,
            },
          },
          {
            key: 'compact_summary',
            label: 'Compact 摘要',
            chars: compactSummaryInjected ? latestBoundary?.summary?.length ?? 0 : 0,
            count: compactSummaryInjected ? 1 : 0,
            metadata: {
              compactSummaryInjected,
              compactSource: latestBoundary?.compact_source ?? null,
            },
          },
          summarizeMemoryContext(memoryContext),
          {
            key: 'attachments',
            label: '附件',
            chars: textAttachmentChars,
            count: attachmentSummary.count,
            truncated: attachmentSummary.items.some(item => item.truncated),
            metadata: attachmentSummary,
          },
          {
            key: 'tool_results',
            label: '工具结果',
            count: 0,
            chars: 0,
            metadata: {
              note: '本轮工具结果在 SDK 执行过程中产生，不属于发送前静态输入。',
            },
          },
          {
            key: 'current_input',
            label: '当前用户输入',
            chars: effectiveMessage.length,
            count: 1,
            metadata: {
              promptBeforeMemoryChars,
              promptForQueryChars: promptForQuery.length,
              explicitSkills: enabledSkills ?? [],
            },
          },
        ],
      }
      logger.info('runtime.chat.prompt_ready', {
        traceId,
        sessionId,
        promptChars: promptForQuery.length,
        memoryInjectedChars: memoryDebug.injectedChars,
        memoryRetrievedCount: memoryDebug.retrievedCount,
        memoryManagedBySdk: memoryDebug.managedBySdk,
        contextBudget: contextBudgetSnapshot,
      })
      if (attachments.length > 0) {
        logger.info('runtime.chat.attachments_prepared', {
          traceId,
          sessionId,
          attachmentSummary,
        })
      }
      logger.info('runtime.chat.context_budget', {
        traceId,
        sessionId,
        phase: 'prompt_ready',
        contextBudget: contextBudgetSnapshot,
      })

      let sessionInUseDetected = false
      let activeRuntimeSessionId = runtimeSessionId
      let activeQuery: Query | null = null
      let sdkContextUsage: Record<string, unknown> | null = null
      let sdkContextUsageSampler = createSdkContextUsageSampler({
        traceId,
        sessionId,
        phase: 'stream_turn',
      })
      const sdkCompactEvents: Record<string, unknown>[] = []
      const captureRuntimeEvent = (event: Record<string, unknown>) => {
        if (event.type !== 'compact_boundary') return
        sdkCompactEvents.push({
          trigger: event.trigger,
          preTokens: event.preTokens,
          metadata: event.metadata,
          seenAt: new Date().toISOString(),
        })
        logger.info('runtime.chat.sdk_compact_boundary_seen', {
          traceId,
          sessionId,
          runtimeSessionId: activeRuntimeSessionId,
          trigger: event.trigger,
          preTokens: event.preTokens,
          metadata: event.metadata,
        })
      }
      const captureRuntimeMessage = async (msg: Record<string, unknown>) => {
        if (!activeQuery) return
        if (msg.type === 'result') {
          sdkContextUsage = await sdkContextUsageSampler.flush() ?? sdkContextUsage
          return
        }
        sdkContextUsageSampler.sample(activeQuery)
        sdkContextUsage = sdkContextUsageSampler.latest() ?? sdkContextUsage
      }
      const q = createLoomQuery({
        prompt: promptForQuery,
        sessionId: runtimeSessionId,
        model: resolvedModel,
        abortController,
        canUseTool,
        askUserQuestionHook,
        bypassPermissions: permissionMode === 'full' || permissionMode === 'plan',
        resumeSession: isResume,
        thinkingMode,
        attachments: attachments.length > 0 ? attachments : undefined,
        enabledSkills,
        additionalDirectories: attachedFolderPaths,
        planMode,
        useWorktree: session.use_worktree === 1,
        projectWorkspacePath: primaryWorkspacePath,
        providerIdOverride: projectProviderId,
        onSessionInUse: () => { sessionInUseDetected = true },
      })
      activeQuery = q

      let needsFallback = false
      try {
        await drainQuery(q, mapper, emit, captureRuntimeEvent, captureRuntimeMessage)
        if (sessionInUseDetected || (isResume && mapper.getBlocks().length === 0)) {
          needsFallback = true
          logger.warn('runtime.chat.fallback_needed', {
            traceId,
            sessionId,
            reason: 'session_in_use_or_zero_blocks',
            isResume,
          })
        }
      } catch (queryErr) {
        const errMsg = queryErr instanceof Error ? queryErr.message : String(queryErr)
        const isSessionInUse = sessionInUseDetected || errMsg.includes('already in use')
        const isResumeFailure = isResume && mapper.getBlocks().length === 0
        if (!isResumeFailure && !isSessionInUse) throw queryErr
        needsFallback = true
        logger.warn('runtime.chat.fallback_needed', {
          traceId,
          sessionId,
          reason: errMsg,
          isResume,
        })
      }

      if (needsFallback) {
        const recentMsgs = db
          .prepare('SELECT role, content FROM messages WHERE session_id = ? AND context_version = ? AND id != ? ORDER BY created_at ASC')
          .all(sessionId, currentContextVersion, userMsgId) as Array<{ role: string; content: string }>
        const fallbackHistory = buildFallbackHistory({
          currentMessage: effectiveMessage,
          recentMessages: recentMsgs,
        })
        let historyPrompt = sdkSkillCommand ? effectiveMessage : fallbackHistory.prompt
        if (!sdkSkillCommand && existingMsgCount === 0 && latestBoundary?.summary && latestBoundary.compact_source !== 'sdk') {
          historyPrompt = `<context_summary>\n${latestBoundary.summary}\n</context_summary>\n\n${historyPrompt}`
        }
        const fallbackMemoryContext = buildLoomMemoryContext({
          userMessage: effectiveMessage,
          workspacePath: primaryWorkspacePath,
          mode: 'sdk',
        })
        memoryDebug = fallbackMemoryContext.debug
        if (!sdkSkillCommand && fallbackMemoryContext.evolutionSummary?.trim()) {
          historyPrompt = `<project_evolution_context>\n${fallbackMemoryContext.evolutionSummary.trim()}\n</project_evolution_context>\n\n${historyPrompt}`
        }
        contextBudgetSnapshot = {
          ...(contextBudgetSnapshot as ContextBudgetSnapshot),
          resumeSession: false,
          parts: (contextBudgetSnapshot?.parts || []).map(part =>
            part.key === 'recent_messages'
              ? {
                  ...part,
                  chars: fallbackHistory.historyChars,
                  count: fallbackHistory.selectedMessageCount,
                  truncated: fallbackHistory.truncated,
                  metadata: {
                    ...(part.metadata || {}),
                    resumeSession: false,
                    fallbackHistoryChars: fallbackHistory.historyChars,
                    fallbackHistoryMessageCount: fallbackHistory.selectedMessageCount,
                    fallbackHistoryTotalMessageCount: fallbackHistory.totalMessageCount,
                    fallbackHistoryPolicy: fallbackHistory.policy,
                  },
                }
              : part.key === 'memory'
                ? summarizeMemoryContext(fallbackMemoryContext)
                : part.key === 'current_input'
                  ? {
                      ...part,
                      metadata: {
                        ...(part.metadata || {}),
                        promptForQueryChars: historyPrompt.length,
                      },
                    }
                  : part
          ),
        }
        logger.info('runtime.chat.fallback_prompt_ready', {
          traceId,
          sessionId,
          promptChars: historyPrompt.length,
          contextBudget: contextBudgetSnapshot,
        })
        logger.info('runtime.chat.context_budget', {
          traceId,
          sessionId,
          phase: 'fallback_prompt_ready',
          contextBudget: contextBudgetSnapshot,
        })
        mapper = new MessageMapper()
        sdkContextUsage = null
        sdkContextUsageSampler = createSdkContextUsageSampler({
          traceId,
          sessionId,
          phase: 'stream_fallback_turn',
        })
        const retryRuntimeSessionId = crypto.randomUUID()
        activeRuntimeSessionId = retryRuntimeSessionId
        const retryQ = createLoomQuery({
          prompt: historyPrompt,
          sessionId: retryRuntimeSessionId,
          model: session.model,
          abortController,
          canUseTool,
          askUserQuestionHook,
          bypassPermissions: permissionMode === 'full' || permissionMode === 'plan',
          resumeSession: false,
          thinkingMode,
          enabledSkills,
          additionalDirectories: attachedFolderPaths,
          planMode,
          useWorktree: session.use_worktree === 1,
          projectWorkspacePath: primaryWorkspacePath,
          providerIdOverride: projectProviderId,
        })
        activeQuery = retryQ
        await drainQuery(retryQ, mapper, emit, captureRuntimeEvent, captureRuntimeMessage)
      }
      if (runtimeProviderChanged || !session.runtime_provider_id || !session.runtime_model_id || activeRuntimeSessionId !== session.runtime_session_id) {
        db.prepare(
          `UPDATE sessions SET runtime_session_id = ?, runtime_provider_id = ?, runtime_model_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
        ).run(activeRuntimeSessionId, turnProviderId, turnModelId, sessionId)
      }

      sdkContextUsage = await sdkContextUsageSampler.flush() ?? sdkContextUsage

      const blocks = mapper.getBlocks()
      const elapsedSeconds = Math.floor((Date.now() - requestStart) / 1000)

      // Truncate large tool results before storage. SDK context remains SDK-managed;
      // this policy only controls Loom DB/UI storage and follow-up fallback prompts.
      const toolStorage = summarizeToolResultStorage(blocks)
      const storableBlocks = blocks.map((b: Record<string, unknown>) => {
        if (b.type === 'tool_raw_result') return null
        if (b.type === 'tool_result' && typeof b.content === 'string' && b.content.length > STORED_TOOL_RESULT_MAX_CHARS) {
          return { ...b, content: (b.content as string).slice(0, STORED_TOOL_RESULT_MAX_CHARS) + '\n[...truncated]' }
        }
        return b
      }).filter(Boolean)
      contextBudgetSnapshot = contextBudgetSnapshot ? {
        ...contextBudgetSnapshot,
        parts: contextBudgetSnapshot.parts.map(part =>
          part.key === 'tool_results'
            ? {
                ...part,
                chars: toolStorage.storedChars,
                count: toolStorage.toolResultCount,
                truncated: toolStorage.truncatedCount > 0,
                metadata: toolStorage,
              }
            : part
        ),
      } : null

      const assistantMsgId = confirmationStore.saveFinal(storableBlocks as Record<string, unknown>[], {
        elapsedSeconds,
        inputTokens: mapper.inputTokens,
        outputTokens: mapper.outputTokens,
        sdkContextUsage,
      })

      const msgCount = db.prepare(
        'SELECT COUNT(*) as count FROM messages WHERE session_id = ? AND context_version = ?'
      ).get(sessionId, currentContextVersion) as { count: number }
      const tsNow = `strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`
      if (msgCount.count <= 2) {
        const title = effectiveMessage.length > 50 ? effectiveMessage.slice(0, 47) + '...' : effectiveMessage
        db.prepare(`UPDATE sessions SET title = ?, updated_at = ${tsNow}, last_message_at = ${tsNow} WHERE id = ?`).run(title, sessionId)
        // Sync title to project
        db.prepare(`UPDATE projects SET updated_at = ${tsNow}, last_opened_at = ${tsNow} WHERE id = ?`).run(session.project_id)
      } else {
        db.prepare(`UPDATE sessions SET updated_at = ${tsNow}, last_message_at = ${tsNow} WHERE id = ?`).run(sessionId)
        db.prepare(`UPDATE projects SET updated_at = ${tsNow}, last_opened_at = ${tsNow} WHERE id = ?`).run(session.project_id)
      }

      let sdkCompactBoundary: Record<string, unknown> | null = null
      if (sdkCompactEvents.length > 0) {
        const latestSdkCompact = sdkCompactEvents[sdkCompactEvents.length - 1]
        const newContextVersion = currentContextVersion + 1
        const boundaryId = crypto.randomUUID()
        const compactMetadata = {
          ...((latestSdkCompact.metadata && typeof latestSdkCompact.metadata === 'object')
            ? latestSdkCompact.metadata as Record<string, unknown>
            : {}),
          loom: {
            fromContextVersion: currentContextVersion,
            toContextVersion: newContextVersion,
            compactSource: 'sdk',
            trigger: latestSdkCompact.trigger || 'auto',
            rowCount: msgCount.count,
            tokenStats: {
              inputTokens: mapper.inputTokens,
              outputTokens: mapper.outputTokens,
              totalTokens: mapper.inputTokens + mapper.outputTokens,
            },
            sdkContextUsage,
          },
          sdkCompactEvents,
        }
        db.transaction(() => {
          db.prepare(
            `INSERT INTO session_boundaries
              (id, session_id, boundary_type, from_runtime_session_id, to_runtime_session_id, summary, compact_source, metadata)
             VALUES (?, ?, 'compact', ?, ?, ?, 'sdk', ?)`
          ).run(
            boundaryId,
            sessionId,
            activeRuntimeSessionId,
            activeRuntimeSessionId,
            null,
            JSON.stringify(compactMetadata),
          )
          db.prepare(
            `UPDATE sessions SET
               context_version = ?,
               updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE id = ?`
          ).run(newContextVersion, sessionId)
        })()
        sdkCompactBoundary = {
          id: boundaryId,
          sessionId,
          boundaryType: 'compact',
          summary: null,
          compactSource: 'sdk',
          metadata: compactMetadata,
          createdAt: new Date().toISOString(),
          contextVersion: newContextVersion,
        }
        logger.info('runtime.chat.sdk_auto_compact_persisted', {
          traceId,
          sessionId,
          boundaryId,
          runtimeSessionId: activeRuntimeSessionId,
          fromContextVersion: currentContextVersion,
          toContextVersion: newContextVersion,
          eventCount: sdkCompactEvents.length,
          trigger: latestSdkCompact.trigger,
          preTokens: latestSdkCompact.preTokens,
          sdkContextUsage,
        })
      }

      let memoryCandidates = extractExplicitMemoryCandidates({
        userMessage: effectiveMessage,
        workspacePath: primaryWorkspacePath,
        sessionId,
      })
      if (memoryCandidates.length === 0 && isExplicitMemoryReferenceRequest(effectiveMessage)) {
        const recentRows = db.prepare(
          `SELECT role, content FROM messages
           WHERE session_id = ? AND context_version = ? AND id != ?
           ORDER BY created_at DESC
           LIMIT 10`
        ).all(sessionId, currentContextVersion, userMsgId) as Array<{ role: 'user' | 'assistant'; content: string }>
        const recentMessages = recentRows.reverse().map(row => ({
          role: row.role,
          text: messageContentToText(row.content),
        })).filter(m => m.text.trim().length > 0)
        memoryCandidates = await resolveExplicitMemoryReferenceWithLlm({
          sessionId,
          workspacePath: primaryWorkspacePath,
          userRequest: effectiveMessage,
          messages: recentMessages,
        })
      }

      await emit({
        type: 'done',
        messageId: assistantMsgId,
        ...(userMsgInserted ? { userMessageId: userMsgId } : {}),
        inputTokens: mapper.inputTokens,
        outputTokens: mapper.outputTokens,
        sdkContextUsage,
        sdkCompactBoundary,
        memory: memoryDebug,
        memoryCandidates: memoryCandidates.length,
      })
      logger.info('runtime.chat.done', {
        traceId,
        sessionId,
        assistantMsgId,
        inputTokens: mapper.inputTokens,
        outputTokens: mapper.outputTokens,
        totalTokens: mapper.inputTokens + mapper.outputTokens,
        elapsedSeconds,
        memoryCandidates: memoryCandidates.length,
        sdkContextUsage,
        sdkCompactBoundary,
        contextBudget: contextBudgetSnapshot ? {
          ...contextBudgetSnapshot,
          actual: {
            inputTokens: mapper.inputTokens,
            outputTokens: mapper.outputTokens,
            totalTokens: mapper.inputTokens + mapper.outputTokens,
          },
        } : null,
      })
    } catch (err) {
      const blocks = mapper.getBlocks()
      const assistantMsgId = confirmationStore.savePartial(blocks)
      if (!assistantMsgId && userMsgInserted) {
        // Only delete user message if we inserted it (don't delete pre-existing ones)
        db.prepare('DELETE FROM messages WHERE id = ?').run(userMsgId)
      }
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      logger.error('runtime.chat.error', err, {
        traceId,
        sessionId,
        userMsgInserted,
        blockCount: blocks.length,
      })
      await emit({ type: 'error', error: errorMessage })
    } finally {
      try { await writer.close() } catch { /* already closed */ }
    }
  })()

  req.signal.addEventListener('abort', () => {
    abortController.abort()
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function jsonError(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
