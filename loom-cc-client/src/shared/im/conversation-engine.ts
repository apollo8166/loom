import crypto from 'crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { CanUseTool, PermissionResult, PermissionUpdate, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { getDb } from '@/shared/db/db'
import { getUploadsDir } from '@/shared/db/paths'
import { createLoomQuery } from '@/shared/runtime/sdk/client'
import type { LoomAttachment } from '@/shared/runtime/sdk/client'
import { MessageMapper } from '@/shared/runtime/sdk/message-mapper'
import { publishProjectEvent, publishSessionEvent } from '@/shared/runtime/session-events'
import { registerActiveRun } from '@/shared/runtime/active-runs'
import type { ImChannelRow, ImConversationCallbacks, ImConversationResult, ImOutboundAttachment, ImSessionResolution, IncomingImMessage } from './types'

const WRITE_TOOL_NAMES = new Set(['Bash', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

export class ImConversationEngine {
  async processMessage(
    message: IncomingImMessage,
    channel: ImChannelRow,
    resolution: ImSessionResolution,
    callbacks: ImConversationCallbacks,
  ): Promise<ImConversationResult> {
    const db = getDb()
    const contextVersion = this.getContextVersion(resolution.sessionId)
    const attachments = this.persistAttachments(message)

    const userBlocks: Record<string, unknown>[] = []
    if (message.text) userBlocks.push({ type: 'text', text: message.text })
    for (const attachment of attachments) {
      if (attachment.tier === 'image') {
        userBlocks.push({ type: 'image_attachment', url: `/api/files/serve/${attachment.filename}`, name: attachment.name })
      } else {
        userBlocks.push({
          type: 'file_attachment',
          url: `/api/files/serve/${attachment.filename}`,
          name: attachment.name,
          size: attachment.size,
          mimeType: attachment.mimeType,
          originalFilename: attachment.name,
        })
      }
    }

    const userMessageId = crypto.randomUUID()
    db.prepare(
      `INSERT INTO messages (id, session_id, context_version, role, content)
       VALUES (?, ?, ?, 'user', ?)`,
    ).run(
      userMessageId,
      resolution.sessionId,
      contextVersion,
      JSON.stringify(userBlocks.length > 0 ? userBlocks : [{ type: 'text', text: message.text }]),
    )
    const model = channel.default_model || resolution.model || 'claude-sonnet-4-6'
    publishSessionEvent(resolution.sessionId, {
      type: 'im_user_message',
      messageId: userMessageId,
      sessionId: resolution.sessionId,
      contextVersion,
      blocks: userBlocks.length > 0 ? userBlocks : [{ type: 'text', text: message.text }],
      createdAt: new Date().toISOString(),
    })
    publishProjectEvent(resolution.projectId, {
      type: 'im_session_activity',
      source: 'feishu',
      projectId: resolution.projectId,
      sessionId: resolution.sessionId,
      runtimeSessionId: resolution.runtimeSessionId,
      title: resolution.title,
      model,
      workspacePath: resolution.workspacePath,
      isNew: resolution.isNew,
      messageId: userMessageId,
      chatId: message.chatId,
      chatName: message.chatName || '',
    })

    const existingMsgCount = (db.prepare(
      `SELECT COUNT(*) AS count FROM messages
       WHERE session_id = ? AND context_version = ?`,
    ).get(resolution.sessionId, contextVersion) as { count: number }).count
    const canUseTool = this.createCanUseTool(channel, message, resolution, callbacks)
    const localAbort = new AbortController()
    callbacks.abortSignal?.addEventListener('abort', () => localAbort.abort(), { once: true })
    const unregisterActiveRun = registerActiveRun(resolution.sessionId, localAbort)
    publishProjectEvent(resolution.projectId, {
      type: 'session_run_started',
      source: 'feishu',
      projectId: resolution.projectId,
      sessionId: resolution.sessionId,
      startedAt: new Date().toISOString(),
    })

    await callbacks.onTyping()

    let result: ImConversationResult
    let activeRuntimeSessionId = resolution.runtimeSessionId
    try {
      result = await this.runQuery({
        message,
        resolution,
        model,
        runtimeSessionId: activeRuntimeSessionId,
        resumeSession: existingMsgCount > 1,
        attachments,
        canUseTool,
        bypassPermissions: channel.permission_mode === 'full',
        abortController: localAbort,
        callbacks,
        userMessageId,
        contextVersion,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('already in use')) {
        publishSessionEvent(resolution.sessionId, { type: 'error', error: msg })
        throw err
      }
      activeRuntimeSessionId = crypto.randomUUID()
      result = await this.runQuery({
        message,
        resolution,
        model,
        runtimeSessionId: activeRuntimeSessionId,
        resumeSession: false,
        attachments,
        canUseTool,
        bypassPermissions: channel.permission_mode === 'full',
        abortController: localAbort,
        callbacks,
        userMessageId,
        contextVersion,
      })
    } finally {
      unregisterActiveRun()
      publishProjectEvent(resolution.projectId, {
        type: 'session_run_finished',
        source: 'feishu',
        projectId: resolution.projectId,
        sessionId: resolution.sessionId,
        finishedAt: new Date().toISOString(),
      })
    }

    const elapsedSeconds = Math.max(1, Math.ceil(result.elapsedMs / 1000))
    db.prepare(
      `INSERT INTO messages (id, session_id, context_version, role, content,
       input_tokens, output_tokens, elapsed_seconds)
       VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?)`,
    ).run(
      result.assistantMessageId,
      resolution.sessionId,
      contextVersion,
      JSON.stringify(result.blocks.length > 0 ? result.blocks : [{ type: 'text', text: result.text || '(no output)' }]),
      result.inputTokens,
      result.outputTokens,
      elapsedSeconds,
    )
    publishSessionEvent(resolution.sessionId, {
      type: 'done',
      messageId: result.assistantMessageId,
      userMessageId,
      elapsedSeconds,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    })

    const title = message.text.length > 50 ? `${message.text.slice(0, 47)}...` : message.text
    const messageCount = (db.prepare(
      'SELECT COUNT(*) AS count FROM messages WHERE session_id = ? AND context_version = ?',
    ).get(resolution.sessionId, contextVersion) as { count: number }).count

    if (messageCount <= 2 && title.trim()) {
      db.prepare(
        `UPDATE sessions
         SET title = ?, runtime_session_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
             last_message_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         WHERE id = ?`,
      ).run(`[Feishu] ${title}`, activeRuntimeSessionId, resolution.sessionId)
    } else {
      db.prepare(
        `UPDATE sessions
         SET runtime_session_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
             last_message_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         WHERE id = ?`,
      ).run(activeRuntimeSessionId, resolution.sessionId)
    }

    db.prepare(
      `UPDATE projects
       SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
           last_opened_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ?`,
    ).run(resolution.projectId)

    return result
  }

  private async runQuery(params: {
    message: IncomingImMessage
    resolution: ImSessionResolution
    model: string
    runtimeSessionId: string
    resumeSession: boolean
    attachments: Array<LoomAttachment & { filename: string; size: number }>
    canUseTool?: CanUseTool
    bypassPermissions: boolean
    abortController: AbortController
    callbacks: ImConversationCallbacks
    userMessageId: string
    contextVersion: number
  }): Promise<ImConversationResult> {
    const assistantMessageId = crypto.randomUUID()
    const startedAt = Date.now()
    publishSessionEvent(params.resolution.sessionId, {
      type: 'im_assistant_started',
      messageId: assistantMessageId,
      sessionId: params.resolution.sessionId,
      contextVersion: params.contextVersion,
      createdAt: new Date(startedAt).toISOString(),
    })

    const q = createLoomQuery({
      prompt: params.message.text || params.attachments.map(a => `[${a.name}]`).join(' '),
      sessionId: params.runtimeSessionId,
      model: params.model,
      projectWorkspacePath: params.resolution.workspacePath,
      attachments: params.attachments.length > 0 ? params.attachments : undefined,
      resumeSession: params.resumeSession,
      canUseTool: params.canUseTool,
      bypassPermissions: params.bypassPermissions,
      abortController: params.abortController,
    })

    const mapper = new MessageMapper()
    let responseText = ''
    let draftText = ''
    let lastDraftAt = 0
    const toolsUsed = new Set<string>()

    for await (const sdkMessage of q as AsyncIterable<SDKMessage>) {
      const events = mapper.mapMessage(sdkMessage)
      for (const event of events) {
        publishSessionEvent(params.resolution.sessionId, event as Record<string, unknown>)
        if (event.type === 'text_delta' && typeof event.text === 'string') {
          draftText += event.text
          const now = Date.now()
          if (params.callbacks.onDraft && now - lastDraftAt > 3000) {
            lastDraftAt = now
            const draftFiles = extractLinkedFilePathsFromText(draftText)
            await params.callbacks.onDraft(draftFiles.text || '正在处理附件...')
          }
        }
        if (event.type === 'tool_use' && typeof event.name === 'string') {
          toolsUsed.add(event.name)
        }
        if (event.type === 'error' && typeof event.error === 'string') {
          throw new Error(event.error)
        }
      }
      if (sdkMessage.type === 'assistant') {
        const textParts: string[] = []
        for (const block of sdkMessage.message.content) {
          if (block.type === 'text' && 'text' in block && typeof block.text === 'string') {
            textParts.push(block.text)
          }
        }
        responseText = textParts.join('')
        if (responseText) draftText = responseText
      }
    }

    const blocks = mapper.getBlocks()
    const rawText = extractTextFromBlocks(blocks) || responseText || draftText
    const { text, mediaPaths } = parseMediaProtocol(rawText)
    const linkedFiles = extractLinkedFilePathsFromText(text || rawText)
    await params.callbacks.onFinal(linkedFiles.text || buildAttachmentOnlyText(linkedFiles.filePaths, mediaPaths))

    const attachments = resolveFileAttachments(uniqueFilePaths([
      ...mediaPaths,
      ...linkedFiles.filePaths,
      ...extractFilePathsFromBlocks(blocks),
    ]))
    if (attachments.length > 0) {
      await params.callbacks.onAttachments?.(attachments)
    }

    return {
      text: linkedFiles.text || text || rawText || '',
      toolsUsed: [...toolsUsed],
      blocks,
      assistantMessageId,
      inputTokens: mapper.inputTokens,
      outputTokens: mapper.outputTokens,
      elapsedMs: Date.now() - startedAt,
    }
  }

  private createCanUseTool(
    channel: ImChannelRow,
    message: IncomingImMessage,
    resolution: ImSessionResolution,
    callbacks: ImConversationCallbacks,
  ): CanUseTool | undefined {
    return async (
      toolName: string,
      input: Record<string, unknown>,
      options: { signal: AbortSignal; suggestions?: PermissionUpdate[] },
    ): Promise<PermissionResult> => {
      if (channel.permission_mode === 'read-only') {
        if (WRITE_TOOL_NAMES.has(toolName)) {
          return { behavior: 'deny', message: `IM read-only mode denied ${toolName}` }
        }
        return {
          behavior: 'allow',
          updatedInput: input,
          updatedPermissions: options.suggestions,
        }
      }

      const requestId = crypto.randomUUID()
      const decision = await callbacks.onPermissionRequest({
        requestId,
        channelId: message.channelId,
        chatId: message.chatId,
        senderId: message.senderId,
        sessionId: resolution.sessionId,
        toolName,
        toolInput: input,
      })
      if (decision === 'allow') {
        return {
          behavior: 'allow',
          updatedInput: input,
          updatedPermissions: options.suggestions,
        }
      }
      return { behavior: 'deny', message: `Permission denied for ${toolName}` }
    }
  }

  private getContextVersion(sessionId: string): number {
    const row = getDb().prepare('SELECT context_version FROM sessions WHERE id = ?').get(sessionId) as { context_version: number } | undefined
    return row?.context_version ?? 0
  }

  private persistAttachments(message: IncomingImMessage): Array<LoomAttachment & { filename: string; size: number }> {
    const uploadsDir = getUploadsDir()
    const attachments: Array<LoomAttachment & { filename: string; size: number }> = []

    for (const image of message.images || []) {
      const ext = extensionForMime(image.mimeType, '.jpg')
      const filename = `im_${Date.now()}_${crypto.randomUUID().slice(0, 8)}${ext}`
      const serverPath = path.join(uploadsDir, filename)
      fs.writeFileSync(serverPath, image.data)
      attachments.push({ name: image.name || filename, filename, serverPath, mimeType: image.mimeType, tier: 'image', size: image.data.length })
    }

    for (const file of message.files || []) {
      const filename = `im_${Date.now()}_${sanitizeFilename(file.name)}`
      const serverPath = path.join(uploadsDir, filename)
      fs.writeFileSync(serverPath, file.data)
      attachments.push({
        name: file.name,
        filename,
        serverPath,
        mimeType: file.mimeType || 'application/octet-stream',
        tier: inferAttachmentTier(file.name, file.mimeType),
        size: file.size,
      })
    }

    return attachments
  }
}

function extractTextFromBlocks(blocks: Record<string, unknown>[]): string {
  return blocks
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => String(block.text))
    .join('')
}

function parseMediaProtocol(text: string): { text: string; mediaPaths: string[] } {
  const mediaPaths: string[] = []
  const lines: string[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('MEDIA:')) {
      const filePath = trimmed.slice('MEDIA:'.length).trim()
      if (filePath) mediaPaths.push(filePath)
    } else {
      lines.push(line)
    }
  }
  return { text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), mediaPaths }
}

