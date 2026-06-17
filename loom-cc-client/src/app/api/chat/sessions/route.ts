import { NextRequest, NextResponse } from 'next/server'
import { GLOBAL_CHAT_PROJECT_ID, ensureGlobalChatProject, getDb } from '@/shared/db/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SessionRow {
  id: string
  project_id: string
  title: string
  model: string
  permission_mode: string
  thinking_mode: string
  plan_mode: number
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
  }
}

export async function GET() {
  const db = getDb()
  ensureGlobalChatProject(db)
  const rows = db.prepare(
    `SELECT * FROM sessions
     WHERE project_id = ? AND status != 'deleted'
     ORDER BY COALESCE(last_message_at, created_at) DESC`
  ).all(GLOBAL_CHAT_PROJECT_ID) as SessionRow[]

  return NextResponse.json({ sessions: rows.map(mapSession) })
}

export async function POST(req: NextRequest) {
  let body: { title?: string; model?: string; permissionMode?: string; thinkingMode?: string; planMode?: boolean; workspacePath?: string; attachedFolderPaths?: string[]; useWorktree?: boolean; runtimeTarget?: 'local' } = {}
  try {
    body = await req.json()
  } catch { /* empty body is fine */ }

  const db = getDb()
  ensureGlobalChatProject(db)
  const project = db.prepare('SELECT default_model FROM projects WHERE id = ?').get(GLOBAL_CHAT_PROJECT_ID) as {
    default_model: string
  }

  const sessionId = crypto.randomUUID()
  const runtimeSessionId = crypto.randomUUID()
  const sessionModel = body.model || project.default_model || 'claude-sonnet-4-6'
  const sessionTitle = body.title || 'New Session'
  const permissionMode = normalizePermissionMode(body.permissionMode)
  const thinkingMode = normalizeThinkingMode(body.thinkingMode)
  const planMode = body.planMode === true ? 1 : 0
  const workspacePath = body.workspacePath?.trim() || null
  const attachedFolderPaths = Array.isArray(body.attachedFolderPaths)
    ? [...new Set(body.attachedFolderPaths.map(p => p.trim()).filter(Boolean))]
    : []

  db.prepare(
    `INSERT INTO sessions (id, project_id, title, model, permission_mode, thinking_mode, plan_mode, runtime_session_id, workspace_path, attached_folder_paths, use_worktree, runtime_target)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sessionId,
    GLOBAL_CHAT_PROJECT_ID,
    sessionTitle,
    sessionModel,
    permissionMode,
    thinkingMode,
    planMode,
    runtimeSessionId,
    workspacePath,
    attachedFolderPaths.length > 0 ? JSON.stringify(attachedFolderPaths) : null,
    body.useWorktree === true ? 1 : 0,
    body.runtimeTarget || 'local',
  )

  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow
  return NextResponse.json({ session: mapSession(row) }, { status: 201 })
}
