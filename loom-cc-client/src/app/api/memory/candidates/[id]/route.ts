import { NextRequest, NextResponse } from 'next/server'
import { approveCandidate, rejectCandidate } from '@/shared/memory/consolidator'
import { updateMemoryCandidate } from '@/shared/memory/files'
import type { MemoryScope } from '@/shared/memory/types'
import { logger } from '@/shared/logging/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = await req.json().catch(() => ({})) as {
    action?: 'approve' | 'reject'
    scope?: MemoryScope
    workspacePath?: string
  }
  if (body.scope !== 'global' && body.scope !== 'project') {
    return NextResponse.json({ error: 'scope must be global or project' }, { status: 400 })
  }
  if (body.scope === 'project' && !body.workspacePath) {
    return NextResponse.json({ error: 'workspacePath is required for project memory' }, { status: 400 })
  }
  if (body.action !== 'approve' && body.action !== 'reject') {
    return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 })
  }
  logger.info('memory.candidate.api_post_request', {
    id,
    action: body.action,
    scope: body.scope,
    workspacePath: body.workspacePath,
  })
  try {
    if (body.action === 'approve') {
      const result = approveCandidate({ id, scope: body.scope, workspacePath: body.workspacePath })
      logger.info('memory.candidate.api_post_done', {
        id,
        action: body.action,
        status: result.candidate.status,
        targetFile: result.targetFile,
        targetPath: result.targetPath,
      })
      return NextResponse.json(result)
    }
    const candidate = rejectCandidate({ id, scope: body.scope, workspacePath: body.workspacePath })
    logger.info('memory.candidate.api_post_done', {
      id,
      action: body.action,
      status: candidate.status,
    })
    return NextResponse.json({ candidate })
  } catch (err) {
    logger.error('memory.candidate.api_post_failed', err, {
      id,
      action: body.action,
      scope: body.scope,
      workspacePath: body.workspacePath,
    })
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Candidate update failed' }, { status: 404 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = await req.json().catch(() => ({})) as {
    scope?: MemoryScope
    workspacePath?: string
    type?: 'preference' | 'fact' | 'decision' | 'workflow' | 'correction' | 'feedback' | 'risk' | 'retrospective' | 'project_rule'
    confidence?: 'high' | 'medium' | 'low'
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
  logger.info('memory.candidate.api_patch_request', {
    id,
    scope: body.scope,
    workspacePath: body.workspacePath,
    type: body.type,
    confidence: body.confidence,
    contentChars: body.content.length,
  })
  try {
    const candidate = updateMemoryCandidate({
      id,
      scope: body.scope,
      workspacePath: body.workspacePath,
      type: body.type,
      confidence: body.confidence,
      content: body.content,
      evidence: body.evidence,
    })
    logger.info('memory.candidate.api_patch_done', {
      id,
      scope: body.scope,
      status: candidate.status,
      candidatePath: candidate.path,
    })
    return NextResponse.json({ candidate })
  } catch (err) {
    logger.error('memory.candidate.api_patch_failed', err, {
      id,
      scope: body.scope,
      workspacePath: body.workspacePath,
    })
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Candidate update failed' }, { status: 404 })
  }
}
