import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getDb } from '@/shared/db/db'
import { startCronEngine } from '@/shared/runtime/cron/engine'
import type { ScheduledTask } from '@/shared/types'
import { logger } from '@/shared/logging/logger'

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

/** GET /api/projects/:id/schedules */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()

  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(id)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Ensure engine is running (fallback in case instrumentation didn't fire in dev)
  startCronEngine()

  const rows = db.prepare(
    'SELECT * FROM scheduled_tasks WHERE project_id = ? ORDER BY created_at ASC'
  ).all(id) as Record<string, unknown>[]

  return NextResponse.json({ tasks: rows.map(mapTask) })
}

/** POST /api/projects/:id/schedules */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()

  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(id)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const body = await req.json() as {
    name: string
    description?: string
    schedule: string
    prompt: string
    skillName?: string
    model?: string
    enabled?: boolean
  }

  if (!body.name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (!body.schedule?.trim()) return NextResponse.json({ error: 'schedule is required' }, { status: 400 })
  if (!body.description?.trim() && !body.prompt?.trim()) {
    return NextResponse.json({ error: 'description (任务说明) is required' }, { status: 400 })
  }

  const taskId = crypto.randomUUID()
  try {
    db.prepare(
      `INSERT INTO scheduled_tasks (id, project_id, name, description, schedule, prompt, skill_name, model, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      taskId, id, body.name.trim(),
      body.description?.trim() ?? '',
      body.schedule.trim(),
      body.prompt?.trim() ?? '',
      body.skillName?.trim() ?? '',
      body.model?.trim() ?? '',
      body.enabled !== false ? 1 : 0,
    )
  } catch (err) {
    logger.error('schedule.create_db_error', err, {
      projectId: id,
      taskId,
      name: body.name,
      schedule: body.schedule,
    })
    return NextResponse.json({ error: err instanceof Error ? err.message : 'DB error' }, { status: 500 })
  }

  startCronEngine()

  const row = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(taskId) as Record<string, unknown>
  return NextResponse.json({ task: mapTask(row) }, { status: 201 })
}
