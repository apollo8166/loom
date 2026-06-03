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

/** POST /api/projects/:id/restore — restore a soft-deleted project */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()

  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined
  if (!existing) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  if (existing.status !== 'deleted') {
    return NextResponse.json({ error: 'Project is not deleted' }, { status: 400 })
  }

  db.prepare(
    `UPDATE projects SET status = 'active', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
  ).run(id)

  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow
  return NextResponse.json({ project: mapProject(row) })
}
