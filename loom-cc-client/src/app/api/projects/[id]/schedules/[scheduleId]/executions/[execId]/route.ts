import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string; scheduleId: string; execId: string }> }

/** PATCH /api/projects/:id/schedules/:scheduleId/executions/:execId — update result after streaming */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id, scheduleId, execId } = await params
  const db = getDb()

  const exec = db.prepare(
    `SELECT te.id FROM task_executions te
     JOIN scheduled_tasks st ON st.id = te.task_id
     WHERE te.id = ? AND te.task_id = ? AND st.project_id = ?`
  ).get(execId, scheduleId, id)
  if (!exec) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json() as { result?: string; status?: 'ok' | 'error' }

  const fields: string[] = []
  const values: unknown[] = []
  if (body.result !== undefined) { fields.push('result = ?'); values.push(body.result.slice(0, 200)) }
  if (body.status !== undefined) { fields.push('status = ?'); values.push(body.status) }
  if (fields.length === 0) return NextResponse.json({ error: 'No fields' }, { status: 400 })

  values.push(execId)
  db.prepare(`UPDATE task_executions SET ${fields.join(', ')} WHERE id = ?`).run(...values)

  // Also update task last_run_result
  if (body.result !== undefined) {
    db.prepare(
      `UPDATE scheduled_tasks SET last_run_result = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
    ).run(body.result.slice(0, 200), scheduleId)
  }

  return NextResponse.json({ ok: true })
}
