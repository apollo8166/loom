import { getDb } from '@/shared/db/db'
import { getUploadsDir } from '@/shared/db/paths'
import { GLOBAL_CHAT_PROJECT_ID } from '@/shared/db/db'
import { getGlobalChatWorkspaceDir } from '@/shared/db/paths'
import crypto from 'crypto'
import path from 'path'
import { createLoomQuery } from '@/shared/runtime/sdk/client'
import type { LoomAttachment } from '@/shared/runtime/sdk/client'
import { MessageMapper } from '@/shared/runtime/sdk/message-mapper'
import type { SseEvent } from '@/shared/runtime/sdk/message-mapper'
import { createPermissionBridge, createAcceptEditsCanUseTool, cleanupStaleSessionAllowances } from '@/shared/runtime/sdk/permission-bridge'
import { createAskUserQuestionBridge } from '@/shared/runtime/sdk/ask-user-question-bridge'
import type { Query } from '@anthropic-ai/claude-agent-sdk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function parsePathList(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return [...new Set(parsed.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map(p => p.trim()))]
    }
  } catch { /* legacy single path */ }
  return [value]
}

function resolveSessionWorkspaces(session: {
  project_id: string
  workspace_path: string | null
  attached_folder_paths: string | null
  project_workspace_path: string | null
}) {
  const legacyWorkspacePaths = parsePathList(session.workspace_path)
  const workspacePath = session.workspace_path?.trim().startsWith('[')
    ? legacyWorkspacePaths[0] ?? null
    : session.workspace_path?.trim() || null
  const primaryWorkspacePath = workspacePath
    || session.project_workspace_path?.trim()
    || (session.project_id === GLOBAL_CHAT_PROJECT_ID ? getGlobalChatWorkspaceDir() : null)
  const attachedFolderPaths = session.workspace_path?.trim().startsWith('[')
    ? [...legacyWorkspacePaths.slice(1), ...parsePathList(session.attached_folder_paths)]
    : parsePathList(session.attached_folder_paths)

  return {
    primaryWorkspacePath,
    attachedFolderPaths: [...new Set(attachedFolderPaths.filter(p => p !== primaryWorkspacePath))],
  }
}

function withAdditionalWorkspaceContext(prompt: string, attachedFolderPaths: string[]): string {
  if (attachedFolderPaths.length === 0) return prompt
  return `<additional_workspaces>\n${attachedFolderPaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n</additional_workspaces>\n\n${prompt}`
}

function isSdkSkillCommand(prompt: string, enabledSkills?: string[]): boolean {
  if (!enabledSkills || enabledSkills.length === 0) return false
  const firstLine = prompt.trimStart().split(/\r?\n/, 1)[0]?.trim() || ''
  if (!firstLine.startsWith('/')) return false
  const commandName = firstLine.slice(1).split(/\s+/, 1)[0]?.trim()
  return Boolean(commandName && enabledSkills.includes(commandName))
}

/**
 * POST /api/chat — compatibility shell for old clients
 *
 * Accepts conversationId (project ID), resolves to the latest active session,
 * then delegates to the same logic as /api/runtime/chat
 */
