import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { getDb } from '@/shared/db/db'
import { ensureClaudeMemory } from '@/shared/memory/files'
import { getClaudeFileForScope, getMemoryDirForScope } from '@/shared/memory/paths'
import { logger } from '@/shared/logging/logger'
import { recordEvolutionEvent } from './events'
import { addDays, daysSince } from './text'
import { createNegativePrior } from './negative-priors'
import type {
  ProjectRule,
  ProjectRuleImpact,
  ProjectRulePriority,
  ProjectRuleRisk,
  ProjectRuleScope,
  ProjectRuleStatus,
} from './types'

const RULES_IMPORT_START = '<!-- LOOM_PROJECT_RULES_START -->'
const RULES_IMPORT_END = '<!-- LOOM_PROJECT_RULES_END -->'

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function stringifyList(values: string[] | undefined): string {
  return JSON.stringify(values || [])
}

function resolveProjectIdForWorkspace(workspacePath: string, projectId?: string): string {
  if (projectId) return projectId
  const row = getDb().prepare(
    `SELECT id FROM projects WHERE workspace_path = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1`
  ).get(workspacePath) as { id: string } | undefined
  return row?.id || ''
}

function rowToProjectRule(row: Record<string, unknown>): ProjectRule {
  return {
    id: String(row.id || ''),
    projectId: String(row.projectId || row.project_id || ''),
    workspacePath: String(row.workspacePath || row.workspace_path || ''),
    title: String(row.title || ''),
    rule: String(row.rule || ''),
    rationale: String(row.rationale || ''),
    scope: (row.scope || 'project') as ProjectRuleScope,
    priority: (row.priority || 'medium') as ProjectRulePriority,
    impact: (row.impact || 'medium') as ProjectRuleImpact,
    risk: (row.risk || 'medium') as ProjectRuleRisk,
    status: (row.status || 'candidate') as ProjectRuleStatus,
    evidenceIds: parseJsonArray(String(row.evidenceIds || row.evidence_ids || '[]')),
    promotedFromIds: parseJsonArray(String(row.promotedFromIds || row.promoted_from_ids || '[]')),
    conflictsWith: parseJsonArray(String(row.conflictsWith || row.conflicts_with || '[]')),
    supersedes: parseJsonArray(String(row.supersedes || '[]')),
    confidence: Number(row.confidence || 0),
    strength: Number(row.strength || 0),
    occurrences: Number(row.occurrences || 0),
    appliedCount: Number(row.appliedCount || row.applied_count || 0),
    successCount: Number(row.successCount || row.success_count || 0),
    conflictCount: Number(row.conflictCount || row.conflict_count || 0),
    negativeEvidenceCount: Number(row.negativeEvidenceCount || row.negative_evidence_count || 0),
    staleScore: Number(row.staleScore || row.stale_score || 0),
    tokenImpact: Number(row.tokenImpact || row.token_impact || 0),
    userConfirmed: Boolean(row.userConfirmed ?? row.user_confirmed),
    needsUserConfirmation: Boolean(row.needsUserConfirmation ?? row.needs_user_confirmation),
    createdBySkill: String(row.createdBySkill || row.created_by_skill || ''),
    createdAt: String(row.createdAt || row.created_at || ''),
    updatedAt: String(row.updatedAt || row.updated_at || ''),
    lastAppliedAt: row.lastAppliedAt || row.last_applied_at ? String(row.lastAppliedAt || row.last_applied_at) : null,
    lastReinforcedAt: row.lastReinforcedAt || row.last_reinforced_at ? String(row.lastReinforcedAt || row.last_reinforced_at) : null,
    expiresAt: row.expiresAt || row.expires_at ? String(row.expiresAt || row.expires_at) : null,
  }
}

