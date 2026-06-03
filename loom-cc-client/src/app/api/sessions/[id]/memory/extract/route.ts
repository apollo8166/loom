import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'
import { loadRecentSessionMessages, runMemoryExtractionJob, runMemoryExtractionJobDetached } from '@/shared/memory/background-jobs'
import { logger } from '@/shared/logging/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = await req.json().catch(() => ({})) as {
    reason?: 'after_message' | 'compact_flush' | 'manual'
    async?: boolean
  }
  const db = getDb()
  const session = db.prepare(
    `SELECT s.id, s.project_id, s.context_version, COALESCE(NULLIF(s.workspace_path, ''), NULLIF(p.workspace_path, '')) AS workspace_path
     FROM sessions s
     JOIN projects p ON p.id = s.project_id
     WHERE s.id = ?`
  ).get(id) as { id: string; project_id: string; context_version: number; workspace_path: string | null } | undefined
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (!session.workspace_path) return NextResponse.json({ error: 'Workspace path not found' }, { status: 400 })

  const reason = body.reason || 'manual'
  const messages = loadRecentSessionMessages({
    sessionId: id,
    contextVersion: session.context_version,
    limit: reason === 'compact_flush' ? 12 : 6,
  })
  if (reason === 'after_message' && messages.length < 4) {
    logger.info('memory.extract.api_skipped_short_context', {
      sessionId: id,
      contextVersion: session.context_version,
      reason,
      messageCount: messages.length,
    })
    return NextResponse.json({
      status: 'skipped',
      reason: 'short_context',
      candidateCount: 0,
      messageCount: messages.length,
    })
  }
  logger.info('memory.extract.api_request', {
    sessionId: id,
    contextVersion: session.context_version,
    reason,
    async: Boolean(body.async),
    messageCount: messages.length,
    workspacePath: session.workspace_path,
  })

  try {
    const payload = {
      sessionId: id,
      projectId: session.project_id,
      workspacePath: session.workspace_path,
      contextVersion: session.context_version,
      messages,
      reason,
    }
    if (body.async) {
      runMemoryExtractionJobDetached(payload)
      logger.info('memory.extract.api_queued', {
        sessionId: id,
        contextVersion: payload.contextVersion,
        reason: payload.reason,
        messageCount: messages.length,
      })
      return NextResponse.json({
        queued: true,
        reason: payload.reason,
        contextVersion: payload.contextVersion,
        messageCount: messages.length,
      })
    }
    const result = await runMemoryExtractionJob(payload)
    logger.info('memory.extract.api_done', {
      sessionId: id,
      contextVersion: payload.contextVersion,
      reason: payload.reason,
      candidateCount: result.candidateCount,
      status: result.status,
    })
    return NextResponse.json(result)
  } catch (err) {
    logger.error('memory.extract.api_failed', err, {
      sessionId: id,
      contextVersion: session.context_version,
      reason,
    })
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Memory extraction failed' }, { status: 500 })
  }
}