export async function POST(req: Request) {
  let body: {
    sessionId?: string
    conversationId?: string
    message?: string
    permissionMode?: string
    thinkingMode?: string
    planMode?: boolean
    enabledSkills?: string[]
    attachments?: Array<{ name: string; filename: string; mimeType: string; tier: string; originalFilename?: string; displayFilename?: string; displayMimeType?: string; readable?: boolean; extractError?: string; placeholder?: string }>
  }
  try {
    body = await req.json()
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const db = getDb()

  // Resolve sessionId from conversationId if needed
  let sessionId = body.sessionId
  if (!sessionId && body.conversationId) {
    const session = db.prepare(
      `SELECT s.id FROM sessions s
       WHERE s.project_id = ? AND s.status = 'active'
       ORDER BY s.last_message_at DESC, s.updated_at DESC
       LIMIT 1`
    ).get(body.conversationId) as { id: string } | undefined
    if (!session) {
      return jsonError('No active session for this project', 404)
    }
    sessionId = session.id
  }

  if (!sessionId) {
    return jsonError('sessionId or conversationId required', 400)
  }

  // Delegate to runtime/chat logic inline (avoid internal fetch for SSE streaming)
  const { message } = body

  const uploadsDir = getUploadsDir()
  const attachments: Array<LoomAttachment & { originalFilename?: string; displayFilename?: string; displayMimeType?: string }> = (body.attachments || []).map(a => {
    const safeFilename = a.filename.replace(/\.\./g, '').replace(/[/\\]/g, '_')
    return {
      name: a.name,
      serverPath: path.join(uploadsDir, safeFilename),
      mimeType: a.mimeType,
      tier: a.tier as LoomAttachment['tier'],
      originalFilename: a.originalFilename?.replace(/\.\./g, '').replace(/[/\\]/g, '_'),
      displayFilename: a.displayFilename?.replace(/\.\./g, '').replace(/[/\\]/g, '_'),
      displayMimeType: a.displayMimeType,
      readable: a.readable,
      extractError: a.extractError,
      placeholder: a.placeholder,
    }
  })

  const unreadablePdf = attachments.find(a => a.tier === 'pdf' && a.readable === false)
  if (unreadablePdf) {
    return jsonError(`${unreadablePdf.name} 当前无法提取可读文字，请换成可复制文字的 PDF，或先转成 txt/docx 后再发送。`, 400)
  }

  if (!message && attachments.length === 0) {
    return jsonError('message (or attachments) required', 400)
  }

  // Get session with effective workspace path. Project sessions inherit the
  // project workspace; standalone Chat sessions store their workspace on session.
  const session = db.prepare(
    `SELECT s.*, p.workspace_path AS project_workspace_path
     FROM sessions s
     JOIN projects p ON p.id = s.project_id
     WHERE s.id = ?`
  ).get(sessionId) as {
    id: string; model: string; project_id: string; context_version: number;
    runtime_session_id: string | null; workspace_path: string | null; attached_folder_paths: string | null; use_worktree: number; project_workspace_path: string | null;
  } | undefined
  if (!session) return jsonError('Session not found', 404)
  const { primaryWorkspacePath, attachedFolderPaths } = resolveSessionWorkspaces(session)
  if (!primaryWorkspacePath) return jsonError('workspacePath is required for this session', 400)

  const permissionMode = body.permissionMode || 'confirm'
  const thinkingMode = body.thinkingMode || 'auto'
  const planMode = body.planMode === true
  const enabledSkills = Array.isArray(body.enabledSkills)
    ? [...new Set(body.enabledSkills
        .filter((skill): skill is string => typeof skill === 'string')
        .map(skill => skill.replace(/^\//, '').trim())
        .filter(Boolean))]
    : undefined
  const sdkSkillCommand = isSdkSkillCommand(
    message || (attachments.length > 0 ? attachments.map(a => `[${a.name}]`).join(' ') : ''),
    enabledSkills,
  )
  const currentContextVersion = session.context_version

  const existingMsgCount = (db.prepare(
    'SELECT COUNT(*) as count FROM messages WHERE session_id = ? AND context_version = ?'
  ).get(sessionId, currentContextVersion) as { count: number }).count

  const STALE_MS = 2 * 3600 * 1000
  const lastMsgRow = existingMsgCount > 0
    ? db.prepare(
        'SELECT created_at FROM messages WHERE session_id = ? AND context_version = ? ORDER BY created_at DESC LIMIT 1'
      ).get(sessionId, currentContextVersion) as { created_at: string } | undefined
    : undefined
  const sessionAge = lastMsgRow ? Date.now() - new Date(lastMsgRow.created_at).getTime() : Infinity

  let effectiveMessage = message || (attachments.length > 0
    ? attachments.map(a => `[${a.name}]`).join(' ')
    : '')
  if (!sdkSkillCommand) {
    effectiveMessage = withAdditionalWorkspaceContext(effectiveMessage, attachedFolderPaths)
  }

  const userMsgBlocks: Array<Record<string, unknown>> = []
  if (message?.trim()) userMsgBlocks.push({ type: 'text', text: message.trim() })
  for (const a of attachments) {
    const fname = a.displayFilename || a.originalFilename || path.basename(a.serverPath)
    if (a.tier === 'image') {
      userMsgBlocks.push({ type: 'image_attachment', url: `/api/files/serve/${fname}`, name: a.name })
    } else {
      userMsgBlocks.push({
        type: 'file_attachment',
        url: `/api/files/serve/${fname}`,
        name: a.name,
        size: 0,
        mimeType: a.displayMimeType || a.mimeType,
        ...(a.originalFilename ? { originalFilename: a.originalFilename } : {}),
        ...(a.displayFilename ? { displayUrl: `/api/files/serve/${a.displayFilename}` } : {}),
        ...(a.displayMimeType ? { displayMimeType: a.displayMimeType } : {}),
      })
    }
  }
  if (userMsgBlocks.length === 0) userMsgBlocks.push({ type: 'text', text: effectiveMessage })

  const userMsgId = crypto.randomUUID()
  db.prepare(
    'INSERT INTO messages (id, session_id, context_version, role, content) VALUES (?, ?, ?, ?, ?)'
  ).run(userMsgId, sessionId, currentContextVersion, 'user', JSON.stringify(userMsgBlocks))

  cleanupStaleSessionAllowances()

  const encoder = new TextEncoder()
  const abortController = new AbortController()
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()

  const emit = async (data: Record<string, unknown>) => {
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
    } catch { /* writer closed */ }
  }

  ;(async () => {
    const requestStart = Date.now()
    let mapper = new MessageMapper()

    try {
      const permissionBridge = createPermissionBridge(sessionId!, emit as (event: SseEvent) => void)
      const canUseTool =
        permissionMode === 'confirm' || permissionMode === 'full'
          ? permissionBridge
          : permissionMode === 'accept_edits'
            ? createAcceptEditsCanUseTool(sessionId!, emit as (event: SseEvent) => void)
            : undefined
      const askUserQuestionHook = createAskUserQuestionBridge(sessionId!, emit as (event: SseEvent) => void)

      const runtimeSessionId = session.runtime_session_id || sessionId!
      const isResume = existingMsgCount > 0 && sessionAge < STALE_MS

      let promptForQuery = effectiveMessage
      if (!sdkSkillCommand && existingMsgCount === 0) {
        const prevBoundary = db.prepare(
          `SELECT summary FROM session_boundaries
           WHERE session_id = ? AND summary IS NOT NULL
           ORDER BY created_at DESC LIMIT 1`
        ).get(sessionId!) as { summary: string } | undefined
        if (prevBoundary?.summary) {
          promptForQuery = `<context_summary>\n${prevBoundary.summary}\n</context_summary>\n\n${promptForQuery}`
        }
      }

      let sessionInUseDetected = false
      const q = createLoomQuery({
        prompt: promptForQuery,
        sessionId: runtimeSessionId,
        loomSessionId: sessionId!,
        model: session.model,
        abortController,
        canUseTool,
        askUserQuestionHook,
        bypassPermissions: permissionMode === 'full' || permissionMode === 'plan',
        resumeSession: isResume,
        thinkingMode,
        attachments: attachments.length > 0 ? attachments : undefined,
        enabledSkills,
        additionalDirectories: attachedFolderPaths,
        planMode,
        useWorktree: session.use_worktree === 1,
        projectWorkspacePath: primaryWorkspacePath,
        onSessionInUse: () => { sessionInUseDetected = true },
      })

      let needsFallback = false
      try {
        await drainQuery(q, mapper, emit)
        if (sessionInUseDetected || (isResume && mapper.getBlocks().length === 0)) {
          needsFallback = true
        }
      } catch (queryErr) {
        const errMsg = queryErr instanceof Error ? queryErr.message : String(queryErr)
        const isSessionInUse = sessionInUseDetected || errMsg.includes('already in use')
        const isResumeFailure = isResume && mapper.getBlocks().length === 0
        if (!isResumeFailure && !isSessionInUse) throw queryErr
        needsFallback = true
      }

      if (needsFallback) {
        const recentMsgs = db
          .prepare('SELECT role, content FROM messages WHERE session_id = ? AND context_version = ? AND id != ? ORDER BY created_at ASC')
          .all(sessionId!, currentContextVersion, userMsgId) as Array<{ role: string; content: string }>
        const historyPrompt = sdkSkillCommand
          ? effectiveMessage
          : buildPromptWithHistory(effectiveMessage, recentMsgs)
        mapper = new MessageMapper()
        const retryQ = createLoomQuery({
          prompt: historyPrompt,
          sessionId: crypto.randomUUID(),
          loomSessionId: sessionId!,
          model: session.model,
          abortController,
          canUseTool,
          askUserQuestionHook,
          bypassPermissions: permissionMode === 'full' || permissionMode === 'plan',
          resumeSession: false,
          thinkingMode,
          attachments: attachments.length > 0 ? attachments : undefined,
          enabledSkills,
          additionalDirectories: attachedFolderPaths,
          planMode,
          useWorktree: session.use_worktree === 1,
          projectWorkspacePath: primaryWorkspacePath,
        })
        await drainQuery(retryQ, mapper, emit)
      }

      const blocks = mapper.getBlocks()
      const elapsedSeconds = Math.floor((Date.now() - requestStart) / 1000)

      const MAX_TOOL_CONTENT = 3000
      const storableBlocks = blocks.map((b: Record<string, unknown>) => {
        if (b.type === 'tool_raw_result') return null
        if (b.type === 'tool_result' && typeof b.content === 'string' && b.content.length > MAX_TOOL_CONTENT) {
          return { ...b, content: (b.content as string).slice(0, MAX_TOOL_CONTENT) + '\n[...truncated]' }
        }
        return b
      }).filter(Boolean)

      const assistantMsgId = crypto.randomUUID()
      db.prepare(
        'INSERT INTO messages (id, session_id, context_version, role, content, elapsed_seconds, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        assistantMsgId, sessionId!, currentContextVersion, 'assistant', JSON.stringify(storableBlocks),
        elapsedSeconds, mapper.inputTokens, mapper.outputTokens
      )

      const msgCount = db.prepare(
        'SELECT COUNT(*) as count FROM messages WHERE session_id = ? AND context_version = ?'
      ).get(sessionId!, currentContextVersion) as { count: number }
      const tsNow = `strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`
      if (msgCount.count <= 2) {
        const title = effectiveMessage.length > 50 ? effectiveMessage.slice(0, 47) + '...' : effectiveMessage
        db.prepare(`UPDATE sessions SET title = ?, updated_at = ${tsNow}, last_message_at = ${tsNow} WHERE id = ?`).run(title, sessionId!)
        db.prepare(`UPDATE projects SET name = ?, updated_at = ${tsNow}, last_opened_at = ${tsNow} WHERE id = ?`).run(title, session.project_id)
      } else {
        db.prepare(`UPDATE sessions SET updated_at = ${tsNow}, last_message_at = ${tsNow} WHERE id = ?`).run(sessionId!)
        db.prepare(`UPDATE projects SET updated_at = ${tsNow}, last_opened_at = ${tsNow} WHERE id = ?`).run(session.project_id)
      }

      await emit({
        type: 'done',
        messageId: assistantMsgId,
        userMessageId: userMsgId,
        inputTokens: mapper.inputTokens,
        outputTokens: mapper.outputTokens,
      })
    } catch (err) {
      const blocks = mapper.getBlocks()
      if (blocks.length > 0) {
        const assistantMsgId = crypto.randomUUID()
        db.prepare(
          'INSERT INTO messages (id, session_id, context_version, role, content) VALUES (?, ?, ?, ?, ?)'
        ).run(assistantMsgId, sessionId!, currentContextVersion, 'assistant', JSON.stringify(blocks))
      } else {
        db.prepare('DELETE FROM messages WHERE id = ?').run(userMsgId)
      }
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      await emit({ type: 'error', error: errorMessage })
    } finally {
      try { await writer.close() } catch { /* already closed */ }
    }
  })()

  req.signal.addEventListener('abort', () => {
    abortController.abort()
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

async function drainQuery(
  q: Query,
  mapper: MessageMapper,
  emit: (data: Record<string, unknown>) => void | Promise<void>,
) {
  for await (const msg of q) {
    const events = mapper.mapMessage(msg)
    for (const event of events) {
      await emit(event as Record<string, unknown>)
    }
  }
}

function buildPromptWithHistory(
  newMessage: string,
  recentMessages: Array<{ role: string; content: string }>,
): string {
  if (recentMessages.length === 0) return newMessage
  const history = recentMessages
    .slice(-20)
    .map(m => {
      const role = m.role === 'user' ? 'Human' : 'Assistant'
      let content = m.content
      if (content.startsWith('[{') || content.startsWith('[')) {
        try {
          const blocks = JSON.parse(content)
          content = blocks
            .filter((b: Record<string, unknown>) => b.type === 'text' && b.text)
            .map((b: Record<string, unknown>) => b.text)
            .join(' ')
          if (!content) content = '[tool usage]'
        } catch {
          content = content.slice(0, 200)
        }
      }
      return `${role}: ${content}`
    })
    .join('\n\n')
  return `<conversation_history>\n${history}\n</conversation_history>\n\n${newMessage}`
}

function jsonError(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
