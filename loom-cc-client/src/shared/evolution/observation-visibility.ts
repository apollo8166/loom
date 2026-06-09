import { isSimilarText, keywords, normalizeText } from './text'
import type { ProjectDossier, SemanticMemory, SessionObservation } from './types'

function dossierText(dossier: ProjectDossier | null): string {
  if (!dossier) return ''
  return [
    dossier.summary,
    dossier.currentGoal,
    dossier.userPreferences,
    dossier.stableRules,
    dossier.recentRisks,
    dossier.repeatedIssues,
    dossier.deprecatedUnderstanding,
    dossier.nextSteps,
  ].filter(Boolean).join('\n')
}

function textCoveredBy(content: string, target: string): boolean {
  const source = normalizeText(content)
  const corpus = normalizeText(target)
  if (source.length < 12 || !corpus) return false
  if (corpus.includes(source)) return true

  const sourcePreview = source.slice(0, 160)
  if (sourcePreview.length >= 32 && corpus.includes(sourcePreview)) return true
  if (target.split(/\r?\n/).some(line => isSimilarText(content, line))) return true

  const sourceKeys = keywords(source, 12)
  if (sourceKeys.length < 3) return false
  const covered = sourceKeys.filter(key => corpus.includes(key)).length
  return covered / sourceKeys.length >= 0.75
}

function coveredBySemanticMemory(observation: SessionObservation, memory: SemanticMemory): boolean {
  if (!['active', 'stale'].includes(memory.status)) return false
  if (memory.sourceObservationIds.includes(observation.id)) return true
  if (memory.memoryKey && memory.memoryKey === observation.observationKey) return true
  return textCoveredBy(observation.content, `${memory.title}\n${memory.content}`)
}

export function filterCoveredRecentObservations(params: {
  observations: SessionObservation[]
  semanticMemories: SemanticMemory[]
  dossier: ProjectDossier | null
}): SessionObservation[] {
  const dossierCorpus = dossierText(params.dossier)
  return params.observations.filter(observation => {
    if (observation.status !== 'active') return true
    if (params.semanticMemories.some(memory => coveredBySemanticMemory(observation, memory))) return false
    return !textCoveredBy(observation.content, dossierCorpus)
  })
}
