import type { ImageProviderConfig } from '@/shared/config/image-generation-config'
import { normalizeImageApiBaseUrl, type ImageOutputFormat } from '@/shared/config/image-generation-config'
import type { GeneratedImage, GenerateImageRequest } from '../types'
import { saveGeneratedImage } from '../storage'
import { readProviderError, referenceToDataUrl } from './common'

type NanoBananaContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type ExtractedImageSource = {
  value: string
  mimeType?: string
}

export async function generateNanoBananaImage(
  provider: ImageProviderConfig,
  request: GenerateImageRequest,
): Promise<GeneratedImage[]> {
  const baseUrl = normalizeImageApiBaseUrl('nano-banana', provider.baseUrl)
  if (!baseUrl) throw new Error('Nano Banana Base URL is not configured')

  const model = provider.model.trim()
  const content: NanoBananaContentPart[] = [
    { type: 'text', text: request.prompt },
  ]

  for (const reference of request.references) {
    content.push({
      type: 'image_url',
      image_url: {
        url: await referenceToDataUrl(reference.path, reference.mimeType),
      },
    })
  }

  const body: Record<string, unknown> = {
    model,
    stream: false,
    messages: [{ role: 'user', content }],
  }
  if (request.count > 1) body.n = request.count

  const imageConfig = buildGoogleImageConfig(request)
  if (imageConfig) {
    body.extra_body = { google: { image_config: imageConfig } }
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`Nano Banana image generation failed: ${await readProviderError(res)}`)
  }

  const data = await res.json()
  const sources = extractImageSources(data)
  if (sources.length === 0) {
    throw new Error('Nano Banana response did not include an image URL or base64 image')
  }

  const images: GeneratedImage[] = []
  const limit = Math.max(1, request.count || 1)
  let lastDownloadError: unknown = null
  for (const source of sources) {
    if (images.length >= limit) break
    try {
      const downloaded = await sourceToBuffer(source)
      images.push(await saveGeneratedImage({
        buffer: downloaded.buffer,
        providerId: provider.id,
        model,
        outputFormat: downloaded.outputFormat ?? request.outputFormat,
        outputName: request.outputName,
        prompt: request.prompt,
        index: images.length,
      }))
    } catch (err) {
      lastDownloadError = err
    }
  }

  if (images.length === 0) {
    const message = lastDownloadError instanceof Error ? lastDownloadError.message : 'No downloadable image found'
    throw new Error(`Nano Banana response did not include a downloadable image: ${message}`)
  }
  return images
}

function buildGoogleImageConfig(request: GenerateImageRequest): Record<string, string> | null {
  const aspectRatio = normalizeAspectRatio(request.aspectRatio) ?? aspectRatioFromSize(request.size)
  const imageSize = normalizeNanoBananaImageSize(request.size)
  const config: Record<string, string> = {}
  if (aspectRatio) config.aspect_ratio = aspectRatio
  if (imageSize) config.image_size = imageSize
  return Object.keys(config).length > 0 ? config : null
}

function normalizeAspectRatio(value?: string): string | null {
  const raw = value?.replace(/\s+/g, '').replace('/', ':')
  if (!raw) return null
  const match = raw.match(/^(\d+):(\d+)$/)
  if (!match) return null
  return `${Number(match[1])}:${Number(match[2])}`
}

function aspectRatioFromSize(size?: string): string | null {
  const match = size?.match(/^(\d+)\s*[xX]\s*(\d+)$/)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const divisor = gcd(width, height)
  return `${width / divisor}:${height / divisor}`
}

function normalizeNanoBananaImageSize(size?: string): string | null {
  const raw = size?.trim().toUpperCase()
  if (raw === '1K' || raw === '2K' || raw === '4K') return raw
  return null
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) {
    const next = x % y
    x = y
    y = next
  }
  return x || 1
}

