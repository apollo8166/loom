import { resolveProvider } from '@/shared/runtime/provider'
import { readClaudeMemory, writeMemoryCandidate } from './files'
import { findDuplicateMemoryCandidate } from './dedupe'
import type { MemoryCandidate, MemoryScope } from './types'
import { logger } from '@/shared/logging/logger'

type MemoryMessage = {
  role: 'user' | 'assistant'
  text: string
}

type ExtractedCandidate = {
  scope: MemoryScope
  type: MemoryCandidate['type']
  confidence: MemoryCandidate['confidence']
  content: string
  evidence?: string
}

type MemoryLogPayload = Record<string, unknown>

function logMemory(event: string, payload: MemoryLogPayload = {}) {
  logger.info(`memory.extract.${event}`, payload)
}

function safeUrl(value?: string): string {
  if (!value) return ''
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname === '/' ? '' : url.pathname}`
  } catch {
    return value.replace(/\/+$/, '')
  }
}

function preview(value: string, max = 120): string {
  return value.replace(/\s+/g, ' ').slice(0, max)
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

async function fetchJsonWithRetry(params: {
  label: string
  url: string
  init: RequestInit
  attempts?: number
  timeoutMs?: number
}): Promise<{ response: unknown; status: number; contentType: string }> {
  const attempts = params.attempts || 3
  const timeoutMs = params.timeoutMs || 45_000
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(params.url, {
        ...params.init,
        signal: controller.signal,
      })
      const contentType = res.headers.get('content-type') || ''
      logMemory(`${params.label}_response`, {
        attempt,
        status: res.status,
        ok: res.ok,
        contentType,
      })
      if (res.ok) {
        return { response: await res.json(), status: res.status, contentType }
      }

      const text = (await res.text()).slice(0, 300)
      lastError = new Error(`Memory extractor ${params.label} request failed (${res.status}): ${text}`)
      if (!shouldRetryStatus(res.status) || attempt === attempts) throw lastError
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError'
      lastError = err instanceof Error
        ? err
        : new Error(String(err))
      logMemory(`${params.label}_request_failed`, {
        attempt,
        retryable: isAbort || attempt < attempts,
        error: lastError.message,
      })
      if (!isAbort && attempt === attempts) throw lastError
      if (attempt === attempts) throw lastError
    } finally {
      clearTimeout(timeout)
    }

    const delayMs = 800 * attempt
    logMemory(`${params.label}_retry_wait`, { attempt, nextAttempt: attempt + 1, delayMs })
    await sleep(delayMs)
  }

  throw lastError || new Error(`Memory extractor ${params.label} request failed`)
}

const SYSTEM_PROMPT = `你是 Loom 的长期记忆提炼器。你的任务是从最近对话中提炼“未来确实有用”的长期记忆候选。

重要规则：
- 只输出 JSON，不要输出解释。
- 不要记录一次性任务细节、临时寒暄、普通推理过程。
- 不要记录密钥、账号、token、隐私敏感内容。
- 不确定就不要提炼。
- 项目事实、项目决策、项目反馈默认 scope=project。
- 用户长期偏好、通用工作方式、跨项目要求才用 scope=global。
- 每次最多输出 5 条。

JSON 格式：
{"candidates":[{"scope":"project","type":"decision","confidence":"high","content":"...","evidence":"..."}]}`

const EXPLICIT_REFERENCE_SYSTEM_PROMPT = `你是 Loom 的显式记忆解析器。用户刚刚要求“记住”某个内容，但可能使用了指代词，例如“上面的提问”“刚才那个要求”“这个问题”。

你的任务：
- 根据最近对话解析用户真正要记住的具体内容。
- 不要保存“我上面的提问”这类字面指代。
- 如果用户明确要求全局/跨项目，scope=global，否则 scope=project。
- 如果只能确定一个具体要求，只输出 1 条。
- 如果不确定，输出 {"candidates":[]}。
- 只输出 JSON。

JSON 格式：
{"candidates":[{"scope":"project","type":"preference","confidence":"high","content":"具体、可长期复用的记忆内容","evidence":"为什么这样解析"}]}`

const COMPACT_SUMMARY_SYSTEM_PROMPT = `你是 Loom 的上下文压缩摘要器。你的任务是把即将归档的对话压缩成可供下一轮继续工作的摘要。

