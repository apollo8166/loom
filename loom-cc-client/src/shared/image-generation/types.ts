import type { ImageGenerationMode, ImageOutputFormat, ImageProviderId } from '@/shared/config/image-generation-config'

export interface ImageReferenceInput {
  name?: string
  path?: string
  url?: string
}

export interface ResolvedImageReference {
  name: string
  path: string
  mimeType: string
}

export interface GenerateImageRequest {
  prompt: string
  mode: ImageGenerationMode
  references: ResolvedImageReference[]
  aspectRatio?: string
  size?: string
  outputName?: string
  count: number
  outputFormat: ImageOutputFormat
}

export interface GeneratedImage {
  providerId: ImageProviderId
  model: string
  filename: string
  name: string
  url: string
  path: string
  mimeType: string
  size: number
  promptSummary: string
}
