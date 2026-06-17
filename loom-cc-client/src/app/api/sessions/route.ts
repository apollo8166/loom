import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SessionRow {
  id: string
  project_id: string
  title: string
  model: string
  permission_mode?: string | null
  thinking_mode?: string | null
  plan_mode?: number | null
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

const PERMISSION_MODES = new Set(['confirm', 'accept_edits', 'full'])
const THINKING_MODES = new Set(['off', 'auto', 'max'])

function normalizePermissionMode(value: unknown) {
  return typeof value === 'string' && PERMISSION_MODES.has(value) ? value : 'confirm'
}

function normalizeThinkingMode(value: unknown) {
  return typeof value === 'string' && THINKING_MODES.has(value) ? value : 'auto'
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
    permissionMode: normalizePermissionMode(row.permission_mode),
    thinkingMode: normalizeThinkingMode(row.thinking_mode),
    planMode: row.plan_mode === 1,
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
    worktreePath: row.worktree_path,
    worktreeBranch: row.worktree_branch,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
  }
}

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
  ).all(projectId) as SessionRow[]

  return NextResponse.json({ sessions: sessions.map(mapSession) })
}

/** POST /api/sessions — create a new session */
export async function POST(req: NextRequest) {
  let body: { projectId?: string; title?: string; model?: string; permissionMode?: string; thinkingMode?: string; planMode?: boolean }
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
  const permissionMode = normalizePermissionMode(body.permissionMode)
  const thinkingMode = normalizeThinkingMode(body.thinkingMode)
  const planMode = body.planMode === true ? 1 : 0

  db.prepare(
    `INSERT INTO sessions (id, project_id, title, model, permission_mode, thinking_mode, plan_mode, runtime_session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, projectId, sessionTitle, sessionModel, permissionMode, thinkingMode, planMode, runtimeSessionId)

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow
  return NextResponse.json({ session: mapSession(session) }, { status: 201 })
}
