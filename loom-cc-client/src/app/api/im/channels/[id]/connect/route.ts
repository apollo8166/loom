import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'
import { getImBridgeManager } from '@/shared/im/bridge-manager'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  return NextResponse.json({ state: getImBridgeManager().getState(id) })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let body: { action?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const manager = getImBridgeManager()
  try {
    if (body.action === 'disconnect') {
      await manager.stopAdapter(id)
      return NextResponse.json({ state: manager.getState(id) })
    }
    if (body.action !== 'connect') {
      return NextResponse.json({ error: 'action must be connect or disconnect' }, { status: 400 })
    }

    const db = getDb()
    const row = db.prepare("SELECT id FROM im_channels WHERE id = ? AND project_id != ''").get(id)
    if (!row) return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    db.prepare(
      `UPDATE im_channels SET enabled = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ?`,
    ).run(id)
    await manager.startAdapter(id)
    return NextResponse.json({ state: manager.getState(id) })
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
      state: manager.getState(id),
    }, { status: 500 })
  }
}
