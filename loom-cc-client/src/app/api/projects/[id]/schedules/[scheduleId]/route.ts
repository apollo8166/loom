import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'
import type { ScheduledTask } from '@/shared/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function mapTask(row: Record<string, unknown>): ScheduledTask {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    name: row.name as string,
    description: (row.description as string) ?? '',
    schedule: row.schedule as string,
    prompt: row.prompt as string,
    skillName: (row.skill_name as string) ?? '',
    model: row.model as string,
    enabled: (row.enabled as number) === 1,
    lastRunAt: (row.last_run_at as string) ?? null,
    lastRunResult: (row.last_run_result as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

type Ctx = { params: Promise<{ id: string; scheduleId: string }> }

/** GET /api/projects/:id/schedules/:scheduleId */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id, scheduleId } = await params
  const db = getDb()
  const row = db.prepare(
    'SELECT * FROM scheduled_tasks WHERE id = ? AND project_id = ?'
  ).get(scheduleId, id) as Record<string, unknown> | undefined
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ task: mapTask(row) })
}

/** PATCH /api/projects/:id/schedules/:scheduleId */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id, scheduleId } = await params
  const db = getDb()

  const existing = db.prepare(
    'SELECT * FROM scheduled_tasks WHERE id = ? AND project_id = ?'
  ).get(scheduleId, id) as Record<string, unknown> | undefined
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json() as Partial<{
    name: string; description: string; schedule: string
    prompt: string; skillName: string; model: string; enabled: boolean
  }>

  const fields: string[] = []
  const values: unknown[] = []

  if (body.name !== undefined)        { fields.push('name = ?');        values.push(body.name.trim()) }
  if (body.description !== undefined) { fields.push('description = ?'); values.push(body.description.trim()) }
  if (body.schedule !== undefined)    { fields.push('schedule = ?');    values.push(body.schedule.trim()) }
  if (body.prompt !== undefined)      { fields.push('prompt = ?');      values.push(body.prompt.trim()) }
  if (body.skillName !== undefined)   { fields.push('skill_name = ?');  values.push(body.skillName.trim()) }
  if (body.model !== undefined)       { fields.push('model = ?');       values.push(body.model.trim()) }
  if (body.enabled !== undefined)     { fields.push('enabled = ?');     values.push(body.enabled ? 1 : 0) }

  if (fields.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 })

  fields.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')")
  values.push(scheduleId, id)

  db.prepare(
    `UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ? AND project_id = ?`
  ).run(...values)

  const row = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(scheduleId) as Record<string, unknown>
  return NextResponse.json({ task: mapTask(row) })
}

/** DELETE /api/projects/:id/schedules/:scheduleId */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id, scheduleId } = await params
  const db = getDb()
  const result = db.prepare(
    'DELETE FROM scheduled_tasks WHERE id = ? AND project_id = ?'
  ).run(scheduleId, id)
  if (result.changes === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
