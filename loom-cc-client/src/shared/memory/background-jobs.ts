import crypto from 'node:crypto'
import { getDb } from '@/shared/db/db'
import { extractMemoryCandidatesWithLlm } from './auto-extractor'
import { messageContentToText } from './session-messages'
import { logger } from '@/shared/logging/logger'
import { runCheapEvolutionPass, runEvolution } from '@/shared/evolution/orchestrator'

type MemoryExtractionReason = 'after_message' | 'compact_flush' | 'manual'

type MemoryJobMessage = {
  role: 'user' | 'assistant'
  text: string
}

type MemoryJobPayload = {
  sessionId: string
  projectId?: string
  workspacePath: string
  contextVersion: number
  reason: MemoryExtractionReason
  messages: MemoryJobMessage[]
}

function logMemoryJob(event: string, payload: Record<string, unknown> = {}) {
  logger.info(`memory.job.${event}`, payload)
}

function hashMessages(messages: MemoryJobMessage[]): string {
  return crypto
    .createHash('sha256')
    .update(messages.map(message => `${message.role}:${message.text}`).join('\n---\n'))
    .digest('hex')
    .slice(0, 24)
}

function prepareJob(payload: MemoryJobPayload): { jobId: string; messageHash: string; inserted: boolean } {
  const db = getDb()
  const messageHash = hashMessages(payload.messages)
  const jobId = crypto.randomUUID()
  const result = db.prepare(
    `INSERT OR IGNORE INTO memory_jobs
      (id, session_id, project_id, workspace_path, reason, context_version, message_hash, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'running')`
  ).run(
    jobId,
    payload.sessionId,
    payload.projectId || '',
    payload.workspacePath,
    payload.reason,
    payload.contextVersion,
    messageHash,
  )
  return { jobId, messageHash, inserted: result.changes > 0 }
}

