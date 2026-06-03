import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'
import { getDefaultWorkspacesDir } from '@/shared/db/paths'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/conversations — list all projects formatted as conversations (compat shell)
 */
export async function GET() {
  const db = getDb()
  const projects = db.prepare(
    `SELECT * FROM projects WHERE status = 'active' ORDER BY last_opened_at DESC, updated_at DESC`
  ).all() as Array<{
    id: string; name: string; workspace_path: string; default_model: string;
    is_pinned: number; status: string; created_at: string; updated_at: string;
    last_opened_at: string | null
  }>

  // Map projects to conversation-like objects
  const conversations = projects.map(p => ({
    id: p.id,
    title: p.name,
    model: p.default_model,
    isPinned: !!p.is_pinned,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    lastOpenedAt: p.last_opened_at,
  }))

  return NextResponse.json({ conversations })
}

/**
 * POST /api/conversations — create a project + default session (compat shell)
 */
export async function POST(req: NextRequest) {
  let body: { title?: string; model?: string; workspacePath?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const db = getDb()
  const projectId = crypto.randomUUID()
  const sessionId = crypto.randomUUID()
  const runtimeSessionId = crypto.randomUUID()
  const title = body.title || 'New Conversation'
  const model = body.model || 'claude-sonnet-4-6'
  const workspacePath = body.workspacePath || getDefaultWorkspacesDir()

  db.transaction(() => {
    db.prepare(
      `INSERT INTO projects (id, name, workspace_path, default_model)
       VALUES (?, ?, ?, ?)`
    ).run(projectId, title, workspacePath, model)

    db.prepare(
      `INSERT INTO sessions (id, project_id, title, model, runtime_session_id)
       VALUES (?, ?, ?, ?, ?)`
    ).run(sessionId, projectId, title, model, runtimeSessionId)
  })()

  return NextResponse.json({
    conversation: {
      id: projectId,
      title,
      model,
      isPinned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    sessionId,
  }, { status: 201 })
}
