import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'
import type { TaskExecution } from '@/shared/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function mapExec(row: Record<string, unknown>): TaskExecution {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    sessionId: row.session_id as string,
    status: row.status as 'ok' | 'error',
    result: row.result as string,
    executedAt: row.executed_at as string,
  }
}

/** GET /api/projects/:id/schedules/:scheduleId/executions */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; scheduleId: string }> },
) {
  const { id, scheduleId } = await params
  const db = getDb()

  const task = db.prepare(
    'SELECT id FROM scheduled_tasks WHERE id = ? AND project_id = ?'
  ).get(scheduleId, id)
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100)

  const rows = db.prepare(
    `SELECT * FROM task_executions WHERE task_id = ? ORDER BY executed_at DESC LIMIT ?`
  ).all(scheduleId, limit) as Record<string, unknown>[]

  return NextResponse.json({ executions: rows.map(mapExec) })
}
