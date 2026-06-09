import type { ScheduledTask } from '@/shared/types'

export function normalizeTaskSkillNames(values: unknown): string[] {
  const rawValues = Array.isArray(values) ? values : [values]
  const seen = new Set<string>()
  const names: string[] = []

  for (const value of rawValues) {
    if (typeof value !== 'string') continue
    const name = value.replace(/^\//, '').trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }

  return names
}

export function parseTaskSkillNames(value: string | null | undefined): string[] {
  const text = value?.trim()
  if (!text) return []

  if (text.startsWith('[')) {
    try {
      return normalizeTaskSkillNames(JSON.parse(text))
    } catch {
      // Fall through to legacy single-skill parsing.
    }
  }

  return normalizeTaskSkillNames(text)
}

export function serializeTaskSkillNames(names: unknown): string {
  const normalized = normalizeTaskSkillNames(names)
  if (normalized.length === 0) return ''
  if (normalized.length === 1) return normalized[0]
  return JSON.stringify(normalized)
}

export function getTaskSkillNames(task: Pick<ScheduledTask, 'skillName' | 'skillNames'> | null | undefined): string[] {
  if (!task) return []
  if (task.skillNames?.length) return normalizeTaskSkillNames(task.skillNames)
  return parseTaskSkillNames(task.skillName)
}
