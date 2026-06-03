import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/sessions/:id/messages — get all messages for a session */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as {
    id: string; context_version: number
  } | undefined
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  // Return messages across ALL context versions so history is preserved after /clear and /compact
  const messages = db.prepare(
    `SELECT * FROM messages
     WHERE session_id = ?
     ORDER BY context_version ASC, created_at ASC`
  ).all(id)

  // Return all boundary records so the UI can render dividers between context versions
  const boundaries = db.prepare(
    `SELECT * FROM session_boundaries
     WHERE session_id = ?
     ORDER BY created_at ASC`
  ).all(id)

  return NextResponse.json({ messages, boundaries, contextVersion: session.context_version })
}

/** DELETE /api/sessions/:id/messages — delete all messages for a session */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const result = db.prepare('DELETE FROM messages WHERE session_id = ?').run(id)
  return NextResponse.json({ ok: true, deletedCount: result.changes })
}
