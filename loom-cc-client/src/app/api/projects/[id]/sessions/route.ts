import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SessionRow {
  id: string
  project_id: string
  title: string
  model: string
  runtime_session_id: string | null
  status: string
  context_version: number
  compact_summary: string | null
  workspace_path: string | null
  attached_folder_paths: string | null
  use_worktree: number
  runtime_target: string
  worktree_path: string | null
  worktree_branch: string | null
  created_at: string
  updated_at: string
  last_message_at: string | null
}

function parsePathList(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return [...new Set(parsed
        .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
        .map(p => p.trim()))]
    }
  } catch { /* legacy single path */ }
  const trimmed = value.trim()
  return trimmed ? [trimmed] : []
}

function mapSession(row: SessionRow) {
  const legacyWorkspacePaths = parsePathList(row.workspace_path)
  const workspacePath = row.workspace_path?.trim().startsWith('[') ? legacyWorkspacePaths[0] ?? null : row.workspace_path

  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    model: row.model,
    runtimeSessionId: row.runtime_session_id,
    status: row.status,
    contextVersion: row.context_version,
    compactSummary: row.compact_summary,
    workspacePath,
    attachedFolderPaths: row.workspace_path?.trim().startsWith('[')
      ? [...new Set([...legacyWorkspacePaths.slice(1), ...parsePathList(row.attached_folder_paths)])]
      : parsePathList(row.attached_folder_paths),
    useWorktree: row.use_worktree === 1,
    runtimeTarget: row.runtime_target || 'local',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
  }
}

/** GET /api/projects/:id/sessions — list sessions for a project */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()

  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(id)
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const rows = db.prepare(
    `SELECT * FROM sessions
     WHERE project_id = ? AND status != 'deleted'
     ORDER BY COALESCE(last_message_at, created_at) DESC`
  ).all(id) as SessionRow[]

  return NextResponse.json({ sessions: rows.map(mapSession) })
}

/** POST /api/projects/:id/sessions — create a new session */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params

  let body: { title?: string; model?: string } = {}
  try {
    body = await req.json()
  } catch { /* empty body is fine */ }

  const db = getDb()

  const project = db.prepare('SELECT id, default_model FROM projects WHERE id = ?').get(projectId) as {
    id: string; default_model: string
  } | undefined
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const sessionId = crypto.randomUUID()
  const runtimeSessionId = crypto.randomUUID()
  const sessionModel = body.model || project.default_model || 'claude-sonnet-4-6'
  const sessionTitle = body.title || 'New Session'

  db.prepare(
    `INSERT INTO sessions (id, project_id, title, model, runtime_session_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run(sessionId, projectId, sessionTitle, sessionModel, runtimeSessionId)

  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow
  return NextResponse.json({ session: mapSession(row) }, { status: 201 })
}
