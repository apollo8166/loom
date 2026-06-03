import crypto from 'node:crypto'
import { getDb } from '@/shared/db/db'
import { recordEvolutionEvent } from './events'
import { parseJsonObject, preview } from './text'
import type { FactRecord, MessageSnippet } from './types'

function rowToFact(row: Record<string, unknown>): FactRecord {
  return {
    id: String(row.id || ''),
    projectId: String(row.projectId || row.project_id || ''),
    sessionId: String(row.sessionId || row.session_id || ''),
    workspacePath: String(row.workspacePath || row.workspace_path || ''),
    sourceType: String(row.sourceType || row.source_type || ''),
    sourceId: String(row.sourceId || row.source_id || ''),
    kind: String(row.kind || ''),
    role: String(row.role || ''),
    content: String(row.content || ''),
    contentHash: String(row.contentHash || row.content_hash || ''),
    metadata: parseJsonObject(String(row.metadata || '')),
    createdAt: String(row.createdAt || row.created_at || ''),
  }
}

function contentHash(params: {
  role?: string
  content: string
  sourceId?: string
}): string {
  return crypto
    .createHash('sha256')
    .update(`${params.role || ''}\n${params.sourceId || ''}\n${params.content.trim()}`)
    .digest('hex')
    .slice(0, 32)
}

export function recordFact(params: {
  projectId?: string
  sessionId?: string
  workspacePath?: string
  sourceType?: string
  sourceId?: string
  kind?: string
  role?: string
  content: string
  metadata?: Record<string, unknown>
}): FactRecord | null {
  const content = params.content.trim()
  if (!content) return null
  const id = `fact_${crypto.randomUUID().slice(0, 10)}`
  const hash = contentHash({ role: params.role, content, sourceId: params.sourceId })
  const result = getDb().prepare(
    `INSERT OR IGNORE INTO fact_records
      (id, project_id, session_id, workspace_path, source_type, source_id, kind, role, content, content_hash, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.projectId || '',
    params.sessionId || '',
    params.workspacePath || '',
    params.sourceType || 'message',
    params.sourceId || '',
    params.kind || 'message',
    params.role || '',
    content,
    hash,
    params.metadata ? JSON.stringify(params.metadata) : '',
  )
  if (result.changes === 0) return null
  recordEvolutionEvent({
    projectId: params.projectId,
    sessionId: params.sessionId,
    workspacePath: params.workspacePath,
    eventType: 'fact_recorded',
    trigger: String(params.metadata?.trigger || ''),
    entityType: 'fact_record',
    entityId: id,
    summary: preview(content),
  })
  const row = getDb().prepare(`SELECT * FROM fact_records WHERE id = ?`).get(id) as Record<string, unknown> | undefined
  return row ? rowToFact(row) : null
}

export function recordMessageFacts(params: {
  projectId?: string
  sessionId: string
  workspacePath: string
  messages: MessageSnippet[]
  trigger?: string
}): FactRecord[] {
  const facts: FactRecord[] = []
  for (const message of params.messages) {
    const fact = recordFact({
      projectId: params.projectId,
      sessionId: params.sessionId,
      workspacePath: params.workspacePath,
      sourceType: 'message',
      sourceId: message.messageId || '',
      kind: 'message',
      role: message.role,
      content: message.text,
      metadata: {
        trigger: params.trigger,
        createdAt: message.createdAt,
      },
    })
    if (fact) facts.push(fact)
  }
  return facts
}

export function listFactRecords(params: {
  projectId?: string
  workspacePath?: string
  limit?: number
}): FactRecord[] {
  const where: string[] = []
  const values: unknown[] = []
  if (params.projectId) {
    where.push('project_id = ?')
    values.push(params.projectId)
  }
  if (params.workspacePath) {
    where.push('workspace_path = ?')
    values.push(params.workspacePath)
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const rows = getDb().prepare(
    `SELECT * FROM fact_records
     ${clause}
     ORDER BY created_at DESC
     LIMIT ?`
  ).all(...values, params.limit || 80) as Array<Record<string, unknown>>
  return rows.map(rowToFact)
}
