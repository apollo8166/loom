import { getLatestProjectDossier, rebuildProjectDossierDeterministic } from './dossier-store'
import { listRecentObservations } from './observation-store'
import { listProjectRules } from './rule-store'
import { listSemanticMemories } from './semantic-memory-store'
import { keywords, preview } from './text'
import type { EvolutionInjectionContext, ProjectRule, SemanticMemory, SessionObservation } from './types'

const MAX_INJECTION_CHARS = 4200

function scoreText(text: string, keys: string[]): number {
  const lower = text.toLowerCase()
  return keys.reduce((sum, key) => sum + (lower.includes(key.toLowerCase()) ? 1 : 0), 0)
}

function rankSemanticMemories(memories: SemanticMemory[], userMessage: string): SemanticMemory[] {
  const keys = keywords(userMessage, 24)
  return [...memories].sort((a, b) => {
    const scoreA = a.strength * 100 + a.confidence * 30 - a.staleScore * 15 + scoreText(`${a.title}\n${a.content}`, keys) * 20
    const scoreB = b.strength * 100 + b.confidence * 30 - b.staleScore * 15 + scoreText(`${b.title}\n${b.content}`, keys) * 20
    return scoreB - scoreA
  })
}

function rankRules(rules: ProjectRule[], userMessage: string): ProjectRule[] {
  const keys = keywords(userMessage, 24)
  return [...rules].sort((a, b) => {
    const scoreA = a.strength * 100 + a.confidence * 30 - a.staleScore * 15 + scoreText(`${a.title}\n${a.rule}`, keys) * 20
    const scoreB = b.strength * 100 + b.confidence * 30 - b.staleScore * 15 + scoreText(`${b.title}\n${b.rule}`, keys) * 20
    return scoreB - scoreA
  })
}

function renderSemantic(memory: SemanticMemory): string {
  const evidence = memory.evidenceIds.length > 0 ? ` evidence=${memory.evidenceIds.slice(0, 3).join(',')}` : ''
  return `- ${preview(memory.content, 180)} (id=${memory.id}; strength=${memory.strength.toFixed(2)}; occurrences=${memory.occurrences};${evidence})`
}

function renderObservation(observation: SessionObservation): string {
  const evidence = observation.evidenceIds.length > 0 ? ` evidence=${observation.evidenceIds.slice(0, 2).join(',')}` : ''
  return `- ${preview(observation.content, 150)} (id=${observation.id}; confidence=${observation.confidence.toFixed(2)};${evidence})`
}

function renderRule(rule: ProjectRule): string {
  return `- [${rule.priority}] ${preview(rule.rule, 190)} (id=${rule.id}; strength=${rule.strength.toFixed(2)}; occurrences=${rule.occurrences})`
}

function capRendered(parts: string[], maxChars: number): string {
  let used = 0
  const kept: string[] = []
  for (const part of parts) {
    if (!part.trim()) continue
    if (used + part.length > maxChars) break
    kept.push(part)
    used += part.length
  }
  return kept.join('\n\n')
}

export function buildEvolutionInjectionContext(params: {
  projectId?: string
  workspacePath?: string
  userMessage?: string
  enabled?: boolean
}): EvolutionInjectionContext {
  if (params.enabled === false || !params.workspacePath) {
    return { dossier: null, semanticMemories: [], recentObservations: [], activeRules: [], chars: 0, rendered: '' }
  }
  const dossier = getLatestProjectDossier(params) || rebuildProjectDossierDeterministic({
    projectId: params.projectId,
    workspacePath: params.workspacePath,
    source: 'injection',
  })
  const semanticMemories = rankSemanticMemories(
    listSemanticMemories({
      projectId: params.projectId,
      workspacePath: params.workspacePath,
      statuses: ['active', 'stale'],
      limit: 80,
    }),
    params.userMessage || '',
  ).slice(0, 6)
  const recentObservations = listRecentObservations({
    projectId: params.projectId,
    workspacePath: params.workspacePath,
    statuses: ['active'],
    limit: 3,
  })
  const activeRules = rankRules(
    listProjectRules({
      projectId: params.projectId,
      workspacePath: params.workspacePath,
      statuses: ['active'],
      limit: 40,
    }),
    params.userMessage || '',
  ).slice(0, 8)

  const parts = [
    [
      '## Project Dossier',
      dossier.summary || '- 暂无稳定项目理解。',
      dossier.recentRisks ? `\nRecent risks:\n${dossier.recentRisks}` : '',
      dossier.deprecatedUnderstanding ? `\nDeprecated understanding:\n${dossier.deprecatedUnderstanding}` : '',
    ].filter(Boolean).join('\n'),
    activeRules.length > 0 ? ['## Active Project Rules', ...activeRules.map(renderRule)].join('\n') : '',
    semanticMemories.length > 0 ? ['## Stable Semantic Memories', ...semanticMemories.map(renderSemantic)].join('\n') : '',
    recentObservations.length > 0 ? ['## Recent Observations', ...recentObservations.map(renderObservation)].join('\n') : '',
  ]
  const rendered = capRendered(parts, MAX_INJECTION_CHARS)
  return {
    dossier,
    semanticMemories,
    recentObservations,
    activeRules,
    chars: rendered.length,
    rendered,
  }
}
