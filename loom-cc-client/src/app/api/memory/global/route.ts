import { NextRequest, NextResponse } from 'next/server'
import { ensureClaudeMemory, readClaudeMemory } from '@/shared/memory/files'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ memory: readClaudeMemory('global') })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { initialize?: boolean }
  const memory = body.initialize ? ensureClaudeMemory('global') : readClaudeMemory('global')
  return NextResponse.json({ memory })
}