要求：
- 使用中文。
- 输出 5-10 条要点。
- 保留用户目标、关键决策、已完成事项、未完成事项、重要文件/技能/命令、下一步建议。
- 不要编造。
- 不要输出 JSON，只输出 Markdown 要点。`

function extractJson(text: string): { candidates?: ExtractedCandidate[] } {
  const trimmed = text.trim()
  const jsonText = trimmed.startsWith('{')
    ? trimmed
    : /\{[\s\S]*\}/.exec(trimmed)?.[0] || '{"candidates":[]}'
  try {
    return JSON.parse(jsonText) as { candidates?: ExtractedCandidate[] }
  } catch {
    logMemory('json_parse_failed', { textChars: text.length, preview: preview(text) })
    return { candidates: [] }
  }
}

function extractTextFromResponse(response: unknown): string {
  if (!response || typeof response !== 'object') return ''
  const obj = response as Record<string, unknown>
  if (Array.isArray(obj.content)) {
    return obj.content
      .filter((block): block is { type: string; text?: string } => typeof block === 'object' && block !== null && 'type' in block)
      .filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join('\n')
  }
  if (typeof obj.content === 'string') return obj.content
  const choices = obj.choices
  if (Array.isArray(choices)) {
    return choices.map(choice => {
      const c = choice as Record<string, unknown>
      const message = c.message as Record<string, unknown> | undefined
      if (typeof message?.content === 'string') return message.content
      if (typeof c.text === 'string') return c.text
      return ''
    }).filter(Boolean).join('\n')
  }
  if (typeof obj.output_text === 'string') return obj.output_text
  return ''
}

async function callAnthropicMessages(params: {
  apiKey: string
  baseUrl?: string
  model: string
  system: string
  user: string
}): Promise<unknown> {
  const endpoint = `${(params.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`
  const { response } = await fetchJsonWithRetry({
    label: 'anthropic',
    url: endpoint,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': params.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: params.model,
        max_tokens: 1200,
        temperature: 0,
        system: params.system,
        messages: [{ role: 'user', content: params.user }],
      }),
    },
  })
  return response
}

async function callOpenAIChatCompletions(params: {
  apiKey: string
  baseUrl: string
  model: string
  system: string
  user: string
}): Promise<unknown> {
  if (!params.baseUrl.trim()) throw new Error('Memory extractor OpenAI provider baseUrl is empty')
  const endpoint = `${params.baseUrl.replace(/\/$/, '')}/chat/completions`
  logMemory('openai_request', {
    baseUrl: safeUrl(params.baseUrl),
    model: params.model,
    systemChars: params.system.length,
    userChars: params.user.length,
  })
  const { response } = await fetchJsonWithRetry({
    label: 'openai',
    url: endpoint,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        model: params.model,
        temperature: 0,
        max_tokens: 1200,
        stream: false,
        messages: [
          { role: 'system', content: params.system },
          { role: 'user', content: params.user },
        ],
      }),
    },
  })
  return response
}

function isSensitiveCredentialContent(content: string): boolean {
  return [
    /api[_\s-]?key/i,
    /\bsecret\b/i,
    /\btoken\b/i,
    /\bpassword\b/i,
    /密码\s*[:：=]/,
    /口令\s*[:：=]/,
    /密钥\s*[:：=]/,
    /账号.{0,20}密码/,
    /用户名.{0,20}密码/,
  ].some(pattern => pattern.test(content))
}

function normalizeCandidate(candidate: ExtractedCandidate): { candidate: ExtractedCandidate | null; reason?: string } {
  const content = candidate.content?.trim()
  if (!content) return { candidate: null, reason: 'empty_content' }
  if (content.length < 8) return { candidate: null, reason: 'content_too_short' }
  if (isSensitiveCredentialContent(content)) return { candidate: null, reason: 'sensitive_credential' }
  const scope = candidate.scope === 'global' ? 'global' : 'project'
  const allowedTypes = new Set(['preference', 'fact', 'decision', 'workflow', 'correction', 'feedback', 'risk'])
  const allowedConfidence = new Set(['high', 'medium', 'low'])
  return {
    candidate: {
      scope,
      type: allowedTypes.has(candidate.type) ? candidate.type : 'fact',
      confidence: allowedConfidence.has(candidate.confidence) ? candidate.confidence : 'medium',
      content,
      evidence: candidate.evidence?.trim(),
    },
  }
}

function alreadyKnown(candidate: ExtractedCandidate, workspacePath: string): boolean {
  const target = candidate.content.trim()
  const globalMemory = readClaudeMemory('global')
  const projectMemory = readClaudeMemory('project', workspacePath)
  const files = candidate.scope === 'global' ? globalMemory.files : projectMemory.files
  const candidates = candidate.scope === 'global' ? globalMemory.candidates : projectMemory.candidates
  return files.some(file => file.content.includes(target)) || candidates.some(item => item.content === target)
}

function renderMessages(messages: MemoryMessage[]): string {
  return messages
    .slice(-10)
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}:\n${m.text.slice(0, 2500)}`)
    .join('\n\n---\n\n')
}

