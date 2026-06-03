import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key')
  if (!key) return NextResponse.json({ error: 'key is required' }, { status: 400 })
  const db = getDb()
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined
  return NextResponse.json({ key, value: row?.value ?? null })
}

export async function POST(req: NextRequest) {
  const { key, value } = await req.json()
  if (!key || typeof value === 'undefined') {
    return NextResponse.json({ error: 'key and value are required' }, { status: 400 })
  }
  const db = getDb()
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, String(value))
  return NextResponse.json({ ok: true })
}
