/**
 * Core SDK client wrapper for Loom CC.
 * MCP, browser-tools, workspace context, and agents-loader removed.
 * Only Anthropic provider is supported.
 *
 * Key requirements:
 * 1. Start env with full process.env (HOME, PATH, etc.)
 * 2. Ensure HOME is set so SDK can find ~/.claude.json OAuth
 * 3. Expand PATH to include fnm/nvm/volta bin dirs
 * 4. Remove CLAUDECODE env var to prevent "nested session" detection
 * 5. Find claude CLI binary via candidate paths + version manager scans
 */

import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Query, CanUseTool, Options, SDKUserMessage, WorktreeCreateHookInput, WorktreeRemoveHookInput, HookCallback } from '@anthropic-ai/claude-agent-sdk'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources'
import { execFileSync, execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { resolveProvider } from '@/shared/runtime/provider'
import { getModelEntry } from '@/shared/config/models'
import { LOOM_TOOL_RULES, buildEnvironmentPrompt } from './system-prompt'
import { getDefaultWorkspacesDir } from '@/shared/db/paths'
import { logger } from '@/shared/logging/logger'
import {
  createImageGenerationMcpServer,
  IMAGE_MCP_SERVER_NAME,
  isImageGenerationToolEnabled,
} from './image-generation-tool'

// ── Claude CLI Binary Discovery ─────────────────────────────────

let _cachedClaudePath: string | null = null
let _cachedClaudePathTime = 0

function findClaudeExecutable(): string | undefined {
  const now = Date.now()
  if (_cachedClaudePath && now - _cachedClaudePathTime < 60_000) {
    return _cachedClaudePath
  }
  const found = _findClaudeUncached()
  if (found) {
    _cachedClaudePath = found
    _cachedClaudePathTime = now
  }
  return found
}

function _findClaudeUncached(): string | undefined {
  const home = os.homedir()
  const isWin = process.platform === 'win32'
  const binaryName = isWin ? 'claude.exe' : 'claude'

  // 0. Bundled claude binary shipped inside the Electron app (production)
  //    LOOM_RESOURCES_PATH is set by electron/main.ts -> startServer env.
  const resourcesPath = process.env.LOOM_RESOURCES_PATH
  if (resourcesPath) {
    const builtinPath = path.join(resourcesPath, 'claude-cli', binaryName)
    if (fs.existsSync(builtinPath)) {
      try {
        execFileSync(builtinPath, ['--version'], { timeout: 5000, stdio: 'pipe' })
        return builtinPath
      } catch { /* not executable, fall through */ }
    }
  }

  // 1. Check well-known fixed paths (platform-specific)
  const candidates: string[] = isWin ? [
    path.join(home, 'AppData', 'Roaming', 'npm', 'claude.exe'),
    path.join(home, 'AppData', 'Local', 'Programs', 'nodejs', 'claude.exe'),
    'C:\\Program Files\\nodejs\\claude.exe',
    'C:\\Program Files (x86)\\nodejs\\claude.exe',
  ] : [
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    path.join(home, '.npm-global', 'bin', 'claude'),
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, '.claude', 'bin', 'claude'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        execFileSync(p, ['--version'], { timeout: 5000, stdio: 'pipe' })
        try {
          const real = fs.realpathSync(p)
          if (real.endsWith('.js') || real.endsWith('.mjs')) return real
        } catch { /* ignore, return original */ }
        return p
      } catch { /* not executable, try next */ }
    }
  }

  // 2. Scan fnm node versions
  const fnmVersionsDir = isWin
    ? path.join(home, 'AppData', 'Roaming', 'fnm', 'node-versions')
    : path.join(home, '.fnm', 'node-versions')
  const cliRelPath = 'installation/lib/node_modules/@anthropic-ai/claude-code/cli.js'
  try {
    if (fs.existsSync(fnmVersionsDir)) {
      for (const v of fs.readdirSync(fnmVersionsDir)) {
        const cliPath = path.join(fnmVersionsDir, v, cliRelPath)
        if (fs.existsSync(cliPath)) return cliPath
      }
    }
  } catch { /* skip */ }

  // 3. Scan nvm node versions
  const nvmBaseDir = isWin
    ? (process.env.NVM_HOME || path.join(home, 'AppData', 'Roaming', 'nvm'))
    : (process.env.NVM_DIR || path.join(home, '.nvm'))
  const nvmVersionsDir = isWin
    ? nvmBaseDir
    : path.join(nvmBaseDir, 'versions', 'node')
  try {
    if (fs.existsSync(nvmVersionsDir)) {
      for (const v of fs.readdirSync(nvmVersionsDir)) {
        const cliPath = isWin
          ? path.join(nvmVersionsDir, v, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js')
          : path.join(nvmVersionsDir, v, 'lib', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js')
        if (fs.existsSync(cliPath)) return cliPath
      }
    }
  } catch { /* skip */ }

  // 4. Scan volta
  const voltaToolsDir = isWin
    ? path.join(home, 'AppData', 'Local', 'Volta', 'tools', 'image', 'packages', '@anthropic-ai', 'claude-code')
    : path.join(home, '.volta', 'tools', 'image', 'packages', '@anthropic-ai', 'claude-code')
  try {
    if (fs.existsSync(voltaToolsDir)) {
      for (const v of fs.readdirSync(voltaToolsDir)) {
        const cliPath = path.join(voltaToolsDir, v, 'cli.js')
        if (fs.existsSync(cliPath)) return cliPath
      }
    }
  } catch { /* skip */ }

  // 5. Last resort: ask shell for the binary location
  try {
    if (isWin) {
      const result = execSync(`where ${binaryName}`, { timeout: 5000, stdio: 'pipe' })
      const found = result.toString().split('\n')[0].trim()
      if (found && fs.existsSync(found)) return found
    } else {
      const shell = process.env.SHELL || '/bin/zsh'
      const result = execSync(`${shell} -ilc "which claude" 2>/dev/null`, {
        timeout: 5000,
        stdio: 'pipe',
      })
      const found = result.toString().trim()
      if (found && fs.existsSync(found)) {
        return fs.realpathSync(found)
      }
    }
  } catch { /* not found */ }

  return undefined
}

// ── Expanded PATH builder ───────────────────────────────────────

function getExpandedPath(): string {
  const home = os.homedir()
  const isWin = process.platform === 'win32'
  const parts = new Set((process.env.PATH || '').split(path.delimiter).filter(Boolean))

  const extras: string[] = isWin ? [
    path.join(home, 'AppData', 'Roaming', 'npm'),
    path.join(home, 'AppData', 'Local', 'Programs', 'nodejs'),
    'C:\\Program Files\\nodejs',
  ] : [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
  ]

  // fnm
  const fnmVersionsDir = isWin
    ? path.join(home, 'AppData', 'Roaming', 'fnm', 'node-versions')
    : path.join(home, '.fnm', 'node-versions')
  try {
    if (fs.existsSync(fnmVersionsDir)) {
      for (const v of fs.readdirSync(fnmVersionsDir)) {
        extras.push(isWin
          ? path.join(fnmVersionsDir, v, 'installation')
          : path.join(fnmVersionsDir, v, 'installation', 'bin'))
      }
    }
  } catch { /* skip */ }

  // nvm
  const nvmBaseDir = isWin
    ? (process.env.NVM_HOME || path.join(home, 'AppData', 'Roaming', 'nvm'))
    : (process.env.NVM_DIR || path.join(home, '.nvm'))
  const nvmVersionsDir = isWin ? nvmBaseDir : path.join(nvmBaseDir, 'versions', 'node')
  try {
    if (fs.existsSync(nvmVersionsDir)) {
      for (const v of fs.readdirSync(nvmVersionsDir)) {
        extras.push(isWin
          ? path.join(nvmVersionsDir, v)
          : path.join(nvmVersionsDir, v, 'bin'))
      }
    }
  } catch { /* skip */ }

  // volta
  extras.push(isWin
    ? path.join(home, 'AppData', 'Local', 'Volta', 'bin')
    : path.join(home, '.volta', 'bin'))

  for (const p of extras) {
    if (p) parts.add(p)
  }
  return [...parts].join(path.delimiter)
}

// ── SDK Environment Builder ─────────────────────────────────────

function buildSdkEnv(apiKey: string, baseUrl?: string): Record<string, string> {
  const sdkEnv: Record<string, string> = {}

  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') sdkEnv[k] = v
  }

  if (!sdkEnv.HOME) sdkEnv.HOME = os.homedir()
  sdkEnv.PATH = getExpandedPath()
  delete sdkEnv.CLAUDECODE

  if (apiKey) {
    sdkEnv.ANTHROPIC_API_KEY = apiKey
    sdkEnv.ANTHROPIC_AUTH_TOKEN = apiKey
  } else {
    // CLI auth mode: let SDK read OAuth from ~/.claude.json
    delete sdkEnv.ANTHROPIC_API_KEY
    delete sdkEnv.ANTHROPIC_AUTH_TOKEN
  }

  if (baseUrl) {
    sdkEnv.ANTHROPIC_BASE_URL = baseUrl
  }

  return sdkEnv
}

