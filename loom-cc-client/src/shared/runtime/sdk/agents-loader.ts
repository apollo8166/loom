/**
 * Load sub-agent definitions from .claude/agents/*.md files in a workspace.
 * Each file uses YAML frontmatter + markdown body format.
 *
 * Rewritten for Loom CC: accepts workspacePath parameter instead of
 * using child-specific directory resolution.
 */

import fs from 'fs'
import path from 'path'
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk'
import { parseFrontmatter } from '@/shared/runtime/sdk/frontmatter'
import { logger } from '@/shared/logging/logger'

/**
 * Load all sub-agent definitions from a workspace's .claude/agents/ directory.
 */
export function loadAgentsFromFiles(workspacePath: string): Record<string, AgentDefinition> {
  const agentsDir = path.join(workspacePath, '.claude', 'agents')
  if (!fs.existsSync(agentsDir)) return {}

  const files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'))
  const agents: Record<string, AgentDefinition> = {}

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(agentsDir, file), 'utf-8')
      const { frontmatter, body } = parseFrontmatter(content)

      if (frontmatter.enabled === false) continue

      const id = path.basename(file, '.md')
      agents[id] = {
        description: frontmatter.description || frontmatter.name || id,
        prompt: body || `You are ${frontmatter.name || id}. Complete the delegated task concisely.`,
        model: frontmatter.model || 'inherit',
        ...(frontmatter.disallowedTools && frontmatter.disallowedTools.length > 0 && {
          disallowedTools: frontmatter.disallowedTools,
        }),
      }
    } catch (err) {
      logger.warn('runtime.agent.load_failed', {
        path: path.join(agentsDir, file),
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return agents
}
