import { createProjectDossierVersion } from './dossier-store'
import { markObservations } from './observation-store'
import { updateSemanticMemoryFromEvolution } from './semantic-memory-store'
import { recordEvolutionEvent } from './events'
import { preview } from './text'
import type { EvolutionPacket, ObservationStatus, SemanticMemoryStatus } from './types'

type EvolutionDossierPatch = {
  summary?: unknown
  stableRules?: unknown
  recentRisks?: unknown
  repeatedIssues?: unknown
  deprecatedUnderstanding?: unknown
  nextSteps?: unknown
}

type EvolutionSemanticUpdate = {
  id?: unknown
  action?: unknown
  title?: unknown
  content?: unknown
  category?: unknown
  status?: unknown
  mergeSourceIds?: unknown
  absorbedObservationIds?: unknown
  reason?: unknown
}

type EvolutionObservationUpdate = {
  id?: unknown
  status?: unknown
  reason?: unknown
}

export type AppliedProjectEvolution = {
  dossierUpdated: boolean
  semanticUpdated: number
  semanticArchived: number
  observationsMarked: number
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, max)
}

function stringList(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function validSemanticStatus(value: unknown): SemanticMemoryStatus | undefined {
  return value === 'active' || value === 'stale' || value === 'archived' ? value : undefined
}

function validObservationStatus(value: unknown): ObservationStatus | undefined {
  return value === 'active' || value === 'promoted' || value === 'archived' ? value : undefined
}

function hasDossierPatch(patch: EvolutionDossierPatch): boolean {
  return Boolean(
    stringValue(patch.summary, 1) ||
    stringValue(patch.stableRules, 1) ||
    stringValue(patch.recentRisks, 1) ||
    stringValue(patch.repeatedIssues, 1) ||
    stringValue(patch.deprecatedUnderstanding, 1) ||
    stringValue(patch.nextSteps, 1),
  )
}

export function applyProjectEvolutionResult(params: {
  projectId?: string
  sessionId: string
  workspacePath: string
  packet: EvolutionPacket
  result: Record<string, unknown>
}): AppliedProjectEvolution {
  const semanticIds = new Set(params.packet.semanticMemories.map(memory => memory.id))
  const observationIds = new Set(params.packet.recentObservations.map(observation => observation.id))
  const applied: AppliedProjectEvolution = {
    dossierUpdated: false,
    semanticUpdated: 0,
    semanticArchived: 0,
    observationsMarked: 0,
  }

  const dossierPatch = asObject(params.result.dossier) as EvolutionDossierPatch
  if (hasDossierPatch(dossierPatch)) {
    createProjectDossierVersion({
      projectId: params.projectId,
      workspacePath: params.workspacePath,
      source: 'project-evolution',
      summary: stringValue(dossierPatch.summary, 1600),
      stableRules: stringValue(dossierPatch.stableRules, 1600),
      recentRisks: stringValue(dossierPatch.recentRisks, 1200),
      repeatedIssues: stringValue(dossierPatch.repeatedIssues, 1200),
      deprecatedUnderstanding: stringValue(dossierPatch.deprecatedUnderstanding, 1200),
      nextSteps: stringValue(dossierPatch.nextSteps, 1000),
    })
    applied.dossierUpdated = true
  }

  for (const rawUpdate of asArray(params.result.semanticUpdates)) {
    const update = asObject(rawUpdate) as EvolutionSemanticUpdate
    const id = stringValue(update.id, 128)
    if (!id || !semanticIds.has(id)) continue
    const action = stringValue(update.action, 32) || 'keep'
    if (action === 'keep') continue

    const mergeSourceIds = stringList(update.mergeSourceIds).filter(sourceId => semanticIds.has(sourceId) && sourceId !== id)
    const absorbedObservationIds = stringList(update.absorbedObservationIds).filter(observationId => observationIds.has(observationId))
    const status = action === 'archive' ? 'archived' : validSemanticStatus(update.status)
    const updated = updateSemanticMemoryFromEvolution({
      id,
      title: action === 'rewrite' || action === 'merge' ? stringValue(update.title, 180) : undefined,
      content: action === 'rewrite' || action === 'merge' ? stringValue(update.content, 1200) : undefined,
      category: stringValue(update.category, 48),
      status,
      evidenceIds: mergeSourceIds,
      sourceObservationIds: absorbedObservationIds,
      confidenceDelta: action === 'merge' || action === 'rewrite' ? 0.03 : 0,
      strengthDelta: action === 'merge' ? 0.08 : action === 'rewrite' ? 0.03 : 0,
      reason: stringValue(update.reason, 300),
    })
    if (!updated) continue
    if (status === 'archived') applied.semanticArchived += 1
    else applied.semanticUpdated += 1

    if (mergeSourceIds.length > 0) {
      for (const sourceId of mergeSourceIds) {
        const archived = updateSemanticMemoryFromEvolution({
          id: sourceId,
          status: 'archived',
          reason: `Merged into ${id}`,
        })
        if (archived) applied.semanticArchived += 1
      }
    }
    if (absorbedObservationIds.length > 0) {
      markObservations({ ids: absorbedObservationIds, status: 'promoted' })
      applied.observationsMarked += absorbedObservationIds.length
    }
  }

  const observationGroups = new Map<ObservationStatus, string[]>()
  for (const rawUpdate of asArray(params.result.observationUpdates)) {
    const update = asObject(rawUpdate) as EvolutionObservationUpdate
    const id = stringValue(update.id, 128)
    if (!id || !observationIds.has(id)) continue
    const status = validObservationStatus(update.status)
    if (!status || status === 'active') continue
    const ids = observationGroups.get(status) || []
    ids.push(id)
    observationGroups.set(status, ids)
  }
  for (const [status, ids] of observationGroups) {
    markObservations({ ids, status })
    applied.observationsMarked += ids.length
  }

  recordEvolutionEvent({
    projectId: params.projectId,
    sessionId: params.sessionId,
    workspacePath: params.workspacePath,
    eventType: 'project_evolution_applied',
    trigger: params.packet.trigger,
    summary: preview(`dossier ${applied.dossierUpdated ? 'updated' : 'kept'}, semantic updated ${applied.semanticUpdated}, archived ${applied.semanticArchived}, observations ${applied.observationsMarked}`),
    payload: { applied },
  })

  return applied
}
