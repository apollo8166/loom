import type { MemoryCandidate } from '@/shared/memory/types'

export type EvolutionTrigger =
  | 'none'
  | 'explicit_memory'
  | 'feedback'
  | 'correction'
  | 'risk'
  | 'decision'
  | 'rule_signal'
  | 'compact_flush'
  | 'session_end'
  | 'periodic'
  | 'token_anomaly'
  | 'manual'

export type EvolutionSkillName =
  | 'memory-curator'
  | 'retrospective-runner'
  | 'rule-promoter'
  | 'rule-auditor'
  | 'token-economist'
  | 'project-evolution'

export type ProjectRuleScope = 'project' | 'module' | 'workflow' | 'global'
export type ProjectRulePriority = 'low' | 'medium' | 'high' | 'critical'
export type ProjectRuleImpact = 'low' | 'medium' | 'high'
export type ProjectRuleRisk = 'low' | 'medium' | 'high'
export type ProjectRuleStatus = 'candidate' | 'shadow' | 'active' | 'paused' | 'deprecated' | 'superseded'
export type ObservationStatus = 'active' | 'promoted' | 'archived' | 'rejected'
export type SemanticMemoryStatus = 'candidate' | 'active' | 'stale' | 'archived' | 'rejected'

export interface MessageSnippet {
  role: 'user' | 'assistant'
  text: string
  messageId?: string
  createdAt?: string
}

export interface MemorySummary {
  id: string
  type: string
  content: string
  source: string
}

export interface RuleSummary {
  id: string
  title: string
  rule: string
  status: ProjectRuleStatus
  scope: ProjectRuleScope
  priority: ProjectRulePriority
  appliedCount: number
  successCount: number
  conflictCount: number
  strength?: number
  occurrences?: number
  staleScore?: number
}

export interface DossierSummary {
  id: string
  version: number
  summary: string
  stableRules: string
  recentRisks: string
  repeatedIssues: string
  deprecatedUnderstanding: string
  nextSteps: string
}

export interface SemanticMemorySummary {
  id: string
  title: string
  content: string
  category: string
  status: SemanticMemoryStatus
  confidence: number
  strength: number
  occurrences: number
  sourceObservationIds: string[]
  staleScore: number
}

export interface ObservationSummary {
  id: string
  observationKey: string
  category: string
  content: string
  confidence: number
  status: ObservationStatus
  sourceTrigger: string
  createdAt: string
}

export interface RuleMetrics {
  appliedCount: number
  successCount: number
  conflictCount: number
  tokenImpact: number
}

export interface GateResult {
  shouldRunEvolution: boolean
  trigger: EvolutionTrigger
  confidence: number
  suggestedSkills: EvolutionSkillName[]
  reason: string
}

export interface EvolutionPacket {
  projectId?: string
  sessionId: string
  workspacePath: string
  trigger: EvolutionTrigger
  snippets: MessageSnippet[]
  candidate?: MemoryCandidate
  relatedMemories: MemorySummary[]
  projectDossier?: DossierSummary | null
  semanticMemories: SemanticMemorySummary[]
  recentObservations: ObservationSummary[]
  activeRules: RuleSummary[]
  shadowRules: RuleSummary[]
  metrics?: RuleMetrics
}

export interface SkillRunRecord {
  id: string
  skillName: EvolutionSkillName
  status: 'running' | 'done' | 'failed' | 'skipped'
}

export interface ProjectRule {
  id: string
  projectId: string
  workspacePath: string
  title: string
  rule: string
  rationale: string
  scope: ProjectRuleScope
  priority: ProjectRulePriority
  impact: ProjectRuleImpact
  risk: ProjectRuleRisk
  status: ProjectRuleStatus
  evidenceIds: string[]
  promotedFromIds: string[]
  conflictsWith: string[]
  supersedes: string[]
  confidence: number
  strength: number
  occurrences: number
  appliedCount: number
  successCount: number
  conflictCount: number
  negativeEvidenceCount: number
  staleScore: number
  tokenImpact: number
  userConfirmed: boolean
  needsUserConfirmation: boolean
  createdBySkill: string
  createdAt: string
  updatedAt: string
  lastAppliedAt?: string | null
  lastReinforcedAt?: string | null
  expiresAt?: string | null
}

export interface FactRecord {
  id: string
  projectId: string
  sessionId: string
  workspacePath: string
  sourceType: string
  sourceId: string
  kind: string
  role: string
  content: string
  contentHash: string
  metadata: Record<string, unknown>
  createdAt: string
}

export interface SessionObservation {
  id: string
  projectId: string
  sessionId: string
  workspacePath: string
  observationKey: string
  category: string
  content: string
  confidence: number
  status: ObservationStatus
  evidenceIds: string[]
  sourceTrigger: string
  expiresAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface SemanticMemory {
  id: string
  projectId: string
  workspacePath: string
  memoryKey: string
  title: string
  content: string
  category: string
  status: SemanticMemoryStatus
  confidence: number
  strength: number
  occurrences: number
  evidenceIds: string[]
  sourceObservationIds: string[]
  negativeEvidenceCount: number
  confirmedByUser: boolean
  staleScore: number
  lastReinforcedAt?: string | null
  expiresAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface ProjectDossier {
  id: string
  projectId: string
  workspacePath: string
  version: number
  summary: string
  currentGoal: string
  userPreferences: string
  stableRules: string
  recentRisks: string
  repeatedIssues: string
  deprecatedUnderstanding: string
  nextSteps: string
  source: string
  tokenBudgetChars: number
  createdAt: string
  updatedAt: string
}

export interface NegativePrior {
  id: string
  projectId: string
  workspacePath: string
  priorKey: string
  content: string
  sourceEntityType: string
  sourceEntityId: string
  strength: number
  expiresAt?: string | null
  createdAt: string
}

export interface EvolutionInjectionContext {
  dossier: ProjectDossier | null
  semanticMemories: SemanticMemory[]
  recentObservations: SessionObservation[]
  activeRules: ProjectRule[]
  chars: number
  rendered: string
}

export interface RulePromotionResult {
  recommendation: 'promote' | 'keep_as_decision' | 'keep_as_memory' | 'reject' | 'merge' | 'needs_user_confirmation'
  title?: string
  rule?: string
  rationale?: string
  scope?: ProjectRuleScope
  priority?: ProjectRulePriority
  impact?: ProjectRuleImpact
  risk?: ProjectRuleRisk
  confidence?: number
  evidenceIds?: string[]
  mergeWith?: string
  needsUserConfirmation?: boolean
}

export interface RuleAuditResult {
  result: 'pass' | 'reject' | 'merge' | 'narrow_scope' | 'needs_user_confirmation'
  rationale: string
  conflictsWith: string[]
  mergeWith?: string
  scope?: ProjectRuleScope
  risk?: ProjectRuleRisk
  needsUserConfirmation?: boolean
}
