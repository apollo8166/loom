import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/conversations/:id/sessions — get all sessions + messages for a project (compat shell)
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()

  // Verify project exists
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(id)
  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Get all active sessions for this project
  const sessions = db.prepare(
    `SELECT * FROM sessions
     WHERE project_id = ? AND status != 'deleted'
     ORDER BY last_message_at DESC, updated_at DESC`
  ).all(id) as Array<{
    id: string; context_version: number; [key: string]: unknown
  }>

  // For each session, get its messages (current context_version only)
  const sessionsWithMessages = sessions.map(session => {
    const messages = db.prepare(
      `SELECT * FROM messages
       WHERE session_id = ? AND context_version = ?
       ORDER BY created_at ASC`
    ).all(session.id, session.context_version)

    return { ...session, messages }
  })

  return NextResponse.json({ sessions: sessionsWithMessages })
}
