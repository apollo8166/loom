import { writeMemoryCandidate } from '@/shared/memory/files'
import type { MemoryCandidate } from '@/shared/memory/types'
import { findDuplicateMemoryCandidate } from '@/shared/memory/dedupe'
import { approveCandidate } from '@/shared/memory/consolidator'
import { logger } from '@/shared/logging/logger'
import { cheapGate } from './gate'
import { buildEvolutionPacket } from './packets'
import { recordEvolutionEvent } from './events'
import { recordMessageFacts } from './fact-store'
import { valueConfidenceGate } from './gatekeeper'
import { recordDeterministicObservation, runDeterministicPromotionBatch } from './promotion'
import { decaySemanticMemories } from './semantic-memory-store'
import { rebuildProjectDossierDeterministic } from './dossier-store'
import { hasNegativePrior } from './negative-priors'
import { applyProjectEvolutionResult } from './project-evolution-applier'
import { createProjectRule, decayProjectRules, listProjectRules, recordRuleApplication, syncProjectRuleFiles, updateProjectRuleStatus } from './rule-store'
import { runEvolutionSkill } from './skill-runner'
import type {
  EvolutionTrigger,
  GateResult,
  MessageSnippet,
  ProjectRuleImpact,
  ProjectRulePriority,
  ProjectRuleRisk,
  ProjectRuleScope,
  RuleAuditResult,
  RulePromotionResult,
} from './types'

type CuratorAction = {
  action?: string
  type?: MemoryCandidate['type']
  content?: string
  evidence?: string
  confidence?: MemoryCandidate['confidence']
  target?: MemoryCandidate['target']
}

type RetrospectiveItem = {
  rootCause?: string
  lesson?: string
  correction?: string
  risk?: string
  content?: string
  evidence?: string
  confidence?: MemoryCandidate['confidence']
  rulePotential?: boolean
}

