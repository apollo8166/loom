import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { getDb } from '@/shared/db/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/projects/:id/schedules/:scheduleId/execute — manual trigger
 *
 * Creates a session (no user message inserted yet), then emits `session_created`
 * with `displayPrompt` and `effectivePrompt`.
 *
 * The client reads the event, navigates to the session, then calls
 * POST /api/runtime/chat with {sessionId, message: effectivePrompt, displayContent: displayPrompt}
 * which inserts the user message properly and starts real-time streaming —
 * identical to a regular chat session.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; scheduleId: string }> },
) {
  const { id, scheduleId } = await params
  const db = getDb()

  const taskRow = db.prepare(
    'SELECT * FROM scheduled_tasks WHERE id = ? AND project_id = ?'
  ).get(scheduleId, id) as {
    id: string; project_id: string; name: string
    description: string; prompt: string; skill_name: string; model: string
  } | undefined

  if (!taskRow) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  const project = db.prepare(
    'SELECT id, workspace_path, default_model FROM projects WHERE id = ?'
  ).get(taskRow.project_id) as {
    id: string; workspace_path: string; default_model: string
  } | undefined

  if (!project) {
    return new Response(JSON.stringify({ error: 'Project not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  const sessionId = crypto.randomUUID()
  const runtimeSessionId = crypto.randomUUID()
  const model = taskRow.model || project.default_model || 'claude-sonnet-4-6'
  const sessionTitle = `[Scheduled] ${taskRow.name}`

  // Create session only — no user message inserted here.
  // The client will call /api/runtime/chat to insert the message and stream.
  db.prepare(
    `INSERT INTO sessions (id, project_id, title, model, runtime_session_id, status)
     VALUES (?, ?, ?, ?, ?, 'active')`
  ).run(sessionId, taskRow.project_id, sessionTitle, model, runtimeSessionId)

  const hasSkill = !!(taskRow.skill_name && taskRow.prompt)

  // displayPrompt: shown in chat UI — always the task description (human-readable)
  const displayPrompt = taskRow.description?.trim()
    || (hasSkill ? taskRow.name : taskRow.prompt?.trim())
    || taskRow.name

  // effectivePrompt: sent to SDK. For skill tasks, keep the native slash-style
  // invocation; WorkbenchView will pass the skill name separately via options.skills.
  const taskDesc = taskRow.description?.trim()
    || (!hasSkill ? taskRow.prompt?.trim() : '')
    || ''
  const effectivePrompt = hasSkill
    ? `/${taskRow.skill_name.trim()} ${taskDesc}`.trim()
    : taskDesc

  // Record execution immediately so it appears in history
  const execId = crypto.randomUUID()
  db.prepare(
    `INSERT INTO task_executions (id, task_id, session_id, status, result) VALUES (?, ?, ?, 'ok', '')`
  ).run(execId, scheduleId, sessionId)

  // Update task last_run_at
  db.prepare(
    `UPDATE scheduled_tasks SET last_run_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
  ).run(scheduleId)

  return new Response(
    `data: ${JSON.stringify({
      type: 'session_created',
      sessionId,
      execId,
      displayPrompt,
      effectivePrompt,
      enabledSkills: hasSkill ? [taskRow.skill_name.trim()] : undefined,
    })}\n\n`,
    {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    }
  )
}
