import { NextRequest, NextResponse } from 'next/server'
import {
  IMAGE_PROVIDER_PRESETS,
  normalizeImageApiBaseUrl,
  type ImageProviderId,
} from '@/shared/config/image-generation-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type TestBody = {
  providerId?: ImageProviderId
  apiKey?: string
  baseUrl?: string
  model?: string
}

export async function POST(req: NextRequest) {
  const { providerId, apiKey, baseUrl, model } = await req.json() as TestBody

  if (providerId !== 'openai' && providerId !== 'seedream' && providerId !== 'nano-banana') {
    return NextResponse.json({ ok: false, error: '缺少或不支持的 providerId' }, { status: 400 })
  }
  if (!apiKey?.trim()) {
    return NextResponse.json({ ok: false, error: '请填写 API Key' }, { status: 400 })
  }

  const preset = IMAGE_PROVIDER_PRESETS[providerId]
  const endpointBase = normalizeImageApiBaseUrl(providerId, baseUrl || preset.baseUrl)
  const modelId = model?.trim() || preset.model

  try {
    if (providerId === 'nano-banana') {
      if (!endpointBase) return NextResponse.json({ ok: false, error: '请填写 Base URL' }, { status: 400 })
      if (!modelId) return NextResponse.json({ ok: false, error: '请填写模型 ID' }, { status: 400 })
      const result = await testNanoBananaChatCompletion(endpointBase, apiKey, modelId)
      return NextResponse.json(result, { status: result.ok ? 200 : 400 })
    }

    const directModel = await testModelEndpoint(endpointBase, apiKey, modelId)
    if (directModel.ok) return NextResponse.json({ ok: true, modelFound: true })
    if (directModel.authError) return NextResponse.json({ ok: false, error: directModel.error })

    const modelList = await testModelList(endpointBase, apiKey, modelId)
    if (modelList.ok) return NextResponse.json({ ok: true, modelFound: modelList.modelFound })
    return NextResponse.json({ ok: false, error: modelList.error || directModel.error || '连接失败' })
  } catch (e) {
    const message = e instanceof Error ? e.message : '网络错误'
    return NextResponse.json({ ok: false, error: message })
  }
}

async function testNanoBananaChatCompletion(baseUrl: string, apiKey: string, model: string): Promise<{
  ok: boolean
  error?: string
}> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      model,
      stream: false,
      max_tokens: 8,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Reply with OK only. Do not generate an image.' }],
        },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (res.ok) return { ok: true }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: 'API Key 无效' }
  }
  const text = await res.text().catch(() => '')
  return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` }
}

async function testModelEndpoint(baseUrl: string, apiKey: string, model: string): Promise<{
  ok: boolean
  authError?: boolean
  error?: string
}> {
  const res = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
  })
  if (res.ok) return { ok: true }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, authError: true, error: 'API Key 无效' }
  }
  const text = await res.text().catch(() => '')
  return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` }
}

async function testModelList(baseUrl: string, apiKey: string, model: string): Promise<{
  ok: boolean
  modelFound?: boolean
  error?: string
}> {
  const res = await fetch(`${baseUrl}/models`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
  })
  if (res.ok) {
    const data = await res.json().catch(() => null) as { data?: Array<{ id?: string }> } | null
    const modelFound = Array.isArray(data?.data)
      ? data.data.some(item => item.id === model)
      : undefined
    return { ok: true, modelFound }
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: 'API Key 无效' }
  }
  const text = await res.text().catch(() => '')
  return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` }
}
