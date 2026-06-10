import { getDb } from '@/shared/db/db'
import { getImageGenerationConfig, getStylePromptSuffix, normalizeArkImageSize } from '@/shared/config/image-generation-config'
import { getActiveProviderConfig, isAnthropicFormatProvider } from '@/shared/config/provider-config'
import { generateImage } from './generate'
import { createImageJob, getImageJob, updateImageJobStatus, type ImageGenerationJob } from './job-store'
import type { GenerateImageRequest, ResolvedImageReference } from './types'
import type { CreateImageJobParams } from './job-store'

export interface ImageGenHistoryItem {
  prompt: string
  resultUrls: string[]
}

export interface ExecuteImageJobOptions {
  history: ImageGenHistoryItem[]
  referenceImages?: ResolvedImageReference[]
}

export async function executeImageJob(jobId: string, opts: ExecuteImageJobOptions): Promise<void> {
  const db = getDb()

  const job = getImageJob(db, jobId)
  if (!job) return

  const imageConfig = getImageGenerationConfig(db)
  const providerConfig = imageConfig.configs.find(c => c.id === job.providerId)
  if (!providerConfig) {
    updateImageJobStatus(db, jobId, 'error', { errorMessage: `未找到图像生成服务商配置：${job.providerId}` })
    return
  }

  try {
    // Phase 1: merge prompts
    updateImageJobStatus(db, jobId, 'merging')
    const finalPrompt = await mergePromptWithHistory(job, opts.history)
    updateImageJobStatus(db, jobId, 'submitting', { finalPrompt })

    // Phase 2: apply style suffix + build request
    const styleSuffix = getStylePromptSuffix(job.styleId)
    const fullPrompt = styleSuffix ? `${finalPrompt}${styleSuffix}` : finalPrompt
    const requestSize = providerConfig.apiFormat === 'ark-images' ? normalizeArkImageSize(job.size) : job.size

    const request: GenerateImageRequest = {
      prompt: fullPrompt,
      mode: (opts.referenceImages?.length ?? 0) > 0 ? 'image_to_image' : 'text_to_image',
      references: opts.referenceImages ?? [],
      aspectRatio: job.aspectRatio,
      size: requestSize,
      count: job.count,
      outputFormat: imageConfig.outputFormat,
    }

    // Phase 3: call image API
    updateImageJobStatus(db, jobId, 'waiting')
    const images = await generateImage(providerConfig, request)

    const resultUrls = images.map(img => img.url)
    const resultMetadata = {
      model: providerConfig.model,
      size: requestSize,
      format: imageConfig.outputFormat,
      count: images.length,
      mode: request.mode,
      contextRounds: opts.history.length + 1,
      images: images.map(img => ({
        filename: img.filename,
        url: img.url,
        bytes: img.size,
        mimeType: img.mimeType,
      })),
    }

    updateImageJobStatus(db, jobId, 'success', { resultUrls, resultMetadata })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    updateImageJobStatus(db, jobId, 'error', { errorMessage: msg })
  }
}

async function mergePromptWithHistory(
  job: ImageGenerationJob,
  history: ImageGenHistoryItem[],
): Promise<string> {
  if (history.length === 0) return job.prompt

  const db = getDb()
  const providerConfig = getActiveProviderConfig(db)

  if (!providerConfig.apiKey?.trim()) return job.prompt

  try {
    const rounds = history.map((item, i) => `第 ${i + 1} 轮用户需求：${item.prompt}`)
    rounds.push(`第 ${history.length + 1} 轮用户需求：${job.prompt}`)

    const systemPrompt = `你是图像生成助手，负责将多轮图像生成需求合并为一条最终提示词。
规则：
1. 若最新需求描述了不同的主体、场景或人物，直接以最新需求为基准，完全忽略旧需求的细节。
2. 若最新需求是对之前描述的细化或修改，则合并所有相关细节，以最新需求为准处理冲突。
3. 只输出最终图像提示词本身，不要任何解释、前缀或标注。`

    const userContent = `请把下面的多轮图像生成需求整理为一条最终提示词：\n\n${rounds.join('\n')}\n\n请直接输出最终提示词：`

    let merged: string | null = null
    if (isAnthropicFormatProvider(providerConfig)) {
      merged = await callAnthropicForMerge(providerConfig.apiKey, providerConfig.baseUrl, providerConfig.fastModel, systemPrompt, userContent)
    } else {
      merged = await callOpenAIForMerge(providerConfig.apiKey, providerConfig.baseUrl, providerConfig.fastModel, systemPrompt, userContent)
    }

    return merged?.trim() || job.prompt
  } catch {
    return job.prompt
  }
}

async function callAnthropicForMerge(
  apiKey: string,
  baseUrl: string,
  model: string,
  system: string,
  userContent: string,
): Promise<string | null> {
  const url = baseUrl ? `${baseUrl.replace(/\/+$/, '')}/v1/messages` : 'https://api.anthropic.com/v1/messages'
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) return null
  const data = await res.json() as { content?: Array<{ type: string; text?: string }> }
  return data?.content?.find(c => c.type === 'text')?.text ?? null
}

async function callOpenAIForMerge(
  apiKey: string,
  baseUrl: string,
  model: string,
  system: string,
  userContent: string,
): Promise<string | null> {
  const base = baseUrl.replace(/\/+$/, '')
  const url = base ? `${base}/chat/completions` : 'https://api.openai.com/v1/chat/completions'
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) return null
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
  return data?.choices?.[0]?.message?.content ?? null
}

export function createAndExecuteImageJob(
  params: CreateImageJobParams,
  opts: ExecuteImageJobOptions,
): string {
  const db = getDb()
  const jobId = createImageJob(db, params)
  setImmediate(() => {
    executeImageJob(jobId, opts).catch(err => {
      console.error('[image-gen] executeImageJob failed:', err)
    })
  })
  return jobId
}