export function listProjectRules(params: {
  projectId?: string
  workspacePath?: string
  statuses?: ProjectRuleStatus[]
  limit?: number
}): ProjectRule[] {
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
  if (params.statuses && params.statuses.length > 0) {
    where.push(`status IN (${params.statuses.map(() => '?').join(', ')})`)
    values.push(...params.statuses)
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const rows = getDb().prepare(
    `SELECT id,
            project_id AS projectId,
            workspace_path AS workspacePath,
            title,
            rule,
            rationale,
            scope,
            priority,
            impact,
            risk,
            status,
            evidence_ids AS evidenceIds,
            promoted_from_ids AS promotedFromIds,
            conflicts_with AS conflictsWith,
            supersedes,
            confidence,
            strength,
            occurrences,
            applied_count AS appliedCount,
            success_count AS successCount,
            conflict_count AS conflictCount,
            negative_evidence_count AS negativeEvidenceCount,
            stale_score AS staleScore,
            token_impact AS tokenImpact,
            user_confirmed AS userConfirmed,
            needs_user_confirmation AS needsUserConfirmation,
            created_by_skill AS createdBySkill,
            created_at AS createdAt,
            updated_at AS updatedAt,
            last_applied_at AS lastAppliedAt,
            last_reinforced_at AS lastReinforcedAt,
            expires_at AS expiresAt
     FROM project_rules
     ${clause}
     ORDER BY
       CASE status WHEN 'active' THEN 0 WHEN 'shadow' THEN 1 WHEN 'candidate' THEN 2 ELSE 3 END,
       CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       updated_at DESC
     LIMIT ?`
  ).all(...values, params.limit || 200) as Array<Record<string, unknown>>
  return rows.map(rowToProjectRule)
}

export function getProjectRule(id: string): ProjectRule | null {
  const row = getDb().prepare(
    `SELECT * FROM project_rules WHERE id = ?`
  ).get(id) as Record<string, unknown> | undefined
  return row ? rowToProjectRule(row) : null
}

export function createProjectRule(params: {
  projectId?: string
  workspacePath: string
  title: string
  rule: string
  rationale?: string
  scope?: ProjectRuleScope
  priority?: ProjectRulePriority
  impact?: ProjectRuleImpact
  risk?: ProjectRuleRisk
  status?: ProjectRuleStatus
  evidenceIds?: string[]
  promotedFromIds?: string[]
  conflictsWith?: string[]
  supersedes?: string[]
  confidence?: number
  strength?: number
  occurrences?: number
  needsUserConfirmation?: boolean
  userConfirmed?: boolean
  createdBySkill?: string
}): ProjectRule {
  const id = `rule_${crypto.randomUUID().slice(0, 8)}`
  const status = params.status || 'candidate'
  const projectId = resolveProjectIdForWorkspace(params.workspacePath, params.projectId)
  getDb().prepare(
    `INSERT INTO project_rules
      (id, project_id, workspace_path, title, rule, rationale, scope, priority, impact, risk, status,
       evidence_ids, promoted_from_ids, conflicts_with, supersedes, confidence, user_confirmed,
       strength, occurrences, needs_user_confirmation, created_by_skill, last_reinforced_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), ?)`
  ).run(
    id,
    projectId,
    params.workspacePath,
    params.title,
    params.rule,
    params.rationale || '',
    params.scope || 'project',
    params.priority || 'medium',
    params.impact || 'medium',
    params.risk || 'medium',
    status,
    stringifyList(params.evidenceIds),
    stringifyList(params.promotedFromIds),
    stringifyList(params.conflictsWith),
    stringifyList(params.supersedes),
    params.confidence ?? 0.7,
    params.userConfirmed ? 1 : 0,
    params.strength ?? Math.max(0.35, Math.min(0.9, params.confidence ?? 0.7)),
    params.occurrences ?? 1,
    params.needsUserConfirmation ? 1 : 0,
    params.createdBySkill || '',
    addDays(45),
  )
  const rule = getProjectRule(id)!
  syncProjectRuleFiles(params.workspacePath)
  recordEvolutionEvent({
    projectId,
    workspacePath: params.workspacePath,
    eventType: `rule_${status}_created`,
    trigger: 'manual',
    entityType: 'project_rule',
    entityId: id,
    summary: params.title,
    payload: { rule },
  })
  return rule
}

export function updateProjectRuleStatus(params: {
  id: string
  status: ProjectRuleStatus
  userConfirmed?: boolean
  needsUserConfirmation?: boolean
  reason?: string
}): ProjectRule {
  getDb().prepare(
    `UPDATE project_rules
     SET status = ?,
         user_confirmed = COALESCE(?, user_confirmed),
         needs_user_confirmation = COALESCE(?, needs_user_confirmation),
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
     WHERE id = ?`
  ).run(
    params.status,
    typeof params.userConfirmed === 'boolean' ? (params.userConfirmed ? 1 : 0) : null,
    typeof params.needsUserConfirmation === 'boolean' ? (params.needsUserConfirmation ? 1 : 0) : null,
    params.id,
  )
  const rule = getProjectRule(params.id)
  if (!rule) throw new Error('Project rule not found')
  syncProjectRuleFiles(rule.workspacePath)
  recordEvolutionEvent({
    projectId: rule.projectId,
    workspacePath: rule.workspacePath,
    eventType: `rule_${params.status}`,
    entityType: 'project_rule',
    entityId: rule.id,
    summary: params.reason || rule.title,
    payload: { rule },
  })
  if (params.status === 'deprecated') {
    createNegativePrior({
      projectId: rule.projectId,
      workspacePath: rule.workspacePath,
      content: rule.rule,
      sourceEntityType: 'project_rule',
      sourceEntityId: rule.id,
    })
  }
  return rule
}

export function recordRuleApplication(params: {
  ruleId: string
  projectId?: string
  sessionId?: string
  trigger?: string
  taskSummary?: string
  outcome?: 'observed' | 'success' | 'conflict' | 'ignored'
  tokenImpact?: number
}) {
  const id = crypto.randomUUID()
  const outcome = params.outcome || 'observed'
  const tokenImpact = params.tokenImpact || 0
  const db = getDb()
  db.prepare(
    `INSERT INTO rule_applications
      (id, rule_id, project_id, session_id, trigger, task_summary, outcome, token_impact)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.ruleId,
    params.projectId || '',
    params.sessionId || '',
    params.trigger || '',
    params.taskSummary || '',
    outcome,
    tokenImpact,
  )
  db.prepare(
    `UPDATE project_rules
     SET applied_count = applied_count + 1,
         success_count = success_count + ?,
         conflict_count = conflict_count + ?,
         negative_evidence_count = negative_evidence_count + ?,
         occurrences = occurrences + ?,
         strength = CASE
           WHEN ? = 'success' THEN MIN(1, strength + 0.08)
           WHEN ? = 'conflict' THEN MAX(0, strength - 0.12)
           ELSE strength
         END,
         stale_score = CASE WHEN ? IN ('success', 'observed') THEN 0 ELSE stale_score END,
         last_reinforced_at = CASE WHEN ? IN ('success', 'observed') THEN strftime('%Y-%m-%dT%H:%M:%SZ', 'now') ELSE last_reinforced_at END,
         expires_at = CASE WHEN ? IN ('success', 'observed') THEN ? ELSE expires_at END,
         token_impact = token_impact + ?,
         last_applied_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
     WHERE id = ?`
  ).run(
    outcome === 'success' ? 1 : 0,
    outcome === 'conflict' ? 1 : 0,
    outcome === 'conflict' ? 1 : 0,
    outcome === 'success' || outcome === 'observed' ? 1 : 0,
    outcome,
    outcome,
    outcome,
    outcome,
    outcome,
    addDays(45),
    tokenImpact,
    params.ruleId,
  )
}

export function reinforceProjectRule(params: {
  id: string
  evidenceIds?: string[]
  strengthDelta?: number
  confidenceDelta?: number
}): ProjectRule {
  const rule = getProjectRule(params.id)
  if (!rule) throw new Error('Project rule not found')
  const evidenceIds = stringifyList([...(rule.evidenceIds || []), ...(params.evidenceIds || [])])
  getDb().prepare(
    `UPDATE project_rules
     SET evidence_ids = ?,
         confidence = MIN(1, confidence + ?),
         strength = MIN(1, strength + ?),
         occurrences = occurrences + 1,
         stale_score = 0,
         last_reinforced_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
         expires_at = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
     WHERE id = ?`
  ).run(evidenceIds, params.confidenceDelta ?? 0.04, params.strengthDelta ?? 0.1, addDays(45), params.id)
  const updated = getProjectRule(params.id)!
  recordEvolutionEvent({
    projectId: updated.projectId,
    workspacePath: updated.workspacePath,
    eventType: 'project_rule_reinforced',
    entityType: 'project_rule',
    entityId: updated.id,
    summary: updated.title,
    payload: { rule: updated },
  })
  syncProjectRuleFiles(updated.workspacePath)
  return updated
}

export function decayProjectRules(params: {
  projectId?: string
  workspacePath?: string
  staleAfterDays?: number
  archiveAfterStaleScore?: number
}): { stale: number; deprecated: number } {
  const staleAfterDays = params.staleAfterDays || 45
  const archiveAfterStaleScore = params.archiveAfterStaleScore || 3
  const rules = listProjectRules({
    projectId: params.projectId,
    workspacePath: params.workspacePath,
    statuses: ['active', 'shadow'],
    limit: 500,
  })
  let stale = 0
  let deprecated = 0
  for (const rule of rules) {
    const age = daysSince(rule.lastReinforcedAt || rule.lastAppliedAt || rule.updatedAt || rule.createdAt)
    if (age < staleAfterDays) continue
    const nextScore = rule.staleScore + 1
    const nextStatus: ProjectRuleStatus = nextScore >= archiveAfterStaleScore ? 'deprecated' : rule.status
    getDb().prepare(
      `UPDATE project_rules
       SET status = ?,
           stale_score = ?,
           strength = MAX(0, strength - 0.1),
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ?`
    ).run(nextStatus, nextScore, rule.id)
    if (nextStatus === 'deprecated') {
      deprecated += 1
      createNegativePrior({
        projectId: rule.projectId,
        workspacePath: rule.workspacePath,
        content: rule.rule,
        sourceEntityType: 'project_rule',
        sourceEntityId: rule.id,
        strength: 0.7,
      })
    } else {
      stale += 1
    }
    recordEvolutionEvent({
      projectId: rule.projectId,
      workspacePath: rule.workspacePath,
      eventType: nextStatus === 'deprecated' ? 'project_rule_deprecated_by_decay' : 'project_rule_stale',
      entityType: 'project_rule',
      entityId: rule.id,
      summary: rule.title,
      payload: { staleScore: nextScore },
    })
  }
  if (rules.length > 0 && params.workspacePath) syncProjectRuleFiles(params.workspacePath)
  return { stale, deprecated }
}

function renderRuleSection(rule: ProjectRule): string {
  const meta = [
    `id=${rule.id}`,
    `scope=${rule.scope}`,
    `priority=${rule.priority}`,
    `impact=${rule.impact}`,
    `risk=${rule.risk}`,
    `confidence=${rule.confidence.toFixed(2)}`,
    `strength=${rule.strength.toFixed(2)}`,
    `occurrences=${rule.occurrences}`,
    `stale=${rule.staleScore.toFixed(1)}`,
    `applied=${rule.appliedCount}`,
    `success=${rule.successCount}`,
    `conflicts=${rule.conflictCount}`,
  ].join(' · ')
  return [
    `## ${rule.title}`,
    '',
    rule.rule,
    '',
    `> ${meta}`,
    rule.rationale ? `> Rationale: ${rule.rationale.replace(/\n/g, ' ')}` : '',
    '',
  ].filter(Boolean).join('\n')
}

function writeRuleFile(memoryDir: string, filename: string, title: string, rules: ProjectRule[]) {
  const content = [
    `# ${title}`,
    '',
    rules.length > 0 ? rules.map(renderRuleSection).join('\n') : '- 暂无。',
    '',
  ].join('\n')
  fs.writeFileSync(path.join(memoryDir, filename), content, 'utf8')
}

function syncClaudeRuleBlock(workspacePath: string, activeRules: ProjectRule[]) {
  const claudeFile = getClaudeFileForScope('project', workspacePath)
  const body = activeRules.length > 0
    ? [
        RULES_IMPORT_START,
        '## Loom Active Project Rules',
        '',
        '这些是 Loom evolution 系统确认的项目级行为规则。除非当前用户输入明确覆盖，否则应优先遵守。',
        '',
        ...activeRules.map(rule => `- [${rule.priority}] ${rule.rule}`),
        RULES_IMPORT_END,
      ].join('\n')
    : [
        RULES_IMPORT_START,
        '## Loom Active Project Rules',
        '',
        '- 暂无已生效项目规则。',
        RULES_IMPORT_END,
      ].join('\n')

  let existing = ''
  try {
    existing = fs.readFileSync(claudeFile, 'utf8')
  } catch {
    fs.mkdirSync(path.dirname(claudeFile), { recursive: true })
  }
  const escapedStart = RULES_IMPORT_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedEnd = RULES_IMPORT_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const next = existing.includes(RULES_IMPORT_START) && existing.includes(RULES_IMPORT_END)
    ? existing.replace(new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`), body)
    : `${existing.trimEnd()}\n\n${body}\n`
  if (next !== existing) fs.writeFileSync(claudeFile, next, 'utf8')
}

export function syncProjectRuleFiles(workspacePath: string) {
  try {
    ensureClaudeMemory('project', workspacePath)
    const memoryDir = getMemoryDirForScope('project', workspacePath)
    const rules = listProjectRules({ workspacePath, limit: 500 })
    const active = rules.filter(rule => rule.status === 'active')
    const shadow = rules.filter(rule => rule.status === 'shadow' || rule.status === 'candidate')
    const deprecated = rules.filter(rule => rule.status === 'deprecated' || rule.status === 'superseded' || rule.status === 'paused')
    writeRuleFile(memoryDir, 'rules.md', 'Active Project Rules', active)
    writeRuleFile(memoryDir, 'shadow-rules.md', 'Shadow Rules', shadow)
    writeRuleFile(memoryDir, 'deprecated-rules.md', 'Deprecated Rules', deprecated)
    syncClaudeRuleBlock(workspacePath, active)
  } catch (err) {
    logger.warn('evolution.rules.sync_files_failed', {
      workspacePath,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
