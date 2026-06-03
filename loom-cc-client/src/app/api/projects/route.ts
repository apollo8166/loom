import { NextRequest, NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { GLOBAL_CHAT_PROJECT_ID, getDb } from '@/shared/db/db'
import fs from 'fs'
import path from 'path'
import { logger } from '@/shared/logging/logger'
import { ensureClaudeMemory } from '@/shared/memory/files'

// ── .claude/ scaffold ──────────────────────────────────────────────────────────

const CLAUDE_DIR_FILES = [
  'CLAUDE.md',
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'MEMORY.md',
  'HEARTBEAT.md',
]

const CLAUDE_DIR_SUBDIRS = ['memory', 'agents', 'skills', 'rules']

/**
 * Initialise the .claude/ directory skeleton inside `workspacePath`.
 * Existing files/folders are never overwritten.
 */
function initClaudeDir(workspacePath: string): void {
  if (!workspacePath) return
  try {
    const claudeDir = path.join(workspacePath, '.claude')
    fs.mkdirSync(claudeDir, { recursive: true })

    for (const file of CLAUDE_DIR_FILES) {
      const filePath = path.join(claudeDir, file)
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '', 'utf-8')
      }
    }

    for (const sub of CLAUDE_DIR_SUBDIRS) {
      const subPath = path.join(claudeDir, sub)
      if (!fs.existsSync(subPath)) {
        fs.mkdirSync(subPath, { recursive: true })
      }
    }
    ensureClaudeMemory('project', workspacePath)
  } catch (err) {
    // Non-fatal — log but don't fail the project creation
    logger.warn('project.init_claude_dir_failed', {
      workspacePath,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

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

/** GET /api/projects — list all active projects */
export async function GET() {
  const db = getDb()
  const rows = db.prepare(
    `SELECT * FROM projects
     WHERE status = 'active' AND id != ?
     ORDER BY is_pinned DESC, last_opened_at DESC, updated_at DESC`
  ).all(GLOBAL_CHAT_PROJECT_ID) as ProjectRow[]

  return NextResponse.json({ projects: rows.map(mapProject) })
}

/** POST /api/projects — create a new project */
export async function POST(req: NextRequest) {
  let body: { name?: string; description?: string; workspacePath?: string; defaultModel?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { name, description, workspacePath, defaultModel } = body
  if (!name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const id = nanoid()
  const db = getDb()

  db.prepare(
    `INSERT INTO projects (id, name, description, workspace_path, default_model)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, name.trim(), description?.trim() ?? '', workspacePath || '', defaultModel || 'claude-sonnet-4-6')

  if (workspacePath) initClaudeDir(workspacePath)

  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow
  return NextResponse.json({ project: mapProject(row) }, { status: 201 })
}
