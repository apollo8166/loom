import { ImChannelAdapter } from './base'
import type { ImPermissionRequest, IncomingImMessage, OutgoingImMessage } from '../types'
import { asString } from '../json'

type LarkModule = Record<string, any>

async function loadLarkSdk(): Promise<LarkModule> {
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<LarkModule>
    return await dynamicImport('@larksuiteoapi/node-sdk')
  } catch {
    throw new Error('缺少 @larksuiteoapi/node-sdk，请先安装依赖后再连接飞书。')
  }
}

export class FeishuImAdapter extends ImChannelAdapter {
  private Lark: LarkModule | null = null
  private client: any = null
  private wsClient: any = null
  private running = false
  private stopped = false
  private appId = ''
  private appSecret = ''
  private platform: 'feishu' | 'lark' = 'feishu'
  private botIds = new Set<string>()
  private queue: IncomingImMessage[] = []
  private waiter: ((message: IncomingImMessage | null) => void) | null = null
  private permissionCallback: ((requestId: string, decision: 'allow' | 'deny') => void) | null = null
  private pendingPermissionByChat = new Map<string, { requestId: string; senderId: string }>()
  private seenMessageIds = new Set<string>()
  private seenMessageTimer: ReturnType<typeof setTimeout> | null = null

  validateConfig(config: Record<string, unknown>) {
    if (!asString(config.app_id).trim()) return { valid: false, error: 'App ID 不能为空' }
    if (!asString(config.app_secret).trim()) return { valid: false, error: 'App Secret 不能为空' }
    return { valid: true }
  }