function extractImageSources(data: unknown): ExtractedImageSource[] {
  const sources: ExtractedImageSource[] = []
  const seen = new Set<string>()

  function add(value: string, mimeType?: string) {
    const trimmed = value.trim()
    if (!trimmed) return
    const key = `${mimeType || ''}:${trimmed}`
    if (seen.has(key)) return
    seen.add(key)
    sources.push({ value: trimmed, mimeType })
  }

  function visit(value: unknown): void {
    if (typeof value === 'string') {
      collectFromString(value, add)
      const json = parsePossibleJson(value)
      if (json) visit(json)
      return
    }
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }

    const record = value as Record<string, unknown>
    const mimeType = stringValue(record.mime_type) ?? stringValue(record.mimeType)
    const b64Json = stringValue(record.b64_json)
    if (b64Json) add(`data:${mimeType || 'image/png'};base64,${b64Json}`, mimeType)

    const inlineData = objectValue(record.inline_data) ?? objectValue(record.inlineData)
    const inlineMimeType = inlineData
      ? stringValue(inlineData.mime_type) ?? stringValue(inlineData.mimeType) ?? mimeType
      : mimeType
    const inlineB64 = inlineData ? stringValue(inlineData.data) : null
    if (inlineB64) add(`data:${inlineMimeType || 'image/png'};base64,${inlineB64}`, inlineMimeType)

    const imageUrl = record.image_url
    if (typeof imageUrl === 'string') add(imageUrl, mimeType)
    if (imageUrl && typeof imageUrl === 'object') {
      const nestedUrl = stringValue((imageUrl as Record<string, unknown>).url)
      if (nestedUrl) add(nestedUrl, mimeType)
    }

    const url = stringValue(record.url)
    if (url) add(url, mimeType)

    for (const item of Object.values(record)) visit(item)
  }

  visit(data)
  return sources
}

function collectFromString(value: string, add: (url: string, mimeType?: string) => void): void {
  const dataUrlPattern = /data:(image\/(?:png|jpe?g|webp));base64,[A-Za-z0-9+/=_-]+/gi
  for (const match of value.matchAll(dataUrlPattern)) {
    add(match[0], match[1])
  }

  const urlPattern = /https?:\/\/[^\s"'<>\\)]+/gi
  for (const match of value.matchAll(urlPattern)) {
    add(match[0].replace(/[.,;\]}]+$/g, ''))
  }
}

function parsePossibleJson(value: string): unknown | null {
  const trimmed = value.trim()
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  if (!unfenced.startsWith('{') && !unfenced.startsWith('[')) return null
  try {
    return JSON.parse(unfenced)
  } catch {
    return null
  }
}

async function sourceToBuffer(source: ExtractedImageSource): Promise<{
  buffer: Buffer
  outputFormat?: ImageOutputFormat
}> {
  if (source.value.startsWith('data:image/')) {
    const parsed = parseDataUrl(source.value)
    return {
      buffer: parsed.buffer,
      outputFormat: imageFormatFromMimeType(parsed.mimeType ?? source.mimeType),
    }
  }

  const res = await fetch(source.value)
  if (!res.ok) throw new Error(`Failed to download generated image: HTTP ${res.status}`)
  const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || source.mimeType
  if (mimeType?.startsWith('text/') || mimeType === 'application/json') {
    throw new Error(`Generated image URL returned ${mimeType}`)
  }
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    outputFormat: imageFormatFromMimeType(mimeType) ?? imageFormatFromUrl(source.value),
  }
}

function parseDataUrl(value: string): { buffer: Buffer; mimeType?: string } {
  const match = value.match(/^data:(image\/[^;]+);base64,(.+)$/i)
  if (!match) throw new Error('Invalid image data URL in Nano Banana response')
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2].replace(/\s+/g, ''), 'base64'),
  }
}

function imageFormatFromMimeType(value?: string | null): ImageOutputFormat | undefined {
  const mimeType = value?.toLowerCase()
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return 'jpeg'
  if (mimeType === 'image/webp') return 'webp'
  return undefined
}

function imageFormatFromUrl(value: string): ImageOutputFormat | undefined {
  const lower = value.split('?')[0].toLowerCase()
  if (lower.endsWith('.png')) return 'png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'jpeg'
  if (lower.endsWith('.webp')) return 'webp'
  return undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
