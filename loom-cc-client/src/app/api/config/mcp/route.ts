import { NextRequest, NextResponse } from 'next/server'
import {
  listMcpServers,
  addMcpServer,
  removeMcpServer,
  parseMcpAddCommand,
  type McpServerConfig,
  type McpScope,
} from '@/modules/config/mcp-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/config/mcp — list Claude MCP servers for an optional workspace */
export function GET(req: NextRequest) {
  const workspacePath = req.nextUrl.searchParams.get('workspacePath')
  const servers = listMcpServers(workspacePath)
  return NextResponse.json({ servers })
}

/**
 * POST /api/config/mcp — add / update an MCP server
 * Body option A (raw config):
 *   { name: string, config: McpServerConfig }
 * Body option B (parsed from slash command args):
 *   { args: string[] }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      name?: string
      config?: McpServerConfig
      args?: string[]
      scope?: McpScope
      workspacePath?: string
    }

    let name: string
    let config: McpServerConfig
    let scope: McpScope = body.scope ?? 'local'

    if (body.args) {
      const parsed = parseMcpAddCommand(body.args)
      name = parsed.name
      config = parsed.config
      scope = parsed.scope
    } else if (body.name && body.config) {
      name = body.name
      config = body.config
    } else {
      return NextResponse.json({ error: 'Requires { name, config } or { args }' }, { status: 400 })
    }

    if (!name.trim()) {
      return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    }

    addMcpServer(name, config, scope, body.workspacePath)
    return NextResponse.json({ ok: true, name, config, scope })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 })
  }
}

/**
 * DELETE /api/config/mcp — remove an MCP server
 * Body: { name: string, scope?: 'local'|'project'|'user', workspacePath?: string }
 */
export async function DELETE(req: NextRequest) {
  try {
    const { name, scope, workspacePath } = await req.json() as { name?: string; scope?: McpScope; workspacePath?: string }
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
    const targetScope = scope ?? 'local'
    const removed = removeMcpServer(name, targetScope, workspacePath)
    if (!removed) return NextResponse.json({ error: `Server "${name}" not found in ${targetScope} scope` }, { status: 404 })
    return NextResponse.json({ ok: true, name, scope: targetScope })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 })
  }
}
