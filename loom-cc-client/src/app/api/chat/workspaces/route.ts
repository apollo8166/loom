import { NextResponse } from 'next/server'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getDb } from '@/shared/db/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type WorkspaceRow = { workspace_path: string | null; updated_at?: string | null; last_message_at?: string | null }

function readClaudeRecentWorkspaces(): string[] {
  const dir = path.join(os.homedir(), '.claude', 'usage-data', 'session-meta')
  if (!fs.existsSync(dir)) return []
  const entries = fs.readdirSync(dir).filter(name => name.endsWith('.json')).slice(-300)
  const rows: Array<{ projectPath: string; time: number }> = []

  for (const name of entries) {
    try {
      const raw = fs.readFileSync(path.join(dir, name), 'utf8')
      const data = JSON.parse(raw) as { project_path?: string; start_time?: string }
      if (!data.project_path) continue
      rows.push({
        projectPath: data.project_path,
        time: data.start_time ? new Date(data.start_time).getTime() : 0,
      })
    } catch {
      // Ignore malformed cache files.
    }
  }

  return rows
    .sort((a, b) => b.time - a.time)
    .map(row => row.projectPath)
}

export async function GET() {
  const db = getDb()
  const projectRows = db.prepare(
    `SELECT workspace_path, updated_at FROM projects
     WHERE status = 'active' AND workspace_path != ''
     ORDER BY COALESCE(last_opened_at, updated_at) DESC
     LIMIT 50`
  ).all() as WorkspaceRow[]
  const sessionRows = db.prepare(
    `SELECT workspace_path, updated_at, last_message_at FROM sessions
     WHERE status != 'deleted' AND workspace_path IS NOT NULL AND workspace_path != ''
     ORDER BY COALESCE(last_message_at, updated_at) DESC
     LIMIT 50`
  ).all() as WorkspaceRow[]

  const paths = [
    ...projectRows.map(row => row.workspace_path),
    ...sessionRows.map(row => row.workspace_path),
    ...readClaudeRecentWorkspaces(),
  ]
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0 && !p.trim().startsWith('['))
    .map(p => p.trim())

  return NextResponse.json({ workspaces: [...new Set(paths)].slice(0, 12) })
}
