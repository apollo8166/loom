import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/sessions?projectId=xxx — list sessions for a project */
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId')
  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  }

  const db = getDb()
  const sessions = db.prepare(
    `SELECT * FROM sessions
     WHERE project_id = ? AND status != 'deleted'
     ORDER BY last_message_at DESC, updated_at DESC`
  ).all(projectId)

  return NextResponse.json({ sessions })
}

/** POST /api/sessions — create a new session */
export async function POST(req: NextRequest) {
  let body: { projectId?: string; title?: string; model?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { projectId, title, model } = body
  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  }

  const db = getDb()

  // Verify project exists
  const project = db.prepare('SELECT id, default_model FROM projects WHERE id = ?').get(projectId) as {
    id: string; default_model: string
  } | undefined
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const id = crypto.randomUUID()
  const runtimeSessionId = crypto.randomUUID()
  const sessionModel = model || project.default_model || 'claude-sonnet-4-6'
  const sessionTitle = title || 'New Session'

  db.prepare(
    `INSERT INTO sessions (id, project_id, title, model, runtime_session_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, projectId, sessionTitle, sessionModel, runtimeSessionId)

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
  return NextResponse.json({ session }, { status: 201 })
}
