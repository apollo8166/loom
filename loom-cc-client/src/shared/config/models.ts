/**
 * Single source of truth for supported model definitions.
 */

export interface ModelEntry {
  id: string
  label: string
  displayLabel?: string
  provider: string
  providerId: string
}

export const BUILTIN_MODELS: ModelEntry[] = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'Anthropic', providerId: 'anthropic' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'Anthropic', providerId: 'anthropic' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'Anthropic', providerId: 'anthropic' },
]

const MODEL_BY_ID = new Map(BUILTIN_MODELS.map(m => [m.id, m]))

export function getModelEntry(modelId?: string | null): ModelEntry | undefined {
  if (!modelId) return undefined
  return MODEL_BY_ID.get(modelId)
}

export function getModelLabel(modelId?: string | null): string {
  const entry = getModelEntry(modelId)
  return entry?.label || modelId || 'Unknown'
}

export interface ModelCatalogEntry {
  id: string
  label: string
  tier: 'fast' | 'main' | 'heavy'
  contextWindowTokens?: number
}

export const PROVIDER_MODEL_CATALOGS: Record<string, ModelCatalogEntry[]> = {
  anthropic: [
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', tier: 'fast', contextWindowTokens: 200_000 },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', tier: 'main', contextWindowTokens: 200_000 },
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', tier: 'heavy', contextWindowTokens: 1_000_000 },
  ],
  deepseek: [
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', tier: 'heavy', contextWindowTokens: 1_000_000 },
    { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', tier: 'fast', contextWindowTokens: 1_000_000 },
  ],
  qwen: [
    { id: 'qwen3.5-plus', label: 'Qwen3.5 Plus', tier: 'main', contextWindowTokens: 1_000_000 },
    { id: 'qwen3.6-plus', label: 'Qwen3.6 Plus', tier: 'heavy', contextWindowTokens: 1_000_000 },
  ],
  glm: [
    { id: 'glm-5', label: 'GLM-5', tier: 'main', contextWindowTokens: 200_000 },
    { id: 'glm-5.1', label: 'GLM-5.1', tier: 'heavy', contextWindowTokens: 200_000 },
  ],
  doubao: [
    { id: 'ark-code-latest', label: 'Ark Code Latest', tier: 'main', contextWindowTokens: 256_000 },
  ],
  chatgpt: [
    { id: 'gpt-5.5', label: 'GPT-5.5', tier: 'heavy', contextWindowTokens: 1_050_000 },
    { id: 'gpt-5.4', label: 'GPT-5.4', tier: 'main', contextWindowTokens: 1_050_000 },
  ],
  custom: [],
}
