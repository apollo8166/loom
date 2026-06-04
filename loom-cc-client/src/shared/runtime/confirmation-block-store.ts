import crypto from 'crypto'
import type Database from 'better-sqlite3'
import { getDb } from '@/shared/db/db'
import type {
  AskUserQuestionAnnotations,
  AskUserQuestionAnswers,
  AskUserQuestionStatus,
  ContentBlock,
  PermissionStatus,
} from '@/shared/types'

export type PermissionDecisionForPersistence = 'allow' | 'allow_session' | 'deny' | 'timeout'
export type AskUserQuestionActionForPersistence = 'submit' | 'cancel' | 'timeout'

export type ConfirmationContentBlock = Extract<
  ContentBlock,
  { type: 'permission_request' | 'ask_user_question' }
>

export interface AskUserQuestionResponseForPersistence {
  action: AskUserQuestionActionForPersistence
  answers?: AskUserQuestionAnswers
  annotations?: AskUserQuestionAnnotations
}

interface FinalMessageStats {
  elapsedSeconds?: number
  inputTokens?: number
  outputTokens?: number
  sdkContextUsage?: Record<string, unknown> | null
}

export class ConfirmationDraftStore {
  private assistantMessageId: string | null = null
  private confirmationBlocks: ConfirmationContentBlock[] = []

  constructor(
    private readonly db: Database.Database,
    private readonly sessionId: string,
    private readonly contextVersion: number,
  ) {}

  get messageId(): string | null {
    return this.assistantMessageId
  }

  upsertPermissionRequest(block: Extract<ConfirmationContentBlock, { type: 'permission_request' }>): void {
    this.upsertConfirmationBlock(block)
  }

  resolvePermission(requestId: string, decision: PermissionDecisionForPersistence): boolean {
    const idx = this.confirmationBlocks.findIndex(
      block => block.type === 'permission_request' && block.requestId === requestId,
    )
    if (idx < 0) return false

    const block = this.confirmationBlocks[idx]
    if (block.type !== 'permission_request') return false
    this.confirmationBlocks[idx] = {
      ...block,
      status: permissionDecisionToStatus(decision),
    }
    this.persistDraft()
    return true
  }

  upsertAskUserQuestionRequest(block: Extract<ConfirmationContentBlock, { type: 'ask_user_question' }>): void {
    this.upsertConfirmationBlock(block)
  }

  resolveAskUserQuestion(requestId: string, response: AskUserQuestionResponseForPersistence): boolean {
    const idx = this.confirmationBlocks.findIndex(
      block => block.type === 'ask_user_question' && block.requestId === requestId,
    )
    if (idx < 0) return false

    const block = this.confirmationBlocks[idx]
    if (block.type !== 'ask_user_question') return false
    this.confirmationBlocks[idx] = {
      ...block,
      status: askUserQuestionActionToStatus(response.action),
      answers: response.answers ?? {},
      annotations: response.annotations ?? {},
    }
    this.persistDraft()
    return true
  }

