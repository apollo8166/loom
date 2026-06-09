import crypto from 'crypto'
import { getDb } from '@/shared/db/db'
import type { IncomingImMessage } from './types'

let lastCleanupAt = 0

export function markImMessageSeen(message: IncomingImMessage): boolean {
  const sourceKey = message.messageId
    ? `${message.channelId}:${message.messageId}`
    : `${message.channelId}:${message.chatId}:${message.senderId}:${message.text}:${Date.now()}`
  const messageKey = crypto.createHash('sha256').update(sourceKey).digest('hex')

  try {
    const db = getDb()
    const existing = db.prepare('SELECT message_key FROM im_message_dedupe WHERE message_key = ?').get(messageKey)
    if (existing) return true

    db.prepare(
      `INSERT OR IGNORE INTO im_message_dedupe (message_key, channel_id, chat_id)
       VALUES (?, ?, ?)`,
    ).run(messageKey, message.channelId, message.chatId)

    const now = Date.now()
    if (now - lastCleanupAt > 60_000) {
      lastCleanupAt = now
      db.prepare("DELETE FROM im_message_dedupe WHERE created_at < datetime('now', '-1 day')").run()
    }
    return false
  } catch {
    return false
  }
}
