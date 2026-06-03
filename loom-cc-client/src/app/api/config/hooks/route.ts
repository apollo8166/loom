import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface HookGroup {
  matcher: string
  commands: string[]
}

export interface HookEvent {
  event: string
  groups: HookGroup[]
  source: 'project' | 'global'
}

function resolveWorkspaceDir(): string {
  if (process.env.LOOM_WORKSPACE_DIR) return process.env.LOOM_WORKSPACE_DIR
  const home = os.homedir()
  const name = process.env.NODE_ENV === 'production' ? 'loom-cc' : 'loom-cc-dev'
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', name, 'workspaces')
  if (process.platform === 'win32') return path.join(home, 'AppData', 'Roaming', name, 'workspaces')
  return path.join(home, `.${name}`, 'workspaces')
}

function findSettingsFiles(projectWorkspacePath?: string): { project: string | null; global: string | null } {
  const globalSettings = path.join(os.homedir(), '.claude', 'settings.json')
  const global_ = fs.existsSync(globalSettings) ? globalSettings : null

  if (projectWorkspacePath) {
    const candidate = path.join(projectWorkspacePath, '.claude', 'settings.json')
    if (fs.existsSync(candidate) && candidate !== globalSettings) {
      return { project: candidate, global: global_ }
    }
    return { project: null, global: global_ }
  }

  const workspaceSettings = path.join(resolveWorkspaceDir(), '.claude', 'settings.json')
  if (fs.existsSync(workspaceSettings)) {
    return { project: workspaceSettings, global: global_ }
  }

  return { project: null, global: global_ }
}

type HookDef = { type: string; command?: string; if?: string; timeout?: number }
type MatcherGroup = { matcher?: string; hooks: HookDef[] }
type HooksConfig = Record<string, MatcherGroup[]>

function summarizeCommand(cmd: string): string {
  const scriptMatch = /([^/\s]+\.sh)/.exec(cmd)
  if (scriptMatch) return scriptMatch[1]
  return cmd.replace(/\s+/g, ' ').slice(0, 60) + (cmd.length > 60 ? '...' : '')
}

function parseHooks(settingsFile: string, source: 'project' | 'global'): HookEvent[] {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'))
    const hooks = raw.hooks as HooksConfig | undefined
    if (!hooks || typeof hooks !== 'object') return []

    return Object.entries(hooks).map(([event, groups]) => ({
      event,
      source,
      groups: (groups ?? []).map(g => ({
        matcher: g.matcher ?? '',
        commands: (g.hooks ?? [])
          .filter(h => h.command)
          .map(h => (h.if ? `${h.if} -> ` : '') + summarizeCommand(h.command!)),
      })),
    }))
  } catch {
    return []
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const workspacePath = searchParams.get('workspacePath') ?? undefined
  const { project, global: globalSettings } = findSettingsFiles(workspacePath)

  const events: HookEvent[] = []
  const seen = new Set<string>()

  if (project) {
    for (const e of parseHooks(project, 'project')) {
      seen.add(e.event)
      events.push(e)
    }
  }
  if (globalSettings) {
    for (const e of parseHooks(globalSettings, 'global')) {
      if (!seen.has(e.event)) events.push(e)
    }
  }

  const ORDER = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification', 'Stop', 'SessionStart']
  events.sort((a, b) => {
    const ai = ORDER.indexOf(a.event)
    const bi = ORDER.indexOf(b.event)
    if (ai === -1 && bi === -1) return a.event.localeCompare(b.event)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })

  return NextResponse.json({ events })
}
