/**
 * Single source of truth for supported model definitions.
 */

export interface ModelEntry {
  id: string
  label: string
  displayLabel?: string
  provider: string
  providerId: string
  apiModelId?: string
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

export function getApiModelId(modelId?: string | null): string | undefined {
  const entry = getModelEntry(modelId)
  if (entry) return entry.apiModelId || entry.id
  return modelId || undefined
}

export function getModelLabel(modelId?: string | null): string {
  const entry = getModelEntry(modelId)
  return entry?.label || modelId || 'Unknown'
}

export interface ModelCatalogEntry {
  id: string
  label: string
  tier: 'fast' | 'main' | 'heavy'
}

export const PROVIDER_MODEL_CATALOGS: Record<string, ModelCatalogEntry[]> = {
  anthropic: [
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', tier: 'fast' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', tier: 'main' },
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', tier: 'heavy' },
  ],
  deepseek: [
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', tier: 'heavy' },
    { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', tier: 'fast' },
  ],
  qwen: [
    { id: 'qwen3.5-plus', label: 'Qwen3.5 Plus', tier: 'main' },
    { id: 'qwen3.6-plus', label: 'Qwen3.6 Plus', tier: 'heavy' },
  ],
  glm: [
    { id: 'glm-5', label: 'GLM-5', tier: 'main' },
    { id: 'glm-5.1', label: 'GLM-5.1', tier: 'heavy' },
  ],
  doubao: [
    { id: 'ark-code-latest', label: 'Ark Code Latest', tier: 'main' },
  ],
  chatgpt: [
    { id: 'gpt-5.5', label: 'GPT-5.5', tier: 'heavy' },
    { id: 'gpt-5.4', label: 'GPT-5.4', tier: 'main' },
  ],
  custom: [],
}
