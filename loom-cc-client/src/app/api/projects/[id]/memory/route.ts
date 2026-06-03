import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'
import { ensureClaudeMemory, readClaudeMemory } from '@/shared/memory/files'
import { readLatestMemoryJob } from '@/shared/memory/background-jobs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getProjectWorkspace(projectId: string): string | null {
  const db = getDb()
  const row = db.prepare('SELECT workspace_path FROM projects WHERE id = ?').get(projectId) as { workspace_path: string | null } | undefined
  return row?.workspace_path || null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const workspacePath = getProjectWorkspace(id)
  if (!workspacePath) return NextResponse.json({ error: 'Project workspace not found' }, { status: 404 })
  return NextResponse.json({
    memory: readClaudeMemory('project', workspacePath),
    latestMemoryJob: readLatestMemoryJob({ workspacePath }),
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const workspacePath = getProjectWorkspace(id)
  if (!workspacePath) return NextResponse.json({ error: 'Project workspace not found' }, { status: 404 })
  const body = await req.json().catch(() => ({})) as { initialize?: boolean }
  const memory = body.initialize ? ensureClaudeMemory('project', workspacePath) : readClaudeMemory('project', workspacePath)
  return NextResponse.json({
    memory,
    latestMemoryJob: readLatestMemoryJob({ workspacePath }),
  })
}
