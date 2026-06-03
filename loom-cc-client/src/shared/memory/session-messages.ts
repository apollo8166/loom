export function messageContentToText(content: string): string {
  if (!content) return ''
  try {
    const blocks = JSON.parse(content) as Array<Record<string, unknown>>
    if (Array.isArray(blocks)) {
      return blocks.map(block => {
        if (block.type === 'text' && typeof block.text === 'string') return block.text
        if (block.type === 'tool_use' && typeof block.name === 'string') return `[tool_use: ${block.name}]`
        if (block.type === 'tool_result') return '[tool_result]'
        return ''
      }).filter(Boolean).join('\n')
    }
  } catch {
    // legacy plain text
  }
  return content
}
