/**
 * Claude MCP server configuration management.
 *
 * This follows Claude Code / Claude Agent SDK's own MCP scope model:
 *   - local   -> ~/.claude.json projects["<cwd>"].mcpServers
 *   - project -> <cwd>/.mcp.json mcpServers
 *   - user    -> ~/.claude.json mcpServers
 *
 * Effective visibility for a session is resolved by Claude Code using cwd.
 * When names collide, higher-priority scopes win: local > project > user.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import path from 'path'
import os from 'os'
import type { McpServerConfigForProcessTransport } from '@anthropic-ai/claude-agent-sdk'

// ── Types ────────────────────────────────────────────────────────────────────

export type McpTransport = 'http' | 'sse' | 'stdio'
export type McpScope = 'local' | 'project' | 'user'
export type McpServerConfig = Exclude<McpServerConfigForProcessTransport, { type: 'sdk' }>

export interface McpServer {
  name: string
  config: McpServerConfig
  scope: McpScope
  sourcePath: string
  overriddenBy?: McpScope
}

interface ClaudeJson {
  mcpServers?: Record<string, McpServerConfig>
  projects?: Record<string, { mcpServers?: Record<string, McpServerConfig>; [key: string]: unknown }>
  [key: string]: unknown
}

interface ProjectMcpJson {
  mcpServers?: Record<string, McpServerConfig>
  [key: string]: unknown
}

const SCOPE_PRIORITY: Record<McpScope, number> = {
  user: 1,
  project: 2,
  local: 3,
}

function globalClaudeJsonPath(): string {
  return path.join(os.homedir(), '.claude.json')
}

function projectMcpJsonPath(workspacePath: string): string {
  return path.join(workspacePath, '.mcp.json')
}

function normalizeWorkspacePath(workspacePath?: string | null): string | null {
  const trimmed = workspacePath?.trim()
  return trimmed ? path.resolve(trimmed) : null
}

function readJsonFile<T extends object>(filePath: string): T {
  if (!existsSync(filePath)) return {} as T
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T
  } catch {
    return {} as T
  }
}

function writeJsonFile(filePath: string, data: object): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

function readClaudeJson(): ClaudeJson {
  return readJsonFile<ClaudeJson>(globalClaudeJsonPath())
}

function writeClaudeJson(data: ClaudeJson): void {
  writeJsonFile(globalClaudeJsonPath(), data)
}

function readProjectMcpJson(workspacePath: string): ProjectMcpJson {
  return readJsonFile<ProjectMcpJson>(projectMcpJsonPath(workspacePath))
}

function writeProjectMcpJson(workspacePath: string, data: ProjectMcpJson): void {
  writeJsonFile(projectMcpJsonPath(workspacePath), data)
}

function getProjectEntry(json: ClaudeJson, workspacePath: string) {
  json.projects = json.projects ?? {}
  json.projects[workspacePath] = json.projects[workspacePath] ?? {}
  return json.projects[workspacePath]
}

function collectScopedServers(scope: McpScope, servers: Record<string, McpServerConfig> | undefined, sourcePath: string): McpServer[] {
  return Object.entries(servers ?? {}).map(([name, config]) => ({
    name,
    config,
    scope,
    sourcePath,
  }))
}

function resolveEffectiveServers(servers: McpServer[]): McpServer[] {
  const grouped = new Map<string, McpServer[]>()
  for (const server of servers) {
    const group = grouped.get(server.name) ?? []
    group.push(server)
    grouped.set(server.name, group)
  }

  return [...grouped.values()].flatMap(group => {
    const winner = group.reduce((best, server) =>
      SCOPE_PRIORITY[server.scope] > SCOPE_PRIORITY[best.scope] ? server : best
    )
    return group.map(server => ({
      ...server,
      ...(server === winner ? {} : { overriddenBy: winner.scope }),
    }))
  })
    .sort((a, b) => a.name.localeCompare(b.name) || SCOPE_PRIORITY[b.scope] - SCOPE_PRIORITY[a.scope])
}

// ── Public API ────────────────────────────────────────────────────────────────

/** List Claude MCP servers visible from a workspace, annotated with their scope. */
export function listMcpServers(workspacePath?: string | null): McpServer[] {
  const resolvedWorkspace = normalizeWorkspacePath(workspacePath)
  const claudeJson = readClaudeJson()
  const servers: McpServer[] = [
    ...collectScopedServers('user', claudeJson.mcpServers, globalClaudeJsonPath()),
  ]

  if (resolvedWorkspace) {
    const projectJson = readProjectMcpJson(resolvedWorkspace)
    servers.push(...collectScopedServers('project', projectJson.mcpServers, projectMcpJsonPath(resolvedWorkspace)))
    const localServers = claudeJson.projects?.[resolvedWorkspace]?.mcpServers
    servers.push(...collectScopedServers('local', localServers, globalClaudeJsonPath()))
  }

  return resolveEffectiveServers(servers)
}

