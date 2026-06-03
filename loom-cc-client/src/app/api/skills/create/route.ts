import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { getDb } from '@/shared/db/db'
import { getSdkGlobalSkillsDir } from '@/shared/skills/sdk-global-skills'
import { slugifySkillName } from '@/shared/skills/skill-parser'
import {
  installSkillPackage,
  isSafeChild,
  SkillPackageError,
  type SkillPackage,
} from '@/shared/skills/skill-package'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface CreateSkillBody {
  target?: 'project' | 'global'
  projectId?: string
  name?: string
  displayName?: string
  description?: string
  category?: string
  stage?: string
  tags?: string[]
  inputs?: string[]
  outputs?: string[]
  examples?: string[]
  riskLevel?: 'low' | 'medium' | 'high'
  requires?: {
    network?: boolean
    fileRead?: boolean
    fileWrite?: boolean
    shell?: boolean
    mcp?: string[]
  }
  content?: string
}

export async function POST(req: NextRequest) {
  let body: CreateSkillBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const slug = slugifySkillName(body.name || body.displayName || '')
  const displayName = body.displayName?.trim() || slug
  const description = body.description?.trim()
  if (!description) {
    return NextResponse.json({ error: 'description is required' }, { status: 400 })
  }

  const target = body.target === 'global' ? 'global' : 'project'
  const skillsDir = resolveSkillsDir(target, body.projectId)
  if (!skillsDir) {
    return NextResponse.json({ error: 'Project workspace is required' }, { status: 400 })
  }

  const skillDir = path.join(skillsDir, slug)
  const resolvedSkillsDir = path.resolve(skillsDir)
  const resolvedSkillDir = path.resolve(skillDir)
  if (!isSafeChild(resolvedSkillsDir, resolvedSkillDir)) {
    return NextResponse.json({ error: 'Invalid skill path' }, { status: 400 })
  }
  if (fs.existsSync(skillDir)) {
    return NextResponse.json({ error: 'Skill already exists' }, { status: 409 })
  }

  const skillMd = buildSkillMarkdown({
    slug,
    displayName,
    description,
    content: body.content,
    inputs: body.inputs,
    outputs: body.outputs,
    examples: body.examples,
  })

  const uiMeta = {
    schemaVersion: '1.0',
    name: slug,
    displayName,
    description,
    category: body.category || 'uncategorized',
    stage: body.stage || '',
    tags: body.tags ?? [],
    inputTypes: body.inputs ?? [],
    outputTypes: body.outputs ?? [],
    riskLevel: body.riskLevel || 'low',
    requires: body.requires ?? {
      network: false,
      fileRead: true,
      fileWrite: true,
      shell: false,
      mcp: [],
    },
    examples: body.examples ?? [],
  }
  const skillPackage: SkillPackage = {
    slug,
    packageTree: [],
    files: [
      { path: 'SKILL.md', content: skillMd },
      { path: 'loom.skill.json', content: `${JSON.stringify(uiMeta, null, 2)}\n` },
    ],
  }

  let installedDir = skillDir
  try {
    const result = installSkillPackage({
      skillsDir,
      skillPackage,
      installMeta: {
        installedFrom: 'loom:create',
      },
    })
    installedDir = result.skillDir
  } catch (err) {
    if (err instanceof SkillPackageError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    throw err
  }

  return NextResponse.json({
    ok: true,
    skill: {
      id: `${target}:${slug}`,
      name: slug,
      slug,
      displayName,
      description,
      sourceType: target,
      storagePath: installedDir,
    },
  }, { status: 201 })
}

function resolveSkillsDir(target: 'project' | 'global', projectId?: string): string | null {
  if (target === 'global') {
    return getSdkGlobalSkillsDir()
  }

  if (!projectId) return null
  const db = getDb()
  const row = db.prepare('SELECT workspace_path FROM projects WHERE id = ?').get(projectId) as { workspace_path: string } | undefined
  if (!row?.workspace_path) return null
  return path.join(row.workspace_path, '.claude', 'skills')
}

function buildSkillMarkdown(input: {
  slug: string
  displayName: string
  description: string
  content?: string
  inputs?: string[]
  outputs?: string[]
  examples?: string[]
}): string {
  const inputs = listOrFallback(input.inputs, '用户目标或待处理材料')
  const outputs = listOrFallback(input.outputs, '结构化结果')
  const example = input.examples?.[0]?.trim() || `请使用 ${input.displayName} 帮我处理这个任务。`
  const customContent = input.content?.trim()

  if (customContent) {
    return `---\nname: ${input.slug}\ndescription: ${input.description}\n---\n\n${customContent.trim()}\n`
  }

  return `---\nname: ${input.slug}\ndescription: ${input.description}\n---\n\n# ${input.displayName}\n\n## 任务\n\n将用户的目标转化为可执行、可复用、可验证的结果。\n\n## 何时使用\n\n使用这个 Skill，当用户需要：\n\n- ${input.description}\n\n不要使用这个 Skill，当：\n\n- 用户只是闲聊或没有明确任务。\n- 用户要求执行超出当前权限或项目边界的操作。\n\n## 输入\n\n用户需要提供：\n\n${inputs}\n\n如果缺少关键信息，先询问，不要猜。\n\n## 输出\n\n最终输出：\n\n${outputs}\n\n## 工作流程\n\n1. 理解用户目标和当前上下文。\n2. 检查输入是否足够；不足时每次只问 1-2 个关键问题。\n3. 按任务目标执行分析、生成或整理。\n4. 对照质量标准自检。\n5. 输出结果，并给出下一步建议。\n\n## 质量标准\n\n结果必须满足：\n\n- 直接回应用户目标，不跑题。\n- 结构清晰，用户能直接使用。\n- 关键判断给出依据。\n- 不确定的信息明确标注，不编造。\n\n## 风险与边界\n\n- 不执行危险操作，除非用户明确确认。\n- 不写入项目外文件，除非用户明确授权。\n- 不把未经确认的假设当事实。\n\n## 示例\n\n用户可以这样说：\n\n\`\`\`text\n${example}\n\`\`\`\n\n你应该先确认输入是否足够，再给出结构化结果。\n`
}

function listOrFallback(values: string[] | undefined, fallback: string): string {
  const items = values?.map(v => v.trim()).filter(Boolean)
  const safe = items && items.length > 0 ? items : [fallback]
  return safe.map(v => `- ${v}`).join('\n')
}
