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

function similarityTokens(input: string): string[] {
  const normalized = normalizeText(input)
  const tokens = normalized.match(/[a-z0-9_-]{3,}|[\u4e00-\u9fa5]{2,}/g) || []
  const grams: string[] = []
  for (const token of tokens) {
    if (/^[\u4e00-\u9fa5]+$/u.test(token) && token.length > 2) {
      for (let i = 0; i < token.length - 1; i += 1) grams.push(token.slice(i, i + 2))
    } else {
      grams.push(token)
    }
  }
  return [...new Set(grams)]
}

export function textSimilarity(a: string, b: string): number {
  const left = similarityTokens(a)
  const right = similarityTokens(b)
  if (left.length === 0 || right.length === 0) return 0
  const rightSet = new Set(right)
  const overlap = left.filter(token => rightSet.has(token)).length
  const precision = overlap / left.length
  const recall = overlap / right.length
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
}

export function isSimilarText(a: string, b: string, threshold = 0.72): boolean {
  const left = normalizeText(a)
  const right = normalizeText(b)
  if (left.length < 12 || right.length < 12) return false
  if (left.includes(right) || right.includes(left)) return true
  return textSimilarity(left, right) >= threshold
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
