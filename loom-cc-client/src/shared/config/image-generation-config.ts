import type Database from 'better-sqlite3'

export type ImageProviderId = 'openai' | 'seedream' | 'nano-banana'
export type ImageGenerationMode = 'auto' | 'text_to_image' | 'image_to_image'
export type ImageOutputFormat = 'png' | 'jpeg' | 'webp'
export type ImageApiFormat = 'openai-images' | 'ark-images' | 'openai-chat-completions'

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

export interface ImageStylePreset {
  id: string
  label: string
  promptSuffix: string
  thumbnailUrl?: string
}

export interface ImageAspectRatioPreset {
  id: string
  label: string
  size: string
}

export const IMAGE_PROVIDER_ORDER: ImageProviderId[] = ['openai', 'seedream', 'nano-banana']

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
  'nano-banana': {
    id: 'nano-banana',
    name: 'Nano Banana 2',
    baseUrl: '',
    model: '',
    apiFormat: 'openai-chat-completions',
    supportsReferenceImage: true,
  },
}

export function isGptImage2Model(model: string | null | undefined): boolean {
  return /(^|[^a-z0-9])gpt[-_\s]*image[-_\s]*2([^a-z0-9]|$)/i.test(model ?? '')
}

export const IMAGE_STYLE_PRESETS: ImageStylePreset[] = [
  { id: 'none', label: '无风格', promptSuffix: '' },
  { id: 'portrait', label: '人像摄影', promptSuffix: '，人像摄影风格，自然光，高清写实', thumbnailUrl: '/image-styles/portrait.webp' },
  { id: 'cinematic', label: '电影写真', promptSuffix: '，电影质感，胶片色调，大光圈虚化', thumbnailUrl: '/image-styles/cinematic.webp' },
  { id: 'chinese', label: '中国风', promptSuffix: '，中国传统水墨工笔画风格', thumbnailUrl: '/image-styles/chinese.webp' },
  { id: 'anime', label: '动漫', promptSuffix: '，动漫风格，细腻线条，明亮色彩', thumbnailUrl: '/image-styles/anime.webp' },
  { id: '3d', label: '3D 渲染', promptSuffix: '，3D 渲染风格，写实材质，电影级光影', thumbnailUrl: '/image-styles/3d.webp' },
  { id: 'cyberpunk', label: '赛博朋克', promptSuffix: '，赛博朋克风格，霓虹灯，未来城市，高对比度', thumbnailUrl: '/image-styles/cyberpunk.webp' },
  { id: 'cg', label: 'CG 动画', promptSuffix: '，CG 动画风格，精细建模，柔和电影光影', thumbnailUrl: '/image-styles/cg.webp' },
  { id: 'ink', label: '水墨画', promptSuffix: '，中国水墨画风格，留白意境，淡彩', thumbnailUrl: '/image-styles/ink.webp' },
  { id: 'oil', label: '油画', promptSuffix: '，油画风格，厚涂笔触，经典绘画质感', thumbnailUrl: '/image-styles/oil.webp' },
  { id: 'classical', label: '古典', promptSuffix: '，古典绘画风格，典雅构图，柔和明暗关系', thumbnailUrl: '/image-styles/classical.webp' },
  { id: 'watercolor', label: '水彩画', promptSuffix: '，水彩画风格，透明叠色，柔和边缘', thumbnailUrl: '/image-styles/watercolor.webp' },
  { id: 'cartoon', label: '卡通', promptSuffix: '，卡通风格，扁平化，明亮饱和配色', thumbnailUrl: '/image-styles/cartoon.webp' },
  { id: 'flat-illustration', label: '平面插画', promptSuffix: '，平面插画风格，简洁形状，清晰色块', thumbnailUrl: '/image-styles/flat-illustration.webp' },
  { id: 'landscape', label: '风景', promptSuffix: '，风景摄影与插画质感，开阔构图，自然光影', thumbnailUrl: '/image-styles/landscape.webp' },
  { id: 'hong-kong-anime', label: '港风动漫', promptSuffix: '，港风动漫风格，复古色调，强烈城市氛围', thumbnailUrl: '/image-styles/hong-kong-anime.webp' },
  { id: 'pixel', label: '像素风格', promptSuffix: '，像素艺术风格，低分辨率方块质感，复古游戏感', thumbnailUrl: '/image-styles/pixel.webp' },
  { id: 'fluorescent', label: '荧光绘画', promptSuffix: '，荧光绘画风格，高饱和霓虹色，发光边缘', thumbnailUrl: '/image-styles/fluorescent.webp' },
  { id: 'colored-pencil', label: '彩铅画', promptSuffix: '，彩铅画风格，细腻铅笔纹理，手绘质感', thumbnailUrl: '/image-styles/colored-pencil.webp' },
  { id: 'figurine', label: '手办', promptSuffix: '，手办模型风格，精致塑料材质，棚拍光线', thumbnailUrl: '/image-styles/figurine.webp' },
  { id: 'children', label: '儿童绘画', promptSuffix: '，儿童绘画风格，天真笔触，明快色彩', thumbnailUrl: '/image-styles/children.webp' },
  { id: 'abstract', label: '抽象', promptSuffix: '，抽象艺术风格，形状与色彩表达，非写实构成', thumbnailUrl: '/image-styles/abstract.webp' },
  { id: 'sharp-illustration', label: '锐笔插画', promptSuffix: '，锐笔插画风格，清晰线条，利落边缘，高完成度', thumbnailUrl: '/image-styles/sharp-illustration.webp' },
  { id: 'acg', label: '二次元', promptSuffix: '，二次元绘画风格，精致角色设计，清爽上色', thumbnailUrl: '/image-styles/acg.webp' },
  { id: 'ink-print', label: '油墨印刷', promptSuffix: '，油墨印刷风格，网点颗粒，复古印刷质感', thumbnailUrl: '/image-styles/ink-print.webp' },
  { id: 'printmaking', label: '版画', promptSuffix: '，版画风格，刻痕线条，高对比块面', thumbnailUrl: '/image-styles/printmaking.webp' },
  { id: 'monet', label: '莫奈', promptSuffix: '，印象派绘画风格，柔和光色变化，莫奈式笔触', thumbnailUrl: '/image-styles/monet.webp' },
  { id: 'picasso', label: '毕加索', promptSuffix: '，立体主义绘画风格，几何拆解，毕加索式构成', thumbnailUrl: '/image-styles/picasso.webp' },
  { id: 'rembrandt', label: '伦勃朗', promptSuffix: '，伦勃朗式古典油画风格，强烈明暗对比，温暖暗调', thumbnailUrl: '/image-styles/rembrandt.webp' },
  { id: 'matisse', label: '马蒂斯', promptSuffix: '，马蒂斯式绘画风格，大胆色块，装饰性构图', thumbnailUrl: '/image-styles/matisse.webp' },
  { id: 'baroque', label: '巴洛克', promptSuffix: '，巴洛克艺术风格，戏剧化光影，繁复动态构图', thumbnailUrl: '/image-styles/baroque.webp' },
  { id: 'retro-anime', label: '复古动漫', promptSuffix: '，复古动漫风格，旧动画质感，怀旧色彩', thumbnailUrl: '/image-styles/retro-anime.webp' },
  { id: 'picture-book', label: '绘本', promptSuffix: '，绘本插画风格，温柔叙事感，细腻手绘纹理', thumbnailUrl: '/image-styles/picture-book.webp' },
]

