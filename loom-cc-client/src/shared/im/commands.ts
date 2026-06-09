import type { ImChannelAdapter } from './adapters/base'
import type { ImChannelRow, ImCommand, IncomingImMessage } from './types'
import { ImChannelRouter } from './channel-router'

const KNOWN_COMMANDS = new Set([
  'help',
  'status',
  'projects',
  'switch',
  'new',
  'sessions',
  'bind',
  'stop',
])

export function parseImCommand(text: string): ImCommand | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null
  const [namePart, ...args] = trimmed.slice(1).split(/\s+/)
  const name = namePart.toLowerCase()
  if (!name) return null
  return { name, args }
}

export function checkUnknownImCommand(text: string): string | null {
  const command = parseImCommand(text)
  if (!command || KNOWN_COMMANDS.has(command.name)) return null
  return `未知命令：/${command.name}\n输入 /help 查看可用命令。`
}

export async function executeImCommand(params: {
  command: ImCommand
  message: IncomingImMessage
  channel: ImChannelRow
  router: ImChannelRouter
  adapter: ImChannelAdapter
  stopActiveTask: (sessionKey: string) => boolean
}): Promise<string> {
  const { command, message, channel, router, stopActiveTask } = params

  switch (command.name) {
    case 'help':
      return [
        'Loom Feishu 命令',
        '/status - 查看当前绑定',
        '/new - 在当前项目创建新会话',
        '/sessions - 列出最近会话',
        '/bind <会话ID前缀> - 绑定已有会话',
        '/stop - 停止当前运行任务',
        '这个 Feishu Bot 固定绑定当前 Loom 项目。',
      ].join('\n')

    case 'status': {
      const binding = router.getBinding(message.channelId, message.chatId)
      if (!binding) return '当前聊天还没有绑定会话。下一条普通消息会自动创建。'
      return [
        '当前 Feishu 绑定',
        `聊天：${message.chatName || message.chatId}`,
        `项目：${String(binding.project_name || binding.project_id || '-')}`,
        `会话：${String(binding.session_title || binding.session_id || '-')}`,
        `权限：${channel.permission_mode}`,
      ].join('\n')
    }

    case 'projects': {
      const project = router.resolveSession(message, channel)
      return `当前 Bot 固定绑定项目：${project.projectName}`
    }

    case 'switch': {
      const project = router.resolveSession(message, channel)
      return `这个 Feishu Bot 已固定到项目：${project.projectName}。如需连接其他项目，请在对应项目的 IM Channels 中配置另一个 Bot。`
    }

    case 'new': {
      const resolution = router.createNewSession(message, channel)
      return `已创建新会话：${resolution.sessionId.slice(0, 8)}\n项目：${resolution.projectName}`
    }

    case 'sessions': {
      const binding = router.getBinding(message.channelId, message.chatId)
      const projectId = typeof binding?.project_id === 'string' ? binding.project_id : undefined
      const sessions = router.listRecentSessions(10, projectId)
      if (sessions.length === 0) return '暂无最近会话。'
      return [
        '最近会话',
        ...sessions.map((session, index) => `${index + 1}. ${session.title} (${session.id.slice(0, 8)}) - ${session.project_name}`),
        '使用 /bind <会话ID前缀> 绑定。',
      ].join('\n')
    }

    case 'bind': {
      const prefix = command.args[0]?.trim()
      if (!prefix) return '用法：/bind <会话ID前缀>'
      try {
        const { session, project } = router.bindSession(
          message.channelId,
          message.chatId,
          message.chatName || '',
          prefix,
        )
        return `已绑定会话：${session.title} (${session.id.slice(0, 8)})\n项目：${project.name}`
      } catch (err) {
        return err instanceof Error ? err.message : '绑定失败'
      }
    }

    case 'stop': {
      const key = `${message.channelId}:${message.chatId}`
      return stopActiveTask(key) ? '正在停止当前任务...' : '当前没有运行中的任务。'
    }

    default:
      return `未知命令：/${command.name}\n输入 /help 查看可用命令。`
  }
}
