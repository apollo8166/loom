import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const IGNORE_DIRS = new Set([
  '.git', 'node_modules', '.next', 'dist', 'build', 'out',
  '__pycache__', '.DS_Store', '.turbo', '.cache', 'coverage',
  '.nyc_output', 'tmp', '.tmp',
])
const MAX_TREE_DEPTH = 6
const MAX_TREE_NODES = 900
const TREE_CACHE_TTL_MS = 8_000

interface FileNode {
  name: string
  type: 'file' | 'dir'
  path: string
  children?: FileNode[]
}

const treeCache = new Map<string, {
  expiresAt: number
  files: FileNode[]
  branch: string | null
}>()

function invalidateTreeCache(workspacePath: string | null) {
  if (!workspacePath) return
  treeCache.delete(path.resolve(workspacePath))
}

function readGitBranch(workspacePath: string): string | null {
  const cached = treeCache.get(path.resolve(workspacePath))
  if (cached && cached.expiresAt > Date.now()) return cached.branch
  try {
    const headPath = path.join(workspacePath, '.git', 'HEAD')
    const head = fs.readFileSync(headPath, 'utf-8').trim()
    const match = /^ref:\s+refs\/heads\/(.+)$/.exec(head)
    if (match) return match[1]
    return head ? null : null
  } catch { /* fall through to git */ }
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: workspacePath,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 800,
    }).toString().trim()
    return branch && branch !== 'HEAD' ? branch : null
  } catch {
    return null
  }
}

function readTree(dirPath: string, relativePath: string, depth: number, count: { n: number }): FileNode[] {
  if (depth > MAX_TREE_DEPTH || count.n > MAX_TREE_NODES) return []

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return []
  }

  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1
    if (!a.isDirectory() && b.isDirectory()) return 1
    return a.name.localeCompare(b.name)
  })

  const nodes: FileNode[] = []
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue
    if (entry.name.startsWith('.') && !entry.isDirectory() && entry.name !== '.env.example') continue
    count.n++
    if (count.n > MAX_TREE_NODES) break

    const fullPath = path.join(dirPath, entry.name)
    const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      const children = readTree(fullPath, relPath, depth + 1, count)
      nodes.push({ name: entry.name, type: 'dir', path: relPath, children })
    } else {
      nodes.push({ name: entry.name, type: 'file', path: relPath })
    }
  }
  return nodes
}

/* ── Shared: resolve project workspace ── */
async function resolveWorkspace(id: string) {
  const db = getDb()
  const project = db.prepare('SELECT workspace_path FROM projects WHERE id = ? AND status = ?').get(id, 'active') as
    | { workspace_path: string }
    | undefined
  return project?.workspace_path ?? null
}

function safeFullPath(workspacePath: string, relPath: string): string | null {
  const resolved = path.resolve(workspacePath, relPath)
  if (!resolved.startsWith(path.resolve(workspacePath) + path.sep) &&
      resolved !== path.resolve(workspacePath)) {
    return null
  }
  return resolved
}

/* ── GET /api/projects/[id]/files ── */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const workspacePath = await resolveWorkspace(id)
  const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1'

  if (!workspacePath) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (!fs.existsSync(workspacePath)) return NextResponse.json({ files: [], branch: null })

  const cacheKey = path.resolve(workspacePath)
  const cached = treeCache.get(cacheKey)
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(
      { files: cached.files, branch: cached.branch },
      { headers: { 'Cache-Control': 'private, max-age=8' } },
    )
  }

  const count = { n: 0 }
  const files = readTree(workspacePath, '', 1, count)

  const branch = readGitBranch(workspacePath)

  treeCache.set(cacheKey, { expiresAt: Date.now() + TREE_CACHE_TTL_MS, files, branch })

  return NextResponse.json(
    { files, branch },
    { headers: { 'Cache-Control': forceRefresh ? 'no-store' : 'private, max-age=8' } },
  )
}

/* ── POST /api/projects/[id]/files — create file or directory ── */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const workspacePath = await resolveWorkspace(id)
  if (!workspacePath) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const body = await req.json() as { name: string; parentRelPath: string; type: 'file' | 'dir' }
  const { name, parentRelPath, type } = body

  if (!name || /[/\\]/.test(name) || name === '.' || name === '..') {
    return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
  }

  const parentFull = parentRelPath
    ? safeFullPath(workspacePath, parentRelPath)
    : path.resolve(workspacePath)

  if (!parentFull) return NextResponse.json({ error: 'Invalid path' }, { status: 400 })

  const fullPath = path.join(parentFull, name)
  if (!fullPath.startsWith(path.resolve(workspacePath))) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  if (fs.existsSync(fullPath)) {
    return NextResponse.json({ error: 'Already exists' }, { status: 409 })
  }

  try {
    if (type === 'dir') {
      fs.mkdirSync(fullPath, { recursive: true })
    } else {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true })
      fs.writeFileSync(fullPath, '')
    }
    invalidateTreeCache(workspacePath)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

/* ── PATCH /api/projects/[id]/files — rename ── */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const workspacePath = await resolveWorkspace(id)
  if (!workspacePath) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const body = await req.json() as { relPath: string; newName: string }
  const { relPath, newName } = body

  if (!newName || /[/\\]/.test(newName) || newName === '.' || newName === '..') {
    return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
  }

  const oldFull = safeFullPath(workspacePath, relPath)
  if (!oldFull) return NextResponse.json({ error: 'Invalid path' }, { status: 400 })

  if (!fs.existsSync(oldFull)) {
    return NextResponse.json({ error: 'Path does not exist' }, { status: 404 })
  }

  const newFull = path.join(path.dirname(oldFull), newName)
  if (!newFull.startsWith(path.resolve(workspacePath))) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  try {
    fs.renameSync(oldFull, newFull)
    invalidateTreeCache(workspacePath)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

/* ── DELETE /api/projects/[id]/files — delete file or directory ── */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const workspacePath = await resolveWorkspace(id)
  if (!workspacePath) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const body = await req.json() as { relPath: string }
  const { relPath } = body

  const fullPath = safeFullPath(workspacePath, relPath)
  if (!fullPath) return NextResponse.json({ error: 'Invalid path' }, { status: 400 })

  if (fullPath === path.resolve(workspacePath)) {
    return NextResponse.json({ error: 'Cannot delete workspace root' }, { status: 400 })
  }

  if (!fs.existsSync(fullPath)) {
    return NextResponse.json({ error: 'Path does not exist' }, { status: 404 })
  }

  try {
    fs.rmSync(fullPath, { recursive: true, force: true })
    invalidateTreeCache(workspacePath)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
