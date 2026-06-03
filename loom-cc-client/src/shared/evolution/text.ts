export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function keywords(input: string, limit = 32): string[] {
  const words = normalizeText(input).match(/[a-z0-9_-]{3,}|[\u4e00-\u9fa5]{2,}/g) || []
  return [...new Set(words)].slice(0, limit)
}

export function stableKey(input: string, fallback = 'general'): string {
  const keys = keywords(input, 8)
  if (keys.length === 0) return fallback
  return keys.join(':').slice(0, 160)
}

export function preview(input: string, max = 180): string {
  const value = input.replace(/\s+/g, ' ').trim()
  return value.length <= max ? value : `${value.slice(0, max)}...`
}

export function parseJsonList(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function stringifyList(values: string[] | undefined): string {
  return JSON.stringify([...new Set(values || [])])
}

export function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

export function addDays(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

export function daysSince(value: string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY
  return Math.floor((Date.now() - time) / 86_400_000)
}
