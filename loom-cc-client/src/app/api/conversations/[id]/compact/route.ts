import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'
import { clearSessionAllowances } from '@/shared/runtime/sdk/permission-bridge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/conversations/:id/compact — compact the latest active session (compat shell)
 * body: { summary?: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let body: { summary?: string } = {}
  try {
    body = await req.json()
  } catch { /* empty body is fine */ }

  const db = getDb()

  // Find the latest active session for this project
  const session = db.prepare(
    `SELECT * FROM sessions
     WHERE project_id = ? AND status = 'active'
     ORDER BY last_message_at DESC, updated_at DESC
     LIMIT 1`
  ).get(id) as {
    id: string; runtime_session_id: string | null; context_version: number
  } | undefined

  if (!session) {
    return NextResponse.json({ error: 'No active session found for this project' }, { status: 404 })
  }

  const summary = body.summary || null
  const newRuntimeSessionId = crypto.randomUUID()
  const newContextVersion = session.context_version + 1
  const boundaryId = crypto.randomUUID()

  db.transaction(() => {
    db.prepare(
      `INSERT INTO session_boundaries (id, session_id, boundary_type, from_runtime_session_id, to_runtime_session_id, summary)
       VALUES (?, ?, 'compact', ?, ?, ?)`
    ).run(boundaryId, session.id, session.runtime_session_id, newRuntimeSessionId, summary)

    db.prepare(
      `UPDATE sessions SET
         context_version = ?,
         runtime_session_id = ?,
         compact_summary = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ?`
    ).run(newContextVersion, newRuntimeSessionId, summary, session.id)
  })()

  if (session.runtime_session_id) {
    clearSessionAllowances(session.runtime_session_id)
  }
  clearSessionAllowances(session.id)

  const updated = db.prepare('SELECT * FROM sessions WHERE id = ?').get(session.id)
  return NextResponse.json({ session: updated })
}
