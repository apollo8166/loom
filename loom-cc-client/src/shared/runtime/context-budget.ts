import fs from 'node:fs'
import type { LoomAttachment } from '@/shared/runtime/sdk/client'
import { TEXT_ATTACHMENT_MAX_CHARS } from '@/shared/runtime/sdk/client'
import type { LoomMemoryContext } from '@/shared/memory/types'
import { messageContentToText } from '@/shared/memory/session-messages'

export const FALLBACK_HISTORY_MAX_MESSAGES = 20
export const FALLBACK_HISTORY_MAX_CHARS = 40_000
export const STORED_TOOL_RESULT_MAX_CHARS = 3_000

export interface ContextBudgetPart {
  key: string
  label: string
  chars?: number
  count?: number
  truncated?: boolean
  metadata?: Record<string, unknown>
}

export interface ContextBudgetSnapshot {
  traceId: string
  sessionId: string
  contextVersion: number
  providerId: string
  model: string
  resolvedModelId: string
  resumeSession: boolean
  parts: ContextBudgetPart[]
  actual?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
}

export function summarizeAttachments(attachments: Array<LoomAttachment & { originalFilename?: string }>) {
  const tiers = attachments.reduce<Record<string, number>>((acc, attachment) => {
    acc[attachment.tier] = (acc[attachment.tier] || 0) + 1
    return acc
  }, {})
  const items = attachments.slice(0, 20).map(attachment => {
    let bytes = 0
    let textChars = 0
    let truncated = false
    try {
      const stat = fs.statSync(attachment.serverPath)
      bytes = stat.size
      if (attachment.tier === 'text') {
        const content = fs.readFileSync(attachment.serverPath, 'utf-8')
        textChars = content.length
        truncated = content.length > TEXT_ATTACHMENT_MAX_CHARS
      }
    } catch {
      // Attachment read failures are handled by the SDK client; this summary is diagnostic only.
    }
    return {
      name: attachment.name,
      tier: attachment.tier,
      mimeType: attachment.mimeType,
      bytes,
      textChars: attachment.tier === 'text' ? textChars : undefined,
      injectedChars: attachment.tier === 'text' ? Math.min(textChars, TEXT_ATTACHMENT_MAX_CHARS) : undefined,
      truncated,
    }
  })
  return {
    count: attachments.length,
    tiers,
    names: attachments.slice(0, 8).map(attachment => attachment.name),
    items,
    policy: {
      textAttachmentMaxChars: TEXT_ATTACHMENT_MAX_CHARS,
      imageHandling: 'sent as SDK image block',
      pdfHandling: 'sent as SDK document block',
      binaryHandling: 'sent as text placeholder',
    },
  }
}

export function summarizeMemoryContext(memoryContext: LoomMemoryContext | null): ContextBudgetPart {
  const debug = memoryContext?.debug
  return {
    key: 'memory',
    label: debug?.managedBySdk ? 'Memory 文件 / SDK 托管' : 'Memory 注入',
    chars: debug?.injectedChars ?? 0,
    count: (debug?.retrievedCount ?? 0) + (debug?.semanticMemoryCount ?? 0) + (debug?.recentObservationCount ?? 0) + (debug?.activeRuleCount ?? 0),
    truncated: debug?.truncated ?? false,
    metadata: {
      budgetChars: debug?.budgetChars ?? 0,
      globalSummaryChars: debug?.globalSummaryChars ?? 0,
      projectSummaryChars: debug?.projectSummaryChars ?? 0,
      evolutionChars: debug?.evolutionChars ?? 0,
      retrievedChars: debug?.retrievedChars ?? 0,
      rawRetrievedCount: debug?.rawRetrievedCount ?? 0,
      semanticMemoryCount: debug?.semanticMemoryCount ?? 0,
      recentObservationCount: debug?.recentObservationCount ?? 0,
      activeRuleCount: debug?.activeRuleCount ?? 0,
      dossierVersion: debug?.dossierVersion,
      managedBySdk: debug?.managedBySdk ?? false,
      globalMemoryFile: debug?.globalMemoryFile,
      projectMemoryFile: debug?.projectMemoryFile,
    },
  }
}

export function buildFallbackHistory(params: {
  currentMessage: string
  recentMessages: Array<{ role: string; content: string }>
}) {
  const selected: Array<{ role: string; content: string; chars: number }> = []
  let usedChars = 0
  const tail = params.recentMessages.slice(-FALLBACK_HISTORY_MAX_MESSAGES).reverse()

  for (const message of tail) {
    const text = messageContentToText(message.content).trim()
    if (!text) continue
    const role = message.role === 'user' ? 'Human' : 'Assistant'
    let content = text
    const remaining = FALLBACK_HISTORY_MAX_CHARS - usedChars
    if (remaining <= 0) break
    if (content.length > remaining) {
      const marker = '\n\n[... history truncated]'
      content = remaining > marker.length
        ? `${content.slice(0, remaining - marker.length)}${marker}`
        : content.slice(0, remaining)
    }
    selected.push({ role, content, chars: content.length })
    usedChars += content.length
  }

  const ordered = selected.reverse()
  const history = ordered.map(message => `${message.role}: ${message.content}`).join('\n\n')
  return {
    prompt: history
      ? `<conversation_history>\n${history}\n</conversation_history>\n\n${params.currentMessage}`
      : params.currentMessage,
    historyChars: history.length,
    selectedMessageCount: ordered.length,
    totalMessageCount: params.recentMessages.length,
    truncated: params.recentMessages.length > ordered.length || usedChars >= FALLBACK_HISTORY_MAX_CHARS,
    policy: {
      maxMessages: FALLBACK_HISTORY_MAX_MESSAGES,
      maxChars: FALLBACK_HISTORY_MAX_CHARS,
    },
  }
}

export function summarizeToolResultStorage(blocks: Array<Record<string, unknown>>) {
  let toolResultCount = 0
  let rawToolResultCount = 0
  let originalChars = 0
  let storedChars = 0
  let truncatedCount = 0

  for (const block of blocks) {
    if (block.type === 'tool_raw_result') {
      rawToolResultCount += 1
      continue
    }
    if (block.type !== 'tool_result') continue
    toolResultCount += 1
    const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '')
    const chars = content.length
    originalChars += chars
    storedChars += Math.min(chars, STORED_TOOL_RESULT_MAX_CHARS)
    if (chars > STORED_TOOL_RESULT_MAX_CHARS) truncatedCount += 1
  }

  return {
    toolResultCount,
    rawToolResultCount,
    originalChars,
    storedChars,
    truncatedCount,
    policy: {
      storedToolResultMaxChars: STORED_TOOL_RESULT_MAX_CHARS,
      rawToolResultsStored: false,
    },
  }
}
