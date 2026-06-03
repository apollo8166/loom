import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/shared/logging/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    event?: string
    [key: string]: unknown
  }
  const event = typeof body.event === 'string' && body.event.trim()
    ? body.event.trim()
    : 'client.event'
  const { event: _event, ...fields } = body
  logger.info(event, fields)
  return NextResponse.json({ ok: true })
}

