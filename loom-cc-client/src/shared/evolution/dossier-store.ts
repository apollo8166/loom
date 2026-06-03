import crypto from 'node:crypto'
import { getDb } from '@/shared/db/db'
import { recordEvolutionEvent } from './events'
import { listProjectRules } from './rule-store'
import { listRecentObservations } from './observation-store'
import { listSemanticMemories } from './semantic-memory-store'
import { preview } from './text'
import type { ProjectDossier } from './types'

function rowToDossier(row: Record<string, unknown>): ProjectDossier {
  return {
    id: String(row.id || ''),
    projectId: String(row.projectId || row.project_id || ''),
    workspacePath: String(row.workspacePath || row.workspace_path || ''),
    version: Number(row.version || 1),
    summary: String(row.summary || ''),
    currentGoal: String(row.currentGoal || row.current_goal || ''),
    userPreferences: String(row.userPreferences || row.user_preferences || ''),
    stableRules: String(row.stableRules || row.stable_rules || ''),
    recentRisks: String(row.recentRisks || row.recent_risks || ''),
    repeatedIssues: String(row.repeatedIssues || row.repeated_issues || ''),
    deprecatedUnderstanding: String(row.deprecatedUnderstanding || row.deprecated_understanding || ''),
    nextSteps: String(row.nextSteps || row.next_steps || ''),
    source: String(row.source || 'deterministic'),
    tokenBudgetChars: Number(row.tokenBudgetChars || row.token_budget_chars || 1200),
    createdAt: String(row.createdAt || row.created_at || ''),
    updatedAt: String(row.updatedAt || row.updated_at || ''),
  }
}

export function getLatestProjectDossier(params: {
  projectId?: string
  workspacePath?: string
}): ProjectDossier | null {
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
  if (where.length === 0) return null
  const row = getDb().prepare(
    `SELECT * FROM project_dossiers
     WHERE ${where.join(' AND ')}
     ORDER BY version DESC, created_at DESC
     LIMIT 1`
  ).get(...values) as Record<string, unknown> | undefined
  return row ? rowToDossier(row) : null
}

function bulletLines(items: string[], max = 5): string {
  return items
    .filter(Boolean)
    .slice(0, max)
    .map(item => `- ${preview(item, 150)}`)
    .join('\n')
}

export function rebuildProjectDossierDeterministic(params: {
  projectId?: string
  workspacePath: string
  source?: string
}): ProjectDossier {
  const previous = getLatestProjectDossier(params)
  const activeRules = listProjectRules({ projectId: params.projectId, workspacePath: params.workspacePath, statuses: ['active'], limit: 8 })
  const staleRules = listProjectRules({ projectId: params.projectId, workspacePath: params.workspacePath, statuses: ['deprecated', 'superseded', 'paused'], limit: 8 })
  const memories = listSemanticMemories({ projectId: params.projectId, workspacePath: params.workspacePath, statuses: ['active', 'stale'], limit: 10 })
  const observations = listRecentObservations({ projectId: params.projectId, workspacePath: params.workspacePath, statuses: ['active'], limit: 8 })
  const risks = [
    ...memories.filter(memory => memory.category === 'risk').map(memory => memory.content),
    ...observations.filter(observation => observation.category === 'risk').map(observation => observation.content),
  ]
  const repeatedIssues = memories
    .filter(memory => memory.category === 'correction' || memory.category === 'feedback' || memory.occurrences >= 2)
    .map(memory => memory.content)
  const stableRules = [
    ...activeRules.map(rule => `[${rule.priority}] ${rule.rule}`),
    ...memories.filter(memory => memory.category !== 'risk').map(memory => memory.content),
  ]
  const summary = bulletLines([
    ...activeRules.slice(0, 4).map(rule => rule.rule),
    ...memories.slice(0, 5).map(memory => memory.content),
    ...observations.slice(0, 3).map(observation => observation.content),
  ], 10) || '- 暂无稳定项目理解。'
  const id = `dos_${crypto.randomUUID().slice(0, 10)}`
  const version = (previous?.version || 0) + 1
  getDb().prepare(
    `INSERT INTO project_dossiers
      (id, project_id, workspace_path, version, summary, current_goal, user_preferences, stable_rules,
       recent_risks, repeated_issues, deprecated_understanding, next_steps, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.projectId || '',
    params.workspacePath,
    version,
    summary,
    previous?.currentGoal || '',
    '',
    bulletLines(stableRules, 8),
    bulletLines(risks, 5),
    bulletLines(repeatedIssues, 6),
    bulletLines(staleRules.map(rule => rule.rule), 5),
    '',
    params.source || 'deterministic',
  )
  const dossier = getLatestProjectDossier(params)!
  recordEvolutionEvent({
    projectId: params.projectId,
    workspacePath: params.workspacePath,
    eventType: 'project_dossier_rebuilt',
    entityType: 'project_dossier',
    entityId: dossier.id,
    summary: `Project dossier v${dossier.version}`,
  })
  return dossier
}
