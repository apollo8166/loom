import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ProjectRow {
  id: string
  name: string
  description: string
  workspace_path: string
  claude_dir: string | null
  default_model: string
  is_pinned: number
  status: string
  created_at: string
  updated_at: string
  last_opened_at: string | null
}

function mapProject(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    workspacePath: row.workspace_path,
    claudeDir: row.claude_dir || null,
    defaultModel: row.default_model,
    isPinned: row.is_pinned === 1,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
  }
}

/** GET /api/projects/:id — get a project (also updates last_opened_at) */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()

  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined
  if (!row) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // Update last_opened_at
  db.prepare(
    `UPDATE projects SET last_opened_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
  ).run(id)

  const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow
  return NextResponse.json({ project: mapProject(updated) })
}

/** PATCH /api/projects/:id — update project */
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
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
  if (!existing) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // Map camelCase body keys to snake_case DB columns
  const fieldMap: Record<string, string> = {
    name: 'name',
    description: 'description',
    isPinned: 'is_pinned',
    defaultModel: 'default_model',
    workspacePath: 'workspace_path',
  }

  const updates: string[] = []
  const values: unknown[] = []

  for (const [bodyKey, dbCol] of Object.entries(fieldMap)) {
    if (bodyKey in body) {
      updates.push(`${dbCol} = ?`)
      const val = body[bodyKey]
      // Convert boolean isPinned to integer
      values.push(bodyKey === 'isPinned' ? (val ? 1 : 0) : val)
    }
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  updates.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`)
  values.push(id)

  db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...values)

  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow
  return NextResponse.json({ project: mapProject(row) })
}

/** DELETE /api/projects/:id — soft delete (set status = 'deleted') */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()

  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined
  if (!existing) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  db.prepare(
    `UPDATE projects SET status = 'deleted', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
  ).run(id)

  return NextResponse.json({ success: true })
}