/** Add or update a Claude MCP server in the selected Claude scope. */
export function addMcpServer(name: string, config: McpServerConfig, scope: McpScope = 'local', workspacePath?: string | null): void {
  const trimmedName = name.trim()
  if (!trimmedName) throw new Error('name cannot be empty')

  if (scope === 'project') {
    const resolvedWorkspace = normalizeWorkspacePath(workspacePath)
    if (!resolvedWorkspace) throw new Error('workspacePath is required for project MCP scope')
    const json = readProjectMcpJson(resolvedWorkspace)
    json.mcpServers = { ...(json.mcpServers ?? {}), [trimmedName]: config }
    writeProjectMcpJson(resolvedWorkspace, json)
    return
  }

  const json = readClaudeJson()
  if (scope === 'user') {
    json.mcpServers = { ...(json.mcpServers ?? {}), [trimmedName]: config }
    writeClaudeJson(json)
    return
  }

  const resolvedWorkspace = normalizeWorkspacePath(workspacePath)
  if (!resolvedWorkspace) throw new Error('workspacePath is required for local MCP scope')
  const project = getProjectEntry(json, resolvedWorkspace)
  project.mcpServers = { ...(project.mcpServers ?? {}), [trimmedName]: config }
  writeClaudeJson(json)
}

/** Remove a Claude MCP server from a specific Claude scope. */
export function removeMcpServer(name: string, scope: McpScope = 'local', workspacePath?: string | null): boolean {
  const trimmedName = name.trim()
  if (!trimmedName) return false

  if (scope === 'project') {
    const resolvedWorkspace = normalizeWorkspacePath(workspacePath)
    if (!resolvedWorkspace) throw new Error('workspacePath is required for project MCP scope')
    const json = readProjectMcpJson(resolvedWorkspace)
    if (!json.mcpServers?.[trimmedName]) return false
    delete json.mcpServers[trimmedName]
    writeProjectMcpJson(resolvedWorkspace, json)
    return true
  }

  const json = readClaudeJson()
  if (scope === 'user') {
    if (!json.mcpServers?.[trimmedName]) return false
    delete json.mcpServers[trimmedName]
    writeClaudeJson(json)
    return true
  }

  const resolvedWorkspace = normalizeWorkspacePath(workspacePath)
  if (!resolvedWorkspace) throw new Error('workspacePath is required for local MCP scope')
  const project = json.projects?.[resolvedWorkspace]
  if (!project?.mcpServers?.[trimmedName]) return false
  delete project.mcpServers[trimmedName]
  writeClaudeJson(json)
  return true
}

// ── Command parser ────────────────────────────────────────────────────────────

/**
 * Parse a `/mcp add` command string into an McpServerConfig.
 *
 * Supported formats:
 *   /mcp add --scope local|project|user --transport http  <name> <url>
 *   /mcp add --scope local|project|user --transport sse   <name> <url>
 *   /mcp add --scope local|project|user --transport stdio <name> <command> [arg1 arg2 ...]
 *   /mcp add <name> <command> [args...]          <- local scope, stdio default
 */
export function parseMcpAddCommand(args: string[]): { name: string; config: McpServerConfig; scope: McpScope } {
  let transport: McpTransport = 'stdio'
  let scope: McpScope = 'local'
  const rest = [...args]

  const tIdx = rest.indexOf('--transport')
  if (tIdx !== -1) {
    const tVal = rest[tIdx + 1]
    if (!tVal || !['http', 'sse', 'stdio'].includes(tVal)) {
      throw new Error(`--transport must be http / sse / stdio, got: ${tVal ?? '(empty)'}`)
    }
    transport = tVal as McpTransport
    rest.splice(tIdx, 2)
  }

  const scopeIdx = rest.indexOf('--scope')
  if (scopeIdx !== -1) {
    const scopeVal = rest[scopeIdx + 1]
    if (!scopeVal || !['local', 'project', 'user'].includes(scopeVal)) {
      throw new Error(`--scope must be local / project / user, got: ${scopeVal ?? '(empty)'}`)
    }
    scope = scopeVal as McpScope
    rest.splice(scopeIdx, 2)
  }

  if (rest.length < 2) {
    throw new Error('Usage: /mcp add [--scope local|project|user] [--transport http|sse|stdio] <name> <url or command> [args...]')
  }

  const name = rest[0]
  const second = rest[1]
  const extraArgs = rest.slice(2)

  if (transport === 'http' || transport === 'sse') {
    return { name, scope, config: { type: transport, url: second } }
  }

  return {
    name,
    scope,
    config: {
      type: 'stdio',
      command: second,
      ...(extraArgs.length > 0 ? { args: extraArgs } : {}),
    },
  }
}