function extractLinkedFilePathsFromText(text: string): { text: string; filePaths: string[] } {
  const filePaths = new Set<string>()
  let cleaned = text

  cleaned = cleaned.replace(/!?\[([^\]]*)\]\(\s*(file:\/\/[\s\S]*?)\s*\)/g, (_match, label: string, rawUrl: string) => {
    const filePath = fileUrlToPath(rawUrl)
    if (filePath) filePaths.add(filePath)
    return filePath ? attachmentTextLabel(label, filePath) : String(label || '').trim()
  })

  cleaned = cleaned.replace(/<file:\/\/([^>]+)>/g, (_match, rest: string) => {
    const rawUrl = `file://${rest}`
    const filePath = fileUrlToPath(rawUrl)
    if (filePath) filePaths.add(filePath)
    return filePath ? path.basename(filePath) : ''
  })

  cleaned = cleaned.replace(/!?\[([^\]]*)\]\((\/api\/local-files\/serve\?path=[^)]+)\)/g, (_match, label: string, rawUrl: string) => {
    const filePath = localServeUrlToPath(rawUrl)
    if (filePath) filePaths.add(filePath)
    return filePath ? attachmentTextLabel(label, filePath) : String(label || '').trim()
  })

  cleaned = cleaned.replace(/\b\/api\/local-files\/serve\?path=[^\s<>)\]]+/g, rawUrl => {
    const filePath = localServeUrlToPath(rawUrl)
    if (filePath) filePaths.add(filePath)
    return path.basename(filePath || rawUrl)
  })

  cleaned = cleaned.replace(/\bfile:\/\/[^\s<>)\]]+/g, rawUrl => {
    const filePath = fileUrlToPath(rawUrl)
    if (filePath) filePaths.add(filePath)
    return path.basename(filePath || rawUrl)
  })

  return {
    text: cleaned.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
    filePaths: [...filePaths],
  }
}