async function callMemoryExtractor(params: {
  system: string
  user: string
}): Promise<ExtractedCandidate[]> {
  const provider = resolveProvider('claude-haiku-4-5')
  if (!provider.apiKey) {
    logMemory('skip_no_api_key', { providerId: provider.providerId, apiFormat: provider.apiFormat })
    return []
  }

  const modelId = provider.resolvedModelId ||
    (provider.providerId === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'claude-haiku-4-5')
  logMemory('start', {
    providerId: provider.providerId,
    apiFormat: provider.apiFormat || 'anthropic',
    modelId,
    baseUrl: safeUrl(provider.upstreamBaseUrl || provider.baseUrl),
    systemChars: params.system.length,
    userChars: params.user.length,
  })

  const response = provider.apiFormat === 'openai'
    ? await callOpenAIChatCompletions({
        apiKey: provider.apiKey,
        baseUrl: provider.upstreamBaseUrl || provider.baseUrl || '',
        model: modelId,
        system: params.system,
        user: params.user,
      })
    : await callAnthropicMessages({
        apiKey: provider.apiKey,
        baseUrl: provider.upstreamBaseUrl || provider.baseUrl,
        model: modelId,
        system: params.system,
        user: params.user,
      })

  const text = extractTextFromResponse(response)
  const responseObj = response && typeof response === 'object' ? response as Record<string, unknown> : {}
  logMemory('response_parsed', {
    topLevelKeys: Object.keys(responseObj).slice(0, 12),
    textChars: text.length,
    textPreview: preview(text),
  })
  if (!text.trim()) return []
  const candidates = extractJson(text).candidates || []
  logMemory('candidates_raw', { count: candidates.length })
  return candidates
}