async function runProjectEvolutionOrganizer(params: {
  projectId?: string
  sessionId: string
  workspacePath: string
  trigger: EvolutionTrigger
  messages: MessageSnippet[]
}) {
  const packet = buildEvolutionPacket({
    projectId: params.projectId,
    sessionId: params.sessionId,
    workspacePath: params.workspacePath,
    trigger: params.trigger,
    messages: params.messages,
  })
  const result = await runEvolutionSkill({ skillName: 'project-evolution', packet })
  const applied = applyProjectEvolutionResult({
    projectId: params.projectId,
    sessionId: params.sessionId,
    workspacePath: params.workspacePath,
    packet,
    result,
  })
  recordEvolutionEvent({
    projectId: params.projectId,
    sessionId: params.sessionId,
    workspacePath: params.workspacePath,
    eventType: 'project_evolution_audit',
    trigger: params.trigger,
    summary: 'Project evolution organizer completed',
    payload: { result, applied },
  })
  return applied
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeConfidence(value: unknown): MemoryCandidate['confidence'] {
  return value === 'high' || value === 'low' || value === 'medium' ? value : 'medium'
}

function normalizeMemoryType(value: unknown): MemoryCandidate['type'] {
  const allowed: MemoryCandidate['type'][] = ['preference', 'fact', 'decision', 'workflow', 'correction', 'feedback', 'risk', 'retrospective', 'project_rule']
  return allowed.includes(value as MemoryCandidate['type']) ? value as MemoryCandidate['type'] : 'fact'
}

function normalizeScope(value: unknown): ProjectRuleScope {
  return value === 'global' || value === 'module' || value === 'workflow' || value === 'project' ? value : 'project'
}

function normalizePriority(value: unknown): ProjectRulePriority {
  return value === 'critical' || value === 'high' || value === 'low' || value === 'medium' ? value : 'medium'
}

function normalizeImpact(value: unknown): ProjectRuleImpact {
  return value === 'high' || value === 'low' || value === 'medium' ? value : 'medium'
}

function normalizeRisk(value: unknown): ProjectRuleRisk {
  return value === 'high' || value === 'low' || value === 'medium' ? value : 'medium'
}

function candidateTargetForType(type: MemoryCandidate['type']): MemoryCandidate['target'] {
  if (type === 'decision') return 'decision'
  if (type === 'retrospective') return 'retrospective'
  if (type === 'project_rule') return 'project_rule'
  return 'memory'
}

function stageForTarget(target: MemoryCandidate['target']): MemoryCandidate['evolutionStage'] {
  if (target === 'decision') return 'decision'
  if (target === 'retrospective') return 'retrospective'
  if (target === 'project_rule') return 'project_rule_candidate'
  return 'memory'
}

function shouldAutoApplyCandidate(type: MemoryCandidate['type'], target: MemoryCandidate['target'], trigger: EvolutionTrigger): boolean {
  if (target === 'project_rule') return false
  if (trigger === 'explicit_memory') return true
  return type === 'fact' || type === 'preference' || type === 'workflow'
}

function writeEvolutionCandidate(params: {
  projectId?: string
  sessionId: string
  workspacePath: string
  trigger: EvolutionTrigger
  type: MemoryCandidate['type']
  content: string
  evidence?: string
  confidence?: MemoryCandidate['confidence']
  target?: MemoryCandidate['target']
  metadata?: Record<string, unknown>
}): MemoryCandidate | null {
  const target = params.target || candidateTargetForType(params.type)
  const autoApply = shouldAutoApplyCandidate(params.type, target, params.trigger)
  const duplicate = findDuplicateMemoryCandidate({
    candidate: {
      scope: 'project',
      content: params.content,
    },
    workspacePath: params.workspacePath,
  })
  if (duplicate) {
    recordEvolutionEvent({
      projectId: params.projectId,
      sessionId: params.sessionId,
      workspacePath: params.workspacePath,
      eventType: 'memory_candidate_duplicate_skipped',
      trigger: params.trigger,
      entityType: 'memory',
      entityId: duplicate.matchedSource,
      summary: params.content.slice(0, 180),
      payload: { duplicate },
    })
    return null
  }
  const candidate = writeMemoryCandidate({
    scope: 'project',
    workspacePath: params.workspacePath,
    type: params.type,
    confidence: params.confidence || 'medium',
    sourceSessionId: params.sessionId,
    content: params.content,
    evidence: params.evidence || `Evolution ${params.trigger}`,
    target,
    evolutionStage: stageForTarget(target),
    status: 'pending',
    metadata: {
      trigger: params.trigger,
      projectId: params.projectId,
      ...params.metadata,
    },
  })
  if (autoApply) {
    try {
      approveCandidate({
        id: candidate.id,
        scope: 'project',
        workspacePath: params.workspacePath,
      })
    } catch (err) {
      logger.warn('evolution.memory.auto_approve_failed', {
        candidateId: candidate.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  const finalCandidate = autoApply ? { ...candidate, status: 'approved' as const } : candidate
  recordEvolutionEvent({
    projectId: params.projectId,
    sessionId: params.sessionId,
    workspacePath: params.workspacePath,
    eventType: autoApply ? 'memory_auto_saved' : 'memory_candidate_created',
    trigger: params.trigger,
    entityType: 'memory_candidate',
    entityId: finalCandidate.id,
    summary: finalCandidate.content.slice(0, 180),
    payload: { candidate: finalCandidate },
  })
  return finalCandidate
}

function parsePromotion(value: Record<string, unknown>): RulePromotionResult {
  return {
    recommendation: asString(value.recommendation, 'reject') as RulePromotionResult['recommendation'],
    title: asString(value.title),
    rule: asString(value.rule),
    rationale: asString(value.rationale),
    scope: normalizeScope(value.scope),
    priority: normalizePriority(value.priority),
    impact: normalizeImpact(value.impact),
    risk: normalizeRisk(value.risk),
    confidence: asNumber(value.confidence, 0.7),
    needsUserConfirmation: Boolean(value.needsUserConfirmation),
    mergeWith: typeof value.mergeWith === 'string' ? value.mergeWith : undefined,
  }
}

function parseAudit(value: Record<string, unknown>): RuleAuditResult {
  return {
    result: asString(value.result, 'pass') as RuleAuditResult['result'],
    rationale: asString(value.rationale),
    conflictsWith: asArray<string>(value.conflictsWith).filter(item => typeof item === 'string'),
    mergeWith: typeof value.mergeWith === 'string' ? value.mergeWith : undefined,
    scope: normalizeScope(value.scope),
    risk: normalizeRisk(value.risk),
    needsUserConfirmation: Boolean(value.needsUserConfirmation),
  }
}

function ruleNeedsUserConfirmation(params: {
  promotion: RulePromotionResult
  audit: RuleAuditResult
}): boolean {
  if (params.promotion.needsUserConfirmation || params.audit.needsUserConfirmation) return true
  if (params.promotion.scope === 'global') return true
  if (params.promotion.impact === 'high') return true
  if (params.promotion.risk === 'high' || params.audit.risk === 'high') return true
  if (params.audit.conflictsWith.length > 0) return true
  return false
}

async function maybePromoteRule(params: {
  projectId?: string
  sessionId: string
  workspacePath: string
  trigger: EvolutionTrigger
  candidate: MemoryCandidate
}) {
  if (hasNegativePrior({
    projectId: params.projectId,
    workspacePath: params.workspacePath,
    content: params.candidate.content,
  })) {
    recordEvolutionEvent({
      projectId: params.projectId,
      sessionId: params.sessionId,
      workspacePath: params.workspacePath,
      eventType: 'rule_promotion_blocked_by_negative_prior',
      trigger: params.trigger,
      entityType: 'memory_candidate',
      entityId: params.candidate.id,
      summary: params.candidate.content.slice(0, 180),
    })
    return null
  }
  const packet = buildEvolutionPacket({
    projectId: params.projectId,
    sessionId: params.sessionId,
    workspacePath: params.workspacePath,
    trigger: params.trigger,
    messages: [],
    candidate: params.candidate,
  })
  const promotionRaw = await runEvolutionSkill({ skillName: 'rule-promoter', packet })
  const promotion = parsePromotion(promotionRaw)
  if (promotion.recommendation !== 'promote' && promotion.recommendation !== 'needs_user_confirmation') {
    recordEvolutionEvent({
      projectId: params.projectId,
      sessionId: params.sessionId,
      workspacePath: params.workspacePath,
      eventType: 'rule_promotion_skipped',
      trigger: params.trigger,
      entityType: 'memory_candidate',
      entityId: params.candidate.id,
      summary: promotion.recommendation,
      payload: { promotion },
    })
    return null
  }

  const auditRaw = await runEvolutionSkill({ skillName: 'rule-auditor', packet })
  const audit = parseAudit(auditRaw)
  if (audit.result === 'reject') {
    recordEvolutionEvent({
      projectId: params.projectId,
      sessionId: params.sessionId,
      workspacePath: params.workspacePath,
      eventType: 'rule_promotion_rejected',
      trigger: params.trigger,
      entityType: 'memory_candidate',
      entityId: params.candidate.id,
      summary: audit.rationale,
      payload: { promotion, audit },
    })
    return null
  }

  const needsUserConfirmation = ruleNeedsUserConfirmation({ promotion, audit })
  const status = needsUserConfirmation ? 'candidate' : 'shadow'
  const rule = createProjectRule({
    projectId: params.projectId,
    workspacePath: params.workspacePath,
    title: promotion.title || params.candidate.content.slice(0, 48),
    rule: promotion.rule || params.candidate.content,
    rationale: promotion.rationale || audit.rationale || params.candidate.evidence || '',
    scope: audit.scope || promotion.scope || 'project',
    priority: promotion.priority || 'medium',
    impact: promotion.impact || 'medium',
    risk: audit.risk || promotion.risk || 'medium',
    status,
    evidenceIds: [params.candidate.id],
    promotedFromIds: [params.candidate.id],
    conflictsWith: audit.conflictsWith,
    confidence: promotion.confidence || 0.7,
    needsUserConfirmation,
    createdBySkill: 'rule-promoter',
  })
  recordEvolutionEvent({
    projectId: params.projectId,
    sessionId: params.sessionId,
    workspacePath: params.workspacePath,
    eventType: status === 'shadow' ? 'rule_shadow_started' : 'rule_candidate_needs_review',
    trigger: params.trigger,
    entityType: 'project_rule',
    entityId: rule.id,
    summary: rule.title,
    payload: { promotion, audit, rule },
  })
  return rule
}

async function runMemoryCurator(params: {
  projectId?: string
  sessionId: string
  workspacePath: string
  trigger: EvolutionTrigger
  messages: MessageSnippet[]
}): Promise<MemoryCandidate[]> {
  const packet = buildEvolutionPacket(params)
  const result = await runEvolutionSkill({ skillName: 'memory-curator', packet })
  const actions = asArray<CuratorAction>(result.actions)
  const written: MemoryCandidate[] = []
  for (const action of actions) {
    const actionName = action.action || 'save'
    if (actionName === 'discard') continue
    const content = action.content?.trim()
    if (!content || content.length < 8) continue
    const type = normalizeMemoryType(action.type)
    const target = action.target || candidateTargetForType(type)
    const candidate = writeEvolutionCandidate({
      projectId: params.projectId,
      sessionId: params.sessionId,
      workspacePath: params.workspacePath,
      trigger: params.trigger,
      type,
      content,
      evidence: action.evidence,
      confidence: normalizeConfidence(action.confidence),
      target,
      metadata: { curatorAction: actionName },
    })
    if (!candidate) continue
    written.push(candidate)
    if (type === 'project_rule' || target === 'project_rule' || actionName === 'suggest_rule') {
      await maybePromoteRule({
        projectId: params.projectId,
        sessionId: params.sessionId,
        workspacePath: params.workspacePath,
        trigger: params.trigger,
        candidate,
      })
    }
  }
  return written
}

async function runRetrospectiveFlow(params: {
  projectId?: string
  sessionId: string
  workspacePath: string
  trigger: EvolutionTrigger
  messages: MessageSnippet[]
}): Promise<MemoryCandidate[]> {
  const packet = buildEvolutionPacket(params)
  const result = await runEvolutionSkill({ skillName: 'retrospective-runner', packet })
  const retrospectives = asArray<RetrospectiveItem>(result.retrospectives)
  const written: MemoryCandidate[] = []
  for (const item of retrospectives) {
    const content = item.content?.trim() ||
      [item.rootCause, item.lesson, item.correction, item.risk].filter(Boolean).join('\n')
    if (!content || content.length < 8) continue
    const candidate = writeEvolutionCandidate({
      projectId: params.projectId,
      sessionId: params.sessionId,
      workspacePath: params.workspacePath,
      trigger: params.trigger,
      type: 'retrospective',
      content,
      evidence: item.evidence,
      confidence: normalizeConfidence(item.confidence),
      target: 'retrospective',
      metadata: {
        rootCause: item.rootCause,
        lesson: item.lesson,
        correction: item.correction,
        risk: item.risk,
        rulePotential: item.rulePotential,
      },
    })
    if (!candidate) continue
    written.push(candidate)
    if (item.rulePotential) {
      await maybePromoteRule({
        projectId: params.projectId,
        sessionId: params.sessionId,
        workspacePath: params.workspacePath,
        trigger: params.trigger,
        candidate,
      })
    }
  }
  return written
}

export function runCheapEvolutionPass(params: {
  projectId?: string
  sessionId: string
  workspacePath: string
  messages: MessageSnippet[]
  reason: 'after_message' | 'compact_flush' | 'manual' | 'session_end' | 'periodic'
  tokenStats?: {
    inputTokens?: number
    outputTokens?: number
    contextPercent?: number
  }
}): {
  gate: GateResult
  factCount: number
  observationCount: number
  candidateCount: number
  ruleCount: number
} {
  const gate = cheapGate({
    messages: params.messages,
    reason: params.reason,
    tokenStats: params.tokenStats,
  })
  const facts = recordMessageFacts({
    projectId: params.projectId,
    sessionId: params.sessionId,
    workspacePath: params.workspacePath,
    messages: params.messages,
    trigger: gate.trigger,
  })
  recordEvolutionEvent({
    projectId: params.projectId,
    sessionId: params.sessionId,
    workspacePath: params.workspacePath,
    eventType: 'gate_evaluated',
    trigger: gate.trigger,
    summary: gate.reason,
    payload: { gate, mode: 'cheap' },
  })

  if (!gate.shouldRunEvolution) {
    return { gate, factCount: facts.length, observationCount: 0, candidateCount: 0, ruleCount: 0 }
  }

  const decision = valueConfidenceGate({
    projectId: params.projectId,
    workspacePath: params.workspacePath,
    messages: params.messages,
    trigger: gate.trigger,
  })
  if (decision.action === 'discard') {
    recordEvolutionEvent({
      projectId: params.projectId,
      sessionId: params.sessionId,
      workspacePath: params.workspacePath,
      eventType: 'observation_discarded',
      trigger: gate.trigger,
      summary: decision.reason,
      payload: { decision },
    })
    return { gate, factCount: facts.length, observationCount: 0, candidateCount: 0, ruleCount: 0 }
  }

  const beforeRules = listProjectRules({ projectId: params.projectId, workspacePath: params.workspacePath, limit: 500 }).length
  const observation = recordDeterministicObservation({
    projectId: params.projectId,
    sessionId: params.sessionId,
    workspacePath: params.workspacePath,
    messages: params.messages,
    trigger: gate.trigger,
    category: decision.category,
    observationKey: decision.observationKey,
    confidence: decision.confidence,
    evidenceIds: facts.map(fact => fact.id),
  })
  const promotion = runDeterministicPromotionBatch({
    projectId: params.projectId,
    workspacePath: params.workspacePath,
    minOccurrences: 2,
    limit: 10,
  })
  if (observation || promotion.promoted > 0 || promotion.reinforced > 0) {
    rebuildProjectDossierDeterministic({
      projectId: params.projectId,
      workspacePath: params.workspacePath,
      source: 'cheap-pass',
    })
    syncProjectRuleFiles(params.workspacePath)
  }
  const afterRules = listProjectRules({ projectId: params.projectId, workspacePath: params.workspacePath, limit: 500 }).length
  return {
    gate,
    factCount: facts.length,
    observationCount: observation ? 1 : 0,
    candidateCount: observation ? 1 : 0,
    ruleCount: Math.max(0, afterRules - beforeRules),
  }
}

export async function runEvolution(params: {
  projectId?: string
  sessionId: string
  workspacePath: string
  messages: MessageSnippet[]
  reason: 'after_message' | 'compact_flush' | 'manual' | 'session_end' | 'periodic'
  tokenStats?: {
    inputTokens?: number
    outputTokens?: number
    contextPercent?: number
  }
}): Promise<{
  gate: GateResult
  candidateCount: number
  ruleCount: number
}> {
  const gate = cheapGate({
    messages: params.messages,
    reason: params.reason,
    tokenStats: params.tokenStats,
  })
  recordEvolutionEvent({
    projectId: params.projectId,
    sessionId: params.sessionId,
    workspacePath: params.workspacePath,
    eventType: 'gate_evaluated',
    trigger: gate.trigger,
    summary: gate.reason,
    payload: { gate },
  })
  recordMessageFacts({
    projectId: params.projectId,
    sessionId: params.sessionId,
    workspacePath: params.workspacePath,
    messages: params.messages,
    trigger: gate.trigger,
  })

  if (!gate.shouldRunEvolution) return { gate, candidateCount: 0, ruleCount: 0 }

  logger.info('evolution.run.start', {
    projectId: params.projectId,
    sessionId: params.sessionId,
    trigger: gate.trigger,
    reason: params.reason,
    suggestedSkills: gate.suggestedSkills,
  })

  let candidates: MemoryCandidate[] = []
  const beforeRules = listProjectRules({ projectId: params.projectId, workspacePath: params.workspacePath, limit: 500 }).length
  const deterministicGate = valueConfidenceGate({
    projectId: params.projectId,
    workspacePath: params.workspacePath,
    messages: params.messages,
    trigger: gate.trigger,
  })
  if (
    deterministicGate.action !== 'discard' &&
    gate.trigger !== 'periodic' &&
    gate.trigger !== 'token_anomaly' &&
    gate.trigger !== 'compact_flush'
  ) {
    recordDeterministicObservation({
      projectId: params.projectId,
      sessionId: params.sessionId,
      workspacePath: params.workspacePath,
      messages: params.messages,
      trigger: gate.trigger,
      category: deterministicGate.category,
      observationKey: deterministicGate.observationKey,
      confidence: deterministicGate.confidence,
    })
  }
  const relevantRules = listProjectRules({
    projectId: params.projectId,
    workspacePath: params.workspacePath,
    statuses: ['active', 'shadow'],
    limit: 80,
  }).filter(rule => {
    const text = params.messages.map(message => message.text).join('\n').toLowerCase()
    const titleWords = rule.title.toLowerCase().match(/[a-z0-9_\-]{4,}|[\u4e00-\u9fa5]{2,}/g) || []
    const ruleWords = rule.rule.toLowerCase().match(/[a-z0-9_\-]{4,}|[\u4e00-\u9fa5]{2,}/g) || []
    return [...new Set([...titleWords, ...ruleWords])].slice(0, 8).some(word => text.includes(word))
  })
  for (const rule of relevantRules) {
    const negativeTrigger = gate.trigger === 'feedback' || gate.trigger === 'correction' || gate.trigger === 'risk'
    recordRuleApplication({
      ruleId: rule.id,
      projectId: params.projectId,
      sessionId: params.sessionId,
      trigger: gate.trigger,
      taskSummary: gate.reason,
      outcome: negativeTrigger ? 'conflict' : 'observed',
    })
  }

  if (gate.trigger === 'feedback' || gate.trigger === 'correction' || gate.trigger === 'risk') {
    candidates = [
      ...await runRetrospectiveFlow({ ...params, trigger: gate.trigger }),
      ...await runMemoryCurator({ ...params, trigger: gate.trigger }),
    ]
  } else if (
    gate.trigger === 'decision' ||
    gate.trigger === 'rule_signal' ||
    gate.trigger === 'explicit_memory' ||
    gate.trigger === 'compact_flush' ||
    gate.trigger === 'manual'
  ) {
    candidates = await runMemoryCurator({ ...params, trigger: gate.trigger })
    for (const candidate of candidates) {
      if (
        candidate.type === 'decision' ||
        candidate.type === 'retrospective' ||
        candidate.type === 'project_rule' ||
        gate.trigger === 'rule_signal'
      ) {
        await maybePromoteRule({
          projectId: params.projectId,
          sessionId: params.sessionId,
          workspacePath: params.workspacePath,
          trigger: gate.trigger,
          candidate,
        })
      }
    }
  } else if (gate.trigger === 'periodic') {
    const promotion = runDeterministicPromotionBatch({
      projectId: params.projectId,
      workspacePath: params.workspacePath,
      minOccurrences: 2,
      limit: 50,
    })
    const semanticDecay = decaySemanticMemories({
      projectId: params.projectId,
      workspacePath: params.workspacePath,
    })
    const ruleDecay = decayProjectRules({
      projectId: params.projectId,
      workspacePath: params.workspacePath,
    })
    const dossier = rebuildProjectDossierDeterministic({
      projectId: params.projectId,
      workspacePath: params.workspacePath,
      source: 'periodic',
    })
    recordEvolutionEvent({
      projectId: params.projectId,
      sessionId: params.sessionId,
      workspacePath: params.workspacePath,
      eventType: 'deterministic_evolution_batch',
      trigger: gate.trigger,
      summary: `promoted ${promotion.promoted}, reinforced ${promotion.reinforced}, stale ${semanticDecay.stale + ruleDecay.stale}`,
      payload: { promotion, semanticDecay, ruleDecay, dossierId: dossier.id },
    })
    await runProjectEvolutionOrganizer({
      projectId: params.projectId,
      sessionId: params.sessionId,
      workspacePath: params.workspacePath,
      trigger: gate.trigger,
      messages: params.messages,
    })
    await auditShadowRules({
      projectId: params.projectId,
      workspacePath: params.workspacePath,
    })
  } else if (gate.trigger === 'token_anomaly') {
    const packet = buildEvolutionPacket({
      projectId: params.projectId,
      sessionId: params.sessionId,
      workspacePath: params.workspacePath,
      trigger: gate.trigger,
      messages: params.messages,
    })
    const result = await runEvolutionSkill({ skillName: 'token-economist', packet })
    recordEvolutionEvent({
      projectId: params.projectId,
      sessionId: params.sessionId,
      workspacePath: params.workspacePath,
      eventType: 'token_economist_audit',
      trigger: gate.trigger,
      summary: 'Token economist evaluated memory/rule injection pressure',
      payload: { result },
    })
  }

  if (gate.trigger === 'compact_flush' || gate.trigger === 'manual') {
    const promotion = runDeterministicPromotionBatch({
      projectId: params.projectId,
      workspacePath: params.workspacePath,
      minOccurrences: 2,
      limit: 30,
    })
    rebuildProjectDossierDeterministic({
      projectId: params.projectId,
      workspacePath: params.workspacePath,
      source: gate.trigger,
    })
    await runProjectEvolutionOrganizer({
      projectId: params.projectId,
      sessionId: params.sessionId,
      workspacePath: params.workspacePath,
      trigger: gate.trigger,
      messages: params.messages,
    })
    if (promotion.promoted > 0 || promotion.reinforced > 0) {
      recordEvolutionEvent({
        projectId: params.projectId,
        sessionId: params.sessionId,
        workspacePath: params.workspacePath,
        eventType: 'observation_promotion_batch',
        trigger: gate.trigger,
        summary: `promoted ${promotion.promoted}, reinforced ${promotion.reinforced}`,
        payload: { promotion },
      })
    }
  }

  const afterRules = listProjectRules({ projectId: params.projectId, workspacePath: params.workspacePath, limit: 500 }).length
  const ruleCount = Math.max(0, afterRules - beforeRules)
  recordEvolutionEvent({
    projectId: params.projectId,
    sessionId: params.sessionId,
    workspacePath: params.workspacePath,
    eventType: 'evolution_run_completed',
    trigger: gate.trigger,
    summary: `${candidates.length} candidates, ${ruleCount} rules`,
    payload: {
      candidateIds: candidates.map(candidate => candidate.id),
      ruleCount,
    },
  })
  syncProjectRuleFiles(params.workspacePath)

  return { gate, candidateCount: candidates.length, ruleCount }
}

export async function auditShadowRules(params: {
  projectId?: string
  workspacePath: string
}) {
  const rules = listProjectRules({ projectId: params.projectId, workspacePath: params.workspacePath, statuses: ['shadow'], limit: 200 })
  for (const rule of rules) {
    const observedEnough = rule.appliedCount >= 3 && rule.successCount >= 2
    const reinforcedEnough = rule.occurrences >= 3 && rule.strength >= 0.75
    if (rule.risk === 'low' && (observedEnough || reinforcedEnough) && rule.conflictCount === 0 && rule.confidence >= 0.85) {
      updateProjectRuleStatus({
        id: rule.id,
        status: 'active',
        userConfirmed: false,
        needsUserConfirmation: false,
        reason: 'Low-risk shadow rule reached automatic activation threshold.',
      })
    }
  }
}
