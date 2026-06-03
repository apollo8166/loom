import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/sessions/:id — get a session */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }
  return NextResponse.json({ session })
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

  if (updates.length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  updates.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`)
  values.push(id)

  db.prepare(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`).run(...values)

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
  return NextResponse.json({ session })
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
