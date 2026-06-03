export type MemoryScope = 'global' | 'project'

export type MemoryFileKind =
  | 'index'
  | 'user'
  | 'preferences'
  | 'workflows'
  | 'corrections'
  | 'project'
  | 'decisions'
  | 'feedback'
  | 'retrospectives'
  | 'rules'
  | 'shadow-rules'
  | 'deprecated-rules'
  | 'evolution-log'

export interface MemoryFile {
  name: string
  path: string
  kind: MemoryFileKind
  content: string
  exists: boolean
}

export interface MemoryCandidate {
  id: string
  scope: MemoryScope
  type: 'preference' | 'fact' | 'decision' | 'workflow' | 'correction' | 'feedback' | 'risk' | 'retrospective' | 'project_rule'
  confidence: 'high' | 'medium' | 'low'
  sourceSessionId?: string
  createdAt: string
  status: 'pending' | 'auto_applied' | 'shadow' | 'active' | 'needs_user_confirmation' | 'approved' | 'rejected' | 'deprecated'
  content: string
  evidence?: string
  target?: 'memory' | 'decision' | 'retrospective' | 'project_rule'
  evolutionStage?: 'captured' | 'memory' | 'decision' | 'retrospective' | 'project_rule_candidate' | 'shadow_rule' | 'active_rule' | 'deprecated' | 'rejected'
  metadata?: Record<string, unknown>
  path: string
}

export interface MemoryReadResult {
  scope: MemoryScope
  rootDir: string
  claudeFile: string
  initialized: boolean
  files: MemoryFile[]
  candidates: MemoryCandidate[]
}

export interface RetrievedMemory {
  scope: MemoryScope
  source: string
  score: number
  content: string
}

export interface LoomMemoryContext {
  enabled: boolean
  globalSummary: string
  projectSummary: string
  evolutionSummary?: string
  retrieved: RetrievedMemory[]
  debug: {
    globalDir: string
    projectDir?: string
    budgetChars?: number
    injectedChars: number
    globalSummaryChars?: number
    projectSummaryChars?: number
    retrievedChars?: number
    evolutionChars?: number
    semanticMemoryCount?: number
    recentObservationCount?: number
    activeRuleCount?: number
    dossierVersion?: number
    retrievedCount: number
    rawRetrievedCount?: number
    truncated?: boolean
    managedBySdk?: boolean
    globalMemoryFile?: string
    projectMemoryFile?: string
  }
}
