import type { ImChannelRow, IncomingImMessage } from './types'
import { parseJsonStringArray } from './json'

export type ImPolicyResult =
  | { allowed: true }
  | { allowed: false; reason: string }

export function checkImPolicy(channel: ImChannelRow, message: IncomingImMessage): ImPolicyResult {
  if (channel.enabled !== 1) {
    return { allowed: false, reason: '通道未启用' }
  }

  if (message.isDm) {
    if (channel.dm_policy === 'disabled') {
      return { allowed: false, reason: '私聊已关闭' }
    }
    if (channel.dm_policy === 'allowlist') {
      const allowlist = parseJsonStringArray(channel.sender_whitelist)
      if (!allowlist.includes(message.senderId)) {
        return { allowed: false, reason: '发送者不在私聊白名单' }
      }
    }
    return { allowed: true }
  }

  if (channel.group_policy === 'disabled') {
    return { allowed: false, reason: '群聊已关闭' }
  }

  if (channel.group_policy === 'allowlist') {
    const allowlist = parseJsonStringArray(channel.group_whitelist)
    if (!allowlist.includes(message.chatId)) {
      return { allowed: false, reason: '群聊不在白名单' }
    }
  }

  if ((channel.group_policy === 'mention' || channel.trigger_mode === 'mention') && !message.isGroupMention) {
    return { allowed: false, reason: '群聊消息未提及机器人' }
  }

  return { allowed: true }
}
