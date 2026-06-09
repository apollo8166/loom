/**
 * Shared frontmatter parser for agent .md files.
 * Single source of truth — used by agents-loader and chat API.
 */

export interface AgentFrontmatter {
  name?: string
  description?: string
  model?: string
  enabled?: boolean
  tools?: string[]
  disallowedTools?: string[]
  skills?: string[]
}

/**
 * Parse YAML frontmatter from a markdown file.
 * Expects format: --- \n key: value \n --- \n body
 *
 * Supports:
 * - name, description, model (string fields)
 * - enabled (boolean, defaults to true unless explicitly "false")
 * - tools, disallowedTools, skills: inline array [a, b] or YAML list format (- item)
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

    value = parseScalarValue(value)

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
      case 'tools':
        frontmatter.tools = parseStringList(value, lines, () => i++, () => lines[i + 1]?.trim())
        break
      case 'disallowedTools':
        frontmatter.disallowedTools = parseStringList(value, lines, () => i++, () => lines[i + 1]?.trim())
        break
      case 'skills':
        frontmatter.skills = parseStringList(value, lines, () => i++, () => lines[i + 1]?.trim())
        break
    }
  }

  return { frontmatter, body }
}

function parseStringList(
  value: string,
  _lines: string[],
  advance: () => void,
  peekNext: () => string | undefined,
): string[] {
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map(cleanListItem)
      .filter(Boolean)
  }

  if (value === '') {
    const items: string[] = []
    while (true) {
      const nextLine = peekNext()
      if (!nextLine?.startsWith('- ')) break
      items.push(cleanListItem(nextLine.slice(2)))
      advance()
    }
    return items.filter(Boolean)
  }

  return value.split(',').map(cleanListItem).filter(Boolean)
}

function cleanListItem(value: string): string {
  return parseScalarValue(value.trim())
}

function parseScalarValue(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string
    } catch {
      return trimmed.slice(1, -1)
    }
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}
