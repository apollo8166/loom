import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getDb } from '@/shared/db/db'
import { parseFrontmatter } from '@/shared/runtime/sdk/frontmatter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ProjectRow {
  workspace_path: string
}

interface ProjectAgentEntry {
  id: string
  filename: string
  name: string
  description: string
  model: string
  enabled: boolean
  tools: string[]
  disallowedTools: string[]
  skills: string[]
  instructions: string
  updatedAt: string | null
}

type AgentPayload = {
  filename?: string
  name?: string
  description?: string
  model?: string
  enabled?: boolean
  tools?: string[]
  disallowedTools?: string[]
  skills?: string[]
  instructions?: string
}

function resolveWorkspace(projectId: string): string | null {
  const db = getDb()
  const row = db.prepare(
    'SELECT workspace_path FROM projects WHERE id = ? AND status = ?',
  ).get(projectId, 'active') as ProjectRow | undefined
  return row?.workspace_path || null
}

function agentsDirFor(workspacePath: string): string {
  return path.join(workspacePath, '.claude', 'agents')
}

function safeAgentFilename(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const withExt = trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`
  if (withExt.includes('/') || withExt.includes('\\')) return null
  if (withExt === '.md' || withExt === '..md' || withExt.startsWith('.')) return null
  if (!/^[A-Za-z0-9._-]+\.md$/.test(withExt)) return null
  return withExt
}

function safeAgentPath(agentsDir: string, filename: string): { filename: string; filePath: string } | null {
  const safe = safeAgentFilename(filename)
  if (!safe) return null
  const resolvedDir = path.resolve(agentsDir)
  const resolved = path.resolve(agentsDir, safe)
  if (!resolved.startsWith(resolvedDir + path.sep)) return null
  return { filename: safe, filePath: resolved }
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => String(item).trim())
    .filter(Boolean)
}

function yamlString(value: string): string {
  return JSON.stringify(value)
}

function yamlList(name: string, values: string[]): string[] {
  if (values.length === 0) return []
  return [
    `${name}:`,
    ...values.map(value => `- ${yamlString(value)}`),
  ]
}

function serializeAgent(payload: Required<Omit<AgentPayload, 'filename'>>): string {
  return [
    '---',
    `name: ${yamlString(payload.name)}`,
    `description: ${yamlString(payload.description)}`,
    `model: ${yamlString(payload.model || 'inherit')}`,
    `enabled: ${payload.enabled ? 'true' : 'false'}`,
    ...yamlList('tools', payload.tools),
    ...yamlList('disallowedTools', payload.disallowedTools),
    ...yamlList('skills', payload.skills),
    '---',
    '',
    payload.instructions.trim() || `You are ${payload.name}. Complete delegated work clearly and concisely.`,
    '',
  ].join('\n')
}

function readAgentFile(filePath: string, filename: string): ProjectAgentEntry {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const { frontmatter, body } = parseFrontmatter(raw)
  const stat = fs.statSync(filePath)
  const id = filename.replace(/\.md$/, '')
  return {
    id,
    filename,
    name: frontmatter.name || id,
    description: frontmatter.description || '',
    model: frontmatter.model || 'inherit',
    enabled: frontmatter.enabled !== false,
    tools: frontmatter.tools || [],
    disallowedTools: frontmatter.disallowedTools || [],
    skills: frontmatter.skills || [],
    instructions: body,
    updatedAt: stat.mtime.toISOString(),
  }
}

function normalizePayload(body: AgentPayload, fallback: ProjectAgentEntry): Required<Omit<AgentPayload, 'filename'>> {
  return {
    name: body.name?.trim() || fallback.name,
    description: body.description?.trim() ?? fallback.description,
    model: body.model?.trim() || fallback.model || 'inherit',
    enabled: typeof body.enabled === 'boolean' ? body.enabled : fallback.enabled,
    tools: Array.isArray(body.tools) ? asStringList(body.tools) : fallback.tools,
    disallowedTools: Array.isArray(body.disallowedTools) ? asStringList(body.disallowedTools) : fallback.disallowedTools,
    skills: Array.isArray(body.skills) ? asStringList(body.skills) : fallback.skills,
    instructions: body.instructions?.trim() || fallback.instructions,
  }
}

function resolveAgent(projectId: string, filename: string) {
  const workspacePath = resolveWorkspace(projectId)
  if (!workspacePath) return { error: NextResponse.json({ error: 'Project not found' }, { status: 404 }) }

  const agentsDir = agentsDirFor(workspacePath)
  const resolved = safeAgentPath(agentsDir, filename)
  if (!resolved) return { error: NextResponse.json({ error: 'Invalid filename' }, { status: 400 }) }
  if (!fs.existsSync(resolved.filePath)) return { error: NextResponse.json({ error: 'Agent not found' }, { status: 404 }) }
  return { agentsDir, ...resolved }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; filename: string }> },
) {
  const { id, filename } = await params
  const resolved = resolveAgent(id, filename)
  if ('error' in resolved) return resolved.error
  return NextResponse.json({ agent: readAgentFile(resolved.filePath, resolved.filename) })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; filename: string }> },
) {
  const { id, filename } = await params
  const resolved = resolveAgent(id, filename)
  if ('error' in resolved) return resolved.error

  let body: AgentPayload
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const existing = readAgentFile(resolved.filePath, resolved.filename)
  const payload = normalizePayload(body, existing)
  const nextFilename = body.filename ? safeAgentFilename(body.filename) : resolved.filename
  if (!nextFilename) return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })

  const nextPath = safeAgentPath(resolved.agentsDir, nextFilename)
  if (!nextPath) return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
  if (nextPath.filePath !== resolved.filePath && fs.existsSync(nextPath.filePath)) {
    return NextResponse.json({ error: 'Agent filename already exists' }, { status: 409 })
  }

  fs.writeFileSync(resolved.filePath, serializeAgent(payload), 'utf-8')
  if (nextPath.filePath !== resolved.filePath) {
    fs.renameSync(resolved.filePath, nextPath.filePath)
  }
  return NextResponse.json({ agent: readAgentFile(nextPath.filePath, nextPath.filename) })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; filename: string }> },
) {
  const { id, filename } = await params
  const resolved = resolveAgent(id, filename)
  if ('error' in resolved) return resolved.error

  fs.rmSync(resolved.filePath, { force: true })
  return NextResponse.json({ ok: true })
}
