import fs from 'node:fs'
import { getDb } from '@/shared/db/db'
import { logger } from '@/shared/logging/logger'
import type { ImChannelAdapter } from './adapters/base'
import { FeishuImAdapter } from './adapters/feishu'
import type { ImBridgeStatus, ImChannelRow, ImPermissionRequest, IncomingImMessage } from './types'
import { parseJsonObject } from './json'
import { checkImPolicy } from './policy'
import { markImMessageSeen } from './dedupe'
import { ImDeliveryLayer } from './delivery'
import { ImChannelRouter } from './channel-router'
import { ImConversationEngine } from './conversation-engine'
import { executeImCommand, parseImCommand, checkUnknownImCommand } from './commands'
import { logImAudit } from './audit'
import { publishSessionEvent } from '@/shared/runtime/session-events'

declare const globalThis: {
  __loomImBridgeManager?: ImBridgeManager
} & typeof global

class SessionLockManager {
  private tails = new Map<string, Promise<void>>()

  async acquire(key: string): Promise<() => void> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    let release!: () => void
    const next = new Promise<void>(resolve => { release = resolve })
    const current = previous.then(() => next)
    this.tails.set(key, current)
    await previous
    return () => {
      release()
      if (this.tails.get(key) === current) this.tails.delete(key)
    }
  }
}

class PermissionBroker {
  private pending = new Map<string, {
    channelId: string
    resolve: (decision: 'allow' | 'deny') => void
    timeout: ReturnType<typeof setTimeout>
  }>()

