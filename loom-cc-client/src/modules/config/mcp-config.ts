/**
 * MCP server configuration management.
 *
 * Configs are stored in {workspace}/.claude.json so the Claude Agent SDK
 * picks them up automatically via the workspace `cwd` option.
 *
 * Supported transports:
 *   http   — { type: 'http',  url: string }
 *   sse    — { type: 'sse',   url: string }
 *   stdio  — { type: 'stdio', command: string, args?: string[], env?: Record<string,string> }
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import path from 'path'
import os from 'os'

// ── Types ────────────────────────────────────────────────────────────────────

export type McpTransport = 'http' | 'sse' | 'stdio'

export type McpServerConfig =
  | { type: 'http';  url: string }
  | { type: 'sse';   url: string }
  | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }

export interface McpServer {
  name: string
  config: McpServerConfig
}

interface ClaudeJson {
  mcpServers?: Record<string, McpServerConfig>
  [key: string]: unknown
}

// ── Workspace path ────────────────────────────────────────────────────────────

function getWorkspaceDir(): string {
  if (process.env.LOOM_WORKSPACE_DIR) return process.env.LOOM_WORKSPACE_DIR
  const name = process.env.NODE_ENV === 'production' ? 'loom-cc' : 'loom-cc-dev'
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', name, 'workspaces')
  }
  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Roaming', name, 'workspaces')
  }
  return path.join(os.homedir(), `.${name}`, 'workspaces')
}

function getClaudeJsonPath(): string {
  return path.join(getWorkspaceDir(), '.claude.json')
}

// ── Read / Write ──────────────────────────────────────────────────────────────

function readClaudeJson(): ClaudeJson {
  const p = getClaudeJsonPath()
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as ClaudeJson
  } catch {
    return {}
  }
}

function writeClaudeJson(data: ClaudeJson): void {
  const p = getClaudeJsonPath()
  mkdirSync(path.dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

/**
 * Read MCP servers from Claude Code's global ~/.claude.json.
 * Claude Code stores per-project servers under:
 *   projects["<absolute-project-path>"].mcpServers
 * We look up the project path via LOOM_PROJECT_DIR env var, or fall back
 * to the repo root (two levels above this package's __dirname at runtime).
 */
function readGlobalClaudeMcpServers(): Record<string, McpServerConfig> {
  const globalPath = path.join(os.homedir(), '.claude.json')
  if (!existsSync(globalPath)) return {}
  try {
    const raw = JSON.parse(readFileSync(globalPath, 'utf-8')) as {
      projects?: Record<string, { mcpServers?: Record<string, McpServerConfig> }>
    }
    const projects = raw.projects ?? {}

    // Determine which project key to look up
    const projectDir =
      process.env.LOOM_PROJECT_DIR ??
      // In Next.js, process.cwd() is the Next.js app dir; go one level up to repo root
      path.resolve(process.cwd(), '..')

    // Try exact match first, then prefix-match (in case of trailing slash differences)
    const exactKey = Object.keys(projects).find(k => k === projectDir)
    const prefixKey = exactKey ?? Object.keys(projects).find(k => projectDir.startsWith(k))
    const key = prefixKey

    if (key && projects[key]?.mcpServers) {
      return projects[key].mcpServers as Record<string, McpServerConfig>
    }
    return {}
  } catch {
    return {}
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** List all configured MCP servers (workspace config + Claude Code global config) */
export function listMcpServers(): McpServer[] {
  // Merge: workspace-local config takes precedence over global
  const globalServers = readGlobalClaudeMcpServers()
  const localJson = readClaudeJson()
  const localServers = localJson.mcpServers ?? {}
  const merged = { ...globalServers, ...localServers }
  return Object.entries(merged).map(([name, config]) => ({ name, config }))
}

/** Add or update an MCP server */
export function addMcpServer(name: string, config: McpServerConfig): void {
  const json = readClaudeJson()
  json.mcpServers = { ...(json.mcpServers ?? {}), [name]: config }
  writeClaudeJson(json)
}

/** Remove an MCP server by name. Returns true if it existed. */
export function removeMcpServer(name: string): boolean {
  const json = readClaudeJson()
  if (!json.mcpServers?.[name]) return false
  delete json.mcpServers[name]
  writeClaudeJson(json)
  return true
}

// ── Command parser ────────────────────────────────────────────────────────────

/**
 * Parse a `/mcp add` command string into an McpServerConfig.
 *
 * Supported formats (mirrors `claude mcp add` CLI):
 *   /mcp add --transport http  <name> <url>
 *   /mcp add --transport sse   <name> <url>
 *   /mcp add --transport stdio <name> <command> [arg1 arg2 ...]
 *   /mcp add <name> <command> [args...]          <- stdio default
 *
 * Returns { name, config } or throws with a descriptive error.
 */
export function parseMcpAddCommand(args: string[]): { name: string; config: McpServerConfig } {
  let transport: McpTransport = 'stdio'
  const rest = [...args]

  // Extract --transport flag
  const tIdx = rest.indexOf('--transport')
  if (tIdx !== -1) {
    const tVal = rest[tIdx + 1]
    if (!tVal || !['http', 'sse', 'stdio'].includes(tVal)) {
      throw new Error(`--transport must be http / sse / stdio, got: ${tVal ?? '(empty)'}`)
    }
    transport = tVal as McpTransport
    rest.splice(tIdx, 2)
  }

  if (rest.length < 2) {
    throw new Error('Usage: /mcp add [--transport http|sse|stdio] <name> <url or command> [args...]')
  }

  const name = rest[0]
  const second = rest[1]
  const extraArgs = rest.slice(2)

  if (transport === 'http' || transport === 'sse') {
    return { name, config: { type: transport, url: second } }
  }

  // stdio
  return {
    name,
    config: {
      type: 'stdio',
      command: second,
      ...(extraArgs.length > 0 ? { args: extraArgs } : {}),
    },
  }
}
