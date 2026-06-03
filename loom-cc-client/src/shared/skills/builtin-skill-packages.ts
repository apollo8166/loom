import type { SkillItem, SkillPackageTreeItem } from './skill-types'
import {
  findBuiltinSkillPackageDir,
  readStandardSkillPackageFromDirectory,
  SkillPackageError,
} from './skill-package'

export interface BuiltinSkillPackageFile {
  path: string
  content: string | Buffer
  executable?: boolean
}

export interface BuiltinSkillPackage {
  slug: string
  files: BuiltinSkillPackageFile[]
  packageTree: SkillPackageTreeItem[]
}

export function getBuiltinSkillPackage(source: SkillItem): BuiltinSkillPackage {
  const packageDir = findBuiltinSkillPackageDir(source.slug)
  if (!packageDir) {
    throw new SkillPackageError(`Builtin skill not found in configured repository: ${source.slug}`, 404)
  }

  const skillPackage = readStandardSkillPackageFromDirectory(packageDir, { slug: source.slug })
  return {
    slug: skillPackage.slug,
    packageTree: skillPackage.packageTree,
    files: skillPackage.files,
  }
}
