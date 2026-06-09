import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  ensureLegacyGlobalSkillsVisibleToSdk,
  getLegacyLoomGlobalSkillsDir,
  getSdkGlobalClaudeDir,
} from '@/shared/skills/sdk-global-skills'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface SkillEntry {
  name: string
  description: string
  source: 'builtin' | 'project' | 'global'
  content?: string   // body of SKILL.md after stripping frontmatter (sent to AI)
  raw?: string       // full SKILL.md content including frontmatter (for display)
}

type ReadOptions = {
  includeRaw: boolean
  skillName?: string
}

const FEATURED_SKILL_ORDER: Record<string, number> = {
  'student-ppt-skill': 0,
  'skill-builder': 10,
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

function resolveWorkspaceDir(): string {
  if (process.env.LOOM_WORKSPACE_DIR) return process.env.LOOM_WORKSPACE_DIR
  const home = os.homedir()
  const name = process.env.NODE_ENV === 'production' ? 'loom-cc' : 'loom-cc-dev'
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', name, 'workspaces')
  if (process.platform === 'win32') return path.join(home, 'AppData', 'Roaming', name, 'workspaces')
  return path.join(home, `.${name}`, 'workspaces')
}

function findClaudeDirs(projectWorkspacePath?: string): { project: string | null; global: string | null } {
  const globalDir = getSdkGlobalClaudeDir()
  const global_ = fs.existsSync(globalDir) ? globalDir : null

  // If a project workspace path is provided, look there first
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
    // Project workspace exists but has no .claude/skills — return null project dir
    return { project: null, global: global_ }
  }

  // Fallback: check the loom default workspace dir
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

function stripFrontmatter(raw: string): string {
  const match = /^---\n[\s\S]*?\n---\n?([\s\S]*)$/.exec(raw)
  return match ? match[1].trim() : raw.trim()
}

function readSkillsFrom(claudeDir: string, source: 'project' | 'global', options: ReadOptions): SkillEntry[] {
  const skillsDir = path.join(claudeDir, 'skills')
  if (!fs.existsSync(skillsDir)) return []

  const results: SkillEntry[] = []
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const skillDir = path.join(skillsDir, entry.name)
    const skillMd = path.join(skillDir, 'SKILL.md')
    if (!fs.existsSync(skillMd)) continue
    try {
      const raw = fs.readFileSync(skillMd, 'utf-8')
      const fm = parseFrontmatter(raw)
      const name = fm.name || entry.name
      if (options.skillName && options.skillName !== name && options.skillName !== entry.name) continue
      results.push({
        name,
        description: fm.description || '',
        source,
        ...(options.includeRaw ? { content: stripFrontmatter(raw), raw } : {}),
      })
    } catch { /* skip */ }
  }
  return results
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  ensureLegacyGlobalSkillsVisibleToSdk()
  const workspacePath = searchParams.get('workspacePath') ?? undefined
  const includeRaw = searchParams.get('summary') !== '1' || searchParams.get('includeRaw') === '1'
  const skillName = searchParams.get('skill')?.replace(/^\//, '').trim() || undefined
  const readOptions = { includeRaw, skillName }
  const { project, global: globalDir } = findClaudeDirs(workspacePath)
  const legacyLoomGlobalDir = path.dirname(getLegacyLoomGlobalSkillsDir())

  const seen = new Set<string>()
  const skills: SkillEntry[] = []

  for (const [dir, src] of [[project, 'project'], [globalDir, 'global'], [legacyLoomGlobalDir, 'global']] as [string | null, 'project' | 'global'][]) {
    if (!dir) continue
    for (const s of readSkillsFrom(dir, src, readOptions)) {
      if (!seen.has(s.name)) { seen.add(s.name); skills.push(s) }
    }
  }

  skills.sort((a, b) => {
    const rankDiff = (FEATURED_SKILL_ORDER[a.name] ?? 1000) - (FEATURED_SKILL_ORDER[b.name] ?? 1000)
    return rankDiff || a.name.localeCompare(b.name)
  })
  return NextResponse.json(
    { skills },
    { headers: { 'Cache-Control': includeRaw ? 'private, max-age=15' : 'private, max-age=30' } },
  )
}
