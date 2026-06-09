import { readFile } from 'fs/promises'
import type { ImageProviderConfig } from '@/shared/config/image-generation-config'
import { normalizeImageApiBaseUrl } from '@/shared/config/image-generation-config'
import type { GeneratedImage, GenerateImageRequest } from '../types'
import {
  imagesFromResponse,
  readProviderError,
  referenceToDataUrl,
  resolveImageSize,
} from './common'

export async function generateOpenAiImage(
  provider: ImageProviderConfig,
  request: GenerateImageRequest,
): Promise<GeneratedImage[]> {
  const baseUrl = normalizeImageApiBaseUrl('openai', provider.baseUrl)
  const model = provider.model.trim()
  const response = await postGenerations(baseUrl, provider.apiKey, model, request)

  if (response.ok) {
    return imagesFromResponse({
      data: await response.json(),
      providerId: provider.id,
      model,
      request,
    })
  }

  const error = await readProviderError(response)
  if (request.references.length > 0 && shouldTryEditsFallback(response.status, error)) {
    return postEditsFallback(baseUrl, provider.apiKey, model, request)
  }

  throw new Error(`OpenAI image generation failed: ${error}`)
}

async function postGenerations(
  baseUrl: string,
  apiKey: string,
  model: string,
  request: GenerateImageRequest,
): Promise<Response> {
  const body: Record<string, unknown> = {
    model,
    prompt: request.prompt,
    size: resolveImageSize(request),
  }
  if (request.count > 1) body.n = request.count
  if (request.outputFormat !== 'png') body.output_format = request.outputFormat
  if (request.references.length > 0) {
    body.image = await Promise.all(
      request.references.map(reference => referenceToDataUrl(reference.path, reference.mimeType)),
    )
  }

  return fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
}

async function postEditsFallback(
  baseUrl: string,
  apiKey: string,
  model: string,
  request: GenerateImageRequest,
): Promise<GeneratedImage[]> {
  const form = new FormData()
  form.append('model', model)
  form.append('prompt', request.prompt)
  form.append('size', resolveImageSize(request))
  if (request.count > 1) form.append('n', String(request.count))
  if (request.outputFormat !== 'png') form.append('output_format', request.outputFormat)

  for (const reference of request.references) {
    const buffer = await readFile(reference.path)
    const blob = new Blob([new Uint8Array(buffer)], { type: reference.mimeType })
    form.append('image', blob, reference.name)
  }

  const res = await fetch(`${baseUrl}/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })
  if (!res.ok) {
    throw new Error(`OpenAI image edit fallback failed: ${await readProviderError(res)}`)
  }
  return imagesFromResponse({
    data: await res.json(),
    providerId: 'openai',
    model,
    request,
  })
}

function shouldTryEditsFallback(status: number, error: string): boolean {
  if (status !== 400 && status !== 422) return false
  return /image|reference|unknown|unsupported|invalid/i.test(error)
}
