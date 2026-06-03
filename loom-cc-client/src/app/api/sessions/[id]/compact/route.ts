import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'
import { clearSessionAllowances } from '@/shared/runtime/sdk/permission-bridge'
import { createLoomQuery } from '@/shared/runtime/sdk/client'
import { MessageMapper } from '@/shared/runtime/sdk/message-mapper'
import { generateCompactSummaryWithLlm } from '@/shared/memory/auto-extractor'
import { runMemoryExtractionJobDetached } from '@/shared/memory/background-jobs'
import { messageContentToText } from '@/shared/memory/session-messages'
import { logger } from '@/shared/logging/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function logCompact(event: string, payload: Record<string, unknown> = {}) {
  logger.info(`compact.${event}`, payload)
}

async function runSdkCompact(params: {
  sessionId: string
  runtimeSessionId: string | null
  model: string
  workspacePath: string | null
  providerId: string
  useWorktree: boolean
}): Promise<{ ok: boolean; summary: string; metadata?: Record<string, unknown>; error?: string }> {
  if (!params.runtimeSessionId) return { ok: false, summary: '', error: 'missing_runtime_session' }
  const mapper = new MessageMapper()
  const q = createLoomQuery({
    prompt: '/compact',
    sessionId: params.runtimeSessionId,
    model: params.model,
    resumeSession: true,
    bypassPermissions: true,
    projectWorkspacePath: params.workspacePath || undefined,
    providerIdOverride: params.providerId || undefined,
    useWorktree: params.useWorktree,
    maxTurns: 1,
  })
  const textParts: string[] = []
  let metadata: Record<string, unknown> | undefined
  try {
    for await (const msg of q) {
      const events = mapper.mapMessage(msg)
      for (const event of events) {
        if (event.type === 'text_delta' && typeof event.text === 'string') textParts.push(event.text)
        if (event.type === 'compact_boundary') metadata = event.metadata as Record<string, unknown> | undefined
      }
    }
    const blocks = mapper.getBlocks()
    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string') textParts.push(block.text)
    }
    return { ok: true, summary: textParts.join('').trim(), metadata }
  } catch (err) {
    return {
      ok: false,
      summary: '',
      metadata,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * POST /api/sessions/:id/compact
 * body: { summary?: string }
 *
 * Compact context (similar to clear, but preserves a summary):
 * 1. Create session_boundary (boundary_type='compact') with summary
 * 2. Increment session.context_version
 * 3. Update session.compact_summary
 * 4. SDK-managed compact keeps runtime_session_id; Loom fallback compact creates a fresh runtime_session_id
 * 5. Clear runtime allowances only for fallback runtime switch
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let body: { summary?: string } = {}
  try {
    body = await req.json()
  } catch { /* empty body is fine */ }

  const db = getDb()

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as {
    id: string
    project_id: string
    runtime_session_id: string | null
    context_version: number
    workspace_path: string | null
    model: string
    use_worktree: number
  } | undefined
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  let summary = body.summary?.trim() || null
  const newContextVersion = session.context_version + 1
  const boundaryId = crypto.randomUUID()

  logCompact('start', {
    sessionId: id,
    projectId: session.project_id,
    contextVersion: session.context_version,
    newContextVersion,
    hasRuntimeSession: Boolean(session.runtime_session_id),
    summaryChars: summary?.length ?? 0,
  })

  const activeRows = db.prepare(
    `SELECT role, content FROM messages
     WHERE session_id = ? AND context_version = ?
     ORDER BY created_at ASC`
  ).all(id, session.context_version) as Array<{ role: 'user' | 'assistant'; content: string }>
  const activeMessages = activeRows.map(row => ({
    role: row.role,
    text: messageContentToText(row.content),
  })).filter(m => m.text.trim().length > 0)
  const activeTokenRow = db.prepare(
    `SELECT
       COALESCE(SUM(input_tokens), 0) AS input_tokens,
       COALESCE(SUM(output_tokens), 0) AS output_tokens
     FROM messages
     WHERE session_id = ? AND context_version = ?`
  ).get(id, session.context_version) as { input_tokens: number; output_tokens: number }
  const activeTokenStats = {
    inputTokens: activeTokenRow.input_tokens || 0,
    outputTokens: activeTokenRow.output_tokens || 0,
    totalTokens: (activeTokenRow.input_tokens || 0) + (activeTokenRow.output_tokens || 0),
  }
  const activeMessageChars = activeMessages.reduce((sum, message) => sum + message.text.length, 0)
  logCompact('active_context_check', {
    sessionId: id,
    contextVersion: session.context_version,
    rowCount: activeRows.length,
    messageCount: activeMessages.length,
    messageChars: activeMessageChars,
    tokenStats: activeTokenStats,
  })
  if (activeMessages.length === 0) {
    logCompact('abort_empty_context', {
      sessionId: id,
      contextVersion: session.context_version,
    })
    return NextResponse.json(
      { error: 'No messages to compact in the current context' },
      { status: 400 },
    )
  }

  const project = db.prepare('SELECT workspace_path FROM projects WHERE id = ?').get(session.project_id) as { workspace_path: string | null } | undefined
  const workspacePath = session.workspace_path || project?.workspace_path || null
  const projectProvider = db.prepare(
    `SELECT value FROM project_settings WHERE project_id = ? AND key = 'provider_id'`
  ).get(session.project_id) as { value: string } | undefined

  let sdkCompactMetadata: Record<string, unknown> | undefined
  let compactSource: 'sdk' | 'loom' = 'loom'
  if (!summary) {
    const sdkCompact = await runSdkCompact({
      sessionId: id,
      runtimeSessionId: session.runtime_session_id,
      model: session.model,
      workspacePath,
      providerId: projectProvider?.value || '',
      useWorktree: session.use_worktree === 1,
    })
    logCompact('sdk_compact_result', {
      sessionId: id,
      ok: sdkCompact.ok,
      summaryChars: sdkCompact.summary.length,
      hasMetadata: Boolean(sdkCompact.metadata),
      error: sdkCompact.error,
    })
    if (sdkCompact.metadata) sdkCompactMetadata = sdkCompact.metadata
    if (sdkCompact.ok) compactSource = 'sdk'
    if (sdkCompact.summary.trim()) summary = sdkCompact.summary.trim()
  }

  if (!summary) {
    try {
      logCompact('summary_generate_fallback_start', {
        sessionId: id,
        messageCount: activeMessages.length,
        messageChars: activeMessages.reduce((sum, message) => sum + message.text.length, 0),
      })
      summary = await generateCompactSummaryWithLlm({
        sessionId: id,
        messages: activeMessages.slice(-12),
      })
      logCompact('summary_generate_fallback_done', {
        sessionId: id,
        summaryChars: summary?.length ?? 0,
      })
    } catch (err) {
      logger.error('compact.summary_generate_fallback_failed', err, {
        sessionId: id,
      })
      summary = null
    }
  }
  if (!summary?.trim()) {
    logCompact('abort_empty_summary', { sessionId: id })
    return NextResponse.json(
      { error: 'Compact summary generation failed' },
      { status: 500 },
    )
  }
  const targetRuntimeSessionId = compactSource === 'sdk'
    ? session.runtime_session_id
    : crypto.randomUUID()
  const compactMetadata = {
    ...(sdkCompactMetadata || {}),
    loom: {
      fromContextVersion: session.context_version,
      toContextVersion: newContextVersion,
      rowCount: activeRows.length,
      messageCount: activeMessages.length,
      messageChars: activeMessageChars,
      summaryChars: summary.length,
      tokenStats: activeTokenStats,
    },
  }
  const metadataJson = JSON.stringify(compactMetadata)

  db.transaction(() => {
    // 1. Record the boundary with summary
    db.prepare(
      `INSERT INTO session_boundaries
        (id, session_id, boundary_type, from_runtime_session_id, to_runtime_session_id, summary, compact_source, metadata)
       VALUES (?, ?, 'compact', ?, ?, ?, ?, ?)`
    ).run(boundaryId, id, session.runtime_session_id, targetRuntimeSessionId, summary, compactSource, metadataJson)

    // 2. Update session
    db.prepare(
      `UPDATE sessions SET
         context_version = ?,
         runtime_session_id = ?,
         compact_summary = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ?`
    ).run(newContextVersion, targetRuntimeSessionId, summary, id)
  })()
  logCompact('boundary_written', {
    sessionId: id,
    boundaryId,
    fromRuntimeSessionId: session.runtime_session_id,
    toRuntimeSessionId: targetRuntimeSessionId,
    newContextVersion,
    compactSource,
    sdkCompact: compactSource === 'sdk',
    tokenStatsBefore: activeTokenStats,
    messageCountBefore: activeMessages.length,
    summaryChars: summary.length,
  })

  // 3. SDK-managed compact keeps the same runtime session and its compacted context.
  // Fallback compact switches runtime session, so old session allowances must be cleared.
  if (compactSource !== 'sdk' && session.runtime_session_id) {
    clearSessionAllowances(session.runtime_session_id)
  }
  clearSessionAllowances(id)

  const updated = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
  let memoryFlushStatus: 'queued' | 'skipped' = 'skipped'
  if (workspacePath) {
    const messages = activeMessages.slice(-12)
    logCompact('memory_flush_queued', {
      sessionId: id,
      workspacePath,
      fromContextVersion: session.context_version,
      messageCount: messages.length,
      messageChars: messages.reduce((sum, message) => sum + message.text.length, 0),
    })
    runMemoryExtractionJobDetached({
      sessionId: id,
      projectId: session.project_id,
      workspacePath,
      contextVersion: session.context_version,
      reason: 'compact_flush',
      messages,
    })
    memoryFlushStatus = 'queued'
  } else {
    logCompact('memory_flush_skipped', {
      sessionId: id,
      reason: 'missing_workspace',
    })
  }
  logCompact('done', {
    sessionId: id,
    runtimeSessionId: targetRuntimeSessionId,
    newContextVersion,
    compactSource,
    memoryFlushStatus,
    tokenStatsBefore: activeTokenStats,
    messageCountBefore: activeMessages.length,
    summaryChars: summary.length,
  })
  return NextResponse.json({
    session: updated,
    summary,
    boundaryId,
    fromContextVersion: session.context_version,
    toContextVersion: newContextVersion,
    memoryFlushStatus,
    compactSource,
    sdkCompactMetadata,
    compactMetadata,
  })
}
