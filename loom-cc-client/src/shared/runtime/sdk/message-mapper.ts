/**
 * Maps SDK messages to SSE events that the frontend understands.
 * Ported from Forge with no logic changes.
 *
 * Sub-agent messages (parent_tool_use_id !== null) are routed
 * to 'agent_content' SSE events for structured rendering in AgentBlock.
 */

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

export interface SseEvent {
  type: string
  [key: string]: unknown
}

interface AgentStreamState {
  currentToolId: string
  currentToolName: string
  inputJson: string
  inThinkingBlock: boolean
  thinkingText: string
  inTextBlock: boolean
  textAccumulator: string
}

export class MessageMapper {
  private currentToolId = ''
  private currentToolName = ''
  private inputJson = ''
  private allBlocks: Record<string, unknown>[] = []
  private inThinkingBlock = false
  private thinkingText = ''
  private erroredToolUseIds = new Set<string>()
  private toolIdToName = new Map<string, string>()

  private agentStreamState = new Map<string, AgentStreamState>()
  private agentSubBlocks = new Map<string, Record<string, unknown>[]>()

  sdkSessionId: string | null = null
  inputTokens = 0
  outputTokens = 0

  mapMessage(msg: SDKMessage): SseEvent[] {
    const parentId = ('parent_tool_use_id' in msg) ? (msg as Record<string, unknown>).parent_tool_use_id as string | null : null

    switch (msg.type) {
      case 'stream_event':
        if (parentId) return this.mapAgentStreamEvent(parentId, msg)
        return this.mapStreamEvent(msg)
      case 'assistant':
        if (parentId) return this.mapAgentAssistantMessage(parentId, msg)
        return this.mapAssistantMessage(msg)
      case 'tool_use_summary':
        return this.mapToolUseSummary(msg)
      case 'tool_progress':
        return this.mapToolProgress(msg)
      case 'result':
        return this.mapResult(msg)
      case 'system':
        return this.mapSystemMessage(msg)
      case 'user':
        if (parentId) return this.mapAgentUserMessage(parentId, msg)
        return this.mapUserMessage(msg)
      default:
        return []
    }
  }

  getBlocks(): Record<string, unknown>[] {
    const result = [...this.allBlocks]
    for (const [parentId, subBlocks] of this.agentSubBlocks) {
      if (!result.some(b => b.type === 'agent_content' && b.parent_tool_use_id === parentId)) {
        result.push({ type: 'agent_content', parent_tool_use_id: parentId, blocks: subBlocks })
      }
    }
    return result
  }

  private getOrCreateAgentState(parentId: string): AgentStreamState {
    let state = this.agentStreamState.get(parentId)
    if (!state) {
      state = { currentToolId: '', currentToolName: '', inputJson: '', inThinkingBlock: false, thinkingText: '', inTextBlock: false, textAccumulator: '' }
      this.agentStreamState.set(parentId, state)
    }
    return state
  }

  private pushAgentSubBlock(parentId: string, block: Record<string, unknown>): void {
    let blocks = this.agentSubBlocks.get(parentId)
    if (!blocks) { blocks = []; this.agentSubBlocks.set(parentId, blocks) }
    blocks.push(block)
  }

  private upsertToolResultBlock(toolUseId: string, content: string, isError: boolean): void {
    const nextBlock = { type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }
    const index = this.allBlocks.findIndex(b => b.type === 'tool_result' && b.tool_use_id === toolUseId)
    if (index >= 0) {
      this.allBlocks[index] = nextBlock
    } else {
      this.allBlocks.push(nextBlock)
    }
  }

  private addSummaryToolResultBlock(toolUseId: string, content: string, isError: boolean): boolean {
    if (this.allBlocks.some(b => b.type === 'tool_result' && b.tool_use_id === toolUseId)) return false
    this.allBlocks.push({ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError })
    return true
  }

