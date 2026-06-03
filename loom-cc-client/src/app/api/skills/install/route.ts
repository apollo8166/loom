import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { getDb } from '@/shared/db/db'
import { getSdkGlobalSkillsDir } from '@/shared/skills/sdk-global-skills'
import { getBuiltinSkills } from '@/shared/skills/builtin-skills'
import { getBuiltinSkillPackage } from '@/shared/skills/builtin-skill-packages'
import { buildSkillItemFromFile, slugifySkillName } from '@/shared/skills/skill-parser'
import type { SkillItem } from '@/shared/skills/skill-types'
import {
  getSkillMarkdownFromPackage,
  installSkillPackage,
  isSafeChild,
  SkillPackageError,
} from '@/shared/skills/skill-package'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface InstallSkillBody {
  skillId?: string
  slug?: string
  target?: 'global' | 'project'
  projectId?: string
  overwrite?: boolean
}

interface ProjectRow {
  workspace_path: string | null
}

export async function POST(req: NextRequest) {
  let body: InstallSkillBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const target = body.target === 'project' ? 'project' : 'global'
  const slugHint = normalizeSlug(body.slug || body.skillId)
  if (!slugHint) {
    return NextResponse.json({ error: 'slug is required' }, { status: 400 })
  }

  const source = resolveCatalogSkill(slugHint)
  if (!source?.raw?.trim()) {
    return NextResponse.json({ error: 'Skill package not found' }, { status: 404 })
  }

  let skillPackage
  try {
    skillPackage = getBuiltinSkillPackage(source)
  } catch (err) {
    if (err instanceof SkillPackageError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    throw err
  }

  const destination = resolveDestination(target, skillPackage.slug, body.projectId)
  if ('error' in destination) {
    return NextResponse.json({ error: destination.error }, { status: destination.status })
  }

  const { skillsDir, skillDir } = destination
  if (!isSafeChild(skillsDir, skillDir)) {
    return NextResponse.json({ error: 'Invalid skill path' }, { status: 400 })
  }

  if (fs.existsSync(skillDir)) {
    const stat = fs.statSync(skillDir)
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: 'A non-directory file already exists at target path' }, { status: 409 })
    }
    if (!body.overwrite) {
      return NextResponse.json({
        error: 'Skill already installed',
        storagePath: skillDir,
        target,
      }, { status: 409 })
    }
  }

  let installedPackage = skillPackage
  let installedDir = skillDir
  try {
    const result = installSkillPackage({
      skillsDir,
      skillPackage,
      overwrite: body.overwrite,
      installMeta: {
        installedFrom: source.id,
      },
    })
    installedPackage = result.skillPackage
    installedDir = result.skillDir
  } catch (err) {
    if (err instanceof SkillPackageError) {
      return NextResponse.json({
        error: err.message,
        storagePath: skillDir,
        target,
      }, { status: err.status })
    }
    throw err
  }

  const installed = buildSkillItemFromFile({
    id: `${target}:${installedPackage.slug}`,
    slug: installedPackage.slug,
    sourceType: target,
    storagePath: installedDir,
    raw: getSkillMarkdownFromPackage(installedPackage),
  })

  return NextResponse.json({
    ok: true,
    target,
    storagePath: installedDir,
    skill: installed,
    packageTree: installedPackage.packageTree,
    files: installedPackage.files.map(file => ({
      path: file.path,
      executable: Boolean(file.executable),
      bytes: Buffer.isBuffer(file.content)
        ? file.content.byteLength
        : Buffer.byteLength(file.content, 'utf-8'),
    })),
  }, { status: body.overwrite ? 200 : 201 })
}

function normalizeSlug(value?: string): string {
  const raw = (value || '').trim()
  if (!raw) return ''
  const withoutSource = raw.includes(':') ? raw.split(':').pop() || raw : raw
  return slugifySkillName(withoutSource.replace(/^\//, ''))
}

function resolveCatalogSkill(slug: string): SkillItem | null {
  return getBuiltinSkills().find(skill => skill.slug === slug || normalizeSlug(skill.id) === slug) ?? null
}

function resolveDestination(
  target: 'global' | 'project',
  slug: string,
  projectId?: string,
): { skillsDir: string; skillDir: string } | { error: string; status: number } {
  if (target === 'global') {
    const skillsDir = getSdkGlobalSkillsDir()
    return { skillsDir, skillDir: path.join(skillsDir, slug) }
  }

  if (!projectId) return { error: 'projectId is required for project install', status: 400 }

  const db = getDb()
  const row = db.prepare('SELECT workspace_path FROM projects WHERE id = ? AND status = ?')
    .get(projectId, 'active') as ProjectRow | undefined
  const workspacePath = row?.workspace_path?.trim()
  if (!workspacePath) return { error: 'Project workspace is required', status: 404 }

  try {
    const stat = fs.statSync(workspacePath)
    if (!stat.isDirectory()) return { error: 'Project workspace is not a directory', status: 400 }
  } catch {
    return { error: 'Project workspace does not exist', status: 404 }
  }

  const skillsDir = path.join(workspacePath, '.claude', 'skills')
  return { skillsDir, skillDir: path.join(skillsDir, slug) }
}