function normalizeFileUrlText(rawUrl: string): string {
  return rawUrl.trim().replace(/\s*\r?\n\s*/g, '')
}

function fileUrlToPath(rawUrl: string): string {
  const decode = (value: string) => {
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }
  const normalized = normalizeFileUrlText(rawUrl)
  try {
    return decode(new URL(normalized).pathname)
  } catch {
    return decode(normalized.replace(/^file:\/\//, ''))
  }
}

function localServeUrlToPath(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, 'http://loom.local')
    if (url.pathname !== '/api/local-files/serve') return ''
    return url.searchParams.get('path') || ''
  } catch {
    return ''
  }
}

function attachmentTextLabel(label: string, filePath: string): string {
  const clean = String(label || '').replace(/^\s*[^\w\u4e00-\u9fa5]*\s*/, '').trim()
  const basename = path.basename(filePath)
  if (!clean || clean === basename) return basename
  return clean
}

function buildAttachmentOnlyText(linkedPaths: string[], mediaPaths: string[]): string {
  const files = uniqueFilePaths([...linkedPaths, ...mediaPaths])
  if (files.length === 0) return '(no text response)'
  return files.length === 1
    ? `已发送附件：${path.basename(files[0])}`
    : `已发送 ${files.length} 个附件：\n${files.map(filePath => `- ${path.basename(filePath)}`).join('\n')}`
}

