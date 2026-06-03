import { createObservation, listObservationGroupsReadyForPromotion, markObservations } from './observation-store'
import { promoteObservationGroup } from './semantic-memory-store'
import { createProjectRule, listProjectRules, reinforceProjectRule } from './rule-store'
import { recordEvolutionEvent } from './events'
import { keywords, preview } from './text'
import type { EvolutionTrigger, MessageSnippet, SessionObservation } from './types'

function lastUserText(messages: MessageSnippet[]): string {
  return [...messages].reverse().find(message => message.role === 'user')?.text.trim() || ''
}

function ruleSimilarity(content: string, ruleText: string): number {
  const a = new Set(keywords(content, 16))
  const b = new Set(keywords(ruleText, 16))
  if (a.size === 0 || b.size === 0) return 0
  let overlap = 0
  for (const key of a) {
    if (b.has(key)) overlap += 1
  }
  return overlap / Math.min(a.size, b.size)
}

function maybeReinforceExistingRule(params: {
  projectId?: string
  workspacePath: string
  observation: SessionObservation
}): boolean {
  const rules = listProjectRules({
    projectId: params.projectId,
    workspacePath: params.workspacePath,
    statuses: ['active', 'shadow', 'candidate'],
    limit: 80,
  })
  const match = rules
    .map(rule => ({ rule, score: ruleSimilarity(params.observation.content, `${rule.title}\n${rule.rule}`) }))
    .filter(item => item.score >= 0.6)
    .sort((a, b) => b.score - a.score)[0]
  if (!match) return false
  reinforceProjectRule({
    id: match.rule.id,
    evidenceIds: [params.observation.id, ...params.observation.evidenceIds],
    strengthDelta: 0.08,
    confidenceDelta: 0.03,
  })
  markObservations({ ids: [params.observation.id], status: 'promoted' })
  recordEvolutionEvent({
    projectId: params.projectId,
    workspacePath: params.workspacePath,
    eventType: 'observation_reinforced_rule',
    entityType: 'project_rule',
    entityId: match.rule.id,
    summary: preview(params.observation.content),
    payload: { observationId: params.observation.id, score: match.score },
  })
  return true
}

function maybeCreateDirectRule(params: {
  projectId?: string
  sessionId: string
  workspacePath: string
  trigger: EvolutionTrigger
  observation: SessionObservation
}) {
  if (params.observation.category !== 'decision') return null
  if (params.observation.confidence < 0.85) return null
  const rule = createProjectRule({
    projectId: params.projectId,
    workspacePath: params.workspacePath,
    title: params.observation.content.slice(0, 60),
    rule: params.observation.content,
    rationale: 'High-confidence user-stated project decision captured by deterministic gate.',
    status: 'shadow',
    scope: 'project',
    priority: params.trigger === 'rule_signal' ? 'high' : 'medium',
    impact: 'medium',
    risk: 'low',
    confidence: params.observation.confidence,
    strength: 0.55,
    occurrences: 1,
    evidenceIds: [params.observation.id, ...params.observation.evidenceIds],
    promotedFromIds: [params.observation.id],
    needsUserConfirmation: false,
    createdBySkill: 'deterministic-gate',
  })
  markObservations({ ids: [params.observation.id], status: 'promoted' })
  recordEvolutionEvent({
    projectId: params.projectId,
    sessionId: params.sessionId,
    workspacePath: params.workspacePath,
    eventType: 'rule_shadow_started',
    trigger: params.trigger,
    entityType: 'project_rule',
    entityId: rule.id,
    summary: rule.title,
  })
  return rule
}

export function recordDeterministicObservation(params: {
  projectId?: string
  sessionId: string
  workspacePath: string
  messages: MessageSnippet[]
  trigger: EvolutionTrigger
  category: string
  observationKey: string
  confidence: number
  evidenceIds?: string[]
}): SessionObservation | null {
  const text = lastUserText(params.messages)
  if (!text) return null
  const observation = createObservation({
    projectId: params.projectId,
    sessionId: params.sessionId,
    workspacePath: params.workspacePath,
    observationKey: params.observationKey,
    category: params.category,
    content: text,
    confidence: params.confidence,
    evidenceIds: params.evidenceIds,
    sourceTrigger: params.trigger,
  })
  if (!observation) return null
  if (maybeReinforceExistingRule({
    projectId: params.projectId,
    workspacePath: params.workspacePath,
    observation,
  })) return observation
  maybeCreateDirectRule({
    projectId: params.projectId,
    sessionId: params.sessionId,
    workspacePath: params.workspacePath,
    trigger: params.trigger,
    observation,
  })
  return observation
}

export function runDeterministicPromotionBatch(params: {
  projectId?: string
  workspacePath: string
  minOccurrences?: number
  limit?: number
}): { promoted: number; reinforced: number } {
  const groups = listObservationGroupsReadyForPromotion({
    projectId: params.projectId,
    workspacePath: params.workspacePath,
    minOccurrences: params.minOccurrences || 2,
    limit: params.limit || 20,
  })
  let promoted = 0
  let reinforced = 0
  for (const group of groups) {
    const before = group.observations.map(observation => observation.id)
    const semantic = promoteObservationGroup({
      projectId: params.projectId,
      workspacePath: params.workspacePath,
      observationKey: group.observationKey,
      observations: group.observations,
    })
    if (!semantic) continue
    markObservations({ ids: before, status: 'promoted' })
    if (semantic.occurrences > group.observations.length) reinforced += 1
    else promoted += 1
  }
  return { promoted, reinforced }
}
