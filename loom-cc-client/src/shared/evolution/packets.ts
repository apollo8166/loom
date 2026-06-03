import path from 'node:path'
import { readClaudeMemory } from '@/shared/memory/files'
import type { MemoryCandidate } from '@/shared/memory/types'
import { listProjectRules } from './rule-store'
import type { EvolutionPacket, EvolutionTrigger, MemorySummary, MessageSnippet, RuleSummary } from './types'

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

export function buildEvolutionPacket(params: {
  projectId?: string
  sessionId: string
  workspacePath: string
  trigger: EvolutionTrigger
  messages: MessageSnippet[]
  candidate?: MemoryCandidate
}): EvolutionPacket {
  const rules = listProjectRules({ projectId: params.projectId, workspacePath: params.workspacePath, limit: 80 })
  return {
    projectId: params.projectId,
    sessionId: params.sessionId,
    workspacePath: params.workspacePath,
    trigger: params.trigger,
    snippets: params.messages.slice(-8),
    candidate: params.candidate,
    relatedMemories: readRelatedMemories(params.workspacePath),
    activeRules: rules.filter(rule => rule.status === 'active').map(toRuleSummary),
    shadowRules: rules.filter(rule => rule.status === 'shadow' || rule.status === 'candidate').map(toRuleSummary),
  }
}
