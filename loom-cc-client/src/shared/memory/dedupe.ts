import { readClaudeMemory } from './files'
import type { MemoryCandidate, MemoryScope } from './types'

export interface DuplicateMemoryMatch {
  duplicate: boolean
  similarity: number
  matchedScope: MemoryScope
  matchedSource: string
  matchedContent: string
}

function normalizeMemoryText(value: string): string {
  return value
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[#>*_\-[\]()`"'“”‘’.,，。:：;；!?！？、/\\|{}<>《》\s]/g, '')
    .replace(/(当前|已经|已|项目中|用户要求|用户希望|需要|应该|可以|进行|相关|这个|那个)/g, '')
    .trim()
}

function ngrams(value: string, size = 3): Set<string> {
  const normalized = normalizeMemoryText(value)
  if (!normalized) return new Set()
  if (normalized.length <= size) return new Set([normalized])
  const out = new Set<string>()
  for (let i = 0; i <= normalized.length - size; i++) {
    out.add(normalized.slice(i, i + size))
  }
  return out
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const item of a) {
    if (b.has(item)) intersection += 1
  }
  return intersection / (a.size + b.size - intersection)
}

function splitMemorySections(content: string): string[] {
  return content
    .split(/\n(?=##? )/g)
    .map(section => section.trim())
    .filter(section => {
      if (!section) return false
      if (/^#\s/.test(section)) return false
      if (/^##\s*(Active Summary|Memory Index|Recently Approved)/i.test(section)) return false
      return normalizeMemoryText(section).length >= 12
    })
}

function collectComparableMemory(scope: MemoryScope, workspacePath?: string): Array<{
  scope: MemoryScope
  source: string
  content: string
}> {
  const memory = readClaudeMemory(scope, workspacePath)
  const items: Array<{ scope: MemoryScope; source: string; content: string }> = []

  for (const file of memory.files) {
    if (!file.exists || !file.content.trim()) continue
    if (file.name === 'MEMORY.md') continue
    for (const section of splitMemorySections(file.content)) {
      items.push({ scope, source: file.name, content: section })
    }
  }

  for (const candidate of memory.candidates) {
    if (candidate.status === 'rejected') continue
    items.push({
      scope,
      source: candidate.path,
      content: candidate.content,
    })
  }

  return items
}

export function findDuplicateMemoryCandidate(params: {
  candidate: Pick<MemoryCandidate, 'scope' | 'content'>
  workspacePath?: string
  threshold?: number
}): DuplicateMemoryMatch | null {
  const threshold = params.threshold ?? 0.82
  const targetText = normalizeMemoryText(params.candidate.content)
  if (targetText.length < 12) return null
  const targetGrams = ngrams(params.candidate.content)
  const scopes: MemoryScope[] = params.candidate.scope === 'global'
    ? ['global']
    : ['project', 'global']
  let best: DuplicateMemoryMatch | null = null

  for (const scope of scopes) {
    const workspacePath = scope === 'project' ? params.workspacePath : undefined
    if (scope === 'project' && !workspacePath) continue
    for (const item of collectComparableMemory(scope, workspacePath)) {
      const itemText = normalizeMemoryText(item.content)
      if (!itemText) continue
      const contains = itemText.includes(targetText) || targetText.includes(itemText)
      const similarity = contains ? 1 : jaccard(targetGrams, ngrams(item.content))
      if (!best || similarity > best.similarity) {
        best = {
          duplicate: similarity >= threshold,
          similarity,
          matchedScope: item.scope,
          matchedSource: item.source,
          matchedContent: item.content,
        }
      }
    }
  }

  return best?.duplicate ? best : null
}
