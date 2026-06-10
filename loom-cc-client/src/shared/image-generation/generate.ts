import type { ImageProviderConfig } from '@/shared/config/image-generation-config'
import type { GeneratedImage, GenerateImageRequest } from './types'
import { sanitizeImagePrompt } from './prompt-safety'
import { generateNanoBananaImage } from './providers/nano-banana'
import { generateOpenAiImage } from './providers/openai'
import { generateSeedreamImage } from './providers/seedream'

export async function generateImage(
  provider: ImageProviderConfig,
  request: GenerateImageRequest,
): Promise<GeneratedImage[]> {
  if (!provider.apiKey.trim()) throw new Error('Image generation API Key is not configured')
  if (!provider.model.trim()) throw new Error('Image generation model is not configured')

  const prompt = sanitizeImagePrompt(request.prompt)
  if (!prompt) throw new Error('Image generation prompt is required')

  const normalizedRequest: GenerateImageRequest = {
    ...request,
    prompt,
    count: Math.max(1, Math.min(4, request.count || 1)),
    references: request.references.slice(0, 8),
  }

  const effectiveMode = normalizedRequest.mode === 'auto'
    ? (normalizedRequest.references.length > 0 ? 'image_to_image' : 'text_to_image')
    : normalizedRequest.mode

  if (effectiveMode === 'image_to_image' && normalizedRequest.references.length === 0) {
    throw new Error('Image-to-image mode requires at least one reference image')
  }
  if (normalizedRequest.references.length > 0 && !provider.supportsReferenceImage) {
    throw new Error(`${provider.name} does not support reference images`)
  }

  if (provider.id === 'nano-banana' || provider.apiFormat === 'openai-chat-completions') {
    return generateNanoBananaImage(provider, { ...normalizedRequest, mode: effectiveMode })
  }
  if (provider.apiFormat === 'ark-images') {
    return generateSeedreamImage(provider, { ...normalizedRequest, mode: effectiveMode })
  }
  if (provider.apiFormat === 'openai-images' || provider.id === 'openai') {
    return generateOpenAiImage(provider, { ...normalizedRequest, mode: effectiveMode })
  }
  throw new Error(`Unsupported image provider: ${provider.id}`)
}
