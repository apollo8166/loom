import path from 'node:path'
import { ensureClaudeMemory, readClaudeMemory } from './files'
import type { LoomMemoryContext, MemoryScope, RetrievedMemory } from './types'
import { buildEvolutionInjectionContext } from '@/shared/evolution/injection'

const MEMORY_INJECTION_BUDGET_CHARS = 6000
const MAX_GLOBAL_SUMMARY_CHARS = 1200
const MAX_PROJECT_SUMMARY_CHARS = 1800
const MAX_RETRIEVED_CHARS = 3000
const MAX_ITEM_CHARS = 900

const TYPE_PRIORITY: Record<string, number> = {
  corrections: 60,
  preferences: 55,
  decisions: 50,
  workflows: 45,
  project: 35,
  feedback: 25,
  retrospectives: 20,
}

function trim(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n\n[... memory truncated]`
}

function keywords(input: string): string[] {
  const lower = input.toLowerCase()
  const words = lower.match(/[a-z0-9_\-]{3,}|[\u4e00-\u9fa5]{2,}/g) || []
  return [...new Set(words)].slice(0, 32)
}

function scoreContent(content: string, keys: string[]): number {
  const lower = content.toLowerCase()
  return keys.reduce((sum, key) => sum + (lower.includes(key) ? 1 : 0), 0)
}

function scoreFileKind(kind: string): number {
  return TYPE_PRIORITY[kind] ?? 10
}

function splitSections(content: string): string[] {
  const sections = content.split(/\n(?=##? )/g).map(s => s.trim()).filter(Boolean)
  return sections.length > 0 ? sections : [content.trim()].filter(Boolean)
}

function retrieveFromScope(scope: MemoryScope, userMessage: string, workspacePath?: string): { summary: string; retrieved: RetrievedMemory[]; dir: string } {
  const data = readClaudeMemory(scope, workspacePath)
  const keys = keywords(userMessage)
  const summary = trim(
    data.files.find(f => f.name === 'MEMORY.md')?.content || '',
    scope === 'global' ? MAX_GLOBAL_SUMMARY_CHARS : MAX_PROJECT_SUMMARY_CHARS,
  )
  const retrieved: RetrievedMemory[] = []

  for (const file of data.files) {
    if (!file.exists || file.name === 'MEMORY.md' || !file.content.trim()) continue
    for (const section of splitSections(file.content)) {
      const relevanceScore = scoreContent(section, keys)
      if (relevanceScore <= 0) continue
      const score = relevanceScore * 10 + scoreFileKind(file.kind) + (scope === 'project' ? 5 : 0)
      retrieved.push({
        scope,
        source: path.basename(file.path),
        score,
        content: trim(section, MAX_ITEM_CHARS),
      })
    }
  }

  return { summary, retrieved, dir: data.rootDir }
}

export function buildLoomMemoryContext(params: {
  userMessage: string
  workspacePath?: string
  enabled?: boolean
  mode?: 'inject' | 'sdk'
}): LoomMemoryContext {
  if (params.mode === 'sdk') {
    const global = ensureClaudeMemory('global')
    const project = params.workspacePath ? ensureClaudeMemory('project', params.workspacePath) : null
    const evolution = buildEvolutionInjectionContext({
      workspacePath: params.workspacePath,
      userMessage: params.userMessage,
      enabled: params.enabled,
    })
    return {
      enabled: params.enabled !== false,
      globalSummary: '',
      projectSummary: '',
      evolutionSummary: evolution.rendered,
      retrieved: [],
      debug: {
        globalDir: global.rootDir,
        projectDir: project?.rootDir,
        budgetChars: 0,
        injectedChars: evolution.chars,
        globalSummaryChars: 0,
        projectSummaryChars: 0,
        evolutionChars: evolution.chars,
        semanticMemoryCount: evolution.semanticMemories.length,
        recentObservationCount: evolution.recentObservations.length,
        activeRuleCount: evolution.activeRules.length,
        dossierVersion: evolution.dossier?.version,
        retrievedChars: 0,
        retrievedCount: 0,
        rawRetrievedCount: 0,
        truncated: false,
        managedBySdk: true,
        globalMemoryFile: global.files.find(file => file.name === 'MEMORY.md')?.path,
        projectMemoryFile: project?.files.find(file => file.name === 'MEMORY.md')?.path,
      },
    }
  }

  if (params.enabled === false) {
    return {
      enabled: false,
      globalSummary: '',
      projectSummary: '',
      evolutionSummary: '',
      retrieved: [],
      debug: {
        globalDir: '',
        projectDir: params.workspacePath,
        budgetChars: MEMORY_INJECTION_BUDGET_CHARS,
        injectedChars: 0,
        globalSummaryChars: 0,
        projectSummaryChars: 0,
        evolutionChars: 0,
        semanticMemoryCount: 0,
        recentObservationCount: 0,
        activeRuleCount: 0,
        retrievedChars: 0,
        retrievedCount: 0,
        rawRetrievedCount: 0,
        truncated: false,
      },
    }
  }

  const global = retrieveFromScope('global', params.userMessage)
  const project = params.workspacePath ? retrieveFromScope('project', params.userMessage, params.workspacePath) : null
  const evolution = buildEvolutionInjectionContext({
    workspacePath: params.workspacePath,
    userMessage: params.userMessage,
    enabled: params.enabled,
  })
  let globalSummary = global.summary
  let projectSummary = project?.summary || ''
  const retrieved = [...global.retrieved, ...(project?.retrieved || [])]
    .sort((a, b) => b.score - a.score)
  const rawRetrievedCount = retrieved.length

  let summaryBudget = Math.max(0, MEMORY_INJECTION_BUDGET_CHARS - evolution.chars)
  if (globalSummary.length > summaryBudget) globalSummary = trim(globalSummary, summaryBudget)
  summaryBudget -= globalSummary.length
  if (projectSummary.length > summaryBudget) projectSummary = trim(projectSummary, Math.max(0, summaryBudget))
  summaryBudget -= projectSummary.length
  const retrievedBudget = Math.max(0, Math.min(MAX_RETRIEVED_CHARS, summaryBudget))

  let used = 0
  const capped: RetrievedMemory[] = []
  for (const item of retrieved) {
    if (used >= retrievedBudget) break
    const remaining = retrievedBudget - used
    const content = trim(item.content, Math.min(MAX_ITEM_CHARS, remaining))
    capped.push({ ...item, content })
    used += content.length
  }

  const retrievedChars = capped.reduce((sum, item) => sum + item.content.length, 0)
  const injectedChars = globalSummary.length + projectSummary.length + retrievedChars + evolution.chars
  return {
    enabled: true,
    globalSummary,
    projectSummary,
    evolutionSummary: evolution.rendered,
    retrieved: capped,
    debug: {
      globalDir: global.dir,
      projectDir: project?.dir,
      budgetChars: MEMORY_INJECTION_BUDGET_CHARS,
      injectedChars,
      globalSummaryChars: globalSummary.length,
      projectSummaryChars: projectSummary.length,
      evolutionChars: evolution.chars,
      semanticMemoryCount: evolution.semanticMemories.length,
      recentObservationCount: evolution.recentObservations.length,
      activeRuleCount: evolution.activeRules.length,
      dossierVersion: evolution.dossier?.version,
      retrievedChars,
      retrievedCount: capped.length,
      rawRetrievedCount,
      truncated: injectedChars >= MEMORY_INJECTION_BUDGET_CHARS || capped.length < rawRetrievedCount,
    },
  }
}
