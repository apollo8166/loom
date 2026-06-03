import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { getDb } from '@/shared/db/db'
import {
  ensureLegacyGlobalSkillsVisibleToSdk,
  getLegacyLoomGlobalSkillsDir,
  getSdkGlobalSkillsDir,
} from '@/shared/skills/sdk-global-skills'
import type { SkillItem } from '@/shared/skills/skill-types'
import { buildSkillItemFromFile } from '@/shared/skills/skill-parser'
import { getBuiltinSkills } from '@/shared/skills/builtin-skills'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SkillRow {
  id: string
  name: string
  slug: string
  description: string
  source_type: string
  storage_path: string
  is_pinned: number
  created_at: string
  updated_at: string
}

/**
 * Scan a .claude/skills/ directory for skill folders containing SKILL.md,
 * or standalone .md files.
 */
function scanSkillsDir(
  skillsDir: string,
  sourceType: 'global' | 'project',
): SkillItem[] {
  if (!fs.existsSync(skillsDir)) return []

  const results: SkillItem[] = []

  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    // Directory-based skill: skills/<name>/SKILL.md
    if (entry.isDirectory()) {
      const skillMd = path.join(skillsDir, entry.name, 'SKILL.md')
      if (!fs.existsSync(skillMd)) continue
      try {
        const content = fs.readFileSync(skillMd, 'utf-8')
        const slug = entry.name
        results.push(buildSkillItemFromFile({
          id: `${sourceType}:${slug}`,
          slug,
          sourceType,
          storagePath: path.join(skillsDir, entry.name),
          raw: content,
        }))
      } catch { /* skip unreadable */ }
      continue
    }

    // Standalone .md file: skills/<name>.md
    if (entry.isFile() && entry.name.endsWith('.md')) {
      try {
        const content = fs.readFileSync(path.join(skillsDir, entry.name), 'utf-8')
        const slug = entry.name.replace(/\.md$/, '')
        results.push(buildSkillItemFromFile({
          id: `${sourceType}:${slug}`,
          slug,
          sourceType,
          storagePath: path.join(skillsDir, entry.name),
          raw: content,
        }))
      } catch { /* skip */ }
    }
  }

  return results
}

function mapSkillRow(row: SkillRow): SkillItem {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    sourceType: row.source_type as SkillItem['sourceType'],
    storagePath: row.storage_path || null,
    isPinned: row.is_pinned === 1,
    createdAt: row.created_at,
    summary: row.description,
  }
}

function mergeInstalledCatalogState(
  catalogSkill: SkillItem,
  installedSkill: SkillItem,
): SkillItem {
  return {
    ...catalogSkill,
    id: installedSkill.id,
    sourceType: installedSkill.sourceType,
    storagePath: installedSkill.storagePath,
    createdAt: installedSkill.createdAt ?? catalogSkill.createdAt,
    isPinned: catalogSkill.isPinned || installedSkill.isPinned,
  }
}

/** GET /api/skills — merge skills from all sources */
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId')
  const seen = new Map<string, SkillItem>()
  ensureLegacyGlobalSkillsVisibleToSdk()

  // Skills 管理页只展示 Loom 仓库 catalog。已安装目录/DB 只用于给同名
  // catalog skill 合并安装状态和收藏状态，不把仓库外 skill 加进菜单。
  for (const s of getBuiltinSkills()) {
    seen.set(s.slug, s)
  }

  // 2. Global skills: ~/.claude/skills/ is SDK-visible; Loom's old data-dir
  // location is kept as a read-only compatibility source.
  const homeGlobalSkillsDir = getSdkGlobalSkillsDir()
  const loomGlobalSkillsDir = getLegacyLoomGlobalSkillsDir()

  for (const dir of [loomGlobalSkillsDir, homeGlobalSkillsDir]) {
    for (const s of scanSkillsDir(dir, 'global')) {
      const existing = seen.get(s.slug)
      if (existing) seen.set(s.slug, mergeInstalledCatalogState(existing, s))
    }
  }

  // 3. Project skills (if projectId provided)
  if (projectId) {
    const db = getDb()
    const projectRow = db.prepare(
      'SELECT workspace_path FROM projects WHERE id = ?',
    ).get(projectId) as { workspace_path: string } | undefined

    if (projectRow?.workspace_path) {
      const projectSkillsDir = path.join(
        projectRow.workspace_path, '.claude', 'skills',
      )
      for (const s of scanSkillsDir(projectSkillsDir, 'project')) {
        const existing = seen.get(s.slug)
        if (existing) seen.set(s.slug, mergeInstalledCatalogState(existing, s))
      }
    }
  }

  // 4. DB skills (pinned or registered)
  const db = getDb()
  const dbRows = db.prepare('SELECT * FROM skills').all() as SkillRow[]
  for (const row of dbRows) {
    const existing = seen.get(row.slug)
    if (existing) {
      // Merge DB pin state into file-scanned skill
      existing.isPinned = row.is_pinned === 1
      existing.id = row.id
      existing.createdAt = row.created_at
    }
  }

  const skills = Array.from(seen.values())
  skills.sort((a, b) => a.name.localeCompare(b.name))

  // Check if global skills directory exists
  const globalDirExists =
    fs.existsSync(homeGlobalSkillsDir) || fs.existsSync(loomGlobalSkillsDir)

  return NextResponse.json({ skills, globalDirExists })
}
