import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'
import { clearSessionAllowances } from '@/shared/runtime/sdk/permission-bridge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/sessions/:id/clear
 *
 * Clear context without creating a new session:
 * 1. Create a session_boundary (boundary_type='clear')
 * 2. Increment session.context_version
 * 3. Generate new runtime_session_id
 * 4. Clear runtime allowances
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as {
    id: string; runtime_session_id: string | null; context_version: number
  } | undefined
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const newRuntimeSessionId = crypto.randomUUID()
  const newContextVersion = session.context_version + 1
  const boundaryId = crypto.randomUUID()

  db.transaction(() => {
    // 1. Record the boundary
    db.prepare(
      `INSERT INTO session_boundaries (id, session_id, boundary_type, from_runtime_session_id, to_runtime_session_id)
       VALUES (?, ?, 'clear', ?, ?)`
    ).run(boundaryId, id, session.runtime_session_id, newRuntimeSessionId)

    // 2. Update session with new context_version and runtime_session_id
    db.prepare(
      `UPDATE sessions SET
         context_version = ?,
         runtime_session_id = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ?`
    ).run(newContextVersion, newRuntimeSessionId, id)
  })()

  // 3. Clear runtime allowances for the old session
  if (session.runtime_session_id) {
    clearSessionAllowances(session.runtime_session_id)
  }
  clearSessionAllowances(id)

  const updated = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
  return NextResponse.json({ session: updated })
}
