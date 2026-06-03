import crypto from 'node:crypto'
import { getDb } from '@/shared/db/db'
import { addDays, preview, stableKey } from './text'
import { recordEvolutionEvent } from './events'
import type { NegativePrior } from './types'

function rowToNegativePrior(row: Record<string, unknown>): NegativePrior {
  return {
    id: String(row.id || ''),
    projectId: String(row.projectId || row.project_id || ''),
    workspacePath: String(row.workspacePath || row.workspace_path || ''),
    priorKey: String(row.priorKey || row.prior_key || ''),
    content: String(row.content || ''),
    sourceEntityType: String(row.sourceEntityType || row.source_entity_type || ''),
    sourceEntityId: String(row.sourceEntityId || row.source_entity_id || ''),
    strength: Number(row.strength || 0),
    expiresAt: row.expiresAt || row.expires_at ? String(row.expiresAt || row.expires_at) : null,
    createdAt: String(row.createdAt || row.created_at || ''),
  }
}

export function createNegativePrior(params: {
  projectId?: string
  workspacePath: string
  content: string
  priorKey?: string
  sourceEntityType?: string
  sourceEntityId?: string
  strength?: number
  expiresAt?: string
}): NegativePrior {
  const id = `neg_${crypto.randomUUID().slice(0, 10)}`
  const priorKey = params.priorKey || stableKey(params.content)
  getDb().prepare(
    `INSERT INTO negative_priors
      (id, project_id, workspace_path, prior_key, content, source_entity_type, source_entity_id, strength, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.projectId || '',
    params.workspacePath,
    priorKey,
    params.content,
    params.sourceEntityType || '',
    params.sourceEntityId || '',
    params.strength ?? 1,
    params.expiresAt || addDays(90),
  )
  const prior = getDb().prepare(`SELECT * FROM negative_priors WHERE id = ?`).get(id) as Record<string, unknown>
  recordEvolutionEvent({
    projectId: params.projectId,
    workspacePath: params.workspacePath,
    eventType: 'negative_prior_created',
    entityType: 'negative_prior',
    entityId: id,
    summary: preview(params.content),
  })
  return rowToNegativePrior(prior)
}

export function listNegativePriors(params: {
  projectId?: string
  workspacePath?: string
  limit?: number
}): NegativePrior[] {
  const where: string[] = [`(expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`]
  const values: unknown[] = []
  if (params.projectId) {
    where.push('project_id = ?')
    values.push(params.projectId)
  }
  if (params.workspacePath) {
    where.push('workspace_path = ?')
    values.push(params.workspacePath)
  }
  const rows = getDb().prepare(
    `SELECT * FROM negative_priors
     WHERE ${where.join(' AND ')}
     ORDER BY strength DESC, created_at DESC
     LIMIT ?`
  ).all(...values, params.limit || 80) as Array<Record<string, unknown>>
  return rows.map(rowToNegativePrior)
}

export function hasNegativePrior(params: {
  projectId?: string
  workspacePath?: string
  content: string
}): boolean {
  const key = stableKey(params.content)
  return listNegativePriors({
    projectId: params.projectId,
    workspacePath: params.workspacePath,
    limit: 200,
  }).some(prior => prior.priorKey === key || params.content.includes(prior.content) || prior.content.includes(params.content))
}
