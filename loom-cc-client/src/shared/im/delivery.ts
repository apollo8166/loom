import crypto from 'crypto'
import type { ImChannelAdapter } from './adapters/base'
import type { ImChannelType } from './types'
import { getDb } from '@/shared/db/db'
import { logImAudit } from './audit'

class TokenBucket {
  private tokens: number
  private lastRefill = Date.now()

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {
    this.tokens = capacity
  }

  async acquire(): Promise<void> {
    this.refill()
    if (this.tokens >= 1) {
      this.tokens -= 1
      return
    }
    const waitMs = Math.ceil(((1 - this.tokens) / this.refillPerSecond) * 1000)
    await sleep(waitMs)
    this.refill()
    this.tokens = Math.max(0, this.tokens - 1)
  }

  private refill() {
    const now = Date.now()
    const elapsedSeconds = (now - this.lastRefill) / 1000
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond)
    this.lastRefill = now
  }
}

const MAX_MESSAGE_LENGTH: Record<ImChannelType, number> = {
  feishu: 30_000,
}

export class ImDeliveryLayer {
  private rateLimiters = new Map<string, TokenBucket>()
  private lastDedupeCleanupAt = 0

  async deliver(
    adapter: ImChannelAdapter,
    channelId: string,
    channelType: ImChannelType,
    chatId: string,
    text: string,
    options?: { editMessageId?: string; deleteMessageId?: string; skipDedupe?: boolean },
  ): Promise<string | undefined> {
    if (options?.deleteMessageId) {
      await adapter.send({ chatId, text: '', deleteMessageId: options.deleteMessageId })
      logImAudit({ channelId, chatId, action: 'delete', details: { messageId: options.deleteMessageId } })
      return undefined
    }

    await this.acquireToken(channelType, chatId)

    const safeText = sanitizeOutboundText(text)

    if (options?.editMessageId) {
      try {
        const id = await adapter.send({ chatId, text: safeText, editMessageId: options.editMessageId })
        logImAudit({ channelId, chatId, action: 'edit', details: { messageId: options.editMessageId, length: safeText.length } })
        return id
      } catch {
        // Fall through to sending a new message.
      }
    }

    let lastId: string | undefined
    for (const chunk of chunkMessage(safeText || '(no output)', MAX_MESSAGE_LENGTH[channelType])) {
      if (!options?.skipDedupe && this.isDuplicate(channelId, chatId, chunk)) continue
      lastId = await retryWithBackoff(() => adapter.send({ chatId, text: chunk }))
      logImAudit({ channelId, chatId, action: 'send', details: { length: chunk.length, platformMessageId: lastId } })
    }
    return lastId
  }

  async deliverImage(
    adapter: ImChannelAdapter,
    channelId: string,
    channelType: ImChannelType,
    chatId: string,
    buffer: Buffer,
    filename: string,
    mimeType: string,
    caption?: string,
  ) {
    await this.acquireToken(channelType, chatId)
    await adapter.sendImage(chatId, buffer, filename, mimeType, caption)
    logImAudit({ channelId, chatId, action: 'send_image', details: { filename, mimeType, caption } })
  }

  async deliverFile(
    adapter: ImChannelAdapter,
    channelId: string,
    channelType: ImChannelType,
    chatId: string,
    buffer: Buffer,
    filename: string,
    caption?: string,
  ) {
    await this.acquireToken(channelType, chatId)
    await adapter.sendFile(chatId, buffer, filename, caption)
    logImAudit({ channelId, chatId, action: 'send_file', details: { filename, caption } })
  }

  private async acquireToken(channelType: ImChannelType, chatId: string) {
    const key = `${channelType}:${chatId}`
    let bucket = this.rateLimiters.get(key)
    if (!bucket) {
      bucket = new TokenBucket(5, 1 / 3)
      this.rateLimiters.set(key, bucket)
    }
    await bucket.acquire()
  }

  private isDuplicate(channelId: string, chatId: string, text: string): boolean {
    try {
      const db = getDb()
      const messageKey = `out:${crypto.createHash('sha256').update(`${channelId}:${chatId}:${text}`).digest('hex')}`
      const existing = db.prepare('SELECT message_key FROM im_message_dedupe WHERE message_key = ?').get(messageKey)
      if (existing) return true
      db.prepare(
        `INSERT OR IGNORE INTO im_message_dedupe (message_key, channel_id, chat_id)
         VALUES (?, ?, ?)`,
      ).run(messageKey, channelId, chatId)

      const now = Date.now()
      if (now - this.lastDedupeCleanupAt > 60_000) {
        this.lastDedupeCleanupAt = now
        db.prepare("DELETE FROM im_message_dedupe WHERE created_at < datetime('now', '-5 minutes')").run()
      }
    } catch {
      return false
    }
    return false
  }
}

function chunkMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining)
      break
    }
    let splitAt = remaining.lastIndexOf('\n', maxLength)
    if (splitAt < maxLength * 0.5) splitAt = maxLength
    chunks.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt).trimStart()
  }
  return chunks
}

async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt < maxRetries) await sleep(Math.min(1000 * 2 ** attempt, 8000))
    }
  }
  throw lastError
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function sanitizeOutboundText(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\(\s*(file:\/\/[\s\S]*?)\s*\)/g, (_match, label: string, rawUrl: string) => {
      return attachmentLabel(label, fileUrlBasename(rawUrl))
    })
    .replace(/!?\[([^\]]*)\]\(\s*(\/api\/local-files\/serve\?path=[^)]+)\s*\)/g, (_match, label: string, rawUrl: string) => {
      return attachmentLabel(label, localServeBasename(rawUrl))
    })
    .replace(/<file:\/\/([^>]+)>/g, (_match, rest: string) => fileUrlBasename(`file://${rest}`))
    .replace(/\bfile:\/\/[^\s<>)\]]+/g, rawUrl => fileUrlBasename(rawUrl))
    .replace(/\b\/api\/local-files\/serve\?path=[^\s<>)\]]+/g, rawUrl => localServeBasename(rawUrl))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function attachmentLabel(label: string, fallback: string): string {
  const clean = String(label || '').replace(/^\s*[^\w\u4e00-\u9fa5]*\s*/, '').trim()
  return clean || fallback || '附件'
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function fileUrlBasename(rawUrl: string): string {
  const normalized = rawUrl.trim().replace(/\s*\r?\n\s*/g, '')
  let filePath = normalized.replace(/^file:\/\//, '')
  try {
    filePath = new URL(normalized).pathname
  } catch {
    // Use fallback path above.
  }
  return basename(safeDecode(filePath))
}

function localServeBasename(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, 'http://loom.local')
    return basename(url.searchParams.get('path') || rawUrl)
  } catch {
    return basename(rawUrl)
  }
}

function basename(value: string): string {
  const cleaned = safeDecode(value).replace(/[\\/]+$/, '')
  return cleaned.split(/[\\/]/).filter(Boolean).pop() || cleaned || '附件'
}
