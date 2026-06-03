import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getLoomDataDir } from '@/shared/db/paths'
import { logger } from '@/shared/logging/logger'

export function getSdkGlobalClaudeDir(): string {
  return path.join(os.homedir(), '.claude')
}

export function getSdkGlobalSkillsDir(): string {
  return path.join(getSdkGlobalClaudeDir(), 'skills')
}

export function getLegacyLoomGlobalSkillsDir(): string {
  return path.join(getLoomDataDir(), '.claude', 'skills')
}

function isSafeChild(parentDir: string, childPath: string): boolean {
  const parent = path.resolve(parentDir)
  const child = path.resolve(childPath)
  const rel = path.relative(parent, child)
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * Older Loom builds created global skills under LOOM_DATA_DIR/.claude/skills.
 * Claude Agent SDK discovers global skills from ~/.claude/skills by default.
 * Copy legacy skills once, without overwriting the SDK-visible copy.
 */
export function ensureLegacyGlobalSkillsVisibleToSdk(): void {
  const legacyDir = getLegacyLoomGlobalSkillsDir()
  if (!fs.existsSync(legacyDir)) return

  const sdkDir = getSdkGlobalSkillsDir()
  try {
    fs.mkdirSync(sdkDir, { recursive: true })
    for (const entry of fs.readdirSync(legacyDir, { withFileTypes: true })) {
      const sourcePath = path.join(legacyDir, entry.name)
      const targetPath = path.join(sdkDir, entry.name)
      if (!isSafeChild(sdkDir, targetPath) || fs.existsSync(targetPath)) continue

      if (entry.isDirectory()) {
        if (!fs.existsSync(path.join(sourcePath, 'SKILL.md'))) continue
        fs.cpSync(sourcePath, targetPath, { recursive: true })
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const skillName = entry.name.replace(/\.md$/, '')
        const targetDir = path.join(sdkDir, skillName)
        const targetSkillMd = path.join(targetDir, 'SKILL.md')
        if (!isSafeChild(sdkDir, targetDir) || fs.existsSync(targetDir)) continue
        fs.mkdirSync(targetDir, { recursive: true })
        fs.copyFileSync(sourcePath, targetSkillMd)
      }
    }
  } catch (err) {
    logger.warn('skills.legacy_global_mirror_failed', {
      legacyDir,
      sdkDir,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