export const IMAGE_ASPECT_RATIO_PRESETS: ImageAspectRatioPreset[] = [
  { id: '1:1', label: '1:1 正方形，头像', size: '1024x1024' },
  { id: '2:3', label: '2:3 社交媒体，自拍', size: '832x1248' },
  { id: '3:4', label: '3:4 经典比例，拍照', size: '896x1152' },
  { id: '4:3', label: '4:3 文章配图，插画', size: '1152x896' },
  { id: '9:16', label: '9:16 手机壁纸，人像', size: '576x1024' },
  { id: '16:9', label: '16:9 桌面壁纸，风景', size: '1536x864' },
]

export const DEFAULT_IMAGE_GENERATION_CONFIG: ImageGenerationConfig = {
  enabled: false,
  activeProviderId: 'openai',
  defaultMode: 'auto',
  outputFormat: 'png',
  alwaysConfirm: false,
  configs: IMAGE_PROVIDER_ORDER.map(id => ({ ...IMAGE_PROVIDER_PRESETS[id], apiKey: '' })),
}

const KEY_CONFIG = 'image_generation_config'

const VALID_PROVIDER_IDS: ImageProviderId[] = ['openai', 'seedream', 'nano-banana']

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
  if (!VALID_PROVIDER_IDS.includes(config.id as ImageProviderId)) return null
  const id = config.id as ImageProviderId
  const preset = IMAGE_PROVIDER_PRESETS[id]
  return {
    ...preset,
    ...config,
    id: preset.id,
    name: config.name || preset.name,
    apiKey: config.apiKey || '',
    baseUrl: config.baseUrl || preset.baseUrl,
    model: config.model || preset.model,
    apiFormat: id === 'nano-banana' ? preset.apiFormat : config.apiFormat || preset.apiFormat,
    supportsReferenceImage: id === 'nano-banana'
      ? preset.supportsReferenceImage
      : config.supportsReferenceImage ?? preset.supportsReferenceImage,
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
  const activeProviderId: ImageProviderId = VALID_PROVIDER_IDS.includes(value?.activeProviderId as ImageProviderId)
    ? (value!.activeProviderId as ImageProviderId)
    : 'openai'
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
    alwaysConfirm: value?.alwaysConfirm === true,
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
  if (!baseUrl) return ''
  if ((providerId === 'openai' || providerId === 'nano-banana') && !/\/v\d+$/.test(baseUrl)) {
    return `${baseUrl}/v1`
  }
  return baseUrl
}

