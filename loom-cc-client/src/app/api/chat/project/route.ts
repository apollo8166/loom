import { NextResponse } from 'next/server'
import { GLOBAL_CHAT_PROJECT_ID, ensureGlobalChatProject, getDb } from '@/shared/db/db'
import { getGlobalChatWorkspaceDir } from '@/shared/db/paths'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function mapProject(row: {
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
}) {
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

export async function GET() {
  const db = getDb()
  ensureGlobalChatProject(db)
  const defaultWorkspacePath = getGlobalChatWorkspaceDir()
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(GLOBAL_CHAT_PROJECT_ID) as Parameters<typeof mapProject>[0]
  return NextResponse.json({ project: mapProject(row), defaultWorkspacePath })
}
