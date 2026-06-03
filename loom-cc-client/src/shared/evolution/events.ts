import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getDb } from '@/shared/db/db'
import { logger } from '@/shared/logging/logger'
import { getMemoryDirForScope } from '@/shared/memory/paths'
import type { EvolutionTrigger } from './types'

function appendEvolutionLogFile(params: {
  workspacePath?: string
  eventType: string
  summary?: string
  entityType?: string
  entityId?: string
}) {
  if (!params.workspacePath) return
  if (
    params.eventType === 'gate_evaluated' ||
    params.eventType === 'evolution_run_completed' ||
    params.eventType === 'memory_candidate_duplicate_skipped'
  ) return
  try {
    const dir = getMemoryDirForScope('project', params.workspacePath)
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, 'evolution-log.md')
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '# Evolution Log\n\n', 'utf8')
    const line = [
      `## ${new Date().toISOString()} · ${params.eventType}`,
      '',
      params.summary || '',
      params.entityType || params.entityId ? `> ${[params.entityType, params.entityId].filter(Boolean).join(':')}` : '',
      '',
    ].filter(Boolean).join('\n')
    fs.appendFileSync(filePath, `${line}\n`, 'utf8')
  } catch (err) {
    logger.warn('evolution.event.file_append_failed', {
      workspacePath: params.workspacePath,
      eventType: params.eventType,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export function recordEvolutionEvent(params: {
  projectId?: string
  sessionId?: string
  workspacePath?: string
  eventType: string
  trigger?: EvolutionTrigger | string
  entityType?: string
  entityId?: string
  summary?: string
  payload?: Record<string, unknown>
  rollbackPayload?: Record<string, unknown>
}) {
  const id = crypto.randomUUID()
  const payload = params.payload ? JSON.stringify(params.payload) : ''
  const rollbackPayload = params.rollbackPayload ? JSON.stringify(params.rollbackPayload) : ''
  try {
    getDb().prepare(
      `INSERT INTO evolution_events
        (id, project_id, session_id, workspace_path, event_type, trigger, entity_type, entity_id, summary, payload, rollback_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      params.projectId || '',
      params.sessionId || '',
      params.workspacePath || '',
      params.eventType,
      params.trigger || '',
      params.entityType || '',
      params.entityId || '',
      params.summary || '',
      payload,
      rollbackPayload,
    )
  } catch (err) {
    logger.warn('evolution.event.record_failed', {
      eventType: params.eventType,
      entityType: params.entityType,
      entityId: params.entityId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  appendEvolutionLogFile({
    workspacePath: params.workspacePath,
    eventType: params.eventType,
    summary: params.summary,
    entityType: params.entityType,
    entityId: params.entityId,
  })
  return id
}

export function readEvolutionEvents(params: {
  projectId?: string
  workspacePath?: string
  limit?: number
}) {
  const where: string[] = []
  const values: string[] = []
  if (params.projectId) {
    where.push('project_id = ?')
    values.push(params.projectId)
  }
  if (params.workspacePath) {
    where.push('workspace_path = ?')
    values.push(params.workspacePath)
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  return getDb().prepare(
    `SELECT id,
            project_id AS projectId,
            session_id AS sessionId,
            workspace_path AS workspacePath,
            event_type AS eventType,
            trigger,
            entity_type AS entityType,
            entity_id AS entityId,
            summary,
            payload,
            rollback_payload AS rollbackPayload,
            created_at AS createdAt
     FROM evolution_events
     ${clause}
     ORDER BY created_at DESC
     LIMIT ?`
  ).all(...values, params.limit || 50) as Array<{
    id: string
    projectId: string
    sessionId: string
    workspacePath: string
    eventType: string
    trigger: string
    entityType: string
    entityId: string
    summary: string
    payload: string
    rollbackPayload: string
    createdAt: string
  }>
}
