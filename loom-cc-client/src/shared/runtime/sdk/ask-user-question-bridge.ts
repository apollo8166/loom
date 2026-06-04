import crypto from 'crypto'
import type { HookCallback, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk'
import type { SseEvent } from '@/shared/runtime/sdk/message-mapper'
import { logger } from '@/shared/logging/logger'
import type { ConfirmationContentBlock } from '@/shared/runtime/confirmation-block-store'

export type AskUserQuestionStatus = 'submit' | 'cancel' | 'timeout'

export interface AskUserQuestionOption {
  label: string
  description: string
  preview?: string
}

export interface AskUserQuestionItem {
  question: string
  header: string
  options: AskUserQuestionOption[]
  multiSelect: boolean
}

export type AskUserQuestionAnswers = Record<string, string>
export type AskUserQuestionAnnotations = Record<string, { preview?: string; notes?: string }>

interface AskUserQuestionResponse {
  action: AskUserQuestionStatus
  answers?: AskUserQuestionAnswers
  annotations?: AskUserQuestionAnnotations
}

interface PendingAskUserQuestion {
  resolve: (response: AskUserQuestionResponse) => void
  sessionId: string
  questions: AskUserQuestionItem[]
  createdAt: number
  timer: ReturnType<typeof setTimeout>
  cleanup: () => void
}

type AskUserQuestionBlock = Extract<ConfirmationContentBlock, { type: 'ask_user_question' }>

interface AskUserQuestionPersistence {
  onAskUserQuestionRequest?: (block: AskUserQuestionBlock) => void | Promise<void>
  onAskUserQuestionResolved?: (requestId: string, response: AskUserQuestionResponse) => void | Promise<void>
}

const g = globalThis as unknown as {
  __loom_pendingAskUserQuestions?: Map<string, PendingAskUserQuestion>
}

if (!g.__loom_pendingAskUserQuestions) g.__loom_pendingAskUserQuestions = new Map()

const pendingAskUserQuestions = g.__loom_pendingAskUserQuestions

const ASK_USER_QUESTION_TIMEOUT_MS = 30 * 60 * 1000

export function createAskUserQuestionBridge(
  sessionId: string,
  emit: (event: SseEvent) => void | Promise<void>,
  persistence?: AskUserQuestionPersistence,
): HookCallback {
  return async (input, toolUseId, options): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'AskUserQuestion') {
      return { continue: true }
    }

    const toolInput = asRecord(input.tool_input)
    const questions = normalizeQuestions(toolInput.questions)
    if (questions.length === 0) {
      return { continue: true }
    }

    const requestId = crypto.randomUUID()
    const effectiveToolUseId = input.tool_use_id || toolUseId
    const requestBlock: AskUserQuestionBlock = {
      type: 'ask_user_question',
      requestId,
      toolUseId: effectiveToolUseId,
      questions,
      status: 'pending',
    }

    try {
      await Promise.resolve(persistence?.onAskUserQuestionRequest?.(requestBlock))
    } catch (err) {
      logger.warn('runtime.ask_user_question.persist_request_failed', {
        sessionId,
        requestId,
        toolUseId: effectiveToolUseId,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    try {
      await Promise.resolve(emit({
        ...requestBlock,
        type: 'ask_user_question_request',
      }))
    } catch (err) {
      logger.warn('runtime.ask_user_question.emit_failed', {
        sessionId,
        requestId,
        toolUseId: effectiveToolUseId,
        error: err instanceof Error ? err.message : String(err),
      })
      try {
        await Promise.resolve(persistence?.onAskUserQuestionResolved?.(requestId, {
          action: 'cancel',
          answers: {},
          annotations: {},
        }))
      } catch { /* best effort */ }
      return denyAskUserQuestion('无法显示桌面选择界面')
    }

    const response = await waitForResponse(requestId, sessionId, questions, options.signal)

    try {
      await Promise.resolve(persistence?.onAskUserQuestionResolved?.(requestId, response))
    } catch (err) {
      logger.warn('runtime.ask_user_question.persist_resolution_failed', {
        sessionId,
        requestId,
        toolUseId: effectiveToolUseId,
        action: response.action,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    try {
      await Promise.resolve(emit({
        type: 'ask_user_question_resolved',
        requestId,
        action: response.action,
        answers: response.answers ?? {},
        annotations: response.annotations ?? {},
      }))
    } catch {
      // Client may have disconnected.
    }

    if (response.action !== 'submit') {
      return denyAskUserQuestion(response.action === 'timeout' ? '用户未在限定时间内回答' : '用户取消了选择')
    }

    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: {
          ...toolInput,
          answers: response.answers ?? {},
          annotations: response.annotations ?? {},
        },
      },
    }
  }
}

function denyAskUserQuestion(reason: string): HookJSONOutput {
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }
}

function waitForResponse(
  requestId: string,
  sessionId: string,
  questions: AskUserQuestionItem[],
  signal: AbortSignal,
): Promise<AskUserQuestionResponse> {
  return new Promise<AskUserQuestionResponse>((resolve) => {
    let settled = false
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
      clearTimeout(timer)
    }
    const settle = (response: AskUserQuestionResponse) => {
      if (settled) return
      settled = true
      pendingAskUserQuestions.delete(requestId)
      cleanup()
      resolve(response)
    }
    const onAbort = () => settle({ action: 'cancel' })
    const timer = setTimeout(() => settle({ action: 'timeout' }), ASK_USER_QUESTION_TIMEOUT_MS)

    signal.addEventListener('abort', onAbort, { once: true })
    pendingAskUserQuestions.set(requestId, {
      resolve: settle,
      sessionId,
      questions,
      createdAt: Date.now(),
      timer,
      cleanup,
    })
  })
}

export function resolveAskUserQuestion(
  requestId: string,
  response: AskUserQuestionResponse,
): boolean {
  const pending = pendingAskUserQuestions.get(requestId)
  if (!pending) return false
  pending.resolve({
    action: response.action,
    answers: response.answers ?? {},
    annotations: response.annotations ?? {},
  })
  return true
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function normalizeQuestions(value: unknown): AskUserQuestionItem[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const raw = asRecord(item)
      const options = normalizeOptions(raw.options)
      const question = String(raw.question || '').trim()
      const header = String(raw.header || '').trim()
      if (!question || options.length < 2) return null
      return {
        question,
        header: header || '问题',
        options,
        multiSelect: Boolean(raw.multiSelect),
      }
    })
    .filter((item): item is AskUserQuestionItem => item !== null)
    .slice(0, 4)
}

function normalizeOptions(value: unknown): AskUserQuestionOption[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const raw = asRecord(item)
      const label = String(raw.label || '').trim()
      const description = String(raw.description || '').trim()
      if (!label) return null
      return {
        label,
        description,
        ...(typeof raw.preview === 'string' && raw.preview.trim() ? { preview: raw.preview } : {}),
      }
    })
    .filter((item): item is AskUserQuestionOption => item !== null)
    .slice(0, 4)
}

export { ASK_USER_QUESTION_TIMEOUT_MS }
