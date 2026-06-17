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

function normalizePermissionMode(value: unknown, fallback: string | null = null) {
  return typeof value === 'string' && PERMISSION_MODES.has(value) ? value : fallback
}

function normalizeThinkingMode(value: unknown, fallback: string | null = null) {
  return typeof value === 'string' && THINKING_MODES.has(value) ? value : fallback
}

function normalizePlanMode(value: unknown) {
  return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0
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
    permissionMode: normalizePermissionMode(row.permission_mode, 'confirm'),
    thinkingMode: normalizeThinkingMode(row.thinking_mode, 'auto'),
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

/** GET /api/sessions/:id — get a session */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }
  return NextResponse.json({ session: mapSession(session) })
}

/** PATCH /api/sessions/:id — update a session */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const db = getDb()
  const existing = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
  if (!existing) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const allowedFields = ['title', 'model', 'status', 'compact_summary', 'workspace_path', 'attached_folder_paths', 'use_worktree', 'runtime_target', 'worktree_path', 'worktree_branch']
  const updates: string[] = []
  const values: unknown[] = []

  for (const field of allowedFields) {
    if (field in body) {
      updates.push(`${field} = ?`)
      values.push(body[field])
    }
  }

  if ('workspacePath' in body) {
    updates.push('workspace_path = ?')
    values.push(typeof body.workspacePath === 'string' && body.workspacePath.trim() ? body.workspacePath.trim() : null)
  }
  if ('attachedFolderPaths' in body) {
    const paths = Array.isArray(body.attachedFolderPaths)
      ? body.attachedFolderPaths.map(p => typeof p === 'string' ? p.trim() : '').filter(Boolean)
      : []
    updates.push('attached_folder_paths = ?')
    values.push(paths.length > 0 ? JSON.stringify([...new Set(paths)]) : null)
  }
  if ('useWorktree' in body) {
    updates.push('use_worktree = ?')
    values.push(body.useWorktree === true ? 1 : 0)
  }
  if ('runtimeTarget' in body) {
    updates.push('runtime_target = ?')
    values.push(body.runtimeTarget === 'local' ? 'local' : 'local')
  }
  if ('permissionMode' in body || 'permission_mode' in body) {
    const mode = normalizePermissionMode(body.permissionMode ?? body.permission_mode)
    if (!mode) {
      return NextResponse.json({ error: 'Invalid permissionMode' }, { status: 400 })
    }
    updates.push('permission_mode = ?')
    values.push(mode)
  }
  if ('thinkingMode' in body || 'thinking_mode' in body) {
    const mode = normalizeThinkingMode(body.thinkingMode ?? body.thinking_mode)
    if (!mode) {
      return NextResponse.json({ error: 'Invalid thinkingMode' }, { status: 400 })
    }
    updates.push('thinking_mode = ?')
    values.push(mode)
  }
  if ('planMode' in body || 'plan_mode' in body) {
    updates.push('plan_mode = ?')
    values.push(normalizePlanMode(body.planMode ?? body.plan_mode))
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  updates.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`)
  values.push(id)

  db.prepare(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`).run(...values)

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow
  return NextResponse.json({ session: mapSession(session) })
}

/** DELETE /api/sessions/:id — soft delete a session */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()
  const existing = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
  if (!existing) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  db.prepare(
    `UPDATE sessions SET status = 'deleted', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
  ).run(id)

  return NextResponse.json({ ok: true })
}