  private toolResultContentToText(content: unknown): string {
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      const texts = content
        .filter((item): item is { type: string; text: string } => (
          typeof item === 'object' &&
          item !== null &&
          (item as { type?: unknown }).type === 'text' &&
          typeof (item as { text?: unknown }).text === 'string'
        ))
        .map(item => item.text)
      if (texts.length > 0) return texts.join('\n')
    }
    return JSON.stringify(content) || ''
  }

  private isImageGenerationToolName(toolName: string): boolean {
    const normalized = toolName.toLowerCase()
    return normalized === 'generate_image' ||
      normalized === 'mcp__loom_image__generate_image' ||
      (normalized.includes('loom_image') && normalized.includes('generate_image'))
  }

  private mapAgentStreamEvent(parentId: string, msg: Extract<SDKMessage, { type: 'stream_event' }>): SseEvent[] {
    const event = msg.event
    const state = this.getOrCreateAgentState(parentId)
    const events: SseEvent[] = []

    switch (event.type) {
      case 'content_block_start': {
        const block = event.content_block
        if (block.type === 'tool_use') {
          if (state.inTextBlock && state.textAccumulator) {
            this.pushAgentSubBlock(parentId, { type: 'text', text: state.textAccumulator })
            state.inTextBlock = false; state.textAccumulator = ''
          }
          state.currentToolId = block.id; state.currentToolName = block.name; state.inputJson = ''
        } else if (block.type === 'thinking') {
          if (state.inTextBlock && state.textAccumulator) {
            this.pushAgentSubBlock(parentId, { type: 'text', text: state.textAccumulator })
            state.inTextBlock = false; state.textAccumulator = ''
          }
          state.inThinkingBlock = true; state.thinkingText = ''
        } else if (block.type === 'text') {
          state.inTextBlock = true; state.textAccumulator = ''
        }
        break
      }
      case 'content_block_delta': {
        const delta = event.delta
        if (delta.type === 'text_delta') {
          state.textAccumulator += delta.text
          events.push({ type: 'agent_content', parent_tool_use_id: parentId, block_type: 'text_delta', text: delta.text })
        } else if (delta.type === 'thinking_delta') {
          const text = (delta as unknown as Record<string, unknown>).thinking as string || ''
          state.thinkingText += text
          events.push({ type: 'agent_content', parent_tool_use_id: parentId, block_type: 'thinking_delta', text })
        } else if (delta.type === 'input_json_delta') {
          state.inputJson += delta.partial_json
        }
        break
      }
      case 'content_block_stop': {
        if (state.inThinkingBlock) {
          if (state.thinkingText) {
            this.pushAgentSubBlock(parentId, { type: 'thinking', text: state.thinkingText })
            events.push({ type: 'agent_content', parent_tool_use_id: parentId, block_type: 'thinking', text: state.thinkingText })
          }
          state.inThinkingBlock = false; state.thinkingText = ''
        } else if (state.currentToolId) {
          let parsedInput: Record<string, unknown> = {}
          try { parsedInput = JSON.parse(state.inputJson || '{}') } catch { /* empty */ }
          this.pushAgentSubBlock(parentId, { type: 'tool_use', id: state.currentToolId, name: state.currentToolName, input: parsedInput })
          this.toolIdToName.set(state.currentToolId, state.currentToolName)
          events.push({ type: 'agent_content', parent_tool_use_id: parentId, block_type: 'tool_use', id: state.currentToolId, name: state.currentToolName, input: parsedInput })
          state.currentToolId = ''; state.currentToolName = ''; state.inputJson = ''
        } else if (state.inTextBlock) {
          if (state.textAccumulator) this.pushAgentSubBlock(parentId, { type: 'text', text: state.textAccumulator })
          state.inTextBlock = false; state.textAccumulator = ''
        }
        break
      }
    }
    return events
  }

  private mapAgentAssistantMessage(parentId: string, msg: Extract<SDKMessage, { type: 'assistant' }>): SseEvent[] {
    const events: SseEvent[] = []
    for (const block of msg.message.content) {
      if (block.type === 'text' && block.text) {
        this.pushAgentSubBlock(parentId, { type: 'text', text: block.text })
        events.push({ type: 'agent_content', parent_tool_use_id: parentId, block_type: 'text', text: block.text })
      } else if (block.type === 'thinking') {
        const thinkBlock = block as { type: 'thinking'; thinking: string }
        const existingSubBlocks = this.agentSubBlocks.get(parentId) || []
        if (thinkBlock.thinking && !existingSubBlocks.some(b => b.type === 'thinking')) {
          this.pushAgentSubBlock(parentId, { type: 'thinking', text: thinkBlock.thinking })
          events.push({ type: 'agent_content', parent_tool_use_id: parentId, block_type: 'thinking', text: thinkBlock.thinking })
        }
      } else if (block.type === 'tool_use') {
        const toolBlock = block as { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
        this.pushAgentSubBlock(parentId, { type: 'tool_use', id: toolBlock.id, name: toolBlock.name, input: toolBlock.input })
        this.toolIdToName.set(toolBlock.id, toolBlock.name)
        events.push({ type: 'agent_content', parent_tool_use_id: parentId, block_type: 'tool_use', id: toolBlock.id, name: toolBlock.name, input: toolBlock.input })
      }
    }
    return events
  }

  private mapAgentUserMessage(parentId: string, msg: Extract<SDKMessage, { type: 'user' }>): SseEvent[] {
    const events: SseEvent[] = []
    const message = msg.message
    if ('content' in message && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (typeof block !== 'object' || block === null || !('type' in block)) continue
        if (block.type === 'tool_result') {
          const toolResult = block as { type: 'tool_result'; tool_use_id: string; content?: unknown; is_error?: boolean }
          const content = this.toolResultContentToText(toolResult.content)
          const truncatedContent = content.length > 3000 ? content.slice(0, 3000) + ' [truncated]' : content
          const isMainThreadTool = this.allBlocks.some(b => b.type === 'tool_use' && b.id === toolResult.tool_use_id)
          if (isMainThreadTool) {
            const toolName = this.toolIdToName.get(toolResult.tool_use_id) || ''
            const isAgentTool = toolName === 'Agent' || toolName === 'delegate_to_agent'
            let rawContent = toolResult.content
            if (typeof rawContent === 'string') { try { rawContent = JSON.parse(rawContent) } catch { /* not JSON */ } }
            if (isAgentTool && Array.isArray(rawContent)) {
              const contentBlocks = rawContent as { type: string; text?: string }[]
              const textParts: string[] = []
              for (const cb of contentBlocks) {
                if (cb.type === 'text' && cb.text) {
                  const cleanText = this.stripSdkMetadata(cb.text)
                  if (cleanText) {
                    this.pushAgentSubBlock(toolResult.tool_use_id, { type: 'text', text: cleanText })
                    events.push({ type: 'agent_content', parent_tool_use_id: toolResult.tool_use_id, block_type: 'text', text: cleanText })
                    textParts.push(cleanText)
                  }
                }
              }
              const fullText = textParts.join('\n') || content
              this.upsertToolResultBlock(toolResult.tool_use_id, fullText, !!toolResult.is_error)
              events.push({ type: 'tool_result', tool_use_id: toolResult.tool_use_id, name: toolName, result: fullText, is_error: !!toolResult.is_error })
            } else {
              this.upsertToolResultBlock(toolResult.tool_use_id, truncatedContent, !!toolResult.is_error)
              events.push({ type: 'tool_result', tool_use_id: toolResult.tool_use_id, name: toolName || 'unknown', result: truncatedContent.length > 2000 ? truncatedContent.slice(0, 2000) + ' [truncated]' : truncatedContent, is_error: !!toolResult.is_error })
            }
            continue
          }
          const subBlock = { type: 'tool_result', tool_use_id: toolResult.tool_use_id, content: truncatedContent, is_error: !!toolResult.is_error }
          this.pushAgentSubBlock(parentId, subBlock)
          events.push({ type: 'agent_content', parent_tool_use_id: parentId, block_type: 'tool_result', tool_use_id: toolResult.tool_use_id, content: subBlock.content, is_error: subBlock.is_error })
        }
      }
    }
    return events
  }

  private mapStreamEvent(msg: Extract<SDKMessage, { type: 'stream_event' }>): SseEvent[] {
    const event = msg.event
    const events: SseEvent[] = []

    switch (event.type) {
      case 'content_block_start': {
        const block = event.content_block
        if (block.type === 'tool_use') {
          this.currentToolId = block.id; this.currentToolName = block.name; this.inputJson = ''
        } else if (block.type === 'thinking') {
          this.inThinkingBlock = true; this.thinkingText = ''
          events.push({ type: 'thinking_start' })
        }
        break
      }
      case 'content_block_delta': {
        const delta = event.delta
        if (delta.type === 'text_delta') {
          events.push({ type: 'text_delta', text: delta.text })
        } else if (delta.type === 'thinking_delta') {
          const text = (delta as unknown as Record<string, unknown>).thinking as string || ''
          this.thinkingText += text
          events.push({ type: 'thinking_delta', text })
        } else if (delta.type === 'input_json_delta') {
          this.inputJson += delta.partial_json
        }
        break
      }
      case 'content_block_stop': {
        if (this.inThinkingBlock) {
          if (this.thinkingText && !this.allBlocks.some(b => b.type === 'thinking' && (b as Record<string, unknown>).text === this.thinkingText)) {
            this.allBlocks.push({ type: 'thinking', text: this.thinkingText })
          }
          this.inThinkingBlock = false; this.thinkingText = ''
        } else if (this.currentToolId) {
          let parsedInput: Record<string, unknown> = {}
          try { parsedInput = JSON.parse(this.inputJson || '{}') } catch { /* empty */ }
          events.push({ type: 'tool_use', id: this.currentToolId, name: this.currentToolName, input: parsedInput })
          this.allBlocks.push({ type: 'tool_use', id: this.currentToolId, name: this.currentToolName, input: parsedInput })
          this.toolIdToName.set(this.currentToolId, this.currentToolName)
          this.currentToolId = ''; this.currentToolName = ''; this.inputJson = ''
        }
        break
      }
    }
    return events
  }

  private mapAssistantMessage(msg: Extract<SDKMessage, { type: 'assistant' }>): SseEvent[] {
    for (const block of msg.message.content) {
      if (block.type === 'text') {
        this.allBlocks.push({ type: 'text', text: block.text })
      } else if (block.type === 'thinking') {
        const thinkBlock = block as { type: 'thinking'; thinking: string }
        if (thinkBlock.thinking && !this.allBlocks.some(b => b.type === 'thinking')) {
          this.allBlocks.push({ type: 'thinking', text: thinkBlock.thinking })
        }
      }
    }
    return []
  }

  private mapToolUseSummary(msg: Extract<SDKMessage, { type: 'tool_use_summary' }>): SseEvent[] {
    const toolUseIds = msg.preceding_tool_use_ids
    const events: SseEvent[] = []
    for (const toolUseId of toolUseIds) {
      const toolName = this.toolIdToName.get(toolUseId) || ''
      if (this.isImageGenerationToolName(toolName)) continue
      const isError = this.erroredToolUseIds.has(toolUseId)
      if (!this.addSummaryToolResultBlock(toolUseId, msg.summary, isError)) continue
      events.push({
        type: 'tool_result',
        tool_use_id: toolUseId,
        name: toolName,
        result: msg.summary.length > 2000 ? msg.summary.slice(0, 2000) + ' [truncated]' : msg.summary,
        is_error: isError,
      })
    }
    return events
  }

  private mapToolProgress(msg: Extract<SDKMessage, { type: 'tool_progress' }>): SseEvent[] {
    const parentId = (msg as Record<string, unknown>).parent_tool_use_id as string | null
    if (parentId) {
      return [{ type: 'agent_content', parent_tool_use_id: parentId, block_type: 'tool_progress', tool_use_id: msg.tool_use_id, tool_name: msg.tool_name, elapsed_time_seconds: msg.elapsed_time_seconds }]
    }
    return [{ type: 'tool_progress', tool_use_id: msg.tool_use_id, tool_name: msg.tool_name, elapsed_time_seconds: msg.elapsed_time_seconds }]
  }

  private mapSystemMessage(msg: SDKMessage): SseEvent[] {
    const m = msg as Record<string, unknown>
    if (m.subtype === 'init' && typeof m.session_id === 'string') {
      this.sdkSessionId = m.session_id
    }
    if (m.subtype === 'compact_boundary') {
      const metadata = m.compact_metadata as Record<string, unknown> | undefined
      return [{
        type: 'compact_boundary',
        trigger: metadata?.trigger || m.trigger || 'manual',
        preTokens: metadata?.pre_tokens,
        metadata,
      }]
    }
    if (m.subtype === 'task_started') {
      const event = { type: 'task_started', task_id: m.task_id, description: m.description,
                subagent_type: m.subagent_type, task_type: m.task_type, tool_use_id: m.tool_use_id }
      this.allBlocks.push({ type: 'task_event', event: 'task_started', task_id: m.task_id, payload: event, created_at: Date.now() })
      return [event]
    }
    if (m.subtype === 'task_progress') {
      const event = { type: 'task_progress', task_id: m.task_id, description: m.description,
                last_tool_name: m.last_tool_name, summary: m.summary, usage: m.usage }
      this.allBlocks.push({ type: 'task_event', event: 'task_progress', task_id: m.task_id, payload: event, created_at: Date.now() })
      return [event]
    }
    if (m.subtype === 'task_updated') {
      const event = { type: 'task_updated', task_id: m.task_id, patch: m.patch }
      this.allBlocks.push({ type: 'task_event', event: 'task_updated', task_id: m.task_id, payload: event, created_at: Date.now() })
      return [event]
    }
    if (m.subtype === 'task_notification') {
      const event = { type: 'task_notification', task_id: m.task_id, status: m.status,
                summary: m.summary, usage: m.usage }
      this.allBlocks.push({ type: 'task_event', event: 'task_notification', task_id: m.task_id, payload: event, created_at: Date.now() })
      return [event]
    }
    return []
  }

  private mapUserMessage(msg: Extract<SDKMessage, { type: 'user' }>): SseEvent[] {
    const events: SseEvent[] = []
    const message = msg.message
    if ('content' in message && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (typeof block !== 'object' || block === null || !('type' in block)) continue
        if (block.type === 'tool_result') {
          const toolResult = block as { type: 'tool_result'; tool_use_id: string; content?: unknown; is_error?: boolean }
          const toolName = this.toolIdToName.get(toolResult.tool_use_id) || 'unknown'
          if (toolResult.is_error) this.erroredToolUseIds.add(toolResult.tool_use_id)

          const isAgentTool = toolName === 'Agent' || toolName === 'delegate_to_agent'
          if (isAgentTool && Array.isArray(toolResult.content)) {
            const contentBlocks = toolResult.content as { type: string; text?: string }[]
            const textParts: string[] = []
            for (const cb of contentBlocks) {
              if (cb.type === 'text' && cb.text) {
                const cleanText = this.stripSdkMetadata(cb.text)
                if (cleanText) {
                  this.pushAgentSubBlock(toolResult.tool_use_id, { type: 'text', text: cleanText })
                  events.push({ type: 'agent_content', parent_tool_use_id: toolResult.tool_use_id, block_type: 'text', text: cleanText })
                  textParts.push(cleanText)
                }
              }
            }
            const fullText = textParts.join('\n') || JSON.stringify(toolResult.content) || ''
            this.upsertToolResultBlock(toolResult.tool_use_id, fullText, !!toolResult.is_error)
            events.push({ type: 'tool_result', tool_use_id: toolResult.tool_use_id, name: toolName, result: fullText, is_error: !!toolResult.is_error })
          } else {
            const contentStr = this.toolResultContentToText(toolResult.content)
            const truncated = (contentStr?.length ?? 0) > 3000 ? contentStr!.slice(0, 3000) + ' [truncated]' : (contentStr || '')
            this.upsertToolResultBlock(toolResult.tool_use_id, truncated, !!toolResult.is_error)
            events.push({
              type: 'tool_result',
              tool_use_id: toolResult.tool_use_id,
              name: toolName,
              result: truncated.length > 2000 ? truncated.slice(0, 2000) + ' [truncated]' : truncated,
              is_error: !!toolResult.is_error,
            })
          }

          const rawContent = toolResult.content ? this.extractRawContent(toolResult.content) : null
          events.push({
            type: 'tool_raw_result',
            tool_use_id: toolResult.tool_use_id,
            tool_name: toolName,
            raw_content: rawContent ?? { type: 'text', text: toolResult.is_error ? '(tool returned an error)' : '(empty result)' },
          })
        }
        if (block.type === 'web_search_tool_result') {
          const wsBlock = block as { type: 'web_search_tool_result'; tool_use_id: string; content: unknown }
          const results = this.extractWebSearchResults(wsBlock.content)
          if (results) {
            events.push({ type: 'tool_raw_result', tool_use_id: wsBlock.tool_use_id, tool_name: 'WebSearch', raw_content: results })
          }
        }
      }
    }
    return events
  }

  private stripSdkMetadata(text: string): string {
    return text
      .replace(/\n*agentId:\s*\S+\s*\(for resuming[^)]*\)\s*/g, '')
      .replace(/<usage>[\s\S]*?<\/usage>\s*/g, '')
      .trim()
  }

  private extractRawContent(content: unknown): Record<string, unknown> | null {
    if (typeof content === 'string') {
      if (!content) return null
      return { type: 'text', text: content.length > 3000 ? content.slice(0, 3000) + '\n[truncated]' : content }
    }
    if (Array.isArray(content)) {
      const webResults = this.extractWebSearchResults(content)
      if (webResults) return webResults
      const texts = content
        .filter((item: Record<string, unknown>) => item?.type === 'text' && item?.text)
        .map((item: Record<string, unknown>) => String(item.text))
      if (texts.length > 0) {
        const joined = texts.join('\n')
        return { type: 'text', text: joined.length > 3000 ? joined.slice(0, 3000) + '\n[truncated]' : joined }
      }
    }
    return null
  }

  private extractWebSearchResults(content: unknown): Record<string, unknown> | null {
    if (!Array.isArray(content)) return null
    const results = content.filter((item: Record<string, unknown>) => item?.type === 'web_search_result' && item?.title && item?.url)
    if (results.length === 0) return null
    return { type: 'web_search', results: results.map((r: Record<string, unknown>) => ({ title: String(r.title), url: String(r.url) })) }
  }

  private mapResult(msg: Extract<SDKMessage, { type: 'result' }>): SseEvent[] {
    if ('usage' in msg && msg.usage) {
      const usage = msg.usage as {
        input_tokens?: number
        output_tokens?: number
        cache_creation_input_tokens?: number
        cache_read_input_tokens?: number
      }
      this.inputTokens = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0)
      this.outputTokens = usage.output_tokens || 0
    }
    if ((!this.inputTokens && !this.outputTokens) && 'modelUsage' in msg && msg.modelUsage) {
      const modelUsage = msg.modelUsage as Record<string, {
        inputTokens?: number
        outputTokens?: number
        cacheCreationInputTokens?: number
        cacheReadInputTokens?: number
      }>
      this.inputTokens = Object.values(modelUsage).reduce(
        (sum, usage) => sum + (usage.inputTokens || 0) + (usage.cacheCreationInputTokens || 0) + (usage.cacheReadInputTokens || 0),
        0,
      )
      this.outputTokens = Object.values(modelUsage).reduce((sum, usage) => sum + (usage.outputTokens || 0), 0)
    }
    if (msg.subtype === 'success') return []
    const errorMsg = msg.subtype.startsWith('error') && 'errors' in msg && Array.isArray(msg.errors)
      ? msg.errors.join('; ')
      : 'Execution failed'
    return [{ type: 'error', error: errorMsg }]
  }
}
