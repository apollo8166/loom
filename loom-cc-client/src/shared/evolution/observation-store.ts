import crypto from 'node:crypto'
import { getDb } from '@/shared/db/db'
import { recordEvolutionEvent } from './events'
import { addDays, parseJsonList, preview, stableKey, stringifyList } from './text'
import type { ObservationStatus, SessionObservation } from './types'

function rowToObservation(row: Record<string, unknown>): SessionObservation {
  return {
    id: String(row.id || ''),
    projectId: String(row.projectId || row.project_id || ''),
    sessionId: String(row.sessionId || row.session_id || ''),
    workspacePath: String(row.workspacePath || row.workspace_path || ''),
    observationKey: String(row.observationKey || row.observation_key || ''),
    category: String(row.category || 'general'),
    content: String(row.content || ''),
    confidence: Number(row.confidence || 0),
    status: (row.status || 'active') as ObservationStatus,
    evidenceIds: parseJsonList(String(row.evidenceIds || row.evidence_ids || '[]')),
    sourceTrigger: String(row.sourceTrigger || row.source_trigger || ''),
    expiresAt: row.expiresAt || row.expires_at ? String(row.expiresAt || row.expires_at) : null,
    createdAt: String(row.createdAt || row.created_at || ''),
    updatedAt: String(row.updatedAt || row.updated_at || ''),
  }
}

export function createObservation(params: {
  projectId?: string
  sessionId: string
  workspacePath: string
  observationKey?: string
  category?: string
  content: string
  confidence: number
  evidenceIds?: string[]
  sourceTrigger?: string
  expiresAt?: string
  status?: ObservationStatus
}): SessionObservation | null {
  const content = params.content.trim()
  if (!content) return null
  const id = `obs_${crypto.randomUUID().slice(0, 10)}`
  const key = params.observationKey || `${params.category || 'general'}:${stableKey(content)}`
  getDb().prepare(
    `INSERT INTO session_observations
      (id, project_id, session_id, workspace_path, observation_key, category, content, confidence, status,
       evidence_ids, source_trigger, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.projectId || '',
    params.sessionId,
    params.workspacePath,
    key,
    params.category || 'general',
    content,
    Math.max(0, Math.min(1, params.confidence)),
    params.status || 'active',
    stringifyList(params.evidenceIds),
    params.sourceTrigger || '',
    params.expiresAt || addDays(14),
  )
  const observation = getObservation(id)
  if (observation) {
    recordEvolutionEvent({
      projectId: params.projectId,
      sessionId: params.sessionId,
      workspacePath: params.workspacePath,
      eventType: 'observation_recorded',
      trigger: params.sourceTrigger,
      entityType: 'session_observation',
      entityId: id,
      summary: preview(content),
      payload: { observation },
    })
  }
  return observation
}

export function getObservation(id: string): SessionObservation | null {
  const row = getDb().prepare(`SELECT * FROM session_observations WHERE id = ?`).get(id) as Record<string, unknown> | undefined
  return row ? rowToObservation(row) : null
}

export function listRecentObservations(params: {
  projectId?: string
  workspacePath?: string
  statuses?: ObservationStatus[]
  limit?: number
}): SessionObservation[] {
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
  if (params.statuses?.length) {
    where.push(`status IN (${params.statuses.map(() => '?').join(', ')})`)
    values.push(...params.statuses)
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const rows = getDb().prepare(
    `SELECT * FROM session_observations
     ${clause}
     ORDER BY created_at DESC
     LIMIT ?`
  ).all(...values, params.limit || 50) as Array<Record<string, unknown>>
  return rows.map(rowToObservation)
}

export function listObservationGroupsReadyForPromotion(params: {
  projectId?: string
  workspacePath?: string
  minOccurrences?: number
  limit?: number
}): Array<{ observationKey: string; count: number; observations: SessionObservation[] }> {
  const where: string[] = [`status = 'active'`]
  const values: unknown[] = []
  if (params.projectId) {
    where.push('project_id = ?')
    values.push(params.projectId)
  }
  if (params.workspacePath) {
    where.push('workspace_path = ?')
    values.push(params.workspacePath)
  }
  const minOccurrences = params.minOccurrences || 2
  const rows = getDb().prepare(
    `SELECT observation_key AS observationKey, COUNT(*) AS count
     FROM session_observations
     WHERE ${where.join(' AND ')}
     GROUP BY observation_key
     HAVING COUNT(*) >= ?
     ORDER BY COUNT(*) DESC, MAX(created_at) DESC
     LIMIT ?`
  ).all(...values, minOccurrences, params.limit || 20) as Array<{ observationKey: string; count: number }>

  return rows.map(row => ({
    observationKey: row.observationKey,
    count: Number(row.count || 0),
    observations: (getDb().prepare(
      `SELECT * FROM session_observations
       WHERE observation_key = ? AND status = 'active'
         ${params.projectId ? 'AND project_id = ?' : ''}
         ${params.workspacePath ? 'AND workspace_path = ?' : ''}
       ORDER BY created_at ASC
       LIMIT 20`
    ).all(
      row.observationKey,
      ...(params.projectId ? [params.projectId] : []),
      ...(params.workspacePath ? [params.workspacePath] : []),
    ) as Array<Record<string, unknown>>).map(rowToObservation),
  }))
}

export function markObservations(params: {
  ids: string[]
  status: ObservationStatus
}) {
  if (params.ids.length === 0) return
  const update = getDb().prepare(
    `UPDATE session_observations
     SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
     WHERE id = ?`
  )
  const tx = getDb().transaction((ids: string[]) => {
    for (const id of ids) update.run(params.status, id)
  })
  tx(params.ids)
}
