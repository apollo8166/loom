import crypto from 'crypto'
import { getDb } from '@/shared/db/db'

export function logImAudit(params: {
  channelId?: string
  chatId?: string
  projectId?: string
  sessionId?: string
  action: string
  status?: string
  details?: Record<string, unknown>
}) {
  try {
    getDb().prepare(
      `INSERT INTO im_audit_logs (id, channel_id, chat_id, project_id, session_id, action, status, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      params.channelId ?? '',
      params.chatId ?? '',
      params.projectId ?? '',
      params.sessionId ?? '',
      params.action,
      params.status ?? 'ok',
      JSON.stringify(params.details ?? {}),
    )
  } catch {
    // Audit logging must never break message processing.
  }
}
