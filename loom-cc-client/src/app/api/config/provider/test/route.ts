import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { providerId, apiKey, baseUrl } = await req.json() as {
    providerId: string
    apiKey: string
    baseUrl?: string
  }

  if (!providerId) {
    return NextResponse.json({ ok: false, error: '缺少 providerId' }, { status: 400 })
  }

  try {
    if (providerId === 'anthropic') {
      // Test Anthropic by calling the models endpoint
      const endpoint = (baseUrl?.replace(/\/$/, '') || 'https://api.anthropic.com') + '/v1/models'
      const headers: Record<string, string> = {
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      }
      if (apiKey) headers['x-api-key'] = apiKey

      const res = await fetch(endpoint, { method: 'GET', headers })
      if (res.ok || res.status === 401) {
        // 401 means key is wrong but endpoint is reachable; treat as connectivity success for base URL test
        if (res.status === 401) {
          return NextResponse.json({ ok: false, error: 'API Key 无效（401 Unauthorized）' })
        }
        return NextResponse.json({ ok: true })
      }
      const text = await res.text()
      return NextResponse.json({ ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` })
    }

    // Generic OpenAI-compatible: GET /models
    // baseUrl already includes the version prefix (e.g. /v1, /v4) — do NOT append /v1 again
    const endpoint = (baseUrl?.replace(/\/$/, '') || '') + '/models'
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey}`,
    }

    const res = await fetch(endpoint, { method: 'GET', headers })
    if (res.ok) {
      return NextResponse.json({ ok: true })
    }
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ ok: false, error: 'API Key 无效' })
    }
    const text = await res.text()
    return NextResponse.json({ ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` })
  } catch (e) {
    const message = e instanceof Error ? e.message : '网络错误'
    return NextResponse.json({ ok: false, error: message })
  }
}
