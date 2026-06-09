import type Database from 'better-sqlite3'

export type ImageProviderId = 'openai' | 'seedream'
export type ImageGenerationMode = 'auto' | 'text_to_image' | 'image_to_image'
export type ImageOutputFormat = 'png' | 'jpeg' | 'webp'
export type ImageApiFormat = 'openai-images' | 'ark-images'

export interface ImageProviderConfig {
  id: ImageProviderId
  name: string
  apiKey: string
  baseUrl: string
  model: string
  apiFormat: ImageApiFormat
  supportsReferenceImage: boolean
}

export interface ImageGenerationConfig {
  enabled: boolean
  activeProviderId: ImageProviderId
  defaultMode: ImageGenerationMode
  outputFormat: ImageOutputFormat
  alwaysConfirm: boolean
  configs: ImageProviderConfig[]
}

export const IMAGE_PROVIDER_ORDER: ImageProviderId[] = ['openai', 'seedream']

export const IMAGE_PROVIDER_PRESETS: Record<ImageProviderId, Omit<ImageProviderConfig, 'apiKey'>> = {
  openai: {
    id: 'openai',
    name: 'GPT-Image2 / OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-image-2',
    apiFormat: 'openai-images',
    supportsReferenceImage: true,
  },
  seedream: {
    id: 'seedream',
    name: 'SeeDream / 火山方舟',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seedream-4-0-250828',
    apiFormat: 'ark-images',
    supportsReferenceImage: true,
  },
}

export const DEFAULT_IMAGE_GENERATION_CONFIG: ImageGenerationConfig = {
  enabled: false,
  activeProviderId: 'openai',
  defaultMode: 'auto',
  outputFormat: 'png',
  alwaysConfirm: true,
  configs: IMAGE_PROVIDER_ORDER.map(id => ({ ...IMAGE_PROVIDER_PRESETS[id], apiKey: '' })),
}

const KEY_CONFIG = 'image_generation_config'

function dbGet(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

function dbSet(db: Database.Database, key: string, value: string): void {
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value)
}

function normalizeProviderConfig(config: Partial<ImageProviderConfig> & { id?: string }): ImageProviderConfig | null {
  if (config.id !== 'openai' && config.id !== 'seedream') return null
  const preset = IMAGE_PROVIDER_PRESETS[config.id]
  return {
    ...preset,
    ...config,
    id: preset.id,
    name: config.name || preset.name,
    apiKey: config.apiKey || '',
    baseUrl: config.baseUrl || preset.baseUrl,
    model: config.model || preset.model,
    apiFormat: config.apiFormat || preset.apiFormat,
    supportsReferenceImage: config.supportsReferenceImage ?? preset.supportsReferenceImage,
  }
}

export function normalizeImageGenerationConfig(value: Partial<ImageGenerationConfig> | null | undefined): ImageGenerationConfig {
  const rawConfigs = Array.isArray(value?.configs) ? value.configs : []
  const normalizedConfigs = rawConfigs
    .map(config => normalizeProviderConfig(config))
    .filter((config): config is ImageProviderConfig => Boolean(config))

  const byId = new Map<ImageProviderId, ImageProviderConfig>()
  for (const config of normalizedConfigs) byId.set(config.id, config)

  const configs = IMAGE_PROVIDER_ORDER.map(id => byId.get(id) ?? { ...IMAGE_PROVIDER_PRESETS[id], apiKey: '' })
  const activeProviderId = value?.activeProviderId === 'seedream' ? 'seedream' : 'openai'
  const defaultMode = value?.defaultMode === 'text_to_image' || value?.defaultMode === 'image_to_image'
    ? value.defaultMode
    : 'auto'
  const outputFormat = value?.outputFormat === 'jpeg' || value?.outputFormat === 'webp'
    ? value.outputFormat
    : 'png'

  return {
    enabled: value?.enabled === true,
    activeProviderId,
    defaultMode,
    outputFormat,
    alwaysConfirm: value?.alwaysConfirm !== false,
    configs,
  }
}

export function getImageGenerationConfig(db: Database.Database): ImageGenerationConfig {
  const raw = dbGet(db, KEY_CONFIG)
  if (!raw) return DEFAULT_IMAGE_GENERATION_CONFIG
  try {
    return normalizeImageGenerationConfig(JSON.parse(raw) as Partial<ImageGenerationConfig>)
  } catch {
    return DEFAULT_IMAGE_GENERATION_CONFIG
  }
}

export function saveImageGenerationConfig(db: Database.Database, config: ImageGenerationConfig): void {
  dbSet(db, KEY_CONFIG, JSON.stringify(normalizeImageGenerationConfig(config)))
}

export function getActiveImageProviderConfig(db: Database.Database): ImageProviderConfig | null {
  const config = getImageGenerationConfig(db)
  if (!config.enabled) return null
  return config.configs.find(provider => provider.id === config.activeProviderId) ?? null
}

export function normalizeImageBaseUrl(value: string, fallback: string): string {
  return (value || fallback).replace(/\/+$/, '')
}

export function normalizeImageApiBaseUrl(providerId: ImageProviderId, value?: string): string {
  const fallback = IMAGE_PROVIDER_PRESETS[providerId].baseUrl
  const baseUrl = normalizeImageBaseUrl(value || fallback, fallback)
  if (providerId === 'openai' && !/\/v\d+$/.test(baseUrl)) {
    return `${baseUrl}/v1`
  }
  return baseUrl
}
