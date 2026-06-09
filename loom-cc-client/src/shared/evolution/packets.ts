import path from 'node:path'
import { readClaudeMemory } from '@/shared/memory/files'
import type { MemoryCandidate } from '@/shared/memory/types'
import { cleanProjectDossier, getLatestProjectDossier } from './dossier-store'
import { listRecentObservations } from './observation-store'
import { listSemanticMemories } from './semantic-memory-store'
import { listProjectRules } from './rule-store'
import type {
  DossierSummary,
  EvolutionPacket,
  EvolutionTrigger,
  MemorySummary,
  MessageSnippet,
  ObservationSummary,
  RuleSummary,
  SemanticMemorySummary,
} from './types'

function textPreview(value: string, max = 360): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

function readRelatedMemories(workspacePath: string, limit = 8): MemorySummary[] {
  const memory = readClaudeMemory('project', workspacePath)
  const items: MemorySummary[] = []
  for (const file of memory.files) {
    if (!file.exists || file.name === 'MEMORY.md' || !file.content.trim()) continue
    const sections = file.content.split(/\n(?=##? )/g).map(section => section.trim()).filter(Boolean)
    for (const section of sections.slice(-3)) {
      if (/^#\s/.test(section)) continue
      items.push({
        id: `${file.name}:${items.length}`,
        type: file.kind,
        content: textPreview(section),
        source: path.basename(file.path),
      })
    }
  }
  return items.slice(-limit)
}

function toRuleSummary(rule: ReturnType<typeof listProjectRules>[number]): RuleSummary {
  return {
    id: rule.id,
    title: rule.title,
    rule: rule.rule,
    status: rule.status,
    scope: rule.scope,
    priority: rule.priority,
    appliedCount: rule.appliedCount,
    successCount: rule.successCount,
    conflictCount: rule.conflictCount,
  }
}

function toDossierSummary(dossier: NonNullable<ReturnType<typeof getLatestProjectDossier>>): DossierSummary {
  return {
    id: dossier.id,
    version: dossier.version,
    summary: textPreview(dossier.summary, 1200),
    stableRules: textPreview(dossier.stableRules, 1200),
    recentRisks: textPreview(dossier.recentRisks, 1000),
    repeatedIssues: textPreview(dossier.repeatedIssues, 1000),
    deprecatedUnderstanding: textPreview(dossier.deprecatedUnderstanding, 1000),
    nextSteps: textPreview(dossier.nextSteps, 800),
  }
}

function toSemanticSummary(memory: ReturnType<typeof listSemanticMemories>[number]): SemanticMemorySummary {
  return {
    id: memory.id,
    title: textPreview(memory.title, 160),
    content: textPreview(memory.content, 520),
    category: memory.category,
    status: memory.status,
    confidence: memory.confidence,
    strength: memory.strength,
    occurrences: memory.occurrences,
    sourceObservationIds: memory.sourceObservationIds.slice(0, 12),
    staleScore: memory.staleScore,
  }
}

function toObservationSummary(observation: ReturnType<typeof listRecentObservations>[number]): ObservationSummary {
  return {
    id: observation.id,
    observationKey: observation.observationKey,
    category: observation.category,
    content: textPreview(observation.content, 420),
    confidence: observation.confidence,
    status: observation.status,
    sourceTrigger: observation.sourceTrigger,
    createdAt: observation.createdAt,
  }
}

export function buildEvolutionPacket(params: {
  projectId?: string
  sessionId: string
  workspacePath: string
  trigger: EvolutionTrigger
  messages: MessageSnippet[]
  candidate?: MemoryCandidate
}): EvolutionPacket {
  const rules = listProjectRules({ projectId: params.projectId, workspacePath: params.workspacePath, limit: 80 })
  const dossier = cleanProjectDossier(getLatestProjectDossier({
    projectId: params.projectId,
    workspacePath: params.workspacePath,
  }))
  return {
    projectId: params.projectId,
    sessionId: params.sessionId,
    workspacePath: params.workspacePath,
    trigger: params.trigger,
    snippets: params.messages.slice(-8),
    candidate: params.candidate,
    relatedMemories: readRelatedMemories(params.workspacePath),
    projectDossier: dossier ? toDossierSummary(dossier) : null,
    semanticMemories: listSemanticMemories({
      projectId: params.projectId,
      workspacePath: params.workspacePath,
      statuses: ['active', 'candidate', 'stale'],
      limit: 60,
    }).map(toSemanticSummary),
    recentObservations: listRecentObservations({
      projectId: params.projectId,
      workspacePath: params.workspacePath,
      statuses: ['active'],
      limit: 40,
    }).map(toObservationSummary),
    activeRules: rules.filter(rule => rule.status === 'active').map(toRuleSummary),
    shadowRules: rules.filter(rule => rule.status === 'shadow' || rule.status === 'candidate').map(toRuleSummary),
  }
}
