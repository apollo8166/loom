/**
 * LLM Proxy — bridges the Claude SDK (Anthropic wire format) to third-party providers.
 *
 * Routing logic:
 *  - apiFormat === 'anthropic' → passthrough to provider's /v1/messages
 *  - apiFormat === 'openai'    → translate Anthropic ↔ OpenAI, forward to /chat/completions
 *
 * Provider is identified by x-loom-provider-id when present, otherwise by
 * matching the Authorization header API key against DB configs.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'
import {
  getAllProviderConfigs,
  isAnthropicProvider,
  isAnthropicFormatProvider,
  mapModelToProvider,
} from '@/shared/config/provider-config'
import type { ProviderConfig } from '@/shared/config/provider-config'
import { logger } from '@/shared/logging/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── Health check ────────────────────────────────────────────────────────────

export async function HEAD() {
  return new NextResponse(null, { status: 200 })
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, Authorization, anthropic-version, anthropic-beta, x-api-key, x-loom-provider-id',
    },
  })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const { path } = await params
  if (path?.join('/').endsWith('models')) {
    return NextResponse.json({ object: 'list', data: [] })
  }
  return NextResponse.json({ ok: true })
}

// ── POST — main proxy entry point ────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Identify provider explicitly when Loom calls the proxy internally. Fall
  // back to API-key matching for Claude SDK requests that do not add headers.
  const providerId = req.headers.get('x-loom-provider-id')?.trim()
  const authRaw =
    req.headers.get('authorization') || req.headers.get('x-api-key') || ''
  const apiKey = authRaw.replace(/^Bearer\s+/i, '').trim()

  const db = getDb()
  const allConfigs = getAllProviderConfigs(db)
  const config: ProviderConfig | undefined = providerId
    ? allConfigs.find(c => !isAnthropicProvider(c) && c.id === providerId && c.apiKey)
    : allConfigs.find(c => !isAnthropicProvider(c) && c.apiKey && c.apiKey === apiKey)

  if (!config) {
    return NextResponse.json(
      { error: { message: providerId ? `Unknown provider — ${providerId} is not configured` : 'Unknown provider — no API key matched', type: 'proxy_error' } },
      { status: 401 },
    )
  }

  let anthropicBody: Record<string, unknown>
  try {
    anthropicBody = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const originalModel = String(anthropicBody.model || '')
  const mappedModel = mapModelToProvider(originalModel, config)
  const baseUrl = config.baseUrl.replace(/\/$/, '')

  logger.info('llm.proxy.request', {
    providerId: config.id,
    apiFormat: config.apiFormat,
    originalModel,
    mappedModel,
    hasSystem: Boolean(anthropicBody.system),
    messageCount: Array.isArray(anthropicBody.messages) ? anthropicBody.messages.length : 0,
    stream: Boolean(anthropicBody.stream),
  })

  try {
    if (isAnthropicFormatProvider(config)) {
      return await handleAnthropicPassthrough(anthropicBody, mappedModel, baseUrl, config.apiKey)
    }
    return await handleOpenAITranslation(anthropicBody, mappedModel, baseUrl, config.apiKey)
  } catch (err) {
    logger.error('llm.proxy.fetch_error', err, {
      providerId: config.id,
      originalModel,
      mappedModel,
    })
    return NextResponse.json(
      { error: { message: err instanceof Error ? err.message : 'Proxy error', type: 'proxy_error' } },
      { status: 502 },
    )
  }
}

// ── Anthropic passthrough ─────────────────────────────────────────────────────

function buildAnthropicPassthroughRequest(
  body: Record<string, unknown>,
  model: string,
): Record<string, unknown> {
  const hasTools = Array.isArray(body.tools) && (body.tools as unknown[]).length > 0
  const result: Record<string, unknown> = {
    model,
    messages: stripThinkingFromMessages(body.messages),
    max_tokens: body.max_tokens ?? 4096,
    stream: body.stream ?? true,
  }
  if (body.system) result.system = body.system
  if (body.temperature != null) result.temperature = body.temperature
  if (body.top_p != null) result.top_p = body.top_p
  if (body.stop_sequences != null) result.stop_sequences = body.stop_sequences
  if (body.tools != null) result.tools = body.tools
  if (body.tool_choice != null) result.tool_choice = body.tool_choice
  if (hasTools) {
    result.thinking = { type: 'disabled' }
  } else if (body.thinking != null) {
    result.thinking = body.thinking
  }
  return result
}

async function handleAnthropicPassthrough(
  body: Record<string, unknown>,
  model: string,
  baseUrl: string,
  apiKey: string,
): Promise<NextResponse> {
  const cleanBody = buildAnthropicPassthroughRequest(body, model)
  const targetUrl = `${baseUrl}/v1/messages`
  const isStreaming = cleanBody.stream === true

  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(cleanBody),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    logger.error('llm.proxy.anthropic_error', undefined, {
      status: response.status,
      model,
      errorPreview: errText.slice(0, 300),
    })
    return NextResponse.json(
      { error: { message: errText || `Upstream ${response.status}`, type: 'proxy_error' } },
      { status: response.status },
    )
  }

  if (isStreaming && response.body) {
    return new NextResponse(response.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    })
  }
  return NextResponse.json(await response.json())
}

// ── OpenAI translation ────────────────────────────────────────────────────────

// Types -----------------------------------------------------------------------

interface AnthropicContentBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string | AnthropicContentBlock[]
  source?: { type: string; media_type: string; data?: string; url?: string }
  thinking?: string
}

interface AnthropicTool {
  type?: string
  name: string
  description?: string
  input_schema?: Record<string, unknown>
}

interface AnthropicToolChoice {
  type: 'auto' | 'any' | 'none' | 'tool'
  name?: string
}

interface OAIChoice {
  message?: {
    role?: string
    content?: string | null
    reasoning_content?: string
    tool_calls?: OAIToolCall[]
  }
  finish_reason?: string | null
}

interface OAIToolCall {
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

interface OAIStreamChoice {
  delta?: {
    role?: string
    content?: string | null
    reasoning_content?: string
    tool_calls?: OAIDeltaToolCall[]
  }
  finish_reason?: string | null
}

interface OAIDeltaToolCall {
  index?: number
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

// Helpers ---------------------------------------------------------------------

const ANTHROPIC_ONLY_BLOCK_TYPES = new Set(['thinking', 'redacted_thinking'])

function stripThinkingFromMessages(messages: unknown): unknown {
  if (!Array.isArray(messages)) return messages
  return messages.map(m => {
    if (!Array.isArray(m.content)) return m
    return {
      ...m,
      content: (m.content as AnthropicContentBlock[]).filter(
        b => !ANTHROPIC_ONLY_BLOCK_TYPES.has(b.type),
      ),
    }
  })
}

function extractSystemText(system: unknown): string {
  if (typeof system === 'string') return system
  if (Array.isArray(system)) {
    return (system as AnthropicContentBlock[])
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text!)
      .join('\n')
  }
  return ''
}

function mapFinishReason(reason: string | null | undefined): string {
  switch (reason) {
    case 'tool_calls':     return 'tool_use'
    case 'function_call':  return 'tool_use'
    case 'length':         return 'max_tokens'
    case 'content_filter': return 'stop_sequence'
    default:               return 'end_turn'
  }
}

function anthropicImageToOpenAI(block: AnthropicContentBlock): Record<string, unknown> | null {
  const src = block.source
  if (!src) return null
  if (src.type === 'base64')
    return { type: 'image_url', image_url: { url: `data:${src.media_type};base64,${src.data}` } }
  if (src.type === 'url' && src.url)
    return { type: 'image_url', image_url: { url: src.url } }
  return null
}

function convertMessage(
  m: { role: string; content: unknown },
): Array<Record<string, unknown>> {
  if (!Array.isArray(m.content)) {
    return [{ role: m.role, content: m.content }]
  }

  const blocks = m.content as AnthropicContentBlock[]
  const visible = blocks.filter(b => !ANTHROPIC_ONLY_BLOCK_TYPES.has(b.type))
  const toolResults = visible.filter(b => b.type === 'tool_result')
  const toolUses    = visible.filter(b => b.type === 'tool_use')
  const texts       = visible.filter(b => b.type === 'text' && b.text)
  const images      = visible.filter(b => b.type === 'image')

  if (toolResults.length > 0) {
    return toolResults.map(tr => {
      const parts: Array<Record<string, unknown>> = []
      if (typeof tr.content === 'string' && tr.content) {
        parts.push({ type: 'text', text: tr.content })
      } else if (Array.isArray(tr.content)) {
        for (const b of tr.content as AnthropicContentBlock[]) {
          if (b.type === 'text' && b.text) parts.push({ type: 'text', text: b.text })
          if (b.type === 'image') { const img = anthropicImageToOpenAI(b); if (img) parts.push(img) }
        }
      }
      const content =
        parts.length === 1 && parts[0].type === 'text'
          ? String(parts[0].text)
          : parts.length > 0 ? parts : ''
      return { role: 'tool', tool_call_id: String(tr.tool_use_id || ''), content }
    })
  }

  if (toolUses.length > 0) {
    return [{
      role: 'assistant',
      content: texts.length > 0 ? texts.map(b => b.text).join('\n') : null,
      tool_calls: toolUses.map(tu => ({
        id: String(tu.id || `call_${Date.now()}_${tu.name}`),
        type: 'function',
        function: { name: String(tu.name || ''), arguments: JSON.stringify(tu.input ?? {}) },
      })),
    }]
  }

  if (images.length > 0) {
    const parts: Array<Record<string, unknown>> = []
    for (const b of visible) {
      if (b.type === 'text' && b.text) parts.push({ type: 'text', text: b.text })
      if (b.type === 'image') { const img = anthropicImageToOpenAI(b); if (img) parts.push(img) }
    }
    return [{ role: m.role, content: parts }]
  }

  return [{ role: m.role, content: texts.map(b => b.text).join('\n') || '' }]
}

function buildOpenAIRequest(
  body: Record<string, unknown>,
  model: string,
): Record<string, unknown> {
  const messages: Array<Record<string, unknown>> = []

  if (body.system) {
    const text = extractSystemText(body.system)
    if (text) messages.push({ role: 'system', content: text })
  }

  const bodyMessages = body.messages as Array<{ role: string; content: unknown }> | undefined
  if (Array.isArray(bodyMessages)) {
    for (const m of bodyMessages) messages.push(...convertMessage(m))
  }

  const isStreaming = body.stream !== false   // default to streaming (same as SDK default)
  const result: Record<string, unknown> = {
    model,
    messages,
    max_tokens: body.max_tokens,
    stream: isStreaming,
    ...(isStreaming ? { stream_options: { include_usage: true } } : {}),
    ...(body.temperature != null ? { temperature: body.temperature } : {}),
    ...(body.top_p != null ? { top_p: body.top_p } : {}),
    ...(body.stop_sequences != null ? { stop: body.stop_sequences } : {}),
  }

  if (Array.isArray(body.tools)) {
    const functionTools = (body.tools as AnthropicTool[]).filter(
      t => !t.type || t.type === 'custom',
    )
    if (functionTools.length > 0) {
      result.tools = functionTools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          ...(t.description ? { description: t.description } : {}),
          parameters: t.input_schema ?? { type: 'object', properties: {} },
        },
      }))
    }
  }

  if (body.thinking != null) {
    const th = body.thinking as { type: string; budget_tokens?: number }
    if (th.type === 'enabled') {
      const budget = th.budget_tokens ?? 4000
      result.reasoning = {
        effort: budget < 1024 ? 'low' : budget < 4000 ? 'medium' : budget < 10000 ? 'high' : 'xhigh',
      }
    } else if (th.type === 'adaptive') {
      // AUTO mode: map to medium effort for OpenAI-format providers
      result.reasoning = { effort: 'medium' }
    }
  }

  if (body.tool_choice != null) {
    const tc = body.tool_choice as AnthropicToolChoice
    switch (tc.type) {
      case 'auto': result.tool_choice = 'auto'; break
      case 'any':  result.tool_choice = 'required'; break
      case 'none': result.tool_choice = 'none'; break
      case 'tool': result.tool_choice = { type: 'function', function: { name: tc.name } }; break
    }
  }

  return result
}

function translateOpenAIResponseToAnthropic(
  body: Record<string, unknown>,
  model: string,
): Record<string, unknown> {
  const choice = (body.choices as OAIChoice[] | undefined)?.[0]
  const message = choice?.message
  const usage = body.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
  const content: Array<Record<string, unknown>> = []

  if (typeof message?.reasoning_content === 'string' && message.reasoning_content.length > 0) {
    content.push({ type: 'thinking', thinking: message.reasoning_content })
  }
  if (typeof message?.content === 'string' && message.content.length > 0) {
    content.push({ type: 'text', text: message.content })
  }
  if (Array.isArray(message?.tool_calls)) {
    for (const tc of message!.tool_calls!) {
      let input: Record<string, unknown> = {}
      try { input = JSON.parse(tc.function?.arguments || '{}') } catch { /* ignore */ }
      content.push({ type: 'tool_use', id: tc.id, name: tc.function?.name ?? '', input })
    }
  }

  return {
    id: body.id ?? `msg_proxy_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content: content.length > 0 ? content : [{ type: 'text', text: '' }],
    model: body.model ?? model,
    stop_reason: mapFinishReason(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: usage?.prompt_tokens ?? 0,
      output_tokens: usage?.completion_tokens ?? 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  }
}

function translateOpenAIStreamToAnthropic(
  openaiStream: ReadableStream<Uint8Array>,
  model: string,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  let headerEmitted = false
  let finishEmitted = false
  let outputTokens = 0
  let inputTokens = 0
  let stopReason = 'end_turn'

  let nextBlockIdx = 0
  let thinkingBlockIdx = -1
  let textBlockIdx = -1
  interface ToolInfo { id: string; name: string; arguments: string; hasUpstreamId: boolean }
  interface NormalizedToolInfo { oaiIndex: number; tool: ToolInfo; sourceIndexes: number[] }
  const toolBlocks = new Map<number, ToolInfo>()

  function sse(event: string, data: object): Uint8Array {
    return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  function emitHeader(ctrl: ReadableStreamDefaultController, msgId: string, resolvedModel: string) {
    if (headerEmitted) return
    headerEmitted = true
    ctrl.enqueue(sse('message_start', {
      type: 'message_start',
      message: {
        id: msgId, type: 'message', role: 'assistant', content: [],
        model: resolvedModel, stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    }))
    ctrl.enqueue(sse('ping', { type: 'ping' }))
  }

  function openTextBlock(ctrl: ReadableStreamDefaultController) {
    if (textBlockIdx >= 0) return
    textBlockIdx = nextBlockIdx++
    ctrl.enqueue(sse('content_block_start', {
      type: 'content_block_start', index: textBlockIdx,
      content_block: { type: 'text', text: '' },
    }))
  }

  function closeTextBlock(ctrl: ReadableStreamDefaultController) {
    if (textBlockIdx < 0) return
    ctrl.enqueue(sse('content_block_stop', { type: 'content_block_stop', index: textBlockIdx }))
    textBlockIdx = -1
  }

  // Some models concatenate multiple JSON objects in a single arguments string,
  // e.g. {"pattern":"a"}{"pattern":"b"}. Split them into individual JSON strings.
  function splitConcatenatedJson(str: string): string[] {
    const results: string[] = []
    let remaining = str.trim()
    while (remaining.length > 0) {
      if (remaining[0] !== '{') break
      let depth = 0
      let inString = false
      let escaped = false
      let i = 0
      for (; i < remaining.length; i++) {
        const ch = remaining[i]
        if (escaped) { escaped = false; continue }
        if (ch === '\\' && inString) { escaped = true; continue }
        if (ch === '"') { inString = !inString; continue }
        if (inString) continue
        if (ch === '{') depth++
        else if (ch === '}') {
          depth--
          if (depth === 0) { i++; break }
        }
      }
      if (depth !== 0) break
      results.push(remaining.slice(0, i))
      remaining = remaining.slice(i).trim()
    }
    return results.length > 0 ? results : [str]
  }

  function getToolBlock(oaiIdx: number): ToolInfo {
    let block = toolBlocks.get(oaiIdx)
    if (!block) {
      block = { id: `call_proxy_${Date.now()}_${oaiIdx}`, name: '', arguments: '', hasUpstreamId: false }
      toolBlocks.set(oaiIdx, block)
    }
    return block
  }

  function isEmptyToolArguments(args: string): boolean {
    const trimmed = args.trim()
    if (!trimmed) return true
    try {
      const input = JSON.parse(trimmed) as unknown
      return input != null &&
        typeof input === 'object' &&
        !Array.isArray(input) &&
        Object.keys(input).length === 0
    } catch {
      return false
    }
  }

  function normalizeBufferedToolBlocks(): NormalizedToolInfo[] {
    const orderedBlocks = [...toolBlocks.entries()].sort(([a], [b]) => a - b)
    const used = new Set<number>()
    const normalized: NormalizedToolInfo[] = []
    const metadataOnly = orderedBlocks.filter(([, tool]) =>
      tool.name.trim().length > 0 && isEmptyToolArguments(tool.arguments))
    const argumentsOnly = orderedBlocks.filter(([, tool]) =>
      tool.name.trim().length === 0 && !isEmptyToolArguments(tool.arguments))

    // Some OpenAI-compatible streams split tool metadata and arguments into
    // separate tool_call indexes. Anthropic requires one complete tool_use.
    // Pair as many as possible even when counts differ (e.g. 2 meta + 1 args).
    const pairCount = Math.min(metadataOnly.length, argumentsOnly.length)
    if (pairCount > 0) {
      for (let i = 0; i < pairCount; i++) {
        const [metaIndex, metaTool] = metadataOnly[i]
        const [argsIndex, argsTool] = argumentsOnly[i]
        used.add(metaIndex)
        used.add(argsIndex)
        normalized.push({
          oaiIndex: Math.min(metaIndex, argsIndex),
          sourceIndexes: [metaIndex, argsIndex],
          tool: {
            id: metaTool.hasUpstreamId ? metaTool.id : argsTool.id,
            name: metaTool.name,
            arguments: argsTool.arguments,
            hasUpstreamId: metaTool.hasUpstreamId || argsTool.hasUpstreamId,
          },
        })
        logger.warn('llm.proxy.merge_stream_tool_call_split_delta', {
          model,
          name: metaTool.name,
          metadataIndex: metaIndex,
          argumentsIndex: argsIndex,
          argumentsChars: argsTool.arguments.length,
        })
      }
    }

    const knownNames = [...new Set(orderedBlocks
      .map(([, tool]) => tool.name.trim())
      .filter(Boolean))]

    // Remaining unmatched metadata-only blocks (no args partner after pairing).
    const unmatchedMeta = metadataOnly.slice(pairCount)
    const unmatchedMetaNames = unmatchedMeta.map(([, t]) => t.name.trim()).filter(Boolean)

    for (const [oaiIndex, tool] of orderedBlocks) {
      if (used.has(oaiIndex)) continue
      const toolName = tool.name.trim()
      const args = tool.arguments.trim()
      if (!toolName && args) {
        // Try to infer name: prefer the single known name, or the next unmatched metadata name.
        let inferredName = knownNames.length === 1 ? knownNames[0] : unmatchedMetaNames.shift() ?? ''
        if (inferredName) {
          const idCarrier = orderedBlocks.find(([, candidate]) =>
            candidate.name.trim() === inferredName && candidate.hasUpstreamId)
          const reusableIdCarrier = idCarrier && used.has(idCarrier[0]) ? idCarrier : undefined
          normalized.push({
            oaiIndex,
            sourceIndexes: [oaiIndex],
            tool: {
              ...tool,
              id: reusableIdCarrier?.[1].id ?? tool.id,
              name: inferredName,
              hasUpstreamId: tool.hasUpstreamId || Boolean(reusableIdCarrier),
            },
          })
          logger.warn('llm.proxy.infer_stream_tool_call_name', {
            model,
            inferredName,
            oaiIndex,
            argumentsChars: tool.arguments.length,
          })
          continue
        }
      }
      normalized.push({ oaiIndex, tool, sourceIndexes: [oaiIndex] })
    }

    return normalized.sort((a, b) => a.oaiIndex - b.oaiIndex)
  }

  function emitBufferedToolBlocks(ctrl: ReadableStreamDefaultController): number {
    if (toolBlocks.size === 0) return 0
    closeTextBlock(ctrl)
    let emitted = 0
    const orderedBlocks = normalizeBufferedToolBlocks()
    const emittedToolIds = new Set<string>()
    for (const { oaiIndex, tool, sourceIndexes } of orderedBlocks) {
      const toolName = tool.name.trim()
      if (!toolName) {
        logger.warn('llm.proxy.skip_stream_tool_call_missing_name', {
          model,
          oaiIndex,
          sourceIndexes,
          toolCallId: tool.id,
          argumentsChars: tool.arguments.length,
        })
        continue
      }
      if (toolName === 'Agent' && isEmptyToolArguments(tool.arguments)) {
        logger.warn('llm.proxy.drop_stream_tool_call_missing_required_input', {
          model,
          oaiIndex,
          sourceIndexes,
          toolCallId: tool.id,
          name: toolName,
          inputKeys: [],
        })
        continue
      }
      let toolId = tool.id
      if (emittedToolIds.has(toolId)) {
        if (isEmptyToolArguments(tool.arguments)) {
          logger.warn('llm.proxy.drop_stream_tool_call_duplicate_empty_input', {
            model,
            oaiIndex,
            sourceIndexes,
            toolCallId: tool.id,
            name: toolName,
          })
          continue
        }
        toolId = `${tool.id}_${sourceIndexes.join('_')}`
        logger.warn('llm.proxy.rename_stream_tool_call_duplicate_id', {
          model,
          oaiIndex,
          sourceIndexes,
          originalToolCallId: tool.id,
          renamedToolCallId: toolId,
          name: toolName,
        })
      }
      const rawArgs = tool.arguments.trim() || '{}'
      const jsonParts = splitConcatenatedJson(rawArgs)
      if (jsonParts.length > 1) {
        logger.warn('llm.proxy.split_stream_tool_call_concatenated_args', {
          model,
          oaiIndex,
          name: toolName,
          splitCount: jsonParts.length,
        })
      }
      for (let partIdx = 0; partIdx < jsonParts.length; partIdx++) {
        const partToolId = partIdx === 0 ? toolId : `${toolId}_p${partIdx}`
        const blockIdx = nextBlockIdx++
        ctrl.enqueue(sse('content_block_start', {
          type: 'content_block_start',
          index: blockIdx,
          content_block: { type: 'tool_use', id: partToolId, name: toolName, input: {} },
        }))
        ctrl.enqueue(sse('content_block_delta', {
          type: 'content_block_delta',
          index: blockIdx,
          delta: { type: 'input_json_delta', partial_json: jsonParts[partIdx] },
        }))
        ctrl.enqueue(sse('content_block_stop', { type: 'content_block_stop', index: blockIdx }))
        emittedToolIds.add(partToolId)
        emitted++
      }
    }
    toolBlocks.clear()
    return emitted
  }

  function closeAllBlocks(ctrl: ReadableStreamDefaultController) {
    if (thinkingBlockIdx >= 0) {
      ctrl.enqueue(sse('content_block_stop', { type: 'content_block_stop', index: thinkingBlockIdx }))
      thinkingBlockIdx = -1
    }
    closeTextBlock(ctrl)
    const emittedTools = emitBufferedToolBlocks(ctrl)
    if (emittedTools === 0 && stopReason === 'tool_use') stopReason = 'end_turn'
  }

  function emitFinish(ctrl: ReadableStreamDefaultController) {
    if (finishEmitted) return
    finishEmitted = true
    closeAllBlocks(ctrl)
    ctrl.enqueue(sse('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: {
        input_tokens: inputTokens,
        output_tokens: Math.max(outputTokens, 1),
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    }))
    ctrl.enqueue(sse('message_stop', { type: 'message_stop' }))
  }

  return new ReadableStream({
    async start(ctrl) {
      const reader = openaiStream.getReader()
      let buf = ''
      const msgId = `msg_proxy_${Date.now()}`

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data:')) continue
            const raw = trimmed.slice(5).trim()
            if (raw === '[DONE]') { emitFinish(ctrl); continue }

            let chunk: Record<string, unknown>
            try { chunk = JSON.parse(raw) } catch { continue }

            const usage = chunk.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
            if (usage) {
              if (usage.prompt_tokens != null) inputTokens = usage.prompt_tokens
              if (usage.completion_tokens != null) outputTokens = usage.completion_tokens
            }

            const choices = chunk.choices as OAIStreamChoice[] | undefined
            if (!choices?.length) continue
            const choice = choices[0]
            const delta = choice.delta ?? {}

            if (!headerEmitted) {
              emitHeader(ctrl, String(chunk.id || msgId), String(chunk.model || model))
            }

            // Reasoning → thinking block
            if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
              if (thinkingBlockIdx < 0) {
                thinkingBlockIdx = nextBlockIdx++
                ctrl.enqueue(sse('content_block_start', {
                  type: 'content_block_start', index: thinkingBlockIdx,
                  content_block: { type: 'thinking', thinking: '' },
                }))
              }
              ctrl.enqueue(sse('content_block_delta', {
                type: 'content_block_delta', index: thinkingBlockIdx,
                delta: { type: 'thinking_delta', thinking: delta.reasoning_content },
              }))
            }

            // Text delta
            if (typeof delta.content === 'string' && delta.content.length > 0) {
              openTextBlock(ctrl)
              outputTokens++
              ctrl.enqueue(sse('content_block_delta', {
                type: 'content_block_delta', index: textBlockIdx,
                delta: { type: 'text_delta', text: delta.content },
              }))
            }

            // Tool call deltas
            if (Array.isArray(delta.tool_calls)) {
              for (const tc of delta.tool_calls as OAIDeltaToolCall[]) {
                const oaiIdx = tc.index ?? 0
                const block = getToolBlock(oaiIdx)
                if (tc.id) {
                  block.id = tc.id
                  block.hasUpstreamId = true
                }
                if (tc.function?.name) block.name = tc.function.name
                const argsChunk = tc.function?.arguments
                if (typeof argsChunk === 'string' && argsChunk.length > 0) {
                  block.arguments += argsChunk
                }
              }
            }

            if (choice.finish_reason) {
              stopReason = mapFinishReason(choice.finish_reason)
            }
          }
        }

        // Flush remaining buffer
        if (buf.trim().startsWith('data:')) {
          const raw = buf.trim().slice(5).trim()
          if (raw !== '[DONE]') {
            try {
              const chunk = JSON.parse(raw) as Record<string, unknown>
              const u = chunk.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
              if (u) {
                if (u.prompt_tokens != null) inputTokens = u.prompt_tokens
                if (u.completion_tokens != null) outputTokens = u.completion_tokens
              }
              const c = (chunk.choices as OAIStreamChoice[])?.[0]
              if (c?.finish_reason) stopReason = mapFinishReason(c.finish_reason)
            } catch { /* ignore */ }
          }
        }

        if (toolBlocks.size > 0 && stopReason === 'end_turn') stopReason = 'tool_use'
        if (headerEmitted && !finishEmitted) emitFinish(ctrl)
      } catch (err) {
        logger.error('llm.proxy.stream_translation_error', err, { model })
        if (headerEmitted && !finishEmitted) emitFinish(ctrl)
      } finally {
        ctrl.close()
        reader.releaseLock()
      }
    },
  })
}

async function handleOpenAITranslation(
  anthropicBody: Record<string, unknown>,
  model: string,
  baseUrl: string,
  apiKey: string,
): Promise<NextResponse> {
  const openaiBody = buildOpenAIRequest(anthropicBody, model)
  const targetUrl = `${baseUrl}/chat/completions`
  const isStreaming = openaiBody.stream === true

  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(openaiBody),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    const isContentFilter = errText.includes('sensitive_words_detected') || errText.includes('content_filter')
    const requestId = /request id:\s*([^)"}\s]+)/i.exec(errText)?.[1]
    logger.error(isContentFilter ? 'llm.proxy.content_filter' : 'llm.proxy.openai_error', undefined, {
      status: response.status,
      model,
      errorCode: isContentFilter ? 'sensitive_words_detected' : undefined,
      providerRequestId: requestId,
      errorPreview: errText.slice(0, 300),
    })
    return NextResponse.json(
      { error: { message: errText || `Upstream ${response.status}`, type: 'proxy_error' } },
      { status: response.status },
    )
  }

  // Validate Content-Type — if upstream returns HTML (e.g. auth redirect, WAF page),
  // we must surface a clear error instead of crashing in JSON.parse
  const ct = response.headers.get('content-type') || ''
  const isJsonCt = ct.includes('application/json')
  const isSseCt  = ct.includes('text/event-stream')
  if (!isJsonCt && !isSseCt) {
    const errText = await response.text().catch(() => '')
    logger.error('llm.proxy.unexpected_content_type', undefined, {
      status: response.status,
      contentType: ct,
      model,
      errorPreview: errText.slice(0, 500),
    })
    return NextResponse.json(
      {
        error: {
          message: `Upstream returned unexpected content-type "${ct}" (status ${response.status}). First 200 chars: ${errText.slice(0, 200)}`,
          type: 'proxy_error',
        },
      },
      { status: 502 },
    )
  }

  if (isStreaming && response.body) {
    return new NextResponse(translateOpenAIStreamToAnthropic(response.body, model), {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    })
  }

  return NextResponse.json(translateOpenAIResponseToAnthropic(await response.json(), model))
}
