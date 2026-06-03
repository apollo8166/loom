import crypto from 'node:crypto'
import { getDb } from '@/shared/db/db'
import { recordEvolutionEvent } from './events'
import { addDays, daysSince, parseJsonList, preview, stableKey, stringifyList } from './text'
import type { SemanticMemory, SemanticMemoryStatus, SessionObservation } from './types'

function rowToSemanticMemory(row: Record<string, unknown>): SemanticMemory {
  return {
    id: String(row.id || ''),
    projectId: String(row.projectId || row.project_id || ''),
    workspacePath: String(row.workspacePath || row.workspace_path || ''),
    memoryKey: String(row.memoryKey || row.memory_key || ''),
    title: String(row.title || ''),
    content: String(row.content || ''),
    category: String(row.category || 'general'),
    status: (row.status || 'active') as SemanticMemoryStatus,
    confidence: Number(row.confidence || 0),
    strength: Number(row.strength || 0),
    occurrences: Number(row.occurrences || 0),
    evidenceIds: parseJsonList(String(row.evidenceIds || row.evidence_ids || '[]')),
    sourceObservationIds: parseJsonList(String(row.sourceObservationIds || row.source_observation_ids || '[]')),
    negativeEvidenceCount: Number(row.negativeEvidenceCount || row.negative_evidence_count || 0),
    confirmedByUser: Boolean(row.confirmedByUser ?? row.confirmed_by_user),
    staleScore: Number(row.staleScore || row.stale_score || 0),
    lastReinforcedAt: row.lastReinforcedAt || row.last_reinforced_at ? String(row.lastReinforcedAt || row.last_reinforced_at) : null,
    expiresAt: row.expiresAt || row.expires_at ? String(row.expiresAt || row.expires_at) : null,
    createdAt: String(row.createdAt || row.created_at || ''),
    updatedAt: String(row.updatedAt || row.updated_at || ''),
  }
}

export function getSemanticMemory(id: string): SemanticMemory | null {
  const row = getDb().prepare(`SELECT * FROM semantic_memories WHERE id = ?`).get(id) as Record<string, unknown> | undefined
  return row ? rowToSemanticMemory(row) : null
}

export function findSemanticMemoryByKey(params: {
  projectId?: string
  workspacePath?: string
  memoryKey: string
}): SemanticMemory | null {
  const row = getDb().prepare(
    `SELECT * FROM semantic_memories
     WHERE memory_key = ?
       AND (? = '' OR project_id = ?)
       AND (? = '' OR workspace_path = ?)
     ORDER BY updated_at DESC
     LIMIT 1`
  ).get(
    params.memoryKey,
    params.projectId || '',
    params.projectId || '',
    params.workspacePath || '',
    params.workspacePath || '',
  ) as Record<string, unknown> | undefined
  return row ? rowToSemanticMemory(row) : null
}

export function createSemanticMemory(params: {
  projectId?: string
  workspacePath: string
  memoryKey?: string
  title: string
  content: string
  category?: string
  confidence?: number
  strength?: number
  occurrences?: number
  evidenceIds?: string[]
  sourceObservationIds?: string[]
  status?: SemanticMemoryStatus
  confirmedByUser?: boolean
  expiresAt?: string
}): SemanticMemory {
  const id = `sem_${crypto.randomUUID().slice(0, 10)}`
  const memoryKey = params.memoryKey || `${params.category || 'general'}:${stableKey(params.content)}`
  getDb().prepare(
    `INSERT INTO semantic_memories
      (id, project_id, workspace_path, memory_key, title, content, category, status, confidence, strength,
       occurrences, evidence_ids, source_observation_ids, confirmed_by_user, last_reinforced_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), ?)`
  ).run(
    id,
    params.projectId || '',
    params.workspacePath,
    memoryKey,
    params.title,
    params.content,
    params.category || 'general',
    params.status || 'active',
    Math.max(0, Math.min(1, params.confidence ?? 0.72)),
    Math.max(0, params.strength ?? 0.55),
    Math.max(1, params.occurrences ?? 1),
    stringifyList(params.evidenceIds),
    stringifyList(params.sourceObservationIds),
    params.confirmedByUser ? 1 : 0,
    params.expiresAt || addDays(30),
  )
  const memory = getSemanticMemory(id)!
  recordEvolutionEvent({
    projectId: params.projectId,
    workspacePath: params.workspacePath,
    eventType: 'semantic_memory_created',
    entityType: 'semantic_memory',
    entityId: id,
    summary: preview(params.content),
    payload: { memory },
  })
  return memory
}

