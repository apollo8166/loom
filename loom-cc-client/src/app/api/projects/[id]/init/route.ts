/**
 * POST /api/projects/[id]/init
 *
 * Ensures the .claude/ skeleton exists inside the project's workspace,
 * then returns the init template files for the AI to use in the setup interview.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'
import fs from 'fs'
import path from 'path'
import { ensureClaudeMemory } from '@/shared/memory/files'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── .claude/ skeleton ──────────────────────────────────────────────────────────

const CLAUDE_FILES = [
  'CLAUDE.md',
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'MEMORY.md',
  'HEARTBEAT.md',
]

const CLAUDE_SUBDIRS = ['memory', 'agents', 'skills', 'rules']

function ensureClaudeDir(workspacePath: string): { created: string[]; skipped: string[] } {
  const claudeDir = path.join(workspacePath, '.claude')

  const existingFiles = fs.existsSync(claudeDir)
    ? new Set(fs.readdirSync(claudeDir).filter(f => f.endsWith('.md')))
    : new Set<string>()

  fs.mkdirSync(claudeDir, { recursive: true })

  for (const sub of CLAUDE_SUBDIRS) {
    fs.mkdirSync(path.join(claudeDir, sub), { recursive: true })
  }

  for (const file of CLAUDE_FILES) {
    const filePath = path.join(claudeDir, file)
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', 'utf-8')
    }
  }

  const allFiles = fs.readdirSync(claudeDir).filter(f => f.endsWith('.md'))
  return {
    created: allFiles.filter(f => !existingFiles.has(f)),
    skipped: allFiles.filter(f => existingFiles.has(f)),
  }
}

// ── Template loader ────────────────────────────────────────────────────────────

function getTemplatesDir(): string {
  const base = process.env.LOOM_RESOURCES_PATH || process.cwd()
  return path.join(base, 'templates', 'init')
}

function readInitTemplates(): Record<string, string> {
  const dir = getTemplatesDir()
  const result: Record<string, string> = {}
  if (!fs.existsSync(dir)) return result

  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
    try {
      result[file] = fs.readFileSync(path.join(dir, file), 'utf-8')
    } catch { /* skip unreadable */ }
  }
  return result
}

// ── Route ──────────────────────────────────────────────────────────────────────

interface ProjectRow {
  workspace_path: string
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  try {
    const db = getDb()
    const project = db.prepare('SELECT workspace_path FROM projects WHERE id = ?').get(id) as ProjectRow | undefined

    if (!project) {
      return NextResponse.json({ ok: false, message: 'Project not found' }, { status: 404 })
    }

    const workspacePath = project.workspace_path
    if (!workspacePath) {
      return NextResponse.json({ ok: false, message: 'Project has no workspace path' }, { status: 400 })
    }

    const { created, skipped } = ensureClaudeDir(workspacePath)
    ensureClaudeMemory('project', workspacePath)
    const templates = readInitTemplates()

    // Read existing non-empty file contents — AI uses these to skip already-answered sections
    const existingContents: Record<string, string> = {}
    const claudeDir = path.join(workspacePath, '.claude')
    for (const file of CLAUDE_FILES) {
      const filePath = path.join(claudeDir, file)
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8').trim()
        if (content) existingContents[file] = content
      }
    }

    return NextResponse.json({
      ok: true,
      created,
      skipped,
      templates,
      existingContents,
      message: created.length > 0
        ? `已创建 ${created.length} 个文件：${created.join('、')}`
        : '所有配置文件已存在。',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : '初始化失败'
    return NextResponse.json({ ok: false, message }, { status: 500 })
  }
}