export async function runMemoryExtractionJob(payload: MemoryJobPayload): Promise<{
  status: 'done' | 'failed' | 'skipped'
  candidateCount: number
  jobId?: string
  messageHash: string
  error?: string
}> {
  const db = getDb()
  const filteredMessages = payload.messages.filter(message => message.text.trim().length > 0)
  const messageHash = hashMessages(filteredMessages)
  if (filteredMessages.length === 0) {
    logMemoryJob('skip_no_messages', {
      sessionId: payload.sessionId,
      reason: payload.reason,
      contextVersion: payload.contextVersion,
      messageHash,
    })
    return { status: 'skipped', candidateCount: 0, messageHash }
  }

  const prepared = prepareJob({ ...payload, messages: filteredMessages })
  if (!prepared.inserted) {
    logMemoryJob('skip_duplicate', {
      sessionId: payload.sessionId,
      reason: payload.reason,
      contextVersion: payload.contextVersion,
      messageHash: prepared.messageHash,
    })
    return { status: 'skipped', candidateCount: 0, messageHash: prepared.messageHash }
  }

  logMemoryJob('start', {
    jobId: prepared.jobId,
    sessionId: payload.sessionId,
    reason: payload.reason,
    contextVersion: payload.contextVersion,
    messageCount: filteredMessages.length,
    messageChars: filteredMessages.reduce((sum, message) => sum + message.text.length, 0),
  })

  try {
    if (payload.reason === 'after_message') {
      const cheapResult = runCheapEvolutionPass({
        projectId: payload.projectId,
        sessionId: payload.sessionId,
        workspacePath: payload.workspacePath,
        messages: filteredMessages,
        reason: payload.reason,
      })
      db.prepare(
        `UPDATE memory_jobs
         SET status = 'done',
             candidate_count = ?,
             completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         WHERE id = ?`
      ).run(cheapResult.candidateCount, prepared.jobId)
      logMemoryJob('done_cheap', {
        jobId: prepared.jobId,
        sessionId: payload.sessionId,
        reason: payload.reason,
        factCount: cheapResult.factCount,
        observationCount: cheapResult.observationCount,
        candidateCount: cheapResult.candidateCount,
        ruleCount: cheapResult.ruleCount,
        evolutionTrigger: cheapResult.gate.trigger,
      })
      return {
        status: 'done',
        candidateCount: cheapResult.candidateCount,
        jobId: prepared.jobId,
        messageHash: prepared.messageHash,
      }
    }

    const candidates = await extractMemoryCandidatesWithLlm({
      sessionId: payload.sessionId,
      workspacePath: payload.workspacePath,
      messages: filteredMessages,
      reason: payload.reason,
    })
    const evolutionResult = await runEvolution({
      projectId: payload.projectId,
      sessionId: payload.sessionId,
      workspacePath: payload.workspacePath,
      messages: filteredMessages,
      reason: payload.reason,
    })
    const totalCandidateCount = candidates.length + evolutionResult.candidateCount
    db.prepare(
      `UPDATE memory_jobs
       SET status = 'done',
           candidate_count = ?,
           completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ?`
    ).run(totalCandidateCount, prepared.jobId)
    logMemoryJob('done', {
      jobId: prepared.jobId,
      sessionId: payload.sessionId,
      reason: payload.reason,
      candidateCount: totalCandidateCount,
      memoryCandidateCount: candidates.length,
      evolutionCandidateCount: evolutionResult.candidateCount,
      evolutionRuleCount: evolutionResult.ruleCount,
      evolutionTrigger: evolutionResult.gate.trigger,
    })
    return {
      status: 'done',
      candidateCount: totalCandidateCount,
      jobId: prepared.jobId,
      messageHash: prepared.messageHash,
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    db.prepare(
      `UPDATE memory_jobs
       SET status = 'failed',
           error = ?,
           completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ?`
    ).run(error.slice(0, 1000), prepared.jobId)
    logger.error('memory.job.failed', err, {
      jobId: prepared.jobId,
      sessionId: payload.sessionId,
      reason: payload.reason,
    })
    return {
      status: 'failed',
      candidateCount: 0,
      jobId: prepared.jobId,
      messageHash: prepared.messageHash,
      error,
    }
  }
}

export function runMemoryExtractionJobDetached(payload: MemoryJobPayload) {
  setTimeout(() => {
    runMemoryExtractionJob(payload).catch(err => {
      logger.error('memory.job.detached_failed', err, {
        sessionId: payload.sessionId,
        reason: payload.reason,
      })
    })
  }, 0)
}

export function loadRecentSessionMessages(params: {
  sessionId: string
  contextVersion: number
  limit?: number
}): MemoryJobMessage[] {
  const db = getDb()
  const rows = db.prepare(
    `SELECT role, content FROM messages
     WHERE session_id = ? AND context_version = ?
     ORDER BY created_at DESC
     LIMIT ?`
  ).all(params.sessionId, params.contextVersion, params.limit || 10) as Array<{ role: 'user' | 'assistant'; content: string }>

  return rows.reverse().map(row => ({
    role: row.role,
    text: messageContentToText(row.content),
  })).filter(message => message.text.trim().length > 0)
}

export function readLatestMemoryJob(params: {
  sessionId?: string
  workspacePath?: string
}): {
  id: string
  sessionId: string
  reason: string
  status: string
  candidateCount: number
  error: string
  startedAt: string
  completedAt: string | null
} | null {
  const db = getDb()
  const where: string[] = []
  const values: string[] = []
  if (params.sessionId) {
    where.push('session_id = ?')
    values.push(params.sessionId)
  }
  if (params.workspacePath) {
    where.push('workspace_path = ?')
    values.push(params.workspacePath)
  }
  if (where.length === 0) return null
  const row = db.prepare(
    `SELECT id,
            session_id AS sessionId,
            reason,
            status,
            candidate_count AS candidateCount,
            error,
            started_at AS startedAt,
            completed_at AS completedAt
     FROM memory_jobs
     WHERE ${where.join(' AND ')}
     ORDER BY started_at DESC
     LIMIT 1`
  ).get(...values) as {
    id: string
    sessionId: string
    reason: string
    status: string
    candidateCount: number
    error: string
    startedAt: string
    completedAt: string | null
  } | undefined
  return row || null
}