export function getStylePromptSuffix(styleId: string): string {
  return IMAGE_STYLE_PRESETS.find(s => s.id === styleId)?.promptSuffix ?? ''
}

export function getAspectRatioSize(aspectRatioId: string): string {
  return IMAGE_ASPECT_RATIO_PRESETS.find(r => r.id === aspectRatioId)?.size ?? '1024x1024'
}

const ARK_MIN_IMAGE_PIXELS = 2560 * 1440
const ARK_MAX_IMAGE_PIXELS = 4096 * 4096
const ARK_SIZE_MULTIPLE = 16

function roundUpToMultiple(value: number, multiple: number): number {
  return Math.ceil(value / multiple) * multiple
}

function roundDownToMultiple(value: number, multiple: number): number {
  return Math.max(multiple, Math.floor(value / multiple) * multiple)
}

export function normalizeArkImageSize(size: string): string {
  const raw = (size || '').trim()
  if (!raw) return '2048x2048'

  const symbolic = raw.toUpperCase()
  if (symbolic === '1K' || symbolic === '2K' || symbolic === '4K' || symbolic === 'ADAPTIVE') {
    return symbolic
  }

  const match = raw.match(/^(\d+)\s*[xX]\s*(\d+)$/)
  if (!match) return raw

  const width = Number(match[1])
  const height = Number(match[2])
  const pixels = width * height
  if (!Number.isFinite(pixels) || pixels <= 0) return '2048x2048'
  if (pixels >= ARK_MIN_IMAGE_PIXELS && pixels <= ARK_MAX_IMAGE_PIXELS) return `${width}x${height}`

  if (pixels < ARK_MIN_IMAGE_PIXELS) {
    const scale = Math.sqrt(ARK_MIN_IMAGE_PIXELS / pixels)
    let nextWidth = roundUpToMultiple(width * scale, ARK_SIZE_MULTIPLE)
    let nextHeight = roundUpToMultiple(height * scale, ARK_SIZE_MULTIPLE)
    const ratio = width / Math.max(height, 1)
    while (nextWidth * nextHeight < ARK_MIN_IMAGE_PIXELS) {
      if (nextWidth / Math.max(nextHeight, 1) >= ratio) nextHeight += ARK_SIZE_MULTIPLE
      else nextWidth += ARK_SIZE_MULTIPLE
    }
    return `${nextWidth}x${nextHeight}`
  }

  const scale = Math.sqrt(ARK_MAX_IMAGE_PIXELS / pixels)
  return `${roundDownToMultiple(width * scale, ARK_SIZE_MULTIPLE)}x${roundDownToMultiple(height * scale, ARK_SIZE_MULTIPLE)}`
}
