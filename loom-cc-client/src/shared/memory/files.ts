import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { getClaudeFileForScope, getMemoryDirForScope } from './paths'
import type { MemoryCandidate, MemoryFile, MemoryReadResult, MemoryScope } from './types'

const GLOBAL_IMPORT_START = '<!-- LOOM_GLOBAL_MEMORY_IMPORT_START -->'
const GLOBAL_IMPORT_END = '<!-- LOOM_GLOBAL_MEMORY_IMPORT_END -->'
const PROJECT_IMPORT_START = '<!-- LOOM_MEMORY_IMPORT_START -->'
const PROJECT_IMPORT_END = '<!-- LOOM_MEMORY_IMPORT_END -->'
const APPROVED_SUMMARY_START = '<!-- LOOM_APPROVED_MEMORY_START -->'
const APPROVED_SUMMARY_END = '<!-- LOOM_APPROVED_MEMORY_END -->'

type MemoryTemplate = readonly [string, MemoryFile['kind'], string]

const GLOBAL_FILES: readonly MemoryTemplate[] = [
  ['MEMORY.md', 'index', '# Global Memory\n\n## Active Summary\n\n- 暂无全局长期记忆。\n\n## Memory Index\n\n- 用户资料：@user.md\n- 偏好：@preferences.md\n- 工作方式：@workflows.md\n- 常见纠错：@corrections.md\n'],
  ['user.md', 'user', '# User\n\n'],
  ['preferences.md', 'preferences', '# Preferences\n\n'],
  ['workflows.md', 'workflows', '# Workflows\n\n'],
  ['corrections.md', 'corrections', '# Corrections\n\n'],
] as const

const PROJECT_FILES: readonly MemoryTemplate[] = [
  ['MEMORY.md', 'index', '# Project Memory\n\n## Active Summary\n\n- 暂无项目长期记忆。\n\n## Memory Index\n\n- 项目背景：@project.md\n- 关键决策：@decisions.md\n- 用户反馈：@feedback.md\n- 复盘记录：@retrospectives.md\n- 常见纠错：@corrections.md\n- 已生效项目规则：@rules.md\n- 观察中规则：@shadow-rules.md\n- 已废弃规则：@deprecated-rules.md\n- 进化日志：@evolution-log.md\n'],
  ['project.md', 'project', '# Project\n\n'],
  ['decisions.md', 'decisions', '# Decisions\n\n'],
  ['feedback.md', 'feedback', '# Feedback\n\n'],
  ['retrospectives.md', 'retrospectives', '# Retrospectives\n\n'],
  ['corrections.md', 'corrections', '# Corrections\n\n'],
  ['rules.md', 'rules', '# Active Project Rules\n\n'],
  ['shadow-rules.md', 'shadow-rules', '# Shadow Rules\n\n'],
  ['deprecated-rules.md', 'deprecated-rules', '# Deprecated Rules\n\n'],
  ['evolution-log.md', 'evolution-log', '# Evolution Log\n\n'],
] as const

function readText(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch {
    return ''
  }
}

function writeIfMissing(filePath: string, content: string) {
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, content, 'utf8')
}

