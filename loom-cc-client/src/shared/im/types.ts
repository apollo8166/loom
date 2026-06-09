export type ImChannelType = 'feishu'
export type ImBridgeStatus = 'connected' | 'connecting' | 'disconnected' | 'not_configured' | 'error'
export type ImDmPolicy = 'open' | 'allowlist' | 'disabled'
export type ImGroupPolicy = 'mention' | 'open' | 'allowlist' | 'disabled'
export type ImTriggerMode = 'mention' | 'all'
export type ImPermissionMode = 'confirm' | 'read-only' | 'full'

export interface ImChannelRow {
  id: string
  type: ImChannelType
  project_id: string
  enabled: number
  status: ImBridgeStatus
  credentials: string
  dm_policy: ImDmPolicy
  group_policy: ImGroupPolicy
  trigger_mode: ImTriggerMode
  sender_whitelist: string
  group_whitelist: string
  default_model: string
  permission_mode: ImPermissionMode
  last_connected_at: string | null
  last_error: string
  created_at: string
  updated_at: string
}

export interface ImChannelBindingRow {
  id: string
  channel_id: string
  chat_id: string
  chat_name: string
  project_id: string
  session_id: string
  created_at: string
  updated_at: string
  project_name?: string
  session_title?: string
}

export interface IncomingImMessage {
  channelType: ImChannelType
  channelId: string
  chatId: string
  chatName?: string
  messageId?: string
  senderId: string
  senderName: string
  text: string
  isDm: boolean
  isGroupMention: boolean
  images?: Array<{ data: Buffer; mimeType: string; name: string }>
  files?: Array<{ data: Buffer; name: string; mimeType: string; size: number }>
  rawEvent?: unknown
}

export interface OutgoingImMessage {
  chatId: string
  text: string
  editMessageId?: string
  deleteMessageId?: string
}

export interface ImPermissionRequest {
  requestId: string
  channelId: string
  chatId: string
  senderId: string
  sessionId: string
  toolName: string
  toolInput: Record<string, unknown>
}

export interface ImCommand {
  name: string
  args: string[]
}

export interface ImSessionResolution {
  projectId: string
  projectName: string
  sessionId: string
  runtimeSessionId: string
  model: string
  title: string
  workspacePath: string
  isNew: boolean
}

export interface ImConversationResult {
  text: string
  toolsUsed: string[]
  blocks: Record<string, unknown>[]
  assistantMessageId: string
  inputTokens: number
  outputTokens: number
  elapsedMs: number
}

export interface ImOutboundAttachment {
  filePath: string
  name: string
  mimeType: string
  size: number
  isImage: boolean
}

export interface ImConversationCallbacks {
  onTyping: () => Promise<void>
  onDraft?: (partialText: string) => Promise<void>
  onFinal: (text: string) => Promise<void>
  onAttachments?: (attachments: ImOutboundAttachment[]) => Promise<void>
  onPermissionRequest: (request: ImPermissionRequest) => Promise<'allow' | 'deny'>
  abortSignal?: AbortSignal
}
