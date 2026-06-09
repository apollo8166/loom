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

  if (providerId !== 'openai' && providerId !== 'seedream') {
    return NextResponse.json({ ok: false, error: '缺少或不支持的 providerId' }, { status: 400 })
  }
  if (!apiKey?.trim()) {
    return NextResponse.json({ ok: false, error: '请填写 API Key' }, { status: 400 })
  }

  const preset = IMAGE_PROVIDER_PRESETS[providerId]
  const endpointBase = normalizeImageApiBaseUrl(providerId, baseUrl || preset.baseUrl)
  const modelId = model?.trim() || preset.model

  try {
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
