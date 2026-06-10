import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { getDb } from '@/shared/db/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function resolveWorkspace(id: string) {
  const db = getDb()
  const project = db.prepare('SELECT workspace_path FROM projects WHERE id = ? AND status = ?').get(id, 'active') as
    | { workspace_path: string }
    | undefined
  return project?.workspace_path ?? null
}

function safeFullPath(workspacePath: string, relPath: string): string | null {
  const workspace = path.resolve(workspacePath)
  const resolved = path.resolve(workspace, relPath || '.')
  if (resolved !== workspace && !resolved.startsWith(workspace + path.sep)) return null
  return resolved
}

function openSystemDirectory(dirPath: string): void {
  const platform = process.platform
  const command = platform === 'darwin'
    ? 'open'
    : platform === 'win32'
      ? 'explorer.exe'
      : 'xdg-open'
  const child = spawn(command, [dirPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const workspacePath = await resolveWorkspace(id)
  if (!workspacePath) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as { relPath?: string }
  const fullPath = safeFullPath(workspacePath, body.relPath ?? '')
  if (!fullPath) return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  if (!fs.existsSync(fullPath)) return NextResponse.json({ error: 'Path does not exist' }, { status: 404 })

  const stat = fs.statSync(fullPath)
  if (!stat.isDirectory()) return NextResponse.json({ error: 'Path is not a directory' }, { status: 400 })

  try {
    openSystemDirectory(fullPath)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
