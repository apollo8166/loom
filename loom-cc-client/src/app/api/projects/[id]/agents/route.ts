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

export interface ProjectAgentEntry {
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

function slugFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'agent'
}

function uniqueFilename(agentsDir: string, base: string): string {
  const safeBase = safeAgentFilename(base) ?? 'agent.md'
  if (!fs.existsSync(path.join(agentsDir, safeBase))) return safeBase

  const stem = safeBase.replace(/\.md$/, '')
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem}-${i}.md`
    if (!fs.existsSync(path.join(agentsDir, candidate))) return candidate
  }
  return `${stem}-${Date.now()}.md`
}

function safeAgentPath(agentsDir: string, filename: string): string | null {
  const safe = safeAgentFilename(filename)
  if (!safe) return null
  const resolvedDir = path.resolve(agentsDir)
  const resolved = path.resolve(agentsDir, safe)
  if (!resolved.startsWith(resolvedDir + path.sep)) return null
  return resolved
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
  const frontmatter = [
    `name: ${yamlString(payload.name)}`,
    `description: ${yamlString(payload.description)}`,
    `model: ${yamlString(payload.model || 'inherit')}`,
    `enabled: ${payload.enabled ? 'true' : 'false'}`,
    ...yamlList('tools', payload.tools),
    ...yamlList('disallowedTools', payload.disallowedTools),
    ...yamlList('skills', payload.skills),
  ]

  return [
    '---',
    ...frontmatter,
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

function listAgents(agentsDir: string): ProjectAgentEntry[] {
  if (!fs.existsSync(agentsDir)) return []
  return fs.readdirSync(agentsDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => {
      try {
        return readAgentFile(path.join(agentsDir, entry.name), entry.name)
      } catch {
        return null
      }
    })
    .filter((entry): entry is ProjectAgentEntry => Boolean(entry))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function normalizePayload(body: AgentPayload, fallback?: ProjectAgentEntry): Required<Omit<AgentPayload, 'filename'>> {
  return {
    name: body.name?.trim() || fallback?.name || 'New Agent',
    description: body.description?.trim() ?? fallback?.description ?? '',
    model: body.model?.trim() || fallback?.model || 'inherit',
    enabled: typeof body.enabled === 'boolean' ? body.enabled : fallback?.enabled ?? true,
    tools: Array.isArray(body.tools) ? asStringList(body.tools) : fallback?.tools ?? [],
    disallowedTools: Array.isArray(body.disallowedTools) ? asStringList(body.disallowedTools) : fallback?.disallowedTools ?? [],
    skills: Array.isArray(body.skills) ? asStringList(body.skills) : fallback?.skills ?? [],
    instructions: body.instructions?.trim() || fallback?.instructions || '',
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const workspacePath = resolveWorkspace(id)
  if (!workspacePath) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const agentsDir = agentsDirFor(workspacePath)
  return NextResponse.json({
    agents: listAgents(agentsDir),
    path: path.join(workspacePath, '.claude', 'agents'),
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const workspacePath = resolveWorkspace(id)
  if (!workspacePath) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  let body: AgentPayload
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const agentsDir = agentsDirFor(workspacePath)
  fs.mkdirSync(agentsDir, { recursive: true })

  const payload = normalizePayload(body)
  const filename = uniqueFilename(agentsDir, body.filename || `${slugFromName(payload.name)}.md`)
  const filePath = safeAgentPath(agentsDir, filename)
  if (!filePath) return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })

  fs.writeFileSync(filePath, serializeAgent(payload), 'utf-8')
  return NextResponse.json({ agent: readAgentFile(filePath, filename) }, { status: 201 })
}
