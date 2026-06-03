import { NextRequest, NextResponse } from 'next/server'
import {
  listMcpServers,
  addMcpServer,
  removeMcpServer,
  parseMcpAddCommand,
  type McpServerConfig,
} from '@/modules/config/mcp-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/config/mcp — list all configured MCP servers */
export function GET() {
  const servers = listMcpServers()
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
    }

    let name: string
    let config: McpServerConfig

    if (body.args) {
      const parsed = parseMcpAddCommand(body.args)
      name = parsed.name
      config = parsed.config
    } else if (body.name && body.config) {
      name = body.name
      config = body.config
    } else {
      return NextResponse.json({ error: 'Requires { name, config } or { args }' }, { status: 400 })
    }

    if (!name.trim()) {
      return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    }

    addMcpServer(name, config)
    return NextResponse.json({ ok: true, name, config })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 })
  }
}

/**
 * DELETE /api/config/mcp — remove an MCP server
 * Body: { name: string }
 */
export async function DELETE(req: NextRequest) {
  try {
    const { name } = await req.json() as { name?: string }
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
    const removed = removeMcpServer(name)
    if (!removed) return NextResponse.json({ error: `Server "${name}" not found` }, { status: 404 })
    return NextResponse.json({ ok: true, name })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 })
  }
}
