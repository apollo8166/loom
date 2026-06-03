export type SkillSourceType = 'builtin' | 'global' | 'project' | 'session' | 'user'

export type SkillPackageNodeType =
  | 'instruction'
  | 'metadata'
  | 'directory'
  | 'reference'
  | 'script'
  | 'template'
  | 'asset'

export interface SkillPackageTreeItem {
  path: string
  type: SkillPackageNodeType
  description: string
  risk?: 'none' | 'file-read' | 'file-write' | 'network' | 'shell' | 'privacy'
  autoRun?: boolean
  loadedWhen?: string
}

export interface SkillUiMeta {
  schemaVersion?: string
  displayName?: string
  category?: string
  stage?: string
  tags?: string[]
  inputTypes?: string[]
  outputTypes?: string[]
  riskLevel?: 'low' | 'medium' | 'high'
  requires?: {
    network?: boolean
    fileRead?: boolean
    fileWrite?: boolean
    shell?: boolean
    mcp?: string[]
  }
  examples?: string[]
  packageTree?: SkillPackageTreeItem[]
}

export interface SkillItem {
  id: string
  name: string
  slug: string
  description: string
  sourceType: SkillSourceType
  storagePath: string | null
  isPinned: boolean
  createdAt: string | null
  raw?: string
  summary?: string
  stage?: string
  category?: string
  tags?: string[]
  inputs?: string[]
  outputs?: string[]
  examples?: string[]
  riskLevel?: 'low' | 'medium' | 'high'
  requires?: SkillUiMeta['requires']
  packageTree?: SkillPackageTreeItem[]
}
