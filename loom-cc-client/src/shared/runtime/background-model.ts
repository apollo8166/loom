import { resolveProvider, type ResolvedProvider } from '@/shared/runtime/provider'

export type BackgroundModelTier = 'fast' | 'main' | 'heavy'

export interface BackgroundModelCandidate {
  tier: BackgroundModelTier
  logicalModel: string
  provider: ResolvedProvider
  modelId: string
}

const BACKGROUND_MODEL_TIERS: Array<{ tier: BackgroundModelTier; logicalModel: string }> = [
  { tier: 'fast', logicalModel: 'claude-haiku-4-5' },
  { tier: 'main', logicalModel: 'claude-sonnet-4-6' },
  { tier: 'heavy', logicalModel: 'claude-opus-4-6' },
]

export function getBackgroundModelCandidates(): BackgroundModelCandidate[] {
  const candidates: BackgroundModelCandidate[] = []
  const seen = new Set<string>()
  for (const item of BACKGROUND_MODEL_TIERS) {
    const provider = resolveProvider(item.logicalModel)
    const modelId = provider.resolvedModelId || item.logicalModel
    const key = `${provider.providerId}:${provider.apiFormat || 'anthropic'}:${modelId}`
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({
      tier: item.tier,
      logicalModel: item.logicalModel,
      provider,
      modelId,
    })
  }
  return candidates
}

export function isUnavailableModelError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /model_not_found|No available channel|model.*not.*found|not found/i.test(message)
}
