import fs from 'node:fs'
import path from 'node:path'
import type { SkillItem, SkillSourceType, SkillUiMeta } from './skill-types'

export interface ParsedSkillFile {
  name?: string
  description?: string
  body: string
  raw: string
  frontmatter: Record<string, unknown>
}

export function slugifySkillName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'new-skill'
}

export function parseSkillMarkdown(raw: string): ParsedSkillFile {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw)
  if (!match) return { body: raw.trim(), raw, frontmatter: {} }

  const frontmatter: Record<string, unknown> = {}
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    let value: unknown = line.slice(idx + 1).trim()
    if (value === 'true') value = true
    if (value === 'false') value = false
    frontmatter[key] = value
  }

  return {
    name: typeof frontmatter.name === 'string' ? frontmatter.name : undefined,
    description: typeof frontmatter.description === 'string' ? frontmatter.description : undefined,
    body: match[2].trim(),
    raw,
    frontmatter,
  }
}

export function extractSection(body: string, title: string): string {
  const patterns = [
    new RegExp(`##\\s*${escapeRegExp(title)}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i'),
    new RegExp(`\\[${escapeRegExp(title)}\\]\\s*\\n([\\s\\S]*?)(?=\\n\\[[^\\]]+\\]|$)`, 'i'),
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(body)
    if (match?.[1]) return match[1].trim()
  }
  return ''
}

export function extractBullets(section: string, limit = 5): string[] {
  if (!section) return []
  const bullets = section
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^[-*]\s+/.test(line))
    .map(line => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean)
  return [...new Set(bullets)].slice(0, limit)
}

export function inferSkillMeta(parsed: ParsedSkillFile, uiMeta?: SkillUiMeta) {
  const task = extractSection(parsed.body, '任务')
  const when = extractSection(parsed.body, '何时使用')
  const input = extractSection(parsed.body, '输入') || extractSection(parsed.body, '依赖检测')
  const output = extractSection(parsed.body, '输出')
  const examples = extractSection(parsed.body, '示例')

  const firstTextLine = (task || parsed.body)
    .split('\n')
    .map(line => line.trim())
    .find(line => line && !line.startsWith('#') && !line.startsWith('```'))

  return {
    summary: firstTextLine?.replace(/^[-*]\s*/, '').slice(0, 180) || parsed.description || '',
    stage: uiMeta?.stage || stringField(parsed.frontmatter.stage),
    category: uiMeta?.category || stringField(parsed.frontmatter.category),
    tags: uiMeta?.tags || arrayField(parsed.frontmatter.tags),
    inputs: uiMeta?.inputTypes || extractBullets(input, 6),
    outputs: uiMeta?.outputTypes || extractBullets(output, 6),
    examples: uiMeta?.examples || extractCodeExamples(examples).slice(0, 3),
    riskLevel: uiMeta?.riskLevel || 'low' as const,
    requires: uiMeta?.requires,
    packageTree: uiMeta?.packageTree,
    when: extractBullets(when, 6),
  }
}

export function readSkillUiMeta(skillDir: string): SkillUiMeta | undefined {
  const metaPath = path.join(skillDir, 'loom.skill.json')
  if (!fs.existsSync(metaPath)) return undefined
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as SkillUiMeta
  } catch {
    return undefined
  }
}

export function buildSkillItemFromFile(params: {
  id: string
  slug: string
  sourceType: SkillSourceType
  storagePath: string
  raw: string
  isPinned?: boolean
  createdAt?: string | null
}): SkillItem {
  const parsed = parseSkillMarkdown(params.raw)
  const uiMeta = fs.existsSync(params.storagePath) && fs.statSync(params.storagePath).isDirectory()
    ? readSkillUiMeta(params.storagePath)
    : undefined
  const inferred = inferSkillMeta(parsed, uiMeta)
  return {
    id: params.id,
    name: uiMeta?.displayName || parsed.name || params.slug,
    slug: params.slug,
    description: parsed.description || '',
    sourceType: params.sourceType,
    storagePath: params.storagePath,
    isPinned: params.isPinned ?? false,
    createdAt: params.createdAt ?? null,
    raw: params.raw,
    summary: inferred.summary,
    stage: inferred.stage,
    category: inferred.category,
    tags: inferred.tags,
    inputs: inferred.inputs,
    outputs: inferred.outputs,
    examples: inferred.examples,
    riskLevel: inferred.riskLevel,
    requires: inferred.requires,
    packageTree: inferred.packageTree,
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function arrayField(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map(v => v.trim()).filter(Boolean)
  }
  return undefined
}

function extractCodeExamples(section: string): string[] {
  if (!section) return []
  const matches = [...section.matchAll(/```(?:text|markdown)?\n([\s\S]*?)```/g)]
  return matches.map(match => match[1].trim()).filter(Boolean)
}
