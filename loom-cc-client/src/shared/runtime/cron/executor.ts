/**
 * Scheduled task executor.
 * Creates a persistent session and runs the task's prompt via the SDK.
 */

import crypto from 'crypto'
import { getDb } from '@/shared/db/db'
import { createLoomQuery } from '@/shared/runtime/sdk/client'
import { MessageMapper } from '@/shared/runtime/sdk/message-mapper'
import { logger } from '@/shared/logging/logger'
import { parseTaskSkillNames } from '@/shared/runtime/cron/task-skills'
import { publishProjectEvent } from '@/shared/runtime/session-events'
import { registerActiveRun } from '@/shared/runtime/active-runs'

interface RawTask {
  id: string
  project_id: string
  name: string
  description: string   // 任务说明，用户填写，也是发给 AI 的内容
  prompt: string        // legacy stored skill content when selected; otherwise task text
  agent_name: string
  skill_name: string
  model: string
}

interface RawProject {
  id: string
  workspace_path: string
  default_model: string
}

export async function executeTask(task: RawTask): Promise<{ status: 'ok' | 'error'; result: string; sessionId: string }> {
  const db = getDb()

  const project = db.prepare(
    'SELECT id, workspace_path, default_model FROM projects WHERE id = ?'
  ).get(task.project_id) as RawProject | undefined

  if (!project) {
    return { status: 'error', result: 'Project not found', sessionId: '' }
  }

  const sessionId = crypto.randomUUID()
  const runtimeSessionId = crypto.randomUUID()
  const model = task.model || project.default_model || 'claude-sonnet-4-6'
  const sessionTitle = `[Scheduled] ${task.name}`

  // Pre-create the session so it appears in the chat list
  db.prepare(
    `INSERT INTO sessions (id, project_id, title, model, runtime_session_id, status)
     VALUES (?, ?, ?, ?, ?, 'active')`
  ).run(sessionId, task.project_id, sessionTitle, model, runtimeSessionId)

  // displayPrompt: what is shown in the chat UI as the user message
  // Always prefer task.description (the human-readable task instruction filled by user).
  // Fall back to task.prompt only when description is missing (legacy tasks without the column).
  // If a skill is selected and description is empty, task.prompt may be legacy skill content; don't show that.
  const skillNames = parseTaskSkillNames(task.skill_name)
  const hasSkill = skillNames.length > 0
  const agentName = task.agent_name?.trim() || ''
  const displayPrompt = task.description?.trim()
    || (hasSkill ? task.name : task.prompt?.trim())
    || task.name

  // effectivePrompt: sent to SDK. Selected skills are passed through
  // options.skills so multi-skill tasks are handled by the Claude Agent SDK.
  const taskDesc = task.description?.trim() || (!hasSkill ? task.prompt?.trim() : '') || ''
  const effectivePrompt = taskDesc || task.name

  logger.info('cron.task_prepare_prompt', {
    taskId: task.id,
    projectId: task.project_id,
    taskName: task.name,
    sessionId,
    model,
    hasSkill,
    agentName: agentName || undefined,
    descriptionChars: task.description?.length ?? 0,
    taskDescriptionChars: taskDesc.length,
    effectivePromptChars: effectivePrompt.length,
    enabledSkills: hasSkill ? skillNames : [],
  })

  const userMsgId = crypto.randomUUID()
  db.prepare(
    `INSERT INTO messages (id, session_id, context_version, role, content)
     VALUES (?, ?, 0, 'user', ?)`
  ).run(userMsgId, sessionId, JSON.stringify([{ type: 'text', text: displayPrompt }]))

  let resultText = ''
  let status: 'ok' | 'error' = 'ok'
  const abortController = new AbortController()
  const unregisterActiveRun = registerActiveRun(sessionId, abortController)
  publishProjectEvent(task.project_id, {
    type: 'session_run_started',
    source: 'schedule',
    projectId: task.project_id,
    sessionId,
    startedAt: new Date().toISOString(),
  })

  try {
    const q = createLoomQuery({
      prompt: effectivePrompt,
      sessionId: runtimeSessionId,
      loomSessionId: sessionId,
      model,
      bypassPermissions: true,
      resumeSession: false,
      projectWorkspacePath: project.workspace_path,
      agentName: agentName || undefined,
      enabledSkills: hasSkill ? skillNames : undefined,
      abortController,
    })

    const mapper = new MessageMapper()
    const textParts: string[] = []

    for await (const msg of q) {
      const events = mapper.mapMessage(msg)
      for (const ev of events) {
        if (ev.type === 'text_delta' && typeof ev.text === 'string') {
          textParts.push(ev.text)
        }
      }
    }

    resultText = textParts.join('').trim()
  } catch (err) {
    status = 'error'
    resultText = err instanceof Error ? err.message : String(err)
    logger.error('cron.task_failed', err, {
      taskId: task.id,
      projectId: task.project_id,
      taskName: task.name,
      sessionId,
      model,
    })
  } finally {
    unregisterActiveRun()
    publishProjectEvent(task.project_id, {
      type: 'session_run_finished',
      source: 'schedule',
      projectId: task.project_id,
      sessionId,
      finishedAt: new Date().toISOString(),
    })
  }

  // Persist assistant message
  const assistantMsgId = crypto.randomUUID()
  db.prepare(
    `INSERT INTO messages (id, session_id, context_version, role, content,
       input_tokens, output_tokens, elapsed_seconds)
     VALUES (?, ?, 0, 'assistant', ?, 0, 0, 0)`
  ).run(
    assistantMsgId,
    sessionId,
    JSON.stringify([{ type: 'text', text: resultText || '(no output)' }])
  )

  // Update session timestamps
  db.prepare(
    `UPDATE sessions SET last_message_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
     WHERE id = ?`
  ).run(sessionId)

  // Update task's last_run fields
  const preview = resultText.slice(0, 200)
  db.prepare(
    `UPDATE scheduled_tasks
     SET last_run_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), last_run_result = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
     WHERE id = ?`
  ).run(preview, task.id)

  // Record execution history
  const execId = crypto.randomUUID()
  db.prepare(
    `INSERT INTO task_executions (id, task_id, session_id, status, result)
     VALUES (?, ?, ?, ?, ?)`
  ).run(execId, task.id, sessionId, status, preview)

  return { status, result: preview, sessionId }
}