export async function extractMemoryCandidatesWithLlm(params: {
  sessionId: string
  workspacePath: string
  messages: MemoryMessage[]
  reason: 'after_message' | 'compact_flush' | 'manual'
}): Promise<MemoryCandidate[]> {
  logMemory('extract_request', {
    reason: params.reason,
    sessionId: params.sessionId,
    workspacePath: params.workspacePath,
    messageCount: params.messages.length,
    messageChars: params.messages.reduce((sum, m) => sum + m.text.length, 0),
  })
  if (params.messages.length === 0) {
    logMemory('skip_no_messages', { reason: params.reason, sessionId: params.sessionId })
    return []
  }

  const candidates = await callMemoryExtractor({
    system: SYSTEM_PROMPT,
    user: `提炼原因：${params.reason}\n\n最近对话：\n${renderMessages(params.messages)}`,
  })
  const written: MemoryCandidate[] = []

  for (const raw of candidates) {
    const normalized = normalizeCandidate(raw)
    const candidate = normalized.candidate
    if (!candidate) {
      logMemory('candidate_filtered', {
        reason: normalized.reason || 'normalize_failed',
        rawType: raw?.type,
        rawScope: raw?.scope,
        rawContentType: typeof raw?.content,
        rawContentPreview: typeof raw?.content === 'string' ? preview(raw.content) : '',
      })
      continue
    }
    if (candidate.scope === 'project' && !params.workspacePath) {
      logMemory('candidate_filtered', { reason: 'missing_workspace', contentPreview: preview(candidate.content) })
      continue
    }
    if (alreadyKnown(candidate, params.workspacePath)) {
      logMemory('candidate_filtered', { reason: 'already_known', scope: candidate.scope, type: candidate.type, contentPreview: preview(candidate.content) })
      continue
    }
    const duplicate = findDuplicateMemoryCandidate({
      candidate,
      workspacePath: params.workspacePath,
    })
    if (duplicate) {
      logMemory('candidate_filtered', {
        reason: 'duplicate_similar',
        scope: candidate.scope,
        type: candidate.type,
        similarity: Number(duplicate.similarity.toFixed(3)),
        matchedScope: duplicate.matchedScope,
        matchedSource: duplicate.matchedSource,
        contentPreview: preview(candidate.content),
      })
      continue
    }
    written.push(writeMemoryCandidate({
      scope: candidate.scope,
      workspacePath: candidate.scope === 'project' ? params.workspacePath : undefined,
      type: candidate.type,
      confidence: candidate.confidence,
      sourceSessionId: params.sessionId,
      content: candidate.content,
      evidence: candidate.evidence || `LLM 自动提炼，触发原因：${params.reason}`,
    }))
    logMemory('candidate_written', {
      scope: candidate.scope,
      type: candidate.type,
      confidence: candidate.confidence,
      contentPreview: preview(candidate.content),
    })
  }

  logMemory('extract_done', { reason: params.reason, rawCount: candidates.length, writtenCount: written.length })
  return written
}

export async function resolveExplicitMemoryReferenceWithLlm(params: {
  sessionId: string
  workspacePath: string
  userRequest: string
  messages: MemoryMessage[]
}): Promise<MemoryCandidate[]> {
  const candidates = await callMemoryExtractor({
    system: EXPLICIT_REFERENCE_SYSTEM_PROMPT,
    user: `用户显式记忆请求：${params.userRequest}\n\n最近对话：\n${renderMessages(params.messages)}`,
  })
  const written: MemoryCandidate[] = []
  for (const raw of candidates) {
    const normalized = normalizeCandidate(raw)
    const candidate = normalized.candidate
    if (!candidate) continue
    if (candidate.scope === 'project' && !params.workspacePath) continue
    if (alreadyKnown(candidate, params.workspacePath)) continue
    written.push(writeMemoryCandidate({
      scope: candidate.scope,
      workspacePath: candidate.scope === 'project' ? params.workspacePath : undefined,
      type: candidate.type,
      confidence: candidate.confidence,
      sourceSessionId: params.sessionId,
      content: candidate.content,
      evidence: candidate.evidence || `用户显式要求记住，原始请求：${params.userRequest.slice(0, 300)}`,
    }))
  }
  return written
}

export async function generateCompactSummaryWithLlm(params: {
  sessionId: string
  messages: MemoryMessage[]
}): Promise<string> {
  if (params.messages.length === 0) return ''
  return generateCompactSummaryText(params.messages)
}

async function generateCompactSummaryText(messages: MemoryMessage[]): Promise<string> {
  const provider = resolveProvider('claude-haiku-4-5')
  if (!provider.apiKey) return ''
  const modelId = provider.resolvedModelId ||
    (provider.providerId === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'claude-haiku-4-5')
  const user = `请压缩以下对话，供新上下文继续使用：\n\n${renderMessages(messages)}`
  const response = provider.apiFormat === 'openai'
    ? await callOpenAIChatCompletions({
        apiKey: provider.apiKey,
        baseUrl: provider.upstreamBaseUrl || provider.baseUrl || '',
        model: modelId,
        system: COMPACT_SUMMARY_SYSTEM_PROMPT,
        user,
      })
    : await callAnthropicMessages({
        apiKey: provider.apiKey,
        baseUrl: provider.upstreamBaseUrl || provider.baseUrl,
        model: modelId,
        system: COMPACT_SUMMARY_SYSTEM_PROMPT,
        user,
      })
  const text = extractTextFromResponse(response).trim()
  logMemory('compact_summary_generated', {
    messageCount: messages.length,
    summaryChars: text.length,
    summaryPreview: preview(text),
  })
  return text
}

export type { MemoryMessage }
