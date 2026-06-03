import { NextRequest, NextResponse } from 'next/server'
import { writeMemoryCandidate } from '@/shared/memory/files'
import type { MemoryCandidate, MemoryScope } from '@/shared/memory/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    scope?: MemoryScope
    workspacePath?: string
    type?: MemoryCandidate['type']
    confidence?: MemoryCandidate['confidence']
    sourceSessionId?: string
    content?: string
    evidence?: string
  }
  if (body.scope !== 'global' && body.scope !== 'project') {
    return NextResponse.json({ error: 'scope must be global or project' }, { status: 400 })
  }
  if (body.scope === 'project' && !body.workspacePath) {
    return NextResponse.json({ error: 'workspacePath is required for project memory' }, { status: 400 })
  }
  if (!body.content?.trim()) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 })
  }
  const candidate = writeMemoryCandidate({
    scope: body.scope,
    workspacePath: body.workspacePath,
    type: body.type,
    confidence: body.confidence,
    sourceSessionId: body.sourceSessionId,
    content: body.content,
    evidence: body.evidence,
  })
  return NextResponse.json({ candidate })
}
