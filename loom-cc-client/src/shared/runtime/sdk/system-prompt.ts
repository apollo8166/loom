/**
 * Minimal system prompt for Loom SDK queries.
 *
 * Design principle: The tool provides capability, not persona.
 * Role definition and teaching style are entirely controlled by
 * the user via .claude/CLAUDE.md in their workspace.
 * We only inject what cannot be delegated to user config:
 *   1. Tool-use rules (prevent misuse of Bash/file ops)
 *   2. Environment context (cwd, platform)
 *   3. Model identity (which model is selected)
 */

export const LOOM_TOOL_RULES = `
# Tool Rules

- Use Read/Edit/Glob/Grep instead of Bash for file operations
- Use Bash only for shell commands that require execution
- Never expose API keys, credentials, or secrets
- For irreversible or risky actions, confirm with user first
`.trim()

/**
 * Build the dynamic environment section injected per query.
 */
export function buildEnvironmentPrompt(cwd: string): string {
  const platform = process.platform
  const arch = process.arch
  const shell = process.env.SHELL || (platform === 'win32' ? 'cmd' : '/bin/sh')

  return `
# Environment

- Primary working directory: ${cwd}
- Platform: ${platform} (${arch})
- Shell: ${shell}
`.trim()
}
