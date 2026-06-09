import type { ImageProviderConfig } from '@/shared/config/image-generation-config'
import { normalizeImageApiBaseUrl } from '@/shared/config/image-generation-config'
import type { GeneratedImage, GenerateImageRequest } from '../types'
import {
  imagesFromResponse,
  readProviderError,
  referenceToDataUrl,
  resolveImageSize,
} from './common'

export async function generateSeedreamImage(
  provider: ImageProviderConfig,
  request: GenerateImageRequest,
): Promise<GeneratedImage[]> {
  const baseUrl = normalizeImageApiBaseUrl('seedream', provider.baseUrl)
  const model = provider.model.trim()
  const body: Record<string, unknown> = {
    model,
    prompt: request.prompt,
    size: resolveImageSize(request),
    response_format: 'b64_json',
  }

  if (request.count > 1) {
    body.n = request.count
    body.sequential_image_generation = 'auto'
    body.sequential_image_generation_options = { max_images: request.count }
  }
  if (request.outputFormat !== 'png') body.output_format = request.outputFormat
  if (request.references.length > 0) {
    body.image = await Promise.all(
      request.references.map(reference => referenceToDataUrl(reference.path, reference.mimeType)),
    )
  }

  const res = await fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`Seedream image generation failed: ${await readProviderError(res)}`)
  }

  return imagesFromResponse({
    data: await res.json(),
    providerId: provider.id,
    model,
    request,
  })
}
