import type { GeneratedImage, GenerateImageRequest } from '../types'
import { saveGeneratedImage } from '../storage'
import type { ImageOutputFormat, ImageProviderId } from '@/shared/config/image-generation-config'

type ImageResponseItem = {
  b64_json?: string
  url?: string
}

export async function imagesFromResponse(args: {
  data: unknown
  providerId: ImageProviderId
  model: string
  request: GenerateImageRequest
}): Promise<GeneratedImage[]> {
  const items = extractImageItems(args.data)
  if (items.length === 0) throw new Error('Image response did not include b64_json or url')

  const images: GeneratedImage[] = []
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    const buffer = item.b64_json
      ? Buffer.from(item.b64_json, 'base64')
      : await downloadImage(item.url!)
    images.push(await saveGeneratedImage({
      buffer,
      providerId: args.providerId,
      model: args.model,
      outputFormat: args.request.outputFormat,
      outputName: args.request.outputName,
      prompt: args.request.prompt,
      index: i,
    }))
  }
  return images
}

function extractImageItems(data: unknown): ImageResponseItem[] {
  if (!data || typeof data !== 'object') return []
  const raw = data as { data?: unknown; images?: unknown }
  const items = Array.isArray(raw.data)
    ? raw.data
    : Array.isArray(raw.images)
      ? raw.images
      : []
  return items
    .filter((item): item is ImageResponseItem => Boolean(
      item && typeof item === 'object' && (
        typeof (item as ImageResponseItem).b64_json === 'string' ||
        typeof (item as ImageResponseItem).url === 'string'
      ),
    ))
}

async function downloadImage(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download generated image: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

export async function readProviderError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  if (!text) return `HTTP ${res.status}`
  try {
    const data = JSON.parse(text) as { error?: { message?: string } | string; message?: string }
    const message = typeof data.error === 'string'
      ? data.error
      : data.error?.message || data.message
    if (message) return `HTTP ${res.status}: ${message}`
  } catch {
    // fall through to raw text
  }
  return `HTTP ${res.status}: ${text.slice(0, 500)}`
}

export function resolveImageSize(request: GenerateImageRequest): string {
  if (request.size?.trim()) return request.size.trim()
  const ratio = request.aspectRatio?.replace(/\s+/g, '').toLowerCase()
  switch (ratio) {
    case '16:9':
    case '16/9':
      return '1536x864'
    case '9:16':
    case '9/16':
      return '864x1536'
    case '4:3':
    case '4/3':
      return '1280x960'
    case '3:4':
    case '3/4':
      return '960x1280'
    case '3:2':
    case '3/2':
      return '1344x896'
    case '2:3':
    case '2/3':
      return '896x1344'
    case '1:1':
    case '1/1':
    case 'square':
      return '1024x1024'
    default:
      return '1024x1024'
  }
}

export function imageOutputMime(format: ImageOutputFormat): string {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'webp') return 'image/webp'
  return 'image/png'
}

export async function referenceToDataUrl(path: string, mimeType: string): Promise<string> {
  const { readFile } = await import('fs/promises')
  const buffer = await readFile(path)
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}