function extractFilePathsFromBlocks(blocks: Record<string, unknown>[]): string[] {
  const paths = new Set<string>()
  for (const block of blocks) {
    if (block.type !== 'tool_use' || !block.input || typeof block.input !== 'object') continue
    const input = block.input as Record<string, unknown>
    const name = String(block.name || '')
    if (name === 'Write' || name === 'Read') {
      const filePath = String(input.file_path || input.path || '')
      if (filePath) paths.add(filePath)
    }
    if (name === 'Bash') {
      const command = String(input.command || '')
      for (const pattern of [
        /curl\s+.*?-o\s+["']?(\S+?)["']?(?:\s|$)/g,
        /wget\s+.*?-O\s+["']?(\S+?)["']?(?:\s|$)/g,
        /\bcp\s+\S+\s+["']?(\S+?)["']?\s*$/gm,
        /\bmv\s+\S+\s+["']?(\S+?)["']?\s*$/gm,
      ]) {
        let match: RegExpExecArray | null
        while ((match = pattern.exec(command))) paths.add(match[1])
      }
    }
  }
  return [...paths]
}

function uniqueFilePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const filePath of paths) {
    if (!filePath || seen.has(filePath)) continue
    seen.add(filePath)
    unique.push(filePath)
  }
  return unique
}

function resolveFileAttachments(filePaths: string[]): ImOutboundAttachment[] {
  const attachments: ImOutboundAttachment[] = []
  const seen = new Set<string>()
  for (const rawPath of filePaths) {
    if (!rawPath || seen.has(rawPath)) continue
    seen.add(rawPath)
    try {
      if (!fs.existsSync(rawPath)) continue
      const stat = fs.statSync(rawPath)
      if (!stat.isFile() || stat.size <= 0 || stat.size > 20 * 1024 * 1024) continue
      const ext = path.extname(rawPath).toLowerCase()
      if (SKIP_OUTPUT_EXTS.has(ext)) continue
      attachments.push({
        filePath: rawPath,
        name: path.basename(rawPath),
        mimeType: MIME_BY_EXT[ext] || 'application/octet-stream',
        size: stat.size,
        isImage: IMAGE_EXTS.has(ext),
      })
    } catch {
      // Skip unreadable files.
    }
  }
  return attachments
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])
const SKIP_OUTPUT_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.cpp', '.c', '.h', '.lock', '.log', '.env'])
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
}

function inferAttachmentTier(name: string, mimeType: string): LoomAttachment['tier'] {
  const lower = name.toLowerCase()
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf'
  if (mimeType.startsWith('text/') || TEXT_EXTS.some(ext => lower.endsWith(ext))) return 'text'
  return 'binary'
}

const TEXT_EXTS = ['.txt', '.md', '.csv', '.json', '.yaml', '.yml', '.toml', '.xml', '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.sh', '.sql']

function extensionForMime(mimeType: string, fallback: string): string {
  if (mimeType === 'image/png') return '.png'
  if (mimeType === 'image/gif') return '.gif'
  if (mimeType === 'image/webp') return '.webp'
  if (mimeType === 'image/jpeg') return '.jpg'
  return fallback
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 90) || `${crypto.randomUUID()}.bin`
}