export function reinforceSemanticMemory(params: {
  id: string
  evidenceIds?: string[]
  sourceObservationIds?: string[]
  confidenceDelta?: number
  strengthDelta?: number
}): SemanticMemory {
  const memory = getSemanticMemory(params.id)
  if (!memory) throw new Error('Semantic memory not found')
  const evidenceIds = stringifyList([...memory.evidenceIds, ...(params.evidenceIds || [])])
  const sourceObservationIds = stringifyList([...memory.sourceObservationIds, ...(params.sourceObservationIds || [])])
  getDb().prepare(
    `UPDATE semantic_memories
     SET confidence = MIN(1, confidence + ?),
         strength = MIN(1, strength + ?),
         occurrences = occurrences + 1,
         evidence_ids = ?,
         source_observation_ids = ?,
         status = CASE WHEN status = 'stale' THEN 'active' ELSE status END,
         stale_score = 0,
         last_reinforced_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
         expires_at = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
     WHERE id = ?`
  ).run(
    params.confidenceDelta ?? 0.05,
    params.strengthDelta ?? 0.12,
    evidenceIds,
    sourceObservationIds,
    addDays(30),
    params.id,
  )
  const updated = getSemanticMemory(params.id)!
  recordEvolutionEvent({
    projectId: updated.projectId,
    workspacePath: updated.workspacePath,
    eventType: 'semantic_memory_reinforced',
    entityType: 'semantic_memory',
    entityId: updated.id,
    summary: updated.title || preview(updated.content),
    payload: { memory: updated },
  })
  return updated
}

export function promoteObservationGroup(params: {
  projectId?: string
  workspacePath: string
  observationKey: string
  observations: SessionObservation[]
}): SemanticMemory | null {
  const observations = params.observations.filter(observation => observation.status === 'active')
  if (observations.length < 2) return null
  const existing = findSemanticMemoryByKey({
    projectId: params.projectId,
    workspacePath: params.workspacePath,
    memoryKey: params.observationKey,
  })
  const evidenceIds = observations.flatMap(observation => observation.evidenceIds)
  const observationIds = observations.map(observation => observation.id)
  if (existing) {
    return reinforceSemanticMemory({
      id: existing.id,
      evidenceIds,
      sourceObservationIds: observationIds,
      confidenceDelta: 0.04,
      strengthDelta: 0.1,
    })
  }
  const first = observations[0]
  const confidence = Math.min(0.92, observations.reduce((sum, observation) => sum + observation.confidence, 0) / observations.length + 0.08)
  const strength = Math.min(0.88, 0.45 + observations.length * 0.12)
  return createSemanticMemory({
    projectId: params.projectId,
    workspacePath: params.workspacePath,
    memoryKey: params.observationKey,
    title: first.content.slice(0, 80),
    content: first.content,
    category: first.category,
    confidence,
    strength,
    occurrences: observations.length,
    evidenceIds,
    sourceObservationIds: observationIds,
    status: confidence >= 0.78 ? 'active' : 'candidate',
  })
}

export function listSemanticMemories(params: {
  projectId?: string
  workspacePath?: string
  statuses?: SemanticMemoryStatus[]
  limit?: number
}): SemanticMemory[] {
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
    `SELECT * FROM semantic_memories
     ${clause}
     ORDER BY
       CASE status WHEN 'active' THEN 0 WHEN 'candidate' THEN 1 WHEN 'stale' THEN 2 ELSE 3 END,
       strength DESC,
       updated_at DESC
     LIMIT ?`
  ).all(...values, params.limit || 100) as Array<Record<string, unknown>>
  return rows.map(rowToSemanticMemory)
}

export function decaySemanticMemories(params: {
  projectId?: string
  workspacePath?: string
  staleAfterDays?: number
  archiveAfterStaleScore?: number
}): { stale: number; archived: number } {
  const staleAfterDays = params.staleAfterDays || 30
  const archiveAfterStaleScore = params.archiveAfterStaleScore || 3
  const memories = listSemanticMemories({
    projectId: params.projectId,
    workspacePath: params.workspacePath,
    statuses: ['active', 'candidate', 'stale'],
    limit: 500,
  })
  let stale = 0
  let archived = 0
  for (const memory of memories) {
    const age = daysSince(memory.lastReinforcedAt || memory.updatedAt || memory.createdAt)
    if (age < staleAfterDays) continue
    const nextStaleScore = memory.staleScore + 1
    const nextStatus: SemanticMemoryStatus = nextStaleScore >= archiveAfterStaleScore ? 'archived' : 'stale'
    getDb().prepare(
      `UPDATE semantic_memories
       SET status = ?,
           stale_score = ?,
           strength = MAX(0, strength - 0.12),
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ?`
    ).run(nextStatus, nextStaleScore, memory.id)
    if (nextStatus === 'archived') archived += 1
    else stale += 1
    recordEvolutionEvent({
      projectId: memory.projectId,
      workspacePath: memory.workspacePath,
      eventType: nextStatus === 'archived' ? 'semantic_memory_archived' : 'semantic_memory_stale',
      entityType: 'semantic_memory',
      entityId: memory.id,
      summary: memory.title || preview(memory.content),
    })
  }
  return { stale, archived }
}
