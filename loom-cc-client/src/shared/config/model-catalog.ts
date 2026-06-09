import { PROVIDER_MODEL_CATALOGS } from './models'
import type { ModelCatalogEntry } from './models'
import { normalizeContextWindowTokens } from './context-window'

export type CustomModelCatalogs = Record<string, ModelCatalogEntry[]>

export const CUSTOM_MODELS_KEY = 'custom_model_catalogs'

export function normalizeModelEntry(entry: Partial<ModelCatalogEntry>): ModelCatalogEntry | null {
  const id = String(entry.id ?? '').trim()
  if (!id) return null
  const label = String(entry.label ?? '').trim() || id
  const tier = entry.tier === 'fast' || entry.tier === 'heavy' ? entry.tier : 'main'
  const contextWindowTokens = normalizeContextWindowTokens(entry.contextWindowTokens)
  return contextWindowTokens ? { id, label, tier, contextWindowTokens } : { id, label, tier }
}

export function mergeModelCatalog(
  providerId: string,
  customCatalogs: CustomModelCatalogs | null | undefined,
): ModelCatalogEntry[] {
  const merged = new Map<string, ModelCatalogEntry>()
  for (const entry of PROVIDER_MODEL_CATALOGS[providerId] ?? []) {
    merged.set(entry.id, entry)
  }
  for (const rawEntry of customCatalogs?.[providerId] ?? []) {
    const entry = normalizeModelEntry(rawEntry)
    if (entry) merged.set(entry.id, entry)
  }
  return [...merged.values()]
}

export function parseCustomModelCatalogs(value: unknown): CustomModelCatalogs {
  if (!value) return {}
  const raw = typeof value === 'string' ? JSON.parse(value) : value
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}

  const result: CustomModelCatalogs = {}
  for (const [providerId, entries] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue
    result[providerId] = entries
      .map(entry => normalizeModelEntry(entry as Partial<ModelCatalogEntry>))
      .filter((entry): entry is ModelCatalogEntry => Boolean(entry))
  }
  return result
}
