import type { SkillItem } from './skill-types'
import { buildSkillItemFromFile } from './skill-parser'
import {
  findBuiltinSkillPackageDir,
  getSkillMarkdownFromPackage,
  listBuiltinSkillPackageDirs,
  readStandardSkillPackageFromDirectory,
} from './skill-package'

export function getBuiltinSkills(): SkillItem[] {
  return listBuiltinSkillPackageDirs().map((packageDir) => {
    const skillPackage = readStandardSkillPackageFromDirectory(packageDir)
    return {
      ...buildSkillItemFromFile({
        id: `builtin:${skillPackage.slug}`,
        slug: skillPackage.slug,
        sourceType: 'builtin',
        storagePath: packageDir,
        raw: getSkillMarkdownFromPackage(skillPackage),
      }),
      sourceType: 'builtin' as const,
      storagePath: packageDir,
      packageTree: skillPackage.packageTree,
    }
  })
}

export function getSkillBuilderSystemPrompt(): string | null {
  const packageDir = findBuiltinSkillPackageDir('skill-builder')
  if (!packageDir) return null

  const skillPackage = readStandardSkillPackageFromDirectory(packageDir, { slug: 'skill-builder' })
  return getSkillMarkdownFromPackage(skillPackage) || null
}
