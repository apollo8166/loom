/**
 * Shared frontmatter parser for agent .md files.
 * Single source of truth — used by agents-loader and chat API.
 */

export interface AgentFrontmatter {
  name?: string
  description?: string
  model?: string
  enabled?: boolean
  disallowedTools?: string[]
}

/**
 * Parse YAML frontmatter from a markdown file.
 * Expects format: --- \n key: value \n --- \n body
 *
 * Supports:
 * - name, description, model (string fields)
 * - enabled (boolean, defaults to true unless explicitly "false")
 * - disallowedTools: inline array [a, b] or YAML list format (- item)
 */
export function parseFrontmatter(content: string): { frontmatter: AgentFrontmatter; body: string } {
  const trimmed = content.trim()
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: trimmed }
  }

  const endIdx = trimmed.indexOf('---', 3)
  if (endIdx === -1) {
    return { frontmatter: {}, body: trimmed }
  }

  const yamlBlock = trimmed.slice(3, endIdx).trim()
  const body = trimmed.slice(endIdx + 3).trim()

  const frontmatter: AgentFrontmatter = {}
  const lines = yamlBlock.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue

    const key = line.slice(0, colonIdx).trim()
    let value = line.slice(colonIdx + 1).trim()

    // Remove surrounding quotes (only if they match)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    switch (key) {
      case 'name':
        frontmatter.name = value
        break
      case 'description':
        frontmatter.description = value
        break
      case 'model':
        frontmatter.model = value
        break
      case 'enabled':
        frontmatter.enabled = value !== 'false'
        break
      case 'disallowedTools':
        if (value.startsWith('[') && value.endsWith(']')) {
          frontmatter.disallowedTools = value
            .slice(1, -1)
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
        } else if (value === '') {
          const items: string[] = []
          while (i + 1 < lines.length) {
            const nextLine = lines[i + 1].trim()
            if (nextLine.startsWith('- ')) {
              items.push(nextLine.slice(2).trim())
              i++
            } else {
              break
            }
          }
          if (items.length > 0) {
            frontmatter.disallowedTools = items
          }
        }
        break
    }
  }

  return { frontmatter, body }
}
