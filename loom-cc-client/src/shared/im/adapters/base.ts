import type { ImPermissionRequest, IncomingImMessage, OutgoingImMessage } from '../types'

export abstract class ImChannelAdapter {
  abstract start(config: Record<string, unknown>): Promise<void>
  abstract stop(): Promise<void>
  abstract isRunning(): boolean
  abstract consumeOne(signal: AbortSignal): Promise<IncomingImMessage | null>
  abstract send(message: OutgoingImMessage): Promise<string | undefined>
  abstract sendImage(chatId: string, buffer: Buffer, filename: string, mimeType: string, caption?: string): Promise<void>
  abstract sendFile(chatId: string, buffer: Buffer, filename: string, caption?: string): Promise<void>
  abstract sendTyping(chatId: string): Promise<void>
  abstract sendPermissionPrompt(request: ImPermissionRequest): Promise<void>
  abstract onPermissionResponse(callback: (requestId: string, decision: 'allow' | 'deny') => void): void
  abstract validateConfig(config: Record<string, unknown>): { valid: boolean; error?: string }
}