  async requestPermission(
    request: ImPermissionRequest,
    adapter: ImChannelAdapter,
  ): Promise<'allow' | 'deny'> {
    const db = getDb()
    db.prepare(
      `INSERT INTO im_permission_requests (id, channel_id, chat_id, sender_id, session_id, tool_name, tool_input)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      request.requestId,
      request.channelId,
      request.chatId,
      request.senderId,
      request.sessionId,
      request.toolName,
      JSON.stringify(request.toolInput),
    )

    await adapter.sendPermissionPrompt(request)

    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        this.pending.delete(request.requestId)
        this.updateRequest(request.requestId, 'timeout')
        resolve('deny')
      }, 120_000)
      this.pending.set(request.requestId, {
        channelId: request.channelId,
        resolve: decision => {
          clearTimeout(timeout)
          this.pending.delete(request.requestId)
          this.updateRequest(request.requestId, decision === 'allow' ? 'allowed' : 'denied')
          resolve(decision)
        },
        timeout,
      })
    })
  }

  resolvePermission(requestId: string, decision: 'allow' | 'deny') {
    this.pending.get(requestId)?.resolve(decision)
  }

  cleanupChannel(channelId: string) {
    for (const [requestId, pending] of this.pending) {
      if (pending.channelId !== channelId) continue
      clearTimeout(pending.timeout)
      pending.resolve('deny')
      this.pending.delete(requestId)
    }
  }

  private updateRequest(requestId: string, status: 'allowed' | 'denied' | 'timeout') {
    try {
      getDb().prepare(
        `UPDATE im_permission_requests
         SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         WHERE id = ?`,
      ).run(status, requestId)
    } catch {
      // ignore
    }
  }
}

export class ImBridgeManager {
  private adapters = new Map<string, ImChannelAdapter>()
  private pollControllers = new Map<string, AbortController>()
  private states = new Map<string, { channelId: string; status: ImBridgeStatus; error?: string }>()
  private starting = new Map<string, Promise<void>>()
  private router = new ImChannelRouter()
  private engine = new ImConversationEngine()
  private delivery = new ImDeliveryLayer()
  private locks = new SessionLockManager()
  private permissionBroker = new PermissionBroker()
  private activeTasks = new Map<string, AbortController>()
  private activeSdkCalls = 0
  private sdkWaiters: Array<() => void> = []
  private reconnectAttempts = new Map<string, number>()
  private readonly maxConcurrentSdkCalls = 3

  async startAdapter(channelId = 'feishu'): Promise<void> {
    const existing = this.starting.get(channelId)
    if (existing) await existing.catch(() => {})
    const promise = this.doStartAdapter(channelId)
    this.starting.set(channelId, promise)
    try {
      await promise
    } finally {
      this.starting.delete(channelId)
    }
  }

  private async doStartAdapter(channelId: string) {
    if (this.adapters.has(channelId)) await this.stopAdapter(channelId)
    this.setState(channelId, 'connecting')
    this.updateChannelStatus(channelId, 'connecting', '')

    const channel = this.getChannel(channelId)
    if (!channel) throw new Error(`IM channel not found: ${channelId}`)
    const config = parseJsonObject(channel.credentials)
    const adapter = this.createAdapter(channel)
    const validation = adapter.validateConfig(config)
    if (!validation.valid) {
      this.setState(channelId, 'not_configured', validation.error)
      this.updateChannelStatus(channelId, 'not_configured', validation.error || '')
      throw new Error(validation.error)
    }

    adapter.onPermissionResponse((requestId, decision) => {
      this.permissionBroker.resolvePermission(requestId, decision)
    })

    try {
      await adapter.start(config)
      this.adapters.set(channelId, adapter)
      this.setState(channelId, 'connected')
      this.updateChannelStatus(channelId, 'connected', '')
      this.reconnectAttempts.delete(channelId)
      this.startPollLoop(channelId, adapter)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.setState(channelId, 'error', message)
      this.updateChannelStatus(channelId, 'error', message)
      throw err
    }
  }

  async stopAdapter(channelId = 'feishu'): Promise<void> {
    const controller = this.pollControllers.get(channelId)
    controller?.abort()
    this.pollControllers.delete(channelId)

    const adapter = this.adapters.get(channelId)
    if (adapter) {
      try { await adapter.stop() } catch (err) { logger.warn('im.adapter_stop_failed', { channelId, error: err instanceof Error ? err.message : String(err) }) }
      this.adapters.delete(channelId)
    }

    this.permissionBroker.cleanupChannel(channelId)
    this.setState(channelId, 'disconnected')
    this.updateChannelStatus(channelId, 'disconnected', '')
  }

  async autoReconnect() {
    const channels = getDb().prepare("SELECT id FROM im_channels WHERE enabled = 1 AND project_id != ''").all() as Array<{ id: string }>
    await Promise.allSettled(channels.map(channel => this.startAdapter(channel.id)))
  }

  getState(channelId = 'feishu') {
    const state = this.states.get(channelId)
    const channel = this.getChannel(channelId)
    return {
      channelId,
      status: state?.status ?? channel?.status ?? 'not_configured',
      error: state?.error ?? channel?.last_error ?? '',
      connected: this.adapters.get(channelId)?.isRunning() ?? false,
    }
  }

  isConnected(channelId = 'feishu') {
    return this.adapters.get(channelId)?.isRunning() ?? false
  }

  stopActiveTask(sessionKey: string): boolean {
    const controller = this.activeTasks.get(sessionKey)
    if (!controller) return false
    controller.abort()
    this.activeTasks.delete(sessionKey)
    return true
  }

  private startPollLoop(channelId: string, adapter: ImChannelAdapter) {
    const controller = new AbortController()
    this.pollControllers.set(channelId, controller)
    this.runPollLoop(channelId, adapter, controller.signal).catch(err => {
      logger.error('im.poll_loop_failed', err, { channelId })
    })
  }

  private async runPollLoop(channelId: string, adapter: ImChannelAdapter, signal: AbortSignal) {
    while (!signal.aborted) {
      try {
        const message = await adapter.consumeOne(signal)
        if (!message) {
          if (!adapter.isRunning() && !signal.aborted) await this.handleReconnect(channelId)
          continue
        }
        message.channelId = channelId
        if (markImMessageSeen(message)) continue
        this.processMessage(channelId, adapter, message).catch(err => {
          logger.error('im.message_process_failed', err, { channelId, chatId: message.chatId })
        })
      } catch (err) {
        if (signal.aborted) break
        logger.warn('im.poll_error', { channelId, error: err instanceof Error ? err.message : String(err) })
        if (!adapter.isRunning()) {
          await this.handleReconnect(channelId)
          return
        }
        await sleep(1000)
      }
    }
  }

  private async processMessage(channelId: string, adapter: ImChannelAdapter, message: IncomingImMessage) {
    const channel = this.getChannel(channelId)
    if (!channel) return

    const policy = checkImPolicy(channel, message)
    if (!policy.allowed) {
      logImAudit({
        channelId,
        chatId: message.chatId,
        action: 'policy_block',
        status: 'blocked',
        details: { reason: policy.reason },
      })
      return
    }

    const command = parseImCommand(message.text)
    if (command) {
      const response = await executeImCommand({
        command,
        message,
        channel,
        router: this.router,
        adapter,
        stopActiveTask: key => this.stopActiveTask(key),
      })
      await this.delivery.deliver(adapter, channelId, channel.type, message.chatId, response, { skipDedupe: true })
      return
    }

    const unknownCommand = checkUnknownImCommand(message.text)
    if (unknownCommand) {
      await this.delivery.deliver(adapter, channelId, channel.type, message.chatId, unknownCommand, { skipDedupe: true })
      return
    }

    const resolution = this.router.resolveSession(message, channel)
    const sessionKey = `${channelId}:${message.chatId}`
    const release = await this.locks.acquire(sessionKey)
    const taskAbort = new AbortController()
    let timeout: ReturnType<typeof setTimeout> | null = null
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        taskAbort.abort()
        reject(new Error('IM request timed out after 300 seconds'))
      }, 300_000)
    })
    this.activeTasks.set(sessionKey, taskAbort)

    try {
      let placeholderId: string | undefined
      const result = await Promise.race([
        this.withSdkBackpressure(() => this.engine.processMessage(message, channel, resolution, {
          onTyping: async () => {
            placeholderId = await this.delivery.deliver(adapter, channelId, channel.type, message.chatId, '正在处理...', { skipDedupe: true })
          },
          onDraft: async partialText => {
            if (!placeholderId) return
            const text = partialText.trim()
            if (!text) return
            await this.delivery.deliver(adapter, channelId, channel.type, message.chatId, text, {
              editMessageId: placeholderId,
              skipDedupe: true,
            })
          },
          onFinal: async text => {
            const sentId = await this.delivery.deliver(adapter, channelId, channel.type, message.chatId, text, {
              editMessageId: placeholderId,
              skipDedupe: true,
            })
            if (placeholderId && sentId && sentId !== placeholderId) {
              await this.delivery.deliver(adapter, channelId, channel.type, message.chatId, '', { deleteMessageId: placeholderId })
            }
          },
          onAttachments: async attachments => {
            for (const attachment of attachments) {
              try {
	                const buffer = fs.readFileSync(attachment.filePath)
	                if (attachment.isImage) {
	                  await this.delivery.deliverImage(adapter, channelId, channel.type, message.chatId, buffer, attachment.name, attachment.mimeType, attachment.name)
	                } else {
	                  await this.delivery.deliverFile(adapter, channelId, channel.type, message.chatId, buffer, attachment.name)
	                }
	              } catch (err) {
	                const reason = err instanceof Error ? err.message : String(err)
	                await this.delivery.deliver(adapter, channelId, channel.type, message.chatId, `附件发送失败：${attachment.name}\n${reason}`, { skipDedupe: true })
	              }
            }
          },
          onPermissionRequest: request => this.permissionBroker.requestPermission(request, adapter),
          abortSignal: taskAbort.signal,
        })),
        timeoutPromise,
      ])
      if (!result.text.trim()) {
        await this.delivery.deliver(adapter, channelId, channel.type, message.chatId, '(no text response)', { skipDedupe: true })
      }
      logImAudit({
        channelId,
        chatId: message.chatId,
        projectId: resolution.projectId,
        sessionId: resolution.sessionId,
        action: 'message_processed',
        details: { toolsUsed: result.toolsUsed },
      })
    } catch (err) {
      const isAbort = taskAbort.signal.aborted
      const text = isAbort ? '请求已取消或超时。' : `处理失败：${err instanceof Error ? err.message : String(err)}`
      publishSessionEvent(resolution.sessionId, {
        type: 'error',
        sessionId: resolution.sessionId,
        error: text,
        createdAt: new Date().toISOString(),
      })
      await this.delivery.deliver(adapter, channelId, channel.type, message.chatId, text, { skipDedupe: true })
      logImAudit({
        channelId,
        chatId: message.chatId,
        projectId: resolution.projectId,
        sessionId: resolution.sessionId,
        action: 'message_failed',
        status: 'error',
        details: { error: err instanceof Error ? err.message : String(err), aborted: isAbort },
      })
    } finally {
      if (timeout) clearTimeout(timeout)
      this.activeTasks.delete(sessionKey)
      release()
    }
  }

  private async withSdkBackpressure<T>(fn: () => Promise<T>): Promise<T> {
    while (this.activeSdkCalls >= this.maxConcurrentSdkCalls) {
      await new Promise<void>(resolve => this.sdkWaiters.push(resolve))
    }
    this.activeSdkCalls += 1
    try {
      return await fn()
    } finally {
      this.activeSdkCalls -= 1
      this.sdkWaiters.shift()?.()
    }
  }

  private async handleReconnect(channelId: string) {
    const channel = this.getChannel(channelId)
    if (!channel?.enabled) return
    const attempts = (this.reconnectAttempts.get(channelId) ?? 0) + 1
    this.reconnectAttempts.set(channelId, attempts)
    if (attempts > 5) {
      this.setState(channelId, 'error', '重连失败次数过多，已暂停自动重连。')
      this.updateChannelStatus(channelId, 'error', '重连失败次数过多，已暂停自动重连。')
      return
    }
    await sleep(Math.min(1000 * 2 ** (attempts - 1), 60_000))
    await this.startAdapter(channelId).catch(err => {
      logger.warn('im.reconnect_failed', { channelId, error: err instanceof Error ? err.message : String(err) })
    })
  }

  private createAdapter(channel: ImChannelRow): ImChannelAdapter {
    if (channel.type === 'feishu') return new FeishuImAdapter()
    throw new Error(`Unsupported IM channel type: ${channel.type}`)
  }

  private getChannel(channelId: string): ImChannelRow | undefined {
    return getDb().prepare('SELECT * FROM im_channels WHERE id = ?').get(channelId) as ImChannelRow | undefined
  }

  private setState(channelId: string, status: ImBridgeStatus, error?: string) {
    this.states.set(channelId, { channelId, status, error })
  }

  private updateChannelStatus(channelId: string, status: ImBridgeStatus, error: string) {
    const connectedAt = status === 'connected' ? ", last_connected_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')" : ''
    getDb().prepare(
      `UPDATE im_channels
       SET status = ?, last_error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')${connectedAt}
       WHERE id = ?`,
    ).run(status, error, channelId)
  }
}

export function getImBridgeManager(): ImBridgeManager {
  if (!globalThis.__loomImBridgeManager) {
    globalThis.__loomImBridgeManager = new ImBridgeManager()
  }
  return globalThis.__loomImBridgeManager
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
