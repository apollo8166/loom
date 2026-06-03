import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'
import {
  CUSTOM_MODELS_KEY,
  parseCustomModelCatalogs,
} from '@/shared/config/model-catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function readCustomCatalogs() {
  const db = getDb()
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(CUSTOM_MODELS_KEY) as { value: string } | undefined
  try {
    return parseCustomModelCatalogs(row?.value)
  } catch {
    return {}
  }
}

function writeCustomCatalogs(catalogs: unknown) {
  const normalized = parseCustomModelCatalogs(catalogs)
  const db = getDb()
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(CUSTOM_MODELS_KEY, JSON.stringify(normalized))
  return normalized
}

export async function GET() {
  return NextResponse.json({ catalogs: readCustomCatalogs() })
}

export async function PUT(req: NextRequest) {
  const body = await req.json() as { catalogs?: unknown }
  const catalogs = writeCustomCatalogs(body.catalogs ?? {})
  return NextResponse.json({ ok: true, catalogs })
}
