import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface AgentEntry { name: string; description: string; source: 'project' | 'global' }

function resolveWorkspaceDir(): string {
  if (process.env.LOOM_WORKSPACE_DIR) return process.env.LOOM_WORKSPACE_DIR
  const home = os.homedir()
  const name = process.env.NODE_ENV === 'production' ? 'loom-cc' : 'loom-cc-dev'
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', name, 'workspaces')
  if (process.platform === 'win32') return path.join(home, 'AppData', 'Roaming', name, 'workspaces')
  return path.join(home, `.${name}`, 'workspaces')
}

function findClaudeDirs(projectWorkspacePath?: string): { project: string | null; global: string | null } {
  const globalDir = path.join(os.homedir(), '.claude')
  const global_ = fs.existsSync(globalDir) ? globalDir : null

  if (projectWorkspacePath) {
    const candidate = path.join(projectWorkspacePath, '.claude')
    if (
      fs.existsSync(candidate) &&
      candidate !== globalDir &&
      (fs.existsSync(path.join(candidate, 'skills')) ||
       fs.existsSync(path.join(candidate, 'agents')))
    ) {
      return { project: candidate, global: global_ }
    }
    return { project: null, global: global_ }
  }

  const workspaceClaudeDir = path.join(resolveWorkspaceDir(), '.claude')
  if (
    fs.existsSync(workspaceClaudeDir) &&
    workspaceClaudeDir !== globalDir &&
    (fs.existsSync(path.join(workspaceClaudeDir, 'skills')) ||
     fs.existsSync(path.join(workspaceClaudeDir, 'agents')))
  ) {
    return { project: workspaceClaudeDir, global: global_ }
  }

  return { project: null, global: global_ }
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---/.exec(content)
  if (!match) return {}
  const result: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':')
    if (idx > 0) result[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return result
}

function readAgentsFrom(claudeDir: string, source: 'project' | 'global'): AgentEntry[] {
  const agentsDir = path.join(claudeDir, 'agents')
  if (!fs.existsSync(agentsDir)) return []
  const results: AgentEntry[] = []
  for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    try {
      const fm = parseFrontmatter(fs.readFileSync(path.join(agentsDir, entry.name), 'utf-8'))
      results.push({
        name: fm.name || entry.name.replace('.md', ''),
        description: fm.description || '',
        source,
      })
    } catch { /* skip */ }
  }
  return results
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const workspacePath = searchParams.get('workspacePath') ?? undefined
  const { project, global: globalDir } = findClaudeDirs(workspacePath)

  const seen = new Set<string>()
  const agents: AgentEntry[] = []

  for (const [dir, src] of [[project, 'project'], [globalDir, 'global']] as [string | null, 'project' | 'global'][]) {
    if (!dir) continue
    for (const a of readAgentsFrom(dir, src)) {
      if (!seen.has(a.name)) { seen.add(a.name); agents.push(a) }
    }
  }

  agents.sort((a, b) => a.name.localeCompare(b.name))
  return NextResponse.json(
    { agents },
    { headers: { 'Cache-Control': 'private, max-age=30' } },
  )
}
