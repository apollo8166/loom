import crypto from 'crypto'
import { writeFile } from 'fs/promises'
import path from 'path'
import { getUploadsDir } from '@/shared/db/paths'
import type { GeneratedImage } from './types'
import type { ImageOutputFormat, ImageProviderId } from '@/shared/config/image-generation-config'
import { promptSummary } from './prompt-safety'

const EXT_BY_FORMAT: Record<ImageOutputFormat, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
}

const MIME_BY_FORMAT: Record<ImageOutputFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

export async function saveGeneratedImage(args: {
  buffer: Buffer
  providerId: ImageProviderId
  model: string
  outputFormat: ImageOutputFormat
  outputName?: string
  prompt: string
  index: number
}): Promise<GeneratedImage> {
  const uploadsDir = getUploadsDir()
  const ext = EXT_BY_FORMAT[args.outputFormat] || 'png'
  const id = crypto.randomUUID().slice(0, 8)
  const safeBase = safeFilename(args.outputName || `generated-image-${args.index + 1}`)
  const filename = `${id}_${safeBase}.${ext}`
  const filePath = path.join(uploadsDir, filename)
  await writeFile(filePath, args.buffer)

  return {
    providerId: args.providerId,
    model: args.model,
    filename,
    name: filename,
    url: `/api/files/serve/${filename}`,
    path: filePath,
    mimeType: MIME_BY_FORMAT[args.outputFormat] || 'image/png',
    size: args.buffer.length,
    promptSummary: promptSummary(args.prompt),
  }
}

function safeFilename(value: string): string {
  const withoutExt = value.replace(/\.[a-zA-Z0-9]+$/, '')
  const safe = withoutExt.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+|_+$/g, '').slice(0, 80)
  return safe || 'generated-image'
}
