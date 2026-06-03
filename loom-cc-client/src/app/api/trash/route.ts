import { NextResponse } from 'next/server'
import { GLOBAL_CHAT_PROJECT_ID, getDb } from '@/shared/db/db'

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

/** GET /api/trash — list soft-deleted projects */
export async function GET() {
  const db = getDb()
  const rows = db.prepare(
    `SELECT * FROM projects WHERE status = 'deleted' AND id != ? ORDER BY updated_at DESC`
  ).all(GLOBAL_CHAT_PROJECT_ID) as ProjectRow[]

  return NextResponse.json({ projects: rows.map(mapProject) })
}
