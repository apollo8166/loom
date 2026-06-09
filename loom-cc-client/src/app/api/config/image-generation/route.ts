import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'
import {
  getImageGenerationConfig,
  normalizeImageGenerationConfig,
  saveImageGenerationConfig,
  type ImageGenerationConfig,
} from '@/shared/config/image-generation-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const db = getDb()
  return NextResponse.json(getImageGenerationConfig(db))
}

export async function PUT(req: NextRequest) {
  const body = await req.json() as Partial<ImageGenerationConfig>
  const db = getDb()
  saveImageGenerationConfig(db, normalizeImageGenerationConfig(body))
  return NextResponse.json({ ok: true })
}