  async start(config: Record<string, unknown>): Promise<void> {
    const validation = this.validateConfig(config)
    if (!validation.valid) throw new Error(validation.error)

    this.Lark = await loadLarkSdk()
    this.stopped = false
    this.appId = asString(config.app_id).trim()
    this.appSecret = asString(config.app_secret).trim()
    this.platform = asString(config.platform) === 'lark' ? 'lark' : 'feishu'

    const domain = this.platform === 'lark' ? this.Lark.Domain.Lark : this.Lark.Domain.Feishu
    const sdkConfig = {
      appId: this.appId,
      appSecret: this.appSecret,
      domain,
      appType: this.Lark.AppType.SelfBuild,
    }

    this.client = new this.Lark.Client(sdkConfig)
    await this.fetchBotInfo()

    const dispatcher = new this.Lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: unknown) => {
        await this.handleIncomingMessage(data)
      },
    })

    this.wsClient = new this.Lark.WSClient({
      ...sdkConfig,
      loggerLevel: this.Lark.LoggerLevel.info,
      autoReconnect: false,
    })
    await this.wsClient.start({ eventDispatcher: dispatcher })
    this.running = true
  }

  async stop(): Promise<void> {
    this.running = false
    this.stopped = true
    if (this.wsClient) {
      try { this.wsClient.close({ force: true }) } catch { /* ignore */ }
      this.wsClient = null
    }
    this.client = null
    this.queue = []
    this.botIds.clear()
    this.pendingPermissionByChat.clear()
    this.seenMessageIds.clear()
    if (this.seenMessageTimer) {
      clearTimeout(this.seenMessageTimer)
      this.seenMessageTimer = null
    }
    if (this.waiter) {
      this.waiter(null)
      this.waiter = null
    }
  }

  isRunning(): boolean {
    return this.running
  }

  async consumeOne(signal: AbortSignal): Promise<IncomingImMessage | null> {
    if (this.queue.length > 0) return this.queue.shift()!
    if (signal.aborted) return null

    return new Promise(resolve => {
      const onAbort = () => {
        this.waiter = null
        resolve(null)
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.waiter = (message) => {
        signal.removeEventListener('abort', onAbort)
        this.waiter = null
        resolve(message)
      }
    })
  }

  async send(message: OutgoingImMessage): Promise<string | undefined> {
    if (!this.client) throw new Error('Feishu client not initialized')
    const text = sanitizeFeishuText(message.text)

    if (message.deleteMessageId) {
      try {
        await this.client.im.message.delete({ path: { message_id: message.deleteMessageId } })
      } catch { /* ignore */ }
      return undefined
    }

    if (message.editMessageId) {
      try {
        await this.client.im.message.update({
          path: { message_id: message.editMessageId },
          data: { msg_type: 'text', content: JSON.stringify({ text }) },
        })
        return message.editMessageId
      } catch {
        // Feishu editing can fail; fall through to a new message.
      }
    }

    const res = await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: message.chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
    })
    return res.data?.message_id
  }

  async sendImage(chatId: string, buffer: Buffer, filename: string, mimeType: string, caption?: string): Promise<void> {
    if (!this.client) {
      await this.send({ chatId, text: caption ? `[Image] ${caption}` : '[Image]' })
      return
    }

    try {
      const token = await this.getTenantAccessToken()
      const formData = new FormData()
      formData.append('image_type', 'message')
      formData.append('image', new Blob([new Uint8Array(buffer)], { type: mimeType || 'application/octet-stream' }), filename || 'image')

      const uploadRes = await fetch(`${this.getApiBase()}/im/v1/images`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      const uploadData = await uploadRes.json() as { data?: { image_key?: string }; msg?: string; code?: number }
      const imageKey = uploadData.data?.image_key
      if (!imageKey) throw new Error(uploadData.msg || `Feishu image upload failed (${uploadData.code ?? uploadRes.status})`)

      await this.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'image',
          content: JSON.stringify({ image_key: imageKey }),
        },
      })
      // Feishu image messages do not support caption text. Keep this image-only so
      // Loom file paths never leak back as a follow-up text fallback.
    } catch (err) {
      throw new Error(`飞书图片发送失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async sendFile(chatId: string, buffer: Buffer, filename: string, caption?: string): Promise<void> {
    if (!this.client) {
      await this.send({ chatId, text: caption ? `File: ${filename}\n${caption}` : `File: ${filename}` })
      return
    }

    try {
      const token = await this.getTenantAccessToken()
      const formData = new FormData()
      formData.append('file_type', 'stream')
      formData.append('file_name', filename)
      formData.append('file', new Blob([new Uint8Array(buffer)]), filename)

      const uploadRes = await fetch(`${this.getApiBase()}/im/v1/files`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      const uploadData = await uploadRes.json() as { data?: { file_key?: string }; msg?: string; code?: number }
      const fileKey = uploadData.data?.file_key
      if (!fileKey) throw new Error(uploadData.msg || `Feishu file upload failed (${uploadData.code ?? uploadRes.status})`)

      await this.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'file',
          content: JSON.stringify({ file_key: fileKey }),
        },
      })
      if (caption) await this.send({ chatId, text: caption })
    } catch (err) {
      throw new Error(`飞书文件发送失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async sendTyping(chatId: string): Promise<void> {
    await this.send({ chatId, text: '正在处理...' })
  }

  async sendPermissionPrompt(request: ImPermissionRequest): Promise<void> {
    const shortId = request.requestId.slice(0, 8)
    this.pendingPermissionByChat.set(request.chatId, { requestId: request.requestId, senderId: request.senderId })
    await this.send({
      chatId: request.chatId,
      text: [
        `需要权限：${request.toolName}`,
        `回复“允许 ${shortId}”或“拒绝 ${shortId}”。也支持 allow/deny。`,
      ].join('\n'),
    })
  }

  onPermissionResponse(callback: (requestId: string, decision: 'allow' | 'deny') => void): void {
    this.permissionCallback = callback
  }

  private enqueue(message: IncomingImMessage) {
    if (this.waiter) {
      const waiter = this.waiter
      this.waiter = null
      waiter(message)
      return
    }
    this.queue.push(message)
  }

  private async fetchBotInfo() {
    this.botIds.clear()
    if (!this.client) return
    try {
      const res = await this.client.authen.userInfo.get()
      const data = res?.data ?? {}
      for (const key of ['open_id', 'user_id', 'union_id', 'bot_id']) {
        if (typeof data[key] === 'string' && data[key]) this.botIds.add(data[key])
      }
    } catch {
      // Mention detection still works for DMs and basic group events.
    }
  }

  private markSeen(messageId: string): boolean {
    if (!messageId) return false
    if (this.seenMessageIds.has(messageId)) return true
    this.seenMessageIds.add(messageId)
    if (!this.seenMessageTimer) {
      this.seenMessageTimer = setTimeout(() => {
        this.seenMessageIds.clear()
        this.seenMessageTimer = null
      }, 300_000)
    }
    return false
  }

  private isBotMentioned(mentions: unknown): boolean {
    if (!Array.isArray(mentions)) return false
    return mentions.some(mention => {
      const id = (mention as any)?.id
      return Boolean(
        this.botIds.has(asString(id?.open_id)) ||
        this.botIds.has(asString(id?.user_id)) ||
        this.botIds.has(asString(id?.union_id)),
      )
    })
  }

  private async handlePermissionText(chatId: string, senderId: string, text: string): Promise<boolean> {
    const match = /^(allow|approve|yes|y|deny|no|n|允许|同意|通过|拒绝|不允许|否)(?:\s+([a-zA-Z0-9-]{4,}))?$/iu.exec(text.trim())
    if (!match) return false
    const positive = new Set(['allow', 'approve', 'yes', 'y', '允许', '同意', '通过'])
    const pending = this.pendingPermissionByChat.get(chatId)
    if (!pending || pending.senderId !== senderId || (match[2] && !pending.requestId.startsWith(match[2]))) {
      await this.send({ chatId, text: '当前没有匹配的权限请求，可能已经超时。' }).catch(() => {})
      return true
    }
    this.pendingPermissionByChat.delete(chatId)
    this.permissionCallback?.(pending.requestId, positive.has(match[1].toLowerCase()) ? 'allow' : 'deny')
    return true
  }

  private async handleIncomingMessage(event: any) {
    if (this.stopped) return
    const message = event?.message
    const sender = event?.sender
    if (!message || !sender) return

    const chatId = asString(message.chat_id)
    const chatType = asString(message.chat_type)
    const messageId = asString(message.message_id)
    const senderId = asString(sender.sender_id?.open_id)
    const senderName = asString(sender.sender_id?.user_id) || senderId || 'User'
    const senderType = asString(sender.sender_type)
    const messageType = asString(message.message_type)

    if (!chatId || senderType === 'app' || (senderId && this.botIds.has(senderId))) return
    if (messageId && this.markSeen(messageId)) return

    const isDm = chatType === 'p2p'
    const isGroupMention = isDm ? false : this.isBotMentioned(message.mentions)

    if (messageType === 'image') {
      try {
        const content = JSON.parse(message.content || '{}') as { image_key?: string }
        if (!content.image_key || !messageId) return
        const data = await this.downloadFeishuResource(messageId, content.image_key, 'image')
        this.enqueue({
          channelType: 'feishu',
          channelId: 'feishu',
          chatId,
          messageId,
          senderId,
          senderName,
          text: '',
          isDm,
          isGroupMention,
          images: [{ data, mimeType: 'image/png', name: 'image.png' }],
          rawEvent: event,
        })
      } catch {
        await this.send({ chatId, text: '图片下载失败，请重试。' }).catch(() => {})
      }
      return
    }

    if (messageType === 'file') {
      try {
        const content = JSON.parse(message.content || '{}') as { file_key?: string; file_name?: string }
        if (!content.file_key || !messageId) return
        const data = await this.downloadFeishuResource(messageId, content.file_key, 'file')
        this.enqueue({
          channelType: 'feishu',
          channelId: 'feishu',
          chatId,
          messageId,
          senderId,
          senderName,
          text: '',
          isDm,
          isGroupMention,
          files: [{
            data,
            name: content.file_name || 'file',
            mimeType: 'application/octet-stream',
            size: data.length,
          }],
          rawEvent: event,
        })
      } catch {
        await this.send({ chatId, text: '文件下载失败，请重试。' }).catch(() => {})
      }
      return
    }

    if (messageType === 'text') {
      let text = ''
      try {
        const content = JSON.parse(message.content || '{}') as { text?: string }
        text = content.text ?? ''
      } catch {
        text = asString(message.content)
      }
      text = text.replace(/<at[^>]*>.*?<\/at>/g, '').trim()
      if (!text) return
      if (await this.handlePermissionText(chatId, senderId, text)) return
      this.enqueue({
        channelType: 'feishu',
        channelId: 'feishu',
        chatId,
        messageId,
        senderId,
        senderName,
        text,
        isDm,
        isGroupMention,
        rawEvent: event,
      })
      return
    }

    await this.send({ chatId, text: '暂不支持该消息类型，请发送文字、图片或文件。' }).catch(() => {})
  }

  private getApiBase(): string {
    return this.platform === 'lark'
      ? 'https://open.larksuite.com/open-apis'
      : 'https://open.feishu.cn/open-apis'
  }

  private async getTenantAccessToken(): Promise<string> {
    const res = await fetch(`${this.getApiBase()}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
      signal: AbortSignal.timeout(10_000),
    })
    const data = await res.json() as { tenant_access_token?: string; msg?: string }
    if (!data.tenant_access_token) {
      throw new Error(data.msg || 'No Feishu tenant access token')
    }
    return data.tenant_access_token
  }

  private async downloadFeishuResource(messageId: string, fileKey: string, type: 'image' | 'file'): Promise<Buffer> {
    const token = await this.getTenantAccessToken()
    const res = await fetch(`${this.getApiBase()}/im/v1/messages/${messageId}/resources/${fileKey}?type=${type}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`Feishu resource download failed: ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }
}

function sanitizeFeishuText(text: string): string {
  return (text || '')
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
