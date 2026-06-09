import crypto from 'node:crypto'
import { getDb } from '@/shared/db/db'
import { recordEvolutionEvent } from './events'
import { listProjectRules } from './rule-store'
import { listSemanticMemories } from './semantic-memory-store'
import { isSimilarText, normalizeText, preview } from './text'
import type { ProjectDossier } from './types'

const DOSSIER_SIMILARITY_THRESHOLD = 0.58

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

function dedupeSimilarItems(items: string[]): string[] {
  const kept: string[] = []
  for (const item of items) {
    const content = stripBulletPrefix(item)
    if (!content) continue
    if (kept.some(existing => isSimilarText(content, existing, DOSSIER_SIMILARITY_THRESHOLD))) continue
    kept.push(content)
  }
  return kept
}

function bulletLines(items: string[], max = 5): string {
  return dedupeSimilarItems(items)
    .slice(0, max)
    .map(item => `- ${preview(item, 150)}`)
    .join('\n')
}

function stripBulletPrefix(line: string): string {
  return line.replace(/^\s*[-*]\s+/, '').trim()
}

function removeLinesCoveredBy(summary: string, sectionText: string): string {
  const corpus = normalizeText(sectionText)
  if (!corpus) return summary
  const sectionLines = sectionText
    .split(/\r?\n/)
    .map(stripBulletPrefix)
    .filter(Boolean)
  return summary
    .split(/\r?\n/)
    .filter(line => {
      const content = stripBulletPrefix(line)
      if (!content) return false
      const normalized = normalizeText(content)
      return !normalized || (
        !corpus.includes(normalized) &&
        !sectionLines.some(sectionLine => isSimilarText(content, sectionLine, DOSSIER_SIMILARITY_THRESHOLD))
      )
    })
    .join('\n')
}

export function cleanProjectDossier(dossier: ProjectDossier | null): ProjectDossier | null {
  if (!dossier) return null
  const sectionText = [
    dossier.recentRisks,
    dossier.deprecatedUnderstanding,
    dossier.nextSteps,
  ].filter(Boolean).join('\n')
  const summary = removeLinesCoveredBy(dossier.summary, sectionText)
  return {
    ...dossier,
    summary: bulletLines(summary.split(/\r?\n/), 20) || '- 暂无稳定项目理解。',
    stableRules: bulletLines(dossier.stableRules.split(/\r?\n/), 20),
    recentRisks: bulletLines(dossier.recentRisks.split(/\r?\n/), 20),
    repeatedIssues: bulletLines(dossier.repeatedIssues.split(/\r?\n/), 20),
    deprecatedUnderstanding: bulletLines(dossier.deprecatedUnderstanding.split(/\r?\n/), 20),
  }
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
  const stableMemories = memories.filter(memory => memory.category !== 'risk')
  const risks = [
    ...memories.filter(memory => memory.category === 'risk').map(memory => memory.content),
  ]
  const repeatedIssues = memories
    .filter(memory => memory.category === 'correction' || memory.category === 'feedback' || memory.occurrences >= 2)
    .map(memory => memory.content)
  const stableRules = [
    ...activeRules.map(rule => `[${rule.priority}] ${rule.rule}`),
    ...stableMemories.map(memory => memory.content),
  ]
  const summary = bulletLines([
    ...activeRules.slice(0, 4).map(rule => rule.rule),
    ...stableMemories.slice(0, 5).map(memory => memory.content),
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

export function createProjectDossierVersion(params: {
  projectId?: string
  workspacePath: string
  source: string
  summary?: string
  currentGoal?: string
  userPreferences?: string
  stableRules?: string
  recentRisks?: string
  repeatedIssues?: string
  deprecatedUnderstanding?: string
  nextSteps?: string
}): ProjectDossier {
  const previous = getLatestProjectDossier(params)
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
    params.summary ?? previous?.summary ?? '',
    params.currentGoal ?? previous?.currentGoal ?? '',
    params.userPreferences ?? previous?.userPreferences ?? '',
    params.stableRules ?? previous?.stableRules ?? '',
    params.recentRisks ?? previous?.recentRisks ?? '',
    params.repeatedIssues ?? previous?.repeatedIssues ?? '',
    params.deprecatedUnderstanding ?? previous?.deprecatedUnderstanding ?? '',
    params.nextSteps ?? previous?.nextSteps ?? '',
    params.source,
  )
  const dossier = cleanProjectDossier(getLatestProjectDossier(params))!
  recordEvolutionEvent({
    projectId: params.projectId,
    workspacePath: params.workspacePath,
    eventType: 'project_dossier_rewritten',
    entityType: 'project_dossier',
    entityId: dossier.id,
    summary: `Project dossier v${dossier.version}`,
  })
  return dossier
}
