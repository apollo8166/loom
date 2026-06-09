import type { ProviderConfig } from './provider-config'

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 1_000_000
export const CONTEXT_WINDOW_FALLBACK_SETTING_KEY = 'default_context_window_tokens'

export type ModelTier = 'fast' | 'main' | 'heavy'
export type ContextWindowSource = 'tier_override' | 'model_catalog' | 'model_pattern' | 'fallback'

export type ResolvedContextWindow = {
  tokens: number
  source: ContextWindowSource
  modelId?: string
}

type ContextWindowProviderConfig = {
  fastModel?: string
  mainModel?: string
  heavyModel?: string
  fastContextWindowTokens?: number
  mainContextWindowTokens?: number
  heavyContextWindowTokens?: number
}

const EXACT_MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-haiku-4-5': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-opus-4-6': 1_000_000,
  'deepseek-v4-flash': 1_000_000,
  'deepseek-v4-pro': 1_000_000,
  'qwen3.5-plus': 1_000_000,
  'qwen3.6-plus': 1_000_000,
  'glm-5': 200_000,
  'glm-5.1': 200_000,
  'ark-code-latest': 256_000,
  'gpt-5.5': 1_050_000,
  'gpt-5.4': 1_050_000,
  'gpt-5.2': 400_000,
  'gpt-5.1': 400_000,
  'gpt-5': 400_000,
  'gpt-4.1': 1_047_576,
  'gemini-2.5-pro': 1_048_576,
}

const MODEL_CONTEXT_WINDOW_PATTERNS: Array<{ pattern: RegExp; tokens: number }> = [
  { pattern: /^claude-.*opus/i, tokens: 1_000_000 },
  { pattern: /^claude-/i, tokens: 200_000 },
  { pattern: /^deepseek-v4/i, tokens: 1_000_000 },
  { pattern: /^qwen3\.6/i, tokens: 1_000_000 },
  { pattern: /^qwen3\.5/i, tokens: 1_000_000 },
  { pattern: /^glm-5/i, tokens: 200_000 },
  { pattern: /^ark-code/i, tokens: 256_000 },
  { pattern: /^gpt-5\.[45]/i, tokens: 1_050_000 },
  { pattern: /^gpt-5(?:\.|$)/i, tokens: 400_000 },
  { pattern: /^gpt-4\.1/i, tokens: 1_047_576 },
  { pattern: /^gemini-2\.5-pro/i, tokens: 1_048_576 },
]

export function normalizeContextWindowTokens(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const normalized = typeof value === 'string' ? value.replace(/[,，\s]/g, '') : value
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return Math.round(parsed)
}

export function parseContextWindowFallback(value: unknown): number {
  return normalizeContextWindowTokens(value) ?? DEFAULT_CONTEXT_WINDOW_TOKENS
}

export function getModelContextWindowTokens(modelId?: string | null): number | undefined {
  const normalized = modelId?.trim().toLowerCase()
  if (!normalized) return undefined
  const exact = EXACT_MODEL_CONTEXT_WINDOWS[normalized]
  if (exact) return exact
  return MODEL_CONTEXT_WINDOW_PATTERNS.find(entry => entry.pattern.test(normalized))?.tokens
}

export function getProviderTierModel(config: ContextWindowProviderConfig | undefined, tier: ModelTier): string | undefined {
  if (!config) return undefined
  if (tier === 'fast') return config.fastModel?.trim() || undefined
  if (tier === 'heavy') return config.heavyModel?.trim() || undefined
  return config.mainModel?.trim() || undefined
}

export function getProviderTierContextWindow(
  config: ContextWindowProviderConfig | undefined,
  tier: ModelTier,
): number | undefined {
  if (!config) return undefined
  if (tier === 'fast') return normalizeContextWindowTokens(config.fastContextWindowTokens)
  if (tier === 'heavy') return normalizeContextWindowTokens(config.heavyContextWindowTokens)
  return normalizeContextWindowTokens(config.mainContextWindowTokens)
}

export function inferLogicalTier(modelId?: string | null): ModelTier {
  const normalized = modelId?.trim().toLowerCase() || ''
  if (/haiku|fast/.test(normalized)) return 'fast'
  if (/opus|heavy/.test(normalized)) return 'heavy'
  return 'main'
}

export function resolveContextWindowTokens({
  logicalModel,
  actualModel,
  providerConfig,
  catalogContextWindowTokens,
  fallbackTokens = DEFAULT_CONTEXT_WINDOW_TOKENS,
}: {
  logicalModel?: string | null
  actualModel?: string | null
  providerConfig?: Pick<ProviderConfig,
    | 'fastModel'
    | 'mainModel'
    | 'heavyModel'
    | 'fastContextWindowTokens'
    | 'mainContextWindowTokens'
    | 'heavyContextWindowTokens'
  > | ContextWindowProviderConfig
  catalogContextWindowTokens?: number
  fallbackTokens?: number
}): ResolvedContextWindow {
  const tier = inferLogicalTier(logicalModel)
  const tierWindow = getProviderTierContextWindow(providerConfig, tier)
  if (tierWindow) {
    return { tokens: tierWindow, source: 'tier_override', modelId: actualModel || getProviderTierModel(providerConfig, tier) || logicalModel || undefined }
  }

  const catalogWindow = normalizeContextWindowTokens(catalogContextWindowTokens)
  if (catalogWindow) {
    return { tokens: catalogWindow, source: 'model_catalog', modelId: actualModel || logicalModel || undefined }
  }

  const resolvedModel = actualModel || getProviderTierModel(providerConfig, tier) || logicalModel
  const modelWindow = getModelContextWindowTokens(resolvedModel) ?? getModelContextWindowTokens(logicalModel)
  if (modelWindow) {
    return { tokens: modelWindow, source: 'model_pattern', modelId: resolvedModel || logicalModel || undefined }
  }

  return {
    tokens: parseContextWindowFallback(fallbackTokens),
    source: 'fallback',
    modelId: resolvedModel || logicalModel || undefined,
  }
}

export function formatContextWindowTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    const value = tokens / 1_000_000
    return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2)}M`
  }
  if (tokens >= 1_000) {
    const value = tokens / 1_000
    return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}K`
  }
  return tokens.toLocaleString()
}