// ── Workspace Dir Resolution ────────────────────────────────────
// In production, LOOM_WORKSPACE_DIR is set by Electron main.ts.
// In dev (pnpm dev:next, NODE_ENV=development), no env var -> fallback.

function resolveWorkspaceDir(projectWorkspacePath?: string): string {
  if (projectWorkspacePath) {
    return projectWorkspacePath
  }
  if (process.env.LOOM_WORKSPACE_DIR) {
    return process.env.LOOM_WORKSPACE_DIR
  }
  return getDefaultWorkspacesDir()
}

// ── Git Repo Detection ──────────────────────────────────────────

function isGitRepo(dir: string): boolean {
  try {
    let current = path.resolve(dir)
    const root = path.parse(current).root
    while (current !== root) {
      if (fs.existsSync(path.join(current, '.git'))) return true
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
    return false
  } catch {
    return false
  }
}

// ── Query Options ───────────────────────────────────────────────

export interface LoomAttachment {
  name: string
  serverPath: string
  mimeType: string
  tier: 'image' | 'pdf' | 'text' | 'binary'
  originalFilename?: string
  displayFilename?: string
  displayMimeType?: string
  readable?: boolean
  extractError?: string
  placeholder?: string
}

export const TEXT_ATTACHMENT_MAX_CHARS = 100_000

export interface LoomQueryOptions {
  prompt: string
  sessionId: string
  /** Loom database session id. Differs from SDK runtime session id after provider/session resets. */
  loomSessionId?: string
  model: string
  abortController?: AbortController
  canUseTool?: CanUseTool
  askUserQuestionHook?: HookCallback
  bypassPermissions?: boolean
  resumeSession?: boolean
  thinkingMode?: string
  attachments?: LoomAttachment[]
  agentName?: string
  enabledSkills?: string[]
  additionalDirectories?: string[]
  planMode?: boolean
  useWorktree?: boolean
  /** Workspace path for the project (multi-project support) */
  projectWorkspacePath?: string
  /** Called when stderr contains "already in use" (session conflict) */
  onSessionInUse?: () => void
  /** Project-level provider override (from project_settings) */
  providerIdOverride?: string
  /** Limit query turns for slash commands like /compact. */
  maxTurns?: number
}

function readAppSetting(key: string): string | null {
  try {
    const { getDb } = require('@/shared/db/db') as typeof import('@/shared/db/db')
    const db = getDb()
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value ?? null
  } catch {
    return null
  }
}

function readBooleanSetting(key: string, fallback: boolean): boolean {
  const raw = readAppSetting(key)
  if (raw == null) return fallback
  return raw === 'true' || raw === '1'
}

function readNumberSetting(key: string): number | null {
  const raw = readAppSetting(key)
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

function buildSdkRuntimeSettings(): Options['settings'] {
  const autoCompactEnabled = readBooleanSetting('sdk_auto_compact_enabled', true)
  const autoCompactWindow = readNumberSetting('sdk_auto_compact_window')
  return {
    autoCompactEnabled,
    ...(autoCompactWindow ? { autoCompactWindow } : {}),
  }
}

function inspectProjectCustomization(cwd: string): { claudeMdDetected: boolean; agentFileCount: number } {
  const claudeMdDetected = fs.existsSync(path.join(cwd, '.claude', 'CLAUDE.md')) ||
    fs.existsSync(path.join(cwd, 'CLAUDE.md'))
  const agentsDir = path.join(cwd, '.claude', 'agents')

  let agentFileCount = 0
  try {
    if (fs.existsSync(agentsDir)) {
      agentFileCount = fs.readdirSync(agentsDir).filter(file => file.endsWith('.md')).length
    }
  } catch (err) {
    logger.warn('runtime.sdk.project_customization_inspect_failed', {
      path: agentsDir,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  return { claudeMdDetected, agentFileCount }
}

function buildSystemPromptAppend(modelId: string, cwd: string): string {
  const entry = getModelEntry(modelId)
  const modelLabel = entry?.label || modelId

  const identityPrompt = `
# Model Identity

- The current user-facing model selection is "${modelLabel}".
- If a user asks which model you are, identify yourself as "${modelLabel}".
`.trim()

  const parts = [
    LOOM_TOOL_RULES,
    buildEnvironmentPrompt(cwd),
    identityPrompt,
  ]

  return parts.join('\n\n---\n\n')
}

function buildPlanModeInstructions(): string {
  return `Behavior rules:

1. You MAY read files, search code, list directories, and fetch URLs freely.
2. You MUST write your complete implementation plan to PLAN.md in the project root using the Write tool.
3. You MUST NOT edit any source code files — only PLAN.md is writable.
4. You MUST NOT execute commands via Bash (no builds, no installs, no git).
5. After writing PLAN.md, output the complete contents of PLAN.md verbatim in your chat response so the user can read the full plan inline. Do not just give a short summary.

PLAN.md structure to follow:

# Implementation Plan

## Overview
[What this change achieves and why]

## Files to Change
| File | Change |
|------|--------|
| src/... | [description] |

## Step-by-step
### Step 1 — [name]
[Details, code snippets if helpful]

### Step 2 — ...

## Risks & Notes
[Edge cases, breaking changes, things to verify]

Write the plan thoroughly enough that it can be executed without further clarification.`
}

function mapThinkingMode(mode: string): { thinking: Options['thinking'] } | null {
  const legacy: Record<string, string> = { adaptive: 'auto', enabled: 'max', disabled: 'off' }
  const normalized = legacy[mode.toLowerCase()] || mode.toLowerCase()

  if (normalized === 'off') return { thinking: { type: 'disabled' } }
  if (normalized === 'max') return { thinking: { type: 'enabled' } }
  return { thinking: { type: 'adaptive' } } // 'auto' default
}

/**
 * Create a configured SDK query instance for Loom CC.
 */
export function createLoomQuery(opts: LoomQueryOptions): Query {
  const resolved = resolveProvider(opts.model, opts.providerIdOverride)
  const isAnthropic = resolved.providerId === 'anthropic'
  const supportsThinking = resolved.supportsThinking
  const cwd = resolveWorkspaceDir(opts.projectWorkspacePath)
  const systemPromptAppend = buildSystemPromptAppend(opts.model, cwd)
  const sdkEnv = buildSdkEnv(resolved.apiKey, resolved.baseUrl)
  const claudePath = findClaudeExecutable()
  const runtimeSettings = buildSdkRuntimeSettings()
  const runtimeSettingsLog = runtimeSettings as { autoCompactEnabled?: boolean; autoCompactWindow?: number }
  const projectCustomization = inspectProjectCustomization(cwd)
  const imageGenerationToolEnabled = !opts.planMode && isImageGenerationToolEnabled()
  if (imageGenerationToolEnabled && !sdkEnv.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT) {
    sdkEnv.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = '600000'
  }

  const isClaudeDirWrite = (input: Record<string, unknown>): boolean => {
    const filePath = String(input.file_path || input.path || '')
    return filePath.includes('/.claude/') || filePath.includes('\\.claude\\')
  }

  const sdkOptions: Options = {
    model: resolved.resolvedModelId || opts.model,
    cwd,
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: systemPromptAppend,
    },
    ...(opts.planMode ? { planModeInstructions: buildPlanModeInstructions() } : {}),
    env: sdkEnv,
    ...(opts.resumeSession
      ? { resume: opts.sessionId }
      : { sessionId: opts.sessionId, persistSession: true }),
    includePartialMessages: true,
    agentProgressSummaries: true,
    ...(opts.agentName ? { agent: opts.agentName } : {}),
    settings: runtimeSettings,
    toolConfig: {
      askUserQuestion: { previewFormat: 'html' },
    },
    ...(opts.additionalDirectories && opts.additionalDirectories.length > 0 ? { additionalDirectories: opts.additionalDirectories } : {}),
    ...(opts.enabledSkills && opts.enabledSkills.length > 0 ? { skills: opts.enabledSkills } : {}),
    ...(opts.maxTurns ? { maxTurns: opts.maxTurns } : {}),
    ...(imageGenerationToolEnabled
      ? {
          mcpServers: {
            [IMAGE_MCP_SERVER_NAME]: createImageGenerationMcpServer({
              sessionId: opts.loomSessionId || opts.sessionId,
              cwd,
              attachments: opts.attachments ?? [],
              abortSignal: opts.abortController?.signal,
            }),
          },
        }
      : {}),
    ...(isAnthropic ? { betas: ['context-1m-2025-08-07'] } : {}),
    ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
    ...(opts.useWorktree ? { worktree: { baseRef: 'head' as const } } : {}),
  }

  if (supportsThinking) {
    const thinkingConfig = mapThinkingMode(opts.thinkingMode || 'auto')
    if (thinkingConfig) {
      sdkOptions.thinking = thinkingConfig.thinking
    }
  }

  logger.info('runtime.sdk.query_options', {
    sessionId: opts.sessionId,
    providerId: resolved.providerId,
    apiFormat: resolved.apiFormat,
    model: opts.model,
    resolvedModelId: sdkOptions.model,
    resumeSession: Boolean(opts.resumeSession),
    hasAgent: Boolean(opts.agentName),
    agentName: opts.agentName,
    projectClaudeMdDetected: projectCustomization.claudeMdDetected,
    projectAgentFileCount: projectCustomization.agentFileCount,
    projectCustomizationLoading: 'sdk-default',
    enabledSkillCount: opts.enabledSkills?.length ?? 0,
    attachmentCount: opts.attachments?.length ?? 0,
    additionalDirectoryCount: opts.additionalDirectories?.length ?? 0,
    imageGenerationToolEnabled,
    planMode: Boolean(opts.planMode),
    useWorktree: Boolean(opts.useWorktree),
    supportsThinking,
    thinkingMode: opts.thinkingMode || 'auto',
    sdkThinkingType: sdkOptions.thinking?.type,
    includePartialMessages: sdkOptions.includePartialMessages,
    agentProgressSummaries: sdkOptions.agentProgressSummaries === true,
    autoCompactEnabled: runtimeSettingsLog.autoCompactEnabled,
    autoCompactWindow: runtimeSettingsLog.autoCompactWindow,
    hasCanUseTool: Boolean(opts.canUseTool),
    hasAskUserQuestionHook: Boolean(opts.askUserQuestionHook),
  })

  if (opts.askUserQuestionHook) {
    sdkOptions.hooks = {
      ...(sdkOptions.hooks || {}),
      PreToolUse: [
        ...(sdkOptions.hooks?.PreToolUse || []),
        { hooks: [opts.askUserQuestionHook], timeout: 1800 },
      ],
    }
  }

  if (opts.bypassPermissions) {
    sdkOptions.permissionMode = 'bypassPermissions'
    sdkOptions.allowDangerouslySkipPermissions = true
    sdkOptions.canUseTool = async (_toolName, input, options) => ({
      behavior: 'allow' as const,
      updatedInput: input,
      updatedPermissions: options.suggestions,
    })
  } else if (opts.canUseTool) {
    const callerCanUseTool = opts.canUseTool
    sdkOptions.canUseTool = async (toolName, input, options) => {
      if (isClaudeDirWrite(input)) {
        return {
          behavior: 'allow' as const,
          updatedInput: input,
          updatedPermissions: options.suggestions,
        }
      }
      return callerCanUseTool(toolName, input, options)
    }
  }

  if (opts.planMode) {
    const PLAN_FILE_NAMES = new Set(['PLAN.md', 'plan.md', 'TODO.md', 'PLANNING.md'])
    const isPlanFile = (input: Record<string, unknown>): boolean => {
      const filePath = String(input.file_path || input.path || '')
      const basename = filePath.split('/').pop()?.split('\\').pop() || ''
      return PLAN_FILE_NAMES.has(basename)
    }

    const existingCanUseTool = sdkOptions.canUseTool
    sdkOptions.canUseTool = async (toolName, input, options) => {
      if (toolName === 'Bash') {
        return { behavior: 'deny' as const, message: 'Plan mode: command execution is disabled. Write your plan to PLAN.md instead.' }
      }
      if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(toolName)) {
        if (isPlanFile(input)) {
          return { behavior: 'allow' as const, updatedInput: input, updatedPermissions: options.suggestions }
        }
        return { behavior: 'deny' as const, message: `Plan mode: cannot edit source files. Write your plan to PLAN.md.` }
      }
      if (existingCanUseTool) {
        return existingCanUseTool(toolName, input, options)
      }
      return { behavior: 'allow' as const, updatedInput: input, updatedPermissions: options.suggestions }
    }
  }

  if (opts.abortController) {
    sdkOptions.abortController = opts.abortController
  }

  // For non-git workspace directories, provide programmatic worktree hooks
  // so sub-agents can be spawned (git worktree requires a git repo).
  if (!isGitRepo(cwd)) {
    const worktreeBase = path.join(os.tmpdir(), 'loom-worktrees')
    sdkOptions.hooks = {
      ...(sdkOptions.hooks || {}),
      WorktreeCreate: [{
        hooks: [async (input) => {
          const { name } = input as WorktreeCreateHookInput
          const worktreePath = path.join(worktreeBase, `${opts.sessionId.slice(0, 8)}-${name}`)
          fs.mkdirSync(worktreePath, { recursive: true })
          fs.cpSync(cwd, worktreePath, { recursive: true })
          return {
            continue: true,
            hookSpecificOutput: {
              hookEventName: 'WorktreeCreate' as const,
              worktreePath,
            },
          }
        }],
      }],
      WorktreeRemove: [{
        hooks: [async (input) => {
          const { worktree_path } = input as WorktreeRemoveHookInput
          try {
            fs.rmSync(worktree_path, { recursive: true, force: true })
          } catch { /* best effort cleanup */ }
          return { continue: true }
        }],
      }],
    }
  }

  sdkOptions.stderr = (data: string) => {
    const cleaned = data
      .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .trim()
    if (cleaned) {
      logger.warn('runtime.sdk.stderr', {
        sessionId: opts.sessionId,
        model: opts.model,
        message: cleaned.slice(0, 500),
      })
      if (cleaned.includes('already in use') && opts.onSessionInUse) {
        opts.onSessionInUse()
      }
    }
  }

  if (!opts.attachments || opts.attachments.length === 0) {
    return query({ prompt: opts.prompt, options: sdkOptions })
  }

  const contentBlocks = buildMultimodalContent(opts.prompt, opts.attachments)
  const userMessage: SDKUserMessage = {
    type: 'user',
    message: { role: 'user', content: contentBlocks },
    parent_tool_use_id: null,
    session_id: opts.sessionId,
  }

  async function* singleMessage(): AsyncIterable<SDKUserMessage> {
    yield userMessage
  }

  return query({ prompt: singleMessage(), options: sdkOptions })
}

function buildMultimodalContent(prompt: string, attachments: LoomAttachment[]): ContentBlockParam[] {
  const blocks: ContentBlockParam[] = []
  const manifestLines = attachments.map((att, idx) => {
    const placeholder = att.placeholder || `[Attachment #${idx + 1}]`
    const source = att.tier === 'text' && att.displayMimeType === 'application/pdf'
      ? 'PDF text extracted by Loom'
      : att.tier === 'image'
        ? 'image uploaded through Loom'
        : att.tier === 'pdf'
          ? 'PDF uploaded through Loom'
          : 'file uploaded through Loom'
    return `${idx + 1}. ${placeholder} ${att.name} - ${source}`
  })
  blocks.push({
    type: 'text',
    text: `<loom_attachments>\nThese attachments were uploaded through Loom and are not files in the workspace:\n${manifestLines.join('\n')}\nUse the provided attachment content directly. Do not use Glob, Grep, or Read to search the project directory for these attachment placeholders.\n</loom_attachments>`,
  })

  for (const att of attachments) {
    try {
      if (att.tier === 'image') {
        const data = fs.readFileSync(att.serverPath)
        const base64 = data.toString('base64')
        const mediaType = att.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
        blocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } })
      } else if (att.tier === 'text') {
        const content = fs.readFileSync(att.serverPath, 'utf-8')
        const truncated = content.length > TEXT_ATTACHMENT_MAX_CHARS ? content.slice(0, TEXT_ATTACHMENT_MAX_CHARS) + '\n\n[... truncated]' : content
        const sourceLabel = att.displayMimeType === 'application/pdf' ? 'pdf_text' : 'file_text'
        blocks.push({ type: 'text', text: `<${sourceLabel} name="${att.name}">\n${truncated}\n</${sourceLabel}>` })
      } else if (att.tier === 'pdf') {
        logger.warn('runtime.sdk.pdf_text_unavailable', {
          attachmentName: att.name,
          originalFilename: att.originalFilename,
          displayFilename: att.displayFilename,
          extractError: att.extractError,
        })
        blocks.push({ type: 'text', text: `<unreadable_pdf name="${att.name}">\nLoom could not extract readable text from this PDF. Ask the user for a text-based PDF, TXT/DOCX conversion, or OCR output before analyzing its contents.\n</unreadable_pdf>` })
      } else {
        blocks.push({ type: 'text', text: `[Attached binary file: ${att.name} (${att.mimeType})]` })
      }
    } catch (err) {
      logger.warn('runtime.sdk.attachment_read_failed', {
        attachmentName: att.name,
        tier: att.tier,
        mimeType: att.mimeType,
        error: err instanceof Error ? err.message : String(err),
      })
      blocks.push({ type: 'text', text: `[Failed to read file: ${att.name}]` })
    }
  }

  if (prompt.trim()) {
    blocks.push({ type: 'text', text: prompt })
  }

  return blocks
}