function ensureManagedImport(claudeFile: string, scope: MemoryScope) {
  const start = scope === 'global' ? GLOBAL_IMPORT_START : PROJECT_IMPORT_START
  const end = scope === 'global' ? GLOBAL_IMPORT_END : PROJECT_IMPORT_END
  const importPath = scope === 'global' ? '@memory/MEMORY.md' : '@.claude/memory/MEMORY.md'
  const block = `${start}\n## Loom Managed Memory\n\nSee ${importPath}\n${end}`

  const existing = readText(claudeFile)
  if (existing.includes(start) && existing.includes(end)) {
    const next = existing.replace(new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`), block)
    if (next !== existing) fs.writeFileSync(claudeFile, next, 'utf8')
    return
  }

  const next = existing.trim().length > 0 ? `${existing.trimEnd()}\n\n${block}\n` : `# CLAUDE.md\n\n${block}\n`
  fs.writeFileSync(claudeFile, next, 'utf8')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function ensureClaudeMemory(scope: MemoryScope, workspacePath?: string): MemoryReadResult {
  const rootDir = getMemoryDirForScope(scope, workspacePath)
  const claudeFile = getClaudeFileForScope(scope, workspacePath)
  fs.mkdirSync(rootDir, { recursive: true })
  fs.mkdirSync(path.join(rootDir, 'inbox'), { recursive: true })
  fs.mkdirSync(path.dirname(claudeFile), { recursive: true })

  const templates = scope === 'global' ? GLOBAL_FILES : PROJECT_FILES
  for (const [name, , content] of templates) {
    writeIfMissing(path.join(rootDir, name), content)
  }
  ensureManagedImport(claudeFile, scope)
  return readClaudeMemory(scope, workspacePath)
}

export function readClaudeMemory(scope: MemoryScope, workspacePath?: string): MemoryReadResult {
  const rootDir = getMemoryDirForScope(scope, workspacePath)
  const claudeFile = getClaudeFileForScope(scope, workspacePath)
  const templates = scope === 'global' ? GLOBAL_FILES : PROJECT_FILES
  const initialized = fs.existsSync(path.join(rootDir, 'MEMORY.md'))
  const files: MemoryFile[] = templates.map(([name, kind]) => {
    const filePath = path.join(rootDir, name)
    const exists = fs.existsSync(filePath)
    return { name, path: filePath, kind, exists, content: exists ? readText(filePath) : '' }
  })
  return {
    scope,
    rootDir,
    claudeFile,
    initialized,
    files,
    candidates: readMemoryCandidates(scope, workspacePath),
  }
}

export function readMemoryCandidates(scope: MemoryScope, workspacePath?: string): MemoryCandidate[] {
  const inboxDir = path.join(getMemoryDirForScope(scope, workspacePath), 'inbox')
  if (!fs.existsSync(inboxDir)) return []
  return fs.readdirSync(inboxDir)
    .filter(name => name.endsWith('.md'))
    .sort()
    .map(name => parseCandidateFile(path.join(inboxDir, name), scope))
    .filter((candidate): candidate is MemoryCandidate => candidate !== null)
}

function parseCandidateFile(filePath: string, fallbackScope: MemoryScope): MemoryCandidate | null {
  const raw = readText(filePath)
  if (!raw.trim()) return null
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw)
  const frontmatter = match ? parseFrontmatter(match[1]) : {}
  const body = (match ? match[2] : raw).trim()
  return {
    id: frontmatter.id || path.basename(filePath, '.md'),
    scope: (frontmatter.scope as MemoryScope) || fallbackScope,
    type: (frontmatter.type as MemoryCandidate['type']) || 'fact',
    confidence: (frontmatter.confidence as MemoryCandidate['confidence']) || 'medium',
    sourceSessionId: frontmatter.source_session_id,
    createdAt: frontmatter.created_at || '',
    status: (frontmatter.status as MemoryCandidate['status']) || 'pending',
    content: body.replace(/\n## Evidence\n[\s\S]*$/, '').trim(),
    evidence: /## Evidence\n([\s\S]*)$/.exec(body)?.[1]?.trim(),
    target: frontmatter.target as MemoryCandidate['target'] | undefined,
    evolutionStage: frontmatter.evolution_stage as MemoryCandidate['evolutionStage'] | undefined,
    metadata: parseJsonFrontmatter(frontmatter.metadata),
    path: filePath,
  }
}

function parseFrontmatter(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return out
}

function parseJsonFrontmatter(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function serializeMetadata(metadata: Record<string, unknown> | undefined): string {
  if (!metadata || Object.keys(metadata).length === 0) return ''
  return `metadata: ${JSON.stringify(metadata)}`
}

export function writeMemoryCandidate(params: {
  scope: MemoryScope
  workspacePath?: string
  type?: MemoryCandidate['type']
  confidence?: MemoryCandidate['confidence']
  sourceSessionId?: string
  content: string
  evidence?: string
  id?: string
  target?: MemoryCandidate['target']
  evolutionStage?: MemoryCandidate['evolutionStage']
  status?: MemoryCandidate['status']
  metadata?: Record<string, unknown>
}): MemoryCandidate {
  const rootDir = getMemoryDirForScope(params.scope, params.workspacePath)
  const inboxDir = path.join(rootDir, 'inbox')
  fs.mkdirSync(inboxDir, { recursive: true })
  const id = params.id || `mem_${crypto.randomUUID().slice(0, 8)}`
  const createdAt = new Date().toISOString()
  const filePath = path.join(inboxDir, `${createdAt.slice(0, 10)}-${id}.md`)
  const body = [
    '---',
    `id: ${id}`,
    `scope: ${params.scope}`,
    `type: ${params.type || 'fact'}`,
    `confidence: ${params.confidence || 'medium'}`,
    params.sourceSessionId ? `source_session_id: ${params.sourceSessionId}` : '',
    `created_at: ${createdAt}`,
    `status: ${params.status || 'pending'}`,
    params.target ? `target: ${params.target}` : '',
    params.evolutionStage ? `evolution_stage: ${params.evolutionStage}` : '',
    serializeMetadata(params.metadata),
    '---',
    '',
    params.content.trim(),
    '',
    '## Evidence',
    '',
    params.evidence?.trim() || '用户在当前对话中明确表达。',
    '',
  ].filter(line => line !== '').join('\n')
  fs.writeFileSync(filePath, body, 'utf8')
  return parseCandidateFile(filePath, params.scope)!
}

export function updateMemoryCandidate(params: {
  scope: MemoryScope
  workspacePath?: string
  id: string
  type?: MemoryCandidate['type']
  confidence?: MemoryCandidate['confidence']
  content: string
  evidence?: string
  target?: MemoryCandidate['target']
  evolutionStage?: MemoryCandidate['evolutionStage']
  status?: MemoryCandidate['status']
  metadata?: Record<string, unknown>
}): MemoryCandidate {
  const existing = readMemoryCandidates(params.scope, params.workspacePath).find(c => c.id === params.id)
  if (!existing) throw new Error('Candidate not found')
  const createdAt = existing.createdAt || new Date().toISOString()
  const body = [
    '---',
    `id: ${existing.id}`,
    `scope: ${params.scope}`,
    `type: ${params.type || existing.type}`,
    `confidence: ${params.confidence || existing.confidence}`,
    existing.sourceSessionId ? `source_session_id: ${existing.sourceSessionId}` : '',
    `created_at: ${createdAt}`,
    `status: ${params.status || existing.status}`,
    params.target || existing.target ? `target: ${params.target || existing.target}` : '',
    params.evolutionStage || existing.evolutionStage ? `evolution_stage: ${params.evolutionStage || existing.evolutionStage}` : '',
    serializeMetadata(params.metadata || existing.metadata),
    '---',
    '',
    params.content.trim(),
    '',
    '## Evidence',
    '',
    params.evidence?.trim() || existing.evidence || '用户编辑候选记忆。',
    '',
  ].filter(line => line !== '').join('\n')
  fs.writeFileSync(existing.path, body, 'utf8')
  return parseCandidateFile(existing.path, params.scope)!
}

export function updateCandidateStatus(filePath: string, status: MemoryCandidate['status']) {
  const raw = readText(filePath)
  if (!raw) return
  const next = raw.includes('status:')
    ? raw.replace(/^status:.*$/m, `status: ${status}`)
    : raw.replace(/^---\n/, `---\nstatus: ${status}\n`)
  fs.writeFileSync(filePath, next, 'utf8')
}

export function refreshApprovedMemorySummary(scope: MemoryScope, workspacePath?: string) {
  const rootDir = getMemoryDirForScope(scope, workspacePath)
  const indexPath = path.join(rootDir, 'MEMORY.md')
  if (!fs.existsSync(indexPath)) return

  const approved = readMemoryCandidates(scope, workspacePath)
    .filter(candidate => candidate.status === 'approved')
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 5)

  const block = [
    APPROVED_SUMMARY_START,
    '## Recently Approved',
    '',
    ...(approved.length > 0
      ? approved.map(candidate => {
          const content = candidate.content.replace(/\s+/g, ' ').trim()
          return `- ${candidate.type}: ${content.slice(0, 180)}${content.length > 180 ? '...' : ''}`
        })
      : ['- 暂无已确认记忆。']),
    APPROVED_SUMMARY_END,
  ].join('\n')

  const existing = readText(indexPath)
  const next = existing.includes(APPROVED_SUMMARY_START) && existing.includes(APPROVED_SUMMARY_END)
    ? existing.replace(new RegExp(`${escapeRegExp(APPROVED_SUMMARY_START)}[\\s\\S]*?${escapeRegExp(APPROVED_SUMMARY_END)}`), block)
    : `${existing.trimEnd()}\n\n${block}\n`
  if (next !== existing) fs.writeFileSync(indexPath, next, 'utf8')
}