  saveFinal(baseBlocks: Record<string, unknown>[], stats: FinalMessageStats = {}): string {
    const assistantMessageId = this.assistantMessageId ?? crypto.randomUUID()
    const finalBlocks = mergeConfirmationBlocks(baseBlocks, this.confirmationBlocks)
    const sdkContextUsage = stats.sdkContextUsage ? JSON.stringify(stats.sdkContextUsage) : ''

    if (this.assistantMessageId) {
      this.db.prepare(
        `UPDATE messages
         SET content = ?, elapsed_seconds = ?, input_tokens = ?, output_tokens = ?, sdk_context_usage = ?
         WHERE id = ?`,
      ).run(
        JSON.stringify(finalBlocks),
        stats.elapsedSeconds ?? 0,
        stats.inputTokens ?? 0,
        stats.outputTokens ?? 0,
        sdkContextUsage,
        assistantMessageId,
      )
    } else {
      this.db.prepare(
        `INSERT INTO messages
          (id, session_id, context_version, role, content, elapsed_seconds, input_tokens, output_tokens, sdk_context_usage)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        assistantMessageId,
        this.sessionId,
        this.contextVersion,
        'assistant',
        JSON.stringify(finalBlocks),
        stats.elapsedSeconds ?? 0,
        stats.inputTokens ?? 0,
        stats.outputTokens ?? 0,
        sdkContextUsage,
      )
      this.assistantMessageId = assistantMessageId
    }

    return assistantMessageId
  }

  savePartial(baseBlocks: Record<string, unknown>[]): string | null {
    const finalBlocks = mergeConfirmationBlocks(baseBlocks, this.confirmationBlocks)
    if (finalBlocks.length === 0) return null

    const assistantMessageId = this.assistantMessageId ?? crypto.randomUUID()
    if (this.assistantMessageId) {
      this.db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(
        JSON.stringify(finalBlocks),
        assistantMessageId,
      )
    } else {
      this.db.prepare(
        'INSERT INTO messages (id, session_id, context_version, role, content) VALUES (?, ?, ?, ?, ?)',
      ).run(
        assistantMessageId,
        this.sessionId,
        this.contextVersion,
        'assistant',
        JSON.stringify(finalBlocks),
      )
      this.assistantMessageId = assistantMessageId
    }

    return assistantMessageId
  }

  private upsertConfirmationBlock(block: ConfirmationContentBlock): void {
    const key = confirmationBlockKey(block)
    const idx = this.confirmationBlocks.findIndex(existing => confirmationBlockKey(existing) === key)
    if (idx >= 0) this.confirmationBlocks[idx] = block
    else this.confirmationBlocks.push(block)
    this.persistDraft()
  }

  private persistDraft(): void {
    this.ensureDraft()
    this.db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(
      JSON.stringify(this.confirmationBlocks),
      this.assistantMessageId,
    )
  }

  private ensureDraft(): void {
    if (this.assistantMessageId) return
    this.assistantMessageId = crypto.randomUUID()
    this.db.prepare(
      'INSERT INTO messages (id, session_id, context_version, role, content) VALUES (?, ?, ?, ?, ?)',
    ).run(
      this.assistantMessageId,
      this.sessionId,
      this.contextVersion,
      'assistant',
      JSON.stringify(this.confirmationBlocks),
    )
  }
}

export function permissionDecisionToStatus(decision: PermissionDecisionForPersistence): PermissionStatus {
  if (decision === 'allow') return 'allowed'
  if (decision === 'allow_session') return 'allowed_session'
  if (decision === 'timeout') return 'timeout'
  return 'denied'
}

export function askUserQuestionActionToStatus(action: AskUserQuestionActionForPersistence): AskUserQuestionStatus {
  if (action === 'submit') return 'submitted'
  if (action === 'timeout') return 'timeout'
  return 'cancelled'
}

export function mergeConfirmationBlocks(
  baseBlocks: Record<string, unknown>[],
  confirmationBlocks: ConfirmationContentBlock[],
): Record<string, unknown>[] {
  if (confirmationBlocks.length === 0) return baseBlocks

  const failedToolUseIds = new Set(
    baseBlocks
      .filter(block => block.type === 'tool_result' && block.is_error === true && typeof block.tool_use_id === 'string')
      .map(block => block.tool_use_id as string),
  )
  const normalizedConfirmations = confirmationBlocks.map(block => {
    if (block.type === 'permission_request' && block.toolUseId && failedToolUseIds.has(block.toolUseId)) {
      return { ...block, toolFailed: true }
    }
    return block
  })
  const confirmationsByKey = new Map(normalizedConfirmations.map(block => [confirmationBlockKey(block), block]))
  const placed = new Set<string>()
  const output: Record<string, unknown>[] = []

  for (const block of baseBlocks) {
    if (isConfirmationBlock(block)) {
      const key = confirmationBlockKey(block)
      output.push(confirmationsByKey.get(key) ?? block)
      placed.add(key)
      continue
    }

    output.push(block)

    if (block.type !== 'tool_use' || typeof block.id !== 'string') continue
    for (const confirmation of normalizedConfirmations) {
      if (confirmation.toolUseId !== block.id) continue
      const key = confirmationBlockKey(confirmation)
      if (placed.has(key)) continue
      output.push(confirmation)
      placed.add(key)
    }
  }

  for (const confirmation of normalizedConfirmations) {
    const key = confirmationBlockKey(confirmation)
    if (!placed.has(key)) output.push(confirmation)
  }

  return output
}

export function persistPermissionDecisionByRequestId(
  requestId: string,
  decision: PermissionDecisionForPersistence,
  sessionId?: string,
): boolean {
  return updateStoredConfirmationBlock(requestId, sessionId, block => {
    if (block.type !== 'permission_request') return null
    return { ...block, status: permissionDecisionToStatus(decision) }
  })
}

export function persistAskUserQuestionResponseByRequestId(
  requestId: string,
  response: AskUserQuestionResponseForPersistence,
  sessionId?: string,
): boolean {
  return updateStoredConfirmationBlock(requestId, sessionId, block => {
    if (block.type !== 'ask_user_question') return null
    return {
      ...block,
      status: askUserQuestionActionToStatus(response.action),
      answers: response.answers ?? {},
      annotations: response.annotations ?? {},
    }
  })
}

function updateStoredConfirmationBlock(
  requestId: string,
  sessionId: string | undefined,
  updater: (block: ConfirmationContentBlock) => ConfirmationContentBlock | null,
): boolean {
  try {
    const db = getDb()
    const rows = sessionId
      ? db.prepare(
          `SELECT id, content FROM messages
           WHERE session_id = ? AND role = 'assistant'
           ORDER BY created_at DESC
           LIMIT 100`,
        ).all(sessionId)
      : db.prepare(
          `SELECT id, content FROM messages
           WHERE role = 'assistant'
           ORDER BY created_at DESC
           LIMIT 200`,
        ).all()

    for (const row of rows as Array<{ id: string; content: string }>) {
      const blocks = parseStoredBlocks(row.content)
      let changed = false
      const nextBlocks = blocks.map(block => {
        if (!isConfirmationBlock(block) || block.requestId !== requestId) return block
        const updated = updater(block)
        if (!updated) return block
        changed = true
        return updated
      })

      if (!changed) continue
      db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(JSON.stringify(nextBlocks), row.id)
      return true
    }
  } catch {
    return false
  }

  return false
}

function parseStoredBlocks(content: string): Record<string, unknown>[] {
  try {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed)) return parsed.filter(isRecord)
  } catch {
    return []
  }
  return []
}

function isConfirmationBlock(block: unknown): block is ConfirmationContentBlock {
  if (!isRecord(block)) return false
  return (
    (block.type === 'permission_request' || block.type === 'ask_user_question') &&
    typeof block.requestId === 'string'
  )
}

function confirmationBlockKey(block: ConfirmationContentBlock): string {
  return `${block.type}:${block.requestId}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
