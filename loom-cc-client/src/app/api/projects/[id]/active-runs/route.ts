import { NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'
import { listActiveRunSessionIds } from '@/shared/runtime/active-runs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params
  const activeSessionIds = listActiveRunSessionIds()
  if (activeSessionIds.length === 0) {
    return NextResponse.json({ sessions: [] })
  }

  const placeholders = activeSessionIds.map(() => '?').join(',')
  const rows = getDb().prepare(
    `SELECT id
     FROM sessions
     WHERE project_id = ?
       AND status != 'deleted'
       AND id IN (${placeholders})`,
  ).all(projectId, ...activeSessionIds) as Array<{ id: string }>

  return NextResponse.json({
    sessions: rows.map(row => ({
      sessionId: row.id,
      running: true,
    })),
  })
}
