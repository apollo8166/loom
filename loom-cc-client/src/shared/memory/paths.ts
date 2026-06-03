import os from 'node:os'
import path from 'node:path'

export function getGlobalClaudeDir(): string {
  return path.join(os.homedir(), '.claude')
}

export function getGlobalMemoryDir(): string {
  return path.join(getGlobalClaudeDir(), 'memory')
}

export function getProjectClaudeDir(workspacePath: string): string {
  return path.join(workspacePath, '.claude')
}

export function getProjectMemoryDir(workspacePath: string): string {
  return path.join(getProjectClaudeDir(workspacePath), 'memory')
}

export function getClaudeFileForScope(scope: 'global' | 'project', workspacePath?: string): string {
  if (scope === 'global') return path.join(getGlobalClaudeDir(), 'CLAUDE.md')
  if (!workspacePath) throw new Error('workspacePath is required for project memory')
  return path.join(getProjectClaudeDir(workspacePath), 'CLAUDE.md')
}

export function getMemoryDirForScope(scope: 'global' | 'project', workspacePath?: string): string {
  if (scope === 'global') return getGlobalMemoryDir()
  if (!workspacePath) throw new Error('workspacePath is required for project memory')
  return getProjectMemoryDir(workspacePath)
}
