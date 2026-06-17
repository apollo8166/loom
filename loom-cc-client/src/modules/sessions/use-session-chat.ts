'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import type { Message, ContentBlock, AgentSubBlock, SessionBoundaryGroup, TaskInfo, TaskStatus, SdkContextUsage, AskUserQuestionItem, AskUserQuestionAnswers, AskUserQuestionAnnotations } from '@/shared/types'

interface RawMessage {
  id: string
  session_id: string
  context_version: number
  role: 'user' | 'assistant'
  content: string
  elapsed_seconds?: number
  input_tokens?: number
  output_tokens?: number
  sdk_context_usage?: string
  created_at: string
}

interface RawBoundary {
  id: string
  session_id: string
  boundary_type: string
  from_runtime_session_id: string | null
  to_runtime_session_id: string | null
  summary: string | null
  compact_source?: string
  metadata?: string
  created_at: string
}

export interface MemoryRuntimeNotice {
  retrievedCount: number
  injectedChars: number
  budgetChars?: number
  globalSummaryChars?: number
  projectSummaryChars?: number
  retrievedChars?: number
  rawRetrievedCount?: number
  truncated?: boolean
  candidateCount: number
  extractionQueued: boolean
  createdAt: number
}

const SESSION_MESSAGES_CACHE_TTL = 60_000
const sessionMessagesCache = new Map<string, {
  at: number
  groups: SessionBoundaryGroup[]
  tasks: Map<string, TaskInfo>
}>()

function cloneGroups(groups: SessionBoundaryGroup[]): SessionBoundaryGroup[] {
  return groups.map(group => ({
    ...group,
    messages: [...group.messages],
    boundary: group.boundary ? { ...group.boundary } : null,
  }))
}

function makeClientMessageId(prefix: string): string {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${randomId}`
}

function preferRuntimeNumber(existing: number | undefined, incoming: number | undefined): number | undefined {
  if (incoming !== undefined && incoming > 0) return incoming
  return existing ?? incoming
}

function mergeDuplicateMessage(existing: Message, incoming: Message): Message {
  return {
    ...existing,
    ...incoming,
    createdAt: existing.createdAt || incoming.createdAt,
    blocks: incoming.blocks.length > 0 ? incoming.blocks : existing.blocks,
    content: incoming.content || existing.content,
    elapsedSeconds: preferRuntimeNumber(existing.elapsedSeconds, incoming.elapsedSeconds),
    inputTokens: preferRuntimeNumber(existing.inputTokens, incoming.inputTokens),
    outputTokens: preferRuntimeNumber(existing.outputTokens, incoming.outputTokens),
    sdkContextUsage: incoming.sdkContextUsage || existing.sdkContextUsage,
  }
}

function dedupeMessagesById(messages: Message[]): Message[] {
  const result: Message[] = []
  const indexById = new Map<string, number>()
  for (const message of messages) {
    const existingIdx = indexById.get(message.id)
    if (existingIdx === undefined) {
      indexById.set(message.id, result.length)
      result.push(message)
      continue
    }
    result[existingIdx] = mergeDuplicateMessage(result[existingIdx], message)
  }
  return result
}

function dedupeGroups(groups: SessionBoundaryGroup[]): SessionBoundaryGroup[] {
  const result = groups.map(group => ({
    ...group,
    messages: [] as Message[],
  }))
  const indexById = new Map<string, { groupIdx: number; messageIdx: number }>()

  groups.forEach((group, groupIdx) => {
    for (const message of dedupeMessagesById(group.messages)) {
      const existing = indexById.get(message.id)
      if (!existing) {
        indexById.set(message.id, {
          groupIdx,
          messageIdx: result[groupIdx].messages.length,
        })
        result[groupIdx].messages.push(message)
        continue
      }
      const messages = result[existing.groupIdx].messages
      messages[existing.messageIdx] = mergeDuplicateMessage(messages[existing.messageIdx], message)
    }
  })

  return result
}

function parseSdkContextUsage(raw: string | null | undefined): SdkContextUsage | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const usage = parsed as Partial<SdkContextUsage>
    if (typeof usage.totalTokens !== 'number' || typeof usage.maxTokens !== 'number') return null
    return usage as SdkContextUsage
  } catch {
    return null
  }
}

function requestMemoryPanelRefresh(detail: Record<string, unknown>) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('loom:memory-refresh-requested', { detail }))
}

function parseBlocks(content: string): ContentBlock[] {
  try {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed)) return parsed
  } catch { /* plain text */ }
  return [{ type: 'text', text: content }]
}

function mapRawMessage(m: RawMessage): Message {
  return {
    id: m.id,
    sessionId: m.session_id,
    role: m.role,
    content: m.content,
    blocks: parseBlocks(m.content),
    createdAt: m.created_at,
    elapsedSeconds: m.elapsed_seconds ?? 0,
    inputTokens: m.input_tokens ?? 0,
    outputTokens: m.output_tokens ?? 0,
    sdkContextUsage: parseSdkContextUsage(m.sdk_context_usage),
  }
}

function parseBoundaryMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function taskStatusFromEvent(status: string): TaskStatus {
  return status === 'stopped' ? 'killed' : status as TaskStatus
}

function makeRuntimeTaskEventBlock(event: Record<string, unknown>): ContentBlock | null {
  const eventType = String(event.type || '')
  if (!['task_started', 'task_progress', 'task_updated', 'task_notification'].includes(eventType)) return null
  const taskId = typeof event.task_id === 'string' ? event.task_id : ''
  if (!taskId) return null
  return {
    type: 'task_event',
    event: eventType,
    task_id: taskId,
    payload: { ...event },
    created_at: Date.now(),
  }
}

function rebuildTasksFromMessages(messages: Message[]): Map<string, TaskInfo> {
  const rebuilt = new Map<string, TaskInfo>()
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type !== 'task_event') continue
      const payload = block.payload
      const taskId = block.task_id
      if (block.event === 'task_started') {
        rebuilt.set(taskId, {
          id: taskId,
          description: String(payload.description || ''),
          status: 'running',
          subagentType: typeof payload.subagent_type === 'string' ? payload.subagent_type : undefined,
          taskType: typeof payload.task_type === 'string' ? payload.task_type : undefined,
          startedAt: block.created_at || new Date(message.createdAt || Date.now()).getTime(),
        })
        continue
      }

      const existing = rebuilt.get(taskId)
      if (!existing) continue

      if (block.event === 'task_progress') {
        rebuilt.set(taskId, {
          ...existing,
          description: typeof payload.description === 'string' && payload.description ? payload.description : existing.description,
          lastToolName: typeof payload.last_tool_name === 'string' ? payload.last_tool_name : existing.lastToolName,
          summary: typeof payload.summary === 'string' ? payload.summary : existing.summary,
          usage: payload.usage as TaskInfo['usage'] | undefined,
        })
        continue
      }

      if (block.event === 'task_updated') {
        const patch = payload.patch as Record<string, unknown> | undefined
        if (!patch) continue
        rebuilt.set(taskId, {
          ...existing,
          ...(patch.status !== undefined ? { status: taskStatusFromEvent(String(patch.status)) } : {}),
          ...(patch.description !== undefined ? { description: String(patch.description) } : {}),
          ...(patch.end_time !== undefined ? { endedAt: Number(patch.end_time) } : {}),
          ...(patch.total_paused_ms !== undefined ? { totalPausedMs: Number(patch.total_paused_ms) } : {}),
          ...(patch.error !== undefined ? { error: String(patch.error) } : {}),
          ...(patch.is_backgrounded !== undefined ? { isBackgrounded: Boolean(patch.is_backgrounded) } : {}),
        })
        continue
      }

      if (block.event === 'task_notification') {
        rebuilt.set(taskId, {
          ...existing,
          status: taskStatusFromEvent(String(payload.status || existing.status)),
          summary: typeof payload.summary === 'string' ? payload.summary : existing.summary,
          usage: payload.usage as TaskInfo['usage'] | undefined,
          endedAt: block.created_at || Date.now(),
        })
      }
    }
  }
  return rebuilt
}

const IM_STREAM_TIMEOUT_MS = 310_000

export function useSessionChat(sessionId: string | null) {
  const [groups, setGroups] = useState<SessionBoundaryGroup[]>([])
  const [streaming, setStreaming] = useState(false)
  const [isThinking, setIsThinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCompacting, setIsCompacting] = useState(false)
  const [compactingText, setCompactingText] = useState('')
  const [tasks, setTasks] = useState<Map<string, TaskInfo>>(new Map())
  const [memoryNotice, setMemoryNotice] = useState<MemoryRuntimeNotice | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const abortSessionRef = useRef<string | null>(null)
  const compactSessionIdsRef = useRef<Set<string>>(new Set())

  const messages = useMemo(() => groups.flatMap(g => g.messages), [groups])
  const commitGroups = useCallback((
    next: SessionBoundaryGroup[] | ((prev: SessionBoundaryGroup[]) => SessionBoundaryGroup[]),
  ) => {
    setGroups(prev => dedupeGroups(typeof next === 'function' ? next(prev) : next))
  }, [])

  const streamingForSessionRef = useRef<string | null>(null)
  const localStreamingForSessionRef = useRef<string | null>(null)
  const currentSessionRef = useRef<string | null>(null)
  const viewGenerationRef = useRef(0)
  // Keep a ref to groups so streamPending() can read current state without being in its dep array
  const groupsRef = useRef<SessionBoundaryGroup[]>(groups)
  useEffect(() => { currentSessionRef.current = sessionId }, [sessionId])
  useEffect(() => { groupsRef.current = groups }, [groups])
  useEffect(() => {
    viewGenerationRef.current += 1
    streamingForSessionRef.current = null
    localStreamingForSessionRef.current = null
    commitGroups(sessionId ? [{ contextVersion: 0, messages: [], boundary: null }] : [])
    setStreaming(false)
    setIsThinking(false)
    setError(null)
    setIsCompacting(Boolean(sessionId && compactSessionIdsRef.current.has(sessionId)))
    if (!sessionId || !compactSessionIdsRef.current.has(sessionId)) setCompactingText('')
    setTasks(new Map())
    setMemoryNotice(null)
  }, [sessionId])

  const loadMessages = useCallback(async (sid: string) => {
    try {
      const cached = sessionMessagesCache.get(sid)
      if (cached && Date.now() - cached.at < SESSION_MESSAGES_CACHE_TTL && streamingForSessionRef.current !== sid) {
        commitGroups(cloneGroups(cached.groups))
        setTasks(new Map(cached.tasks))
        setStreaming(false)
        setError(null)
      }

      const res = await fetch(`/api/sessions/${sid}/messages`)
      const data = await res.json()
      const rawMessages: RawMessage[] = data.messages ?? []
      const rawBoundaries: RawBoundary[] = data.boundaries ?? []
      const currentContextVersion = typeof data.contextVersion === 'number' ? data.contextVersion : 0
      const mapped = rawMessages.map(mapRawMessage)
      const rawVersionById = new Map(rawMessages.map(m => [m.id, m.context_version ?? 0]))

      // Group by context_version
      const versionMap = new Map<number, Message[]>()
      for (const m of mapped) {
        const cv = rawVersionById.get(m.id) ?? 0
        if (!versionMap.has(cv)) versionMap.set(cv, [])
        versionMap.get(cv)!.push(m)
      }

      // Build groups; each group except the last gets the boundary that followed it
      // boundaries[i] corresponds to the end of group[i] (there is always one fewer boundary than groups)
      const newGroups: SessionBoundaryGroup[] = []
      const sortedVersions = [...versionMap.keys()].sort((a, b) => a - b)
      for (let i = 0; i < sortedVersions.length; i++) {
        const cv = sortedVersions[i]
        const rawB = rawBoundaries[i] ?? null
        const boundary = rawB ? {
          id: rawB.id,
          sessionId: rawB.session_id,
          boundaryType: rawB.boundary_type as 'clear' | 'compact' | 'manual',
          summary: rawB.summary ?? null,
          compactSource: rawB.compact_source,
          metadata: parseBoundaryMetadata(rawB.metadata),
          createdAt: rawB.created_at,
        } : null
        newGroups.push({
          contextVersion: cv,
          messages: versionMap.get(cv)!,
          boundary,
        })
      }

      // If empty, still create one group for the current context
      if (newGroups.length === 0) {
        newGroups.push({ contextVersion: currentContextVersion, messages: [], boundary: null })
      } else if (!newGroups.some(g => g.contextVersion === currentContextVersion)) {
        newGroups.push({ contextVersion: currentContextVersion, messages: [], boundary: null })
      } else {
        const currentIdx = newGroups.findIndex(g => g.contextVersion === currentContextVersion)
        if (currentIdx >= 0) newGroups[currentIdx] = { ...newGroups[currentIdx], boundary: null }
      }

      // Don't overwrite groups while a stream is in progress for this session —
      // doing so would wipe out the temp streaming messages added by sendMessage.
      if (streamingForSessionRef.current === sid) return
      if (currentSessionRef.current !== sid) return

      const dedupedGroups = dedupeGroups(newGroups)
      commitGroups(dedupedGroups)
      const rebuiltTasks = rebuildTasksFromMessages(mapped)
      setTasks(rebuiltTasks)
      sessionMessagesCache.set(sid, {
        at: Date.now(),
        groups: cloneGroups(dedupedGroups),
        tasks: new Map(rebuiltTasks),
      })
      setStreaming(false)
      setError(null)
    } catch (err) {
      console.error('Failed to load messages:', err)
    }
  }, [commitGroups])

  useEffect(() => {
    if (!sessionId) return

    const source = new EventSource(`/api/sessions/${sessionId}/events`)
    let assistantMessageId: string | null = null
    let currentTextBlockIdx = -1
    let currentThinkingBlockIdx = -1
    let pendingText = ''
    let pendingThinking = ''
    let pendingRaf: number | null = null
    let startedAt = 0
    let timer: ReturnType<typeof setInterval> | null = null
    let timeout: ReturnType<typeof setTimeout> | null = null
    let terminal = false
    const seenEventIds = new Set<number>()
    const agentPending = new Map<string, {
      pendingText: string; pendingThinking: string; currentTextIdx: number; currentThinkingIdx: number
    }>()

    const clearTimer = () => {
      if (timer) clearInterval(timer)
      timer = null
    }

    const clearStreamTimeout = () => {
      if (timeout) clearTimeout(timeout)
      timeout = null
    }

    const updateLastGroup = (updater: (messages: Message[]) => Message[]) => {
      commitGroups(prev => {
        const updated = [...prev]
        const lastIdx = updated.length - 1
        if (lastIdx >= 0) {
          updated[lastIdx] = { ...updated[lastIdx], messages: updater(updated[lastIdx].messages) }
        }
        return updated
      })
    }

    const flushText = () => {
      if ((!pendingText && !pendingThinking) || !assistantMessageId) return
      const text = pendingText
      const thinking = pendingThinking
      pendingText = ''
      pendingThinking = ''
      if (pendingRaf !== null) {
        cancelAnimationFrame(pendingRaf)
        pendingRaf = null
      }
      updateLastGroup(messages => messages.map(message => {
        if (message.id !== assistantMessageId) return message
        const blocks = [...message.blocks]
        if (thinking) {
          if (currentThinkingBlockIdx < 0 || blocks[currentThinkingBlockIdx]?.type !== 'thinking') {
            blocks.push({ type: 'thinking', text: '' })
            currentThinkingBlockIdx = blocks.length - 1
          }
          const block = blocks[currentThinkingBlockIdx]
          if (block.type === 'thinking') blocks[currentThinkingBlockIdx] = { ...block, text: block.text + thinking }
        }
        if (text) {
          if (currentTextBlockIdx < 0 || blocks[currentTextBlockIdx]?.type !== 'text') {
            blocks.push({ type: 'text', text: '' })
            currentTextBlockIdx = blocks.length - 1
          }
          const block = blocks[currentTextBlockIdx]
          if (block.type === 'text') blocks[currentTextBlockIdx] = { ...block, text: block.text + text }
        }
        return { ...message, blocks }
      }))
    }

    const ensureAssistantMessage = (messageId?: string | null, createdAt?: string) => {
      if (!assistantMessageId) {
        assistantMessageId = messageId || makeClientMessageId('im-assistant')
      }
      updateLastGroup(messages => messages.some(message => message.id === assistantMessageId)
        ? messages
        : [...messages, {
            id: assistantMessageId || makeClientMessageId('im-assistant'),
            sessionId,
            role: 'assistant',
            content: '',
            blocks: [],
            createdAt: createdAt || new Date().toISOString(),
          }]
      )
    }

    const flushAgentText = () => {
      if (!assistantMessageId) return
      for (const [parentId, state] of agentPending) {
        if (!state.pendingText && !state.pendingThinking) continue
        const text = state.pendingText
        const thinking = state.pendingThinking
        state.pendingText = ''
        state.pendingThinking = ''
        updateLastGroup(messages => messages.map(message => {
          if (message.id !== assistantMessageId) return message
          const blocks = [...message.blocks]
          let acIdx = blocks.findIndex(block =>
            block.type === 'agent_content' && block.parent_tool_use_id === parentId,
          )
          if (acIdx < 0) {
            blocks.push({ type: 'agent_content', parent_tool_use_id: parentId, blocks: [] })
            acIdx = blocks.length - 1
          }
          const acBlock = blocks[acIdx] as { type: 'agent_content'; parent_tool_use_id: string; blocks: AgentSubBlock[] }
          const subBlocks = [...acBlock.blocks]
          if (thinking) {
            if (state.currentThinkingIdx < 0 || subBlocks[state.currentThinkingIdx]?.type !== 'thinking') {
              subBlocks.push({ type: 'thinking', text: '' })
              state.currentThinkingIdx = subBlocks.length - 1
            }
            const block = subBlocks[state.currentThinkingIdx]
            if (block.type === 'thinking') subBlocks[state.currentThinkingIdx] = { ...block, text: block.text + thinking }
          }
          if (text) {
            if (state.currentTextIdx < 0 || subBlocks[state.currentTextIdx]?.type !== 'text') {
              subBlocks.push({ type: 'text', text: '' })
              state.currentTextIdx = subBlocks.length - 1
            }
            const block = subBlocks[state.currentTextIdx]
            if (block.type === 'text') subBlocks[state.currentTextIdx] = { ...block, text: block.text + text }
          }
          blocks[acIdx] = { ...acBlock, blocks: subBlocks }
          return { ...message, blocks }
        }))
      }
    }

    const flushAll = () => {
      flushText()
      flushAgentText()
    }

    const scheduleFlush = () => {
      if (pendingRaf === null) {
        pendingRaf = requestAnimationFrame(() => {
          pendingRaf = null
          flushAll()
        })
      }
    }

    const startTimer = () => {
      if (timer) return
      ensureAssistantMessage()
      if (!assistantMessageId) return
      if (!startedAt) startedAt = Date.now()
      timer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000)
        updateLastGroup(messages => messages.map(message =>
          message.id === assistantMessageId ? { ...message, elapsedSeconds: elapsed } : message
        ))
      }, 1000)
    }

    const stopStreamingState = () => {
      clearTimer()
      clearStreamTimeout()
      setStreaming(false)
      setIsThinking(false)
      streamingForSessionRef.current = null
    }

    const finishTimeout = () => {
      if (terminal) return
      terminal = true
      flushAll()
      ensureAssistantMessage()
      const elapsedSeconds = startedAt ? Math.max(1, Math.ceil((Date.now() - startedAt) / 1000)) : 0
      const timeoutMessage = 'IM 响应超时，已停止等待。'
      updateLastGroup(messages => messages.map(message => {
        if (message.id !== assistantMessageId) return message
        const blocks = [...message.blocks]
        if (!blocks.some(block => block.type === 'text' && block.text === timeoutMessage)) {
          blocks.push({ type: 'text', text: timeoutMessage })
        }
        return { ...message, blocks, elapsedSeconds }
      }))
      stopStreamingState()
      setError(timeoutMessage)
      sessionMessagesCache.delete(sessionId)
    }

    const armStreamTimeout = () => {
      clearStreamTimeout()
      const remainingMs = startedAt
        ? IM_STREAM_TIMEOUT_MS - Math.max(0, Date.now() - startedAt)
        : IM_STREAM_TIMEOUT_MS
      if (remainingMs <= 0) {
        finishTimeout()
        return
      }
      timeout = setTimeout(finishTimeout, remainingMs)
    }

    const appendTaskEventToAssistant = (data: Record<string, unknown>) => {
      const taskBlock = makeRuntimeTaskEventBlock(data)
      if (!taskBlock) return
      ensureAssistantMessage()
      startTimer()
      armStreamTimeout()
      updateLastGroup(messages => messages.map(message =>
        message.id === assistantMessageId
          ? { ...message, blocks: [...message.blocks, taskBlock] }
          : message
      ))
    }

    source.onmessage = event => {
      let data: Record<string, unknown>
      try {
        data = JSON.parse(event.data) as Record<string, unknown>
      } catch {
        return
      }
      if (data.type === 'connected' || data.type === 'ping') return
      if (data.runtimeSource === 'runtime_chat' && localStreamingForSessionRef.current === sessionId) return
      const eventId = Number(data.eventId || 0)
      if (eventId > 0) {
        if (seenEventIds.has(eventId)) return
        seenEventIds.add(eventId)
      }
      if (terminal && data.type !== 'im_user_message' && data.type !== 'runtime_user_message') return

      if (data.type === 'im_user_message' || data.type === 'runtime_user_message') {
        terminal = false
        const messageId = data.messageId as string
        const blocks = (Array.isArray(data.blocks) ? data.blocks : []) as ContentBlock[]
        updateLastGroup(messages => messages.some(message => message.id === messageId)
          ? messages
          : [...messages, {
              id: messageId,
              sessionId,
              role: 'user',
              content: JSON.stringify(blocks),
              blocks,
              createdAt: (data.createdAt as string) || new Date().toISOString(),
            }]
        )
        return
      }

      if (data.type === 'im_assistant_started' || data.type === 'text_delta' || data.type === 'thinking_delta' || data.type === 'thinking_start') {
        terminal = false
        if (!assistantMessageId) {
          assistantMessageId = (data.messageId as string) || makeClientMessageId('runtime-assistant')
          currentTextBlockIdx = -1
          currentThinkingBlockIdx = -1
          pendingText = ''
          pendingThinking = ''
          startedAt = Date.parse((data.createdAt as string) || '') || Date.now()
          setStreaming(true)
          streamingForSessionRef.current = sessionId
          setError(null)
          ensureAssistantMessage(assistantMessageId, (data.createdAt as string) || new Date().toISOString())
          startTimer()
          armStreamTimeout()
        }
        if (data.type === 'thinking_delta') {
          pendingThinking += (data.text as string) || ''
          scheduleFlush()
          return
        }
        if (data.type === 'text_delta') {
          ensureAssistantMessage()
          pendingText += (data.text as string) || ''
          setIsThinking(false)
          startTimer()
          armStreamTimeout()
          scheduleFlush()
          return
        }
        if (data.type === 'thinking_start') {
          setIsThinking(true)
          return
        }
        return
      }

      if (data.type === 'task_started') {
        appendTaskEventToAssistant(data)
        const task: TaskInfo = {
          id: data.task_id as string,
          description: data.description as string,
          status: 'running',
          subagentType: data.subagent_type as string | undefined,
          taskType: data.task_type as string | undefined,
          startedAt: Date.now(),
        }
        setTasks(prev => new Map(prev).set(task.id, task))
        return
      }

      if (data.type === 'task_progress') {
        appendTaskEventToAssistant(data)
        setTasks(prev => {
          const next = new Map(prev)
          const existing = next.get(data.task_id as string)
          if (existing) {
            next.set(existing.id, {
              ...existing,
              description: (data.description as string) || existing.description,
              lastToolName: data.last_tool_name as string | undefined,
              summary: data.summary as string | undefined,
              usage: data.usage as TaskInfo['usage'],
            })
          }
          return next
        })
        return
      }

      if (data.type === 'task_updated') {
        appendTaskEventToAssistant(data)
        const patch = data.patch as Record<string, unknown> | undefined
        if (!patch) return
        setTasks(prev => {
          const next = new Map(prev)
          const existing = next.get(data.task_id as string)
          if (existing) {
            next.set(existing.id, {
              ...existing,
              ...(patch.status !== undefined ? { status: taskStatusFromEvent(String(patch.status)) } : {}),
              ...(patch.description !== undefined ? { description: String(patch.description) } : {}),
              ...(patch.end_time !== undefined ? { endedAt: Number(patch.end_time) } : {}),
              ...(patch.total_paused_ms !== undefined ? { totalPausedMs: Number(patch.total_paused_ms) } : {}),
              ...(patch.error !== undefined ? { error: String(patch.error) } : {}),
              ...(patch.is_backgrounded !== undefined ? { isBackgrounded: Boolean(patch.is_backgrounded) } : {}),
            })
          }
          return next
        })
        return
      }

      if (data.type === 'task_notification') {
        appendTaskEventToAssistant(data)
        setTasks(prev => {
          const next = new Map(prev)
          const existing = next.get(data.task_id as string)
          if (existing) {
            next.set(existing.id, {
              ...existing,
              status: taskStatusFromEvent(String(data.status || existing.status)),
              summary: data.summary as string | undefined,
              usage: data.usage as TaskInfo['usage'],
              endedAt: Date.now(),
            })
          }
          return next
        })
        return
      }

      if (data.type === 'agent_content') {
        const parentId = data.parent_tool_use_id as string
        const blockType = data.block_type as string
        if (!parentId) return
        ensureAssistantMessage()
        let state = agentPending.get(parentId)
        if (!state) {
          state = { pendingText: '', pendingThinking: '', currentTextIdx: -1, currentThinkingIdx: -1 }
          agentPending.set(parentId, state)
        }
        if (blockType === 'text_delta') {
          state.pendingText += (data.text as string) || ''
          scheduleFlush()
          return
        }
        if (blockType === 'thinking_delta') {
          state.pendingThinking += (data.text as string) || ''
          scheduleFlush()
          return
        }
        flushAll()
        updateLastGroup(messages => messages.map(message => {
          if (message.id !== assistantMessageId) return message
          const blocks = [...message.blocks]
          let acIdx = blocks.findIndex(block =>
            block.type === 'agent_content' && block.parent_tool_use_id === parentId,
          )
          if (acIdx < 0) {
            blocks.push({ type: 'agent_content', parent_tool_use_id: parentId, blocks: [] })
            acIdx = blocks.length - 1
          }
          const acBlock = blocks[acIdx] as { type: 'agent_content'; parent_tool_use_id: string; blocks: AgentSubBlock[] }
          const subBlocks = [...acBlock.blocks]
          if (blockType === 'tool_use') {
            subBlocks.push({ type: 'tool_use', id: data.id as string, name: data.name as string, input: data.input as Record<string, unknown> })
            state.currentTextIdx = -1
            state.currentThinkingIdx = -1
          } else if (blockType === 'tool_result') {
            subBlocks.push({ type: 'tool_result', tool_use_id: data.tool_use_id as string, content: data.content as string, is_error: Boolean(data.is_error) })
          } else if (blockType === 'tool_progress') {
            const toolUseId = data.tool_use_id as string
            const existingIdx = subBlocks.findIndex(block => block.type === 'tool_progress' && block.tool_use_id === toolUseId)
            const progressBlock: AgentSubBlock = { type: 'tool_progress', tool_use_id: toolUseId, tool_name: data.tool_name as string, elapsed_time_seconds: Number(data.elapsed_time_seconds || 0) }
            if (existingIdx >= 0) subBlocks[existingIdx] = progressBlock
            else subBlocks.push(progressBlock)
          } else if (blockType === 'thinking') {
            if (!subBlocks.some(block => block.type === 'thinking')) subBlocks.push({ type: 'thinking', text: data.text as string })
            state.currentThinkingIdx = -1
          } else if (blockType === 'text') {
            subBlocks.push({ type: 'text', text: data.text as string })
            state.currentTextIdx = -1
          }
          blocks[acIdx] = { ...acBlock, blocks: subBlocks }
          return { ...message, blocks }
        }))
        return
      }

      if (data.type === 'tool_use' || data.type === 'tool_result' || data.type === 'tool_raw_result' || data.type === 'tool_progress') {
        flushAll()
        ensureAssistantMessage()
        startTimer()
        armStreamTimeout()
        updateLastGroup(messages => messages.map(message => {
          if (message.id !== assistantMessageId) return message
          const blocks = [...message.blocks]
          if (data.type === 'tool_use') {
            const toolId = data.id as string
            if (!blocks.some(block => block.type === 'tool_use' && block.id === toolId)) {
              blocks.push({ type: 'tool_use', id: toolId, name: data.name as string, input: data.input as Record<string, unknown> })
            }
            currentTextBlockIdx = -1
            currentThinkingBlockIdx = -1
            setIsThinking(false)
          } else if (data.type === 'tool_result') {
            const toolUseId = data.tool_use_id as string
            if (!blocks.some(block => block.type === 'tool_result' && block.tool_use_id === toolUseId)) {
              blocks.push({ type: 'tool_result', tool_use_id: toolUseId, content: data.result as string, is_error: Boolean(data.is_error) })
            }
          } else if (data.type === 'tool_raw_result') {
            const toolUseId = data.tool_use_id as string
            if (!blocks.some(block => block.type === 'tool_raw_result' && block.tool_use_id === toolUseId)) {
              blocks.push({
                type: 'tool_raw_result',
                tool_use_id: toolUseId,
                tool_name: data.tool_name as string,
                raw_content: data.raw_content as ContentBlock & { type: 'tool_raw_result' } extends { raw_content: infer R } ? R : never,
              })
            }
          } else if (data.type === 'tool_progress') {
            const toolUseId = data.tool_use_id as string
            const existingIdx = blocks.findIndex(block => block.type === 'tool_progress' && block.tool_use_id === toolUseId)
            const progressBlock: ContentBlock = {
              type: 'tool_progress',
              tool_use_id: toolUseId,
              tool_name: data.tool_name as string,
              elapsed_time_seconds: Number(data.elapsed_time_seconds || 0),
            }
            if (existingIdx >= 0) blocks[existingIdx] = progressBlock
            else blocks.push(progressBlock)
          }
          return { ...message, blocks }
        }))
        return
      }

      if (data.type === 'error') {
        terminal = true
        flushAll()
        const errorMessage = (data.error as string) || 'IM stream failed'
        const elapsedSeconds = Number(data.elapsedSeconds || (startedAt ? Math.max(1, Math.ceil((Date.now() - startedAt) / 1000)) : 0))
        ensureAssistantMessage()
        updateLastGroup(messages => messages.map(message => {
          if (message.id !== assistantMessageId) return message
          const blocks = [...message.blocks]
          if (!blocks.some(block => block.type === 'text' && block.text === errorMessage)) {
            blocks.push({ type: 'text', text: errorMessage })
          }
          return { ...message, blocks, elapsedSeconds }
        }))
        stopStreamingState()
        setError(errorMessage)
        sessionMessagesCache.delete(sessionId)
        return
      }

      if (data.type === 'done') {
        terminal = true
        flushAll()
        const finalId = (data.messageId as string) || assistantMessageId
        const elapsedSeconds = Number(data.elapsedSeconds || (startedAt ? Math.max(1, Math.ceil((Date.now() - startedAt) / 1000)) : 0))
        const inputTokens = Number(data.inputTokens || 0)
        const outputTokens = Number(data.outputTokens || 0)
        updateLastGroup(messages => {
          const tempMessage = messages.find(message => message.id === assistantMessageId)
          const finalMessageExists = Boolean(finalId && finalId !== assistantMessageId && messages.some(message => message.id === finalId))
          if (finalMessageExists) {
            return messages.flatMap(message => {
              if (message.id === assistantMessageId) return []
              if (message.id === finalId) {
                return [{
                  ...message,
                  blocks: message.blocks.length > 0 ? message.blocks : (tempMessage?.blocks ?? message.blocks),
                  content: message.content || tempMessage?.content || '',
                  elapsedSeconds,
                  inputTokens,
                  outputTokens,
                }]
              }
              return [message]
            })
          }
          return messages.map(message =>
            message.id === assistantMessageId
              ? { ...message, id: finalId || message.id, elapsedSeconds, inputTokens, outputTokens }
              : message
          )
        })
        stopStreamingState()
        sessionMessagesCache.delete(sessionId)
      }
    }

    source.onerror = () => {
      // EventSource reconnects automatically; the IM timeout handles stale active turns.
    }

    return () => {
      clearTimer()
      clearStreamTimeout()
      if (pendingRaf !== null) cancelAnimationFrame(pendingRaf)
      source.close()
    }
  }, [commitGroups, loadMessages, sessionId])

  const clearMessages = useCallback(async () => {
    const targetSessionId = sessionId
    if (!targetSessionId) return
    try {
      const res = await fetch(`/api/sessions/${targetSessionId}/clear`, { method: 'POST' })
      if (!res.ok) return
      const data = await res.json()
      const newContextVersion = data.session?.context_version ?? 0

      if (currentSessionRef.current !== targetSessionId) {
        sessionMessagesCache.delete(targetSessionId)
        return
      }

      // Mark previous groups as having a 'clear' boundary and add empty new group
      commitGroups(prev => {
        const updated = prev.map((g, i) =>
          i === prev.length - 1
            ? {
                ...g,
                boundary: {
                  id: `clear-${Date.now()}`,
                  sessionId: targetSessionId,
                  boundaryType: 'clear' as const,
                  summary: null,
                  createdAt: new Date().toISOString(),
                },
              }
            : g
        )
        return [
          ...updated,
          { contextVersion: newContextVersion, messages: [], boundary: null },
        ]
      })
      sessionMessagesCache.delete(targetSessionId)
    } catch (err) {
      console.error('Failed to clear:', err)
    }
  }, [commitGroups, sessionId])

  const compact = useCallback(async (): Promise<{ summary: string; contextVersion: number; memoryFlushStatus?: string } | null> => {
    const targetSessionId = sessionId
    if (!targetSessionId || compactSessionIdsRef.current.has(targetSessionId)) return null
    const targetGroups = groupsRef.current
    const activeGroup = targetGroups[targetGroups.length - 1]
    if (!activeGroup || activeGroup.messages.length === 0) {
      if (currentSessionRef.current === targetSessionId) setError('No messages to compact')
      return null
    }
    compactSessionIdsRef.current.add(targetSessionId)
    setIsCompacting(true)
    setCompactingText('')

    try {
      // Call compact endpoint with summary generation
      const res = await fetch(`/api/sessions/${targetSessionId}/compact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: '' }),
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({})) as { error?: string }
        if (res.status === 400) {
          if (currentSessionRef.current === targetSessionId) setError(errorData.error || 'No messages to compact')
          return null
        }
        throw new Error(errorData.error || `Compact request failed (${res.status})`)
      }

      const data = await res.json()
      const newContextVersion = data.session?.context_version ?? 0
      const summary = data.summary ?? data.session?.compact_summary ?? ''
      const metadata = data.compactMetadata && typeof data.compactMetadata === 'object'
        ? data.compactMetadata as Record<string, unknown>
        : {}

      sessionMessagesCache.delete(targetSessionId)

      if (currentSessionRef.current !== targetSessionId) {
        if (data.memoryFlushStatus === 'queued') {
          requestMemoryPanelRefresh({
            reason: 'compact_flush',
            sessionId: targetSessionId,
            queuedAt: Date.now(),
          })
        }
        return { summary, contextVersion: newContextVersion, memoryFlushStatus: data.memoryFlushStatus }
      }

      // Update groups: add boundary to current group, create new empty group
      commitGroups(prev => {
        const updated = prev.map((g, i) =>
          i === prev.length - 1
            ? {
                ...g,
                boundary: {
                  id: `compact-${Date.now()}`,
                  sessionId: targetSessionId,
                  boundaryType: 'compact' as const,
                  summary,
                  compactSource: data.compactSource,
                  metadata,
                  createdAt: new Date().toISOString(),
                },
              }
            : g
        )
        return [
          ...updated,
          { contextVersion: newContextVersion, messages: [], boundary: null },
        ]
      })

      if (data.memoryFlushStatus === 'queued') {
        requestMemoryPanelRefresh({
          reason: 'compact_flush',
          sessionId: targetSessionId,
          queuedAt: Date.now(),
        })
      }

      return { summary, contextVersion: newContextVersion, memoryFlushStatus: data.memoryFlushStatus }
    } catch (err) {
      console.error('[compact]', err)
      if (currentSessionRef.current === targetSessionId) {
        setError(err instanceof Error ? err.message : 'Compact request failed')
      }
      return null
    } finally {
      compactSessionIdsRef.current.delete(targetSessionId)
      if (currentSessionRef.current === targetSessionId) {
        setIsCompacting(false)
        setCompactingText('')
      }
    }
  }, [commitGroups, sessionId])

  const sendMessage = useCallback(async (
    content: string,
    permissionMode?: string,
    thinkingMode?: string,
    attachments?: Array<{ name: string; filename: string; mimeType: string; tier: string; originalFilename?: string; displayFilename?: string; displayMimeType?: string; readable?: boolean; extractError?: string; placeholder?: string }>,
    planMode?: boolean,
    displayContent?: string,
    resumePending?: boolean,
    enabledSkills?: string[],
    agentName?: string,
  ) => {
    if (!sessionId) return
    if (!resumePending && !content.trim() && (!attachments || attachments.length === 0)) return
    if (streamingForSessionRef.current === sessionId) return

    streamingForSessionRef.current = sessionId
    localStreamingForSessionRef.current = sessionId
    const viewGeneration = viewGenerationRef.current
    const isCurrentSession = () => currentSessionRef.current === sessionId && viewGenerationRef.current === viewGeneration
    if (isCurrentSession()) setError(null)

    // Clean up orphaned temp messages
    if (isCurrentSession()) {
      commitGroups(prev => prev.map(g => ({
        ...g,
        messages: g.messages.reduce<Message[]>((acc, m) => {
          if (m.id.startsWith('temp-')) {
            if (m.blocks.length > 0) acc.push({ ...m, id: makeClientMessageId('orphan') })
          } else {
            acc.push(m)
          }
          return acc
        }, []),
      })))
    }

    // Build temp user message (skipped when resuming a pre-existing pending message)
    let tempUserMsg: Message | null = null
    if (!resumePending) {
      const displayText = displayContent !== undefined ? displayContent : content
      const userBlocks: ContentBlock[] = []
      if (displayText.trim()) userBlocks.push({ type: 'text', text: displayText.trim() })
      if (attachments && attachments.length > 0) {
        for (const a of attachments) {
          if (a.tier === 'image') {
            userBlocks.push({ type: 'image_attachment', url: `/api/files/serve/${a.filename}`, name: a.name })
          } else {
            const displayFilename = a.displayFilename || a.originalFilename || a.filename
            const displayMimeType = a.displayMimeType || a.mimeType
            userBlocks.push({
              type: 'file_attachment', url: `/api/files/serve/${displayFilename}`, name: a.name,
              size: 0, mimeType: displayMimeType,
              ...(a.originalFilename ? { originalFilename: a.originalFilename } : {}),
              ...(a.displayFilename ? { displayUrl: `/api/files/serve/${a.displayFilename}` } : {}),
              ...(a.displayMimeType ? { displayMimeType: a.displayMimeType } : {}),
            })
          }
        }
      }
      if (userBlocks.length === 0) userBlocks.push({ type: 'text', text: displayText.trim() })
      tempUserMsg = {
        id: makeClientMessageId('temp'),
        sessionId,
        role: 'user',
        content: displayText.trim(),
        blocks: userBlocks,
        createdAt: new Date().toISOString(),
      }
    }

    const tempAssistantId = makeClientMessageId('temp-assistant')
    const tempAssistantMsg: Message = {
      id: tempAssistantId,
      sessionId,
      role: 'assistant',
      content: '',
      blocks: [],
      createdAt: new Date().toISOString(),
    }

    // Append temp messages to the last group
    if (isCurrentSession()) {
      commitGroups(prev => {
        const updated = [...prev]
        const lastIdx = updated.length - 1
        const newMsgs = [...(tempUserMsg ? [tempUserMsg] : []), tempAssistantMsg]
        if (lastIdx >= 0) {
          updated[lastIdx] = {
            ...updated[lastIdx],
            messages: [...updated[lastIdx].messages, ...newMsgs],
          }
        } else {
          updated.push({ contextVersion: 0, messages: newMsgs, boundary: null })
        }
        return updated
      })
    }

    if (isCurrentSession()) setStreaming(true)
    const controller = new AbortController()
    abortRef.current = controller
    abortSessionRef.current = sessionId

    const updateLastGroup = (updater: (messages: Message[]) => Message[]) => {
      if (!isCurrentSession()) return
      commitGroups(prev => {
        const updated = [...prev]
        const lastIdx = updated.length - 1
        if (lastIdx >= 0) {
          updated[lastIdx] = { ...updated[lastIdx], messages: updater(updated[lastIdx].messages) }
        }
        return updated
      })
    }

    const appendTaskEventToTempAssistant = (event: Record<string, unknown>) => {
      const taskBlock = makeRuntimeTaskEventBlock(event)
      if (!taskBlock) return
      updateLastGroup(msgs =>
        msgs.map(m => m.id === tempAssistantId
          ? { ...m, blocks: [...m.blocks, taskBlock] }
          : m
        )
      )
    }

    // Turn-level timing
    let turnStartTime = 0
    let turnTimer: ReturnType<typeof setInterval> | null = null
    const startTurnTimer = () => {
      if (turnTimer) return
      turnStartTime = Date.now()
      turnTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - turnStartTime) / 1000)
        updateLastGroup(msgs =>
          msgs.map(m => m.id === tempAssistantId ? { ...m, elapsedSeconds: elapsed } : m)
        )
      }, 1000)
    }

    let currentTextBlockIdx = -1
    let currentThinkingBlockIdx = -1
    let pendingText = ''
    let pendingThinking = ''
    let pendingRaf: number | null = null

    const flushPendingText = () => {
      if (!pendingText && !pendingThinking) return
      const text = pendingText
      const thinking = pendingThinking
      pendingText = ''
      pendingThinking = ''
      if (pendingRaf !== null) { cancelAnimationFrame(pendingRaf); pendingRaf = null }
      updateLastGroup(msgs =>
        msgs.map(m => {
          if (m.id !== tempAssistantId) return m
          const blocks = [...m.blocks]
          if (thinking) {
            if (currentThinkingBlockIdx < 0 || blocks[currentThinkingBlockIdx]?.type !== 'thinking') {
              blocks.push({ type: 'thinking', text: '' })
              currentThinkingBlockIdx = blocks.length - 1
            }
            const tb = blocks[currentThinkingBlockIdx]
            if (tb.type === 'thinking') blocks[currentThinkingBlockIdx] = { ...tb, text: tb.text + thinking }
          }
          if (text) {
            if (currentTextBlockIdx < 0 || blocks[currentTextBlockIdx]?.type !== 'text') {
              blocks.push({ type: 'text', text: '' })
              currentTextBlockIdx = blocks.length - 1
            }
            const block = blocks[currentTextBlockIdx]
            if (block.type === 'text') blocks[currentTextBlockIdx] = { ...block, text: block.text + text }
          }
          return { ...m, blocks }
        })
      )
    }

    const agentPending = new Map<string, {
      pendingText: string; pendingThinking: string; currentTextIdx: number; currentThinkingIdx: number
    }>()

    const flushAgentText = () => {
      for (const [parentId, state] of agentPending) {
        if (!state.pendingText && !state.pendingThinking) continue
        const text = state.pendingText
        const thinking = state.pendingThinking
        state.pendingText = ''
        state.pendingThinking = ''
        updateLastGroup(msgs =>
          msgs.map(m => {
            if (m.id !== tempAssistantId) return m
            const blocks = [...m.blocks]
            let acIdx = blocks.findIndex(b => b.type === 'agent_content' && (b as { parent_tool_use_id: string }).parent_tool_use_id === parentId)
            if (acIdx < 0) { blocks.push({ type: 'agent_content', parent_tool_use_id: parentId, blocks: [] } as ContentBlock); acIdx = blocks.length - 1 }
            const acBlock = blocks[acIdx] as { type: 'agent_content'; parent_tool_use_id: string; blocks: AgentSubBlock[] }
            const subBlocks = [...acBlock.blocks]
            if (thinking) {
              if (state.currentThinkingIdx < 0 || subBlocks[state.currentThinkingIdx]?.type !== 'thinking') { subBlocks.push({ type: 'thinking', text: '' }); state.currentThinkingIdx = subBlocks.length - 1 }
              const tb = subBlocks[state.currentThinkingIdx]; if (tb.type === 'thinking') subBlocks[state.currentThinkingIdx] = { ...tb, text: tb.text + thinking }
            }
            if (text) {
              if (state.currentTextIdx < 0 || subBlocks[state.currentTextIdx]?.type !== 'text') { subBlocks.push({ type: 'text', text: '' }); state.currentTextIdx = subBlocks.length - 1 }
              const tb = subBlocks[state.currentTextIdx]; if (tb.type === 'text') subBlocks[state.currentTextIdx] = { ...tb, text: tb.text + text }
            }
            blocks[acIdx] = { ...acBlock, blocks: subBlocks } as ContentBlock
            return { ...m, blocks }
          })
        )
      }
    }

    const combinedFlush = () => { flushPendingText(); flushAgentText() }
    const scheduleCombinedFlush = () => {
      if (pendingRaf === null) {
        pendingRaf = requestAnimationFrame(() => { pendingRaf = null; combinedFlush() })
      }
    }

    try {
      const res = await fetch('/api/runtime/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resumePending ? {
          sessionId,
          resumePending: true,
          permissionMode: permissionMode || 'full',
        } : {
          sessionId,
          message: content.trim(),
          // displayMessage: what gets stored in DB / shown in chat.
          // Set when displayContent differs from content, e.g. scheduled tasks.
          ...(displayContent !== undefined && displayContent.trim() !== content.trim()
            ? { displayMessage: displayContent.trim() }
            : {}),
          permissionMode,
          thinkingMode,
          ...(planMode ? { planMode: true } : {}),
          ...(agentName ? { agentName } : {}),
          ...(enabledSkills && enabledSkills.length > 0 ? { enabledSkills } : {}),
          ...(attachments && attachments.length > 0 ? { attachments } : {}),
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        if (turnTimer) clearInterval(turnTimer)
        let errorMsg = 'Request failed'
        try { const errData = await res.json(); errorMsg = errData.error || errorMsg } catch { /* non-JSON */ }
        if (isCurrentSession()) setError(errorMsg)
        updateLastGroup(msgs => msgs.filter(m => m.id !== tempAssistantId))
        if (isCurrentSession()) setStreaming(false)
        streamingForSessionRef.current = null
        return
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No reader')
      const decoder = new TextDecoder()
      let buffer = ''

      const processEvent = (event: Record<string, unknown>) => {
        if (!isCurrentSession()) return
        startTurnTimer()

        if (event.type === 'task_started') {
          appendTaskEventToTempAssistant(event)
          const t: TaskInfo = {
            id: event.task_id as string,
            description: event.description as string,
            status: 'running',
            subagentType: event.subagent_type as string | undefined,
            taskType: event.task_type as string | undefined,
            startedAt: Date.now(),
          }
          setTasks(prev => new Map(prev).set(t.id, t))
          return
        }
        if (event.type === 'task_progress') {
          appendTaskEventToTempAssistant(event)
          setTasks(prev => {
            const next = new Map(prev)
            const ex = next.get(event.task_id as string)
            if (ex) next.set(ex.id, { ...ex,
              description: (event.description as string) || ex.description,
              lastToolName: event.last_tool_name as string | undefined,
              summary: event.summary as string | undefined,
              usage: event.usage as TaskInfo['usage'],
            })
            return next
          })
          return
        }
        if (event.type === 'task_updated') {
          appendTaskEventToTempAssistant(event)
          const patch = event.patch as Record<string, unknown>
          setTasks(prev => {
            const next = new Map(prev)
            const ex = next.get(event.task_id as string)
            if (ex) next.set(ex.id, { ...ex,
              ...(patch.status !== undefined ? { status: patch.status as TaskStatus } : {}),
              ...(patch.description !== undefined ? { description: patch.description as string } : {}),
              ...(patch.end_time !== undefined ? { endedAt: patch.end_time as number } : {}),
              ...(patch.total_paused_ms !== undefined ? { totalPausedMs: patch.total_paused_ms as number } : {}),
              ...(patch.error !== undefined ? { error: patch.error as string } : {}),
              ...(patch.is_backgrounded !== undefined ? { isBackgrounded: patch.is_backgrounded as boolean } : {}),
            })
            return next
          })
          return
        }
        if (event.type === 'task_notification') {
          appendTaskEventToTempAssistant(event)
          setTasks(prev => {
            const next = new Map(prev)
            const ex = next.get(event.task_id as string)
            if (ex) {
              const rawStatus = event.status as string
              const s: TaskStatus = rawStatus === 'stopped' ? 'killed' : rawStatus as TaskStatus
              next.set(ex.id, { ...ex, status: s,
                summary: event.summary as string | undefined,
                usage: event.usage as TaskInfo['usage'],
                endedAt: Date.now(),
              })
            }
            return next
          })
          return
        }

        if (event.type === 'thinking_start') { setIsThinking(true); return }
        if (event.type === 'thinking_delta') { pendingThinking += (event.text as string) || ''; scheduleCombinedFlush(); return }
        if (event.type === 'text_delta') { setIsThinking(false); pendingText += (event.text as string) || ''; scheduleCombinedFlush(); return }

        if (event.type === 'agent_content') {
          const parentId = event.parent_tool_use_id as string
          const blockType = event.block_type as string
          if (blockType === 'text_delta') {
            let state = agentPending.get(parentId)
            if (!state) { state = { pendingText: '', pendingThinking: '', currentTextIdx: -1, currentThinkingIdx: -1 }; agentPending.set(parentId, state) }
            state.pendingText += (event.text as string) || ''; scheduleCombinedFlush(); return
          }
          if (blockType === 'thinking_delta') {
            let state = agentPending.get(parentId)
            if (!state) { state = { pendingText: '', pendingThinking: '', currentTextIdx: -1, currentThinkingIdx: -1 }; agentPending.set(parentId, state) }
            state.pendingThinking += (event.text as string) || ''; scheduleCombinedFlush(); return
          }
          combinedFlush()
          updateLastGroup(msgs =>
            msgs.map(m => {
              if (m.id !== tempAssistantId) return m
              const blocks = [...m.blocks]
              let acIdx = blocks.findIndex(b => b.type === 'agent_content' && (b as { parent_tool_use_id: string }).parent_tool_use_id === parentId)
              if (acIdx < 0) { blocks.push({ type: 'agent_content', parent_tool_use_id: parentId, blocks: [] } as ContentBlock); acIdx = blocks.length - 1 }
              const acBlock = blocks[acIdx] as { type: 'agent_content'; parent_tool_use_id: string; blocks: AgentSubBlock[] }
              const subBlocks = [...acBlock.blocks]
              const agState = agentPending.get(parentId)
              if (blockType === 'tool_use') {
                subBlocks.push({ type: 'tool_use', id: event.id as string, name: event.name as string, input: event.input as Record<string, unknown> })
                if (agState) { agState.currentTextIdx = -1; agState.currentThinkingIdx = -1 }
              } else if (blockType === 'tool_result') {
                subBlocks.push({ type: 'tool_result', tool_use_id: event.tool_use_id as string, content: event.content as string, is_error: event.is_error as boolean })
              } else if (blockType === 'tool_progress') {
                const tuId = event.tool_use_id as string
                const existIdx = subBlocks.findIndex(b => b.type === 'tool_progress' && b.tool_use_id === tuId)
                const pb: AgentSubBlock = { type: 'tool_progress', tool_use_id: tuId, tool_name: event.tool_name as string, elapsed_time_seconds: event.elapsed_time_seconds as number }
                if (existIdx >= 0) subBlocks[existIdx] = pb; else subBlocks.push(pb)
              } else if (blockType === 'thinking') {
                if (!subBlocks.some(b => b.type === 'thinking')) subBlocks.push({ type: 'thinking', text: event.text as string })
                if (agState) agState.currentThinkingIdx = -1
              } else if (blockType === 'text') {
                subBlocks.push({ type: 'text', text: event.text as string })
                if (agState) agState.currentTextIdx = -1
              }
              blocks[acIdx] = { ...acBlock, blocks: subBlocks } as ContentBlock
              return { ...m, blocks }
            })
          )
          return
        }

        combinedFlush()

        if (event.type === 'done') {
          if (turnTimer) clearInterval(turnTimer)
          const serverElapsed = Number(event.elapsedSeconds || 0)
          const localElapsed = turnStartTime > 0 ? Math.max(1, Math.ceil((Date.now() - turnStartTime) / 1000)) : 0
          const finalElapsed = serverElapsed > 0 ? serverElapsed : localElapsed
          const userMsgId = event.userMessageId as string | undefined
          const inTokens = (event.inputTokens as number) || 0
          const outTokens = (event.outputTokens as number) || 0
          const sdkContextUsage = event.sdkContextUsage && typeof event.sdkContextUsage === 'object'
            ? event.sdkContextUsage as SdkContextUsage
            : null
          const sdkCompactBoundary = event.sdkCompactBoundary && typeof event.sdkCompactBoundary === 'object'
            ? event.sdkCompactBoundary as {
                id?: string
                sessionId?: string
                boundaryType?: 'compact'
                summary?: string | null
                compactSource?: string
                metadata?: Record<string, unknown>
                createdAt?: string
                contextVersion?: number
              }
            : null
          updateLastGroup(msgs => {
            const finalAssistantId = event.messageId as string
            const tempAssistant = msgs.find(m => m.id === tempAssistantId)
            const finalAssistantExists = Boolean(finalAssistantId && finalAssistantId !== tempAssistantId && msgs.some(m => m.id === finalAssistantId))
            const next = msgs.flatMap(m => {
              if (finalAssistantExists && m.id === tempAssistantId) return []
              if (m.id === finalAssistantId && finalAssistantExists) {
                return [{
                  ...m,
                  blocks: m.blocks.length > 0 ? m.blocks : (tempAssistant?.blocks ?? m.blocks),
                  content: m.content || tempAssistant?.content || '',
                  elapsedSeconds: finalElapsed,
                  inputTokens: inTokens,
                  outputTokens: outTokens,
                  sdkContextUsage,
                }]
              }
              if (m.id === tempAssistantId) return [{ ...m, id: finalAssistantId, elapsedSeconds: finalElapsed, inputTokens: inTokens, outputTokens: outTokens, sdkContextUsage }]
              if (!resumePending && userMsgId && tempUserMsg && m.id === tempUserMsg.id) {
                if (msgs.some(other => other.id === userMsgId && other.id !== m.id)) return []
                return [{ ...m, id: userMsgId }]
              }
              return [m]
            })
            return next
          })
          if (sdkCompactBoundary?.boundaryType === 'compact') {
            commitGroups(prev => {
              const updated = [...prev]
              const lastIdx = updated.length - 1
              if (lastIdx >= 0) {
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  boundary: {
                    id: sdkCompactBoundary.id || `sdk-compact-${Date.now()}`,
                    sessionId,
                    boundaryType: 'compact',
                    summary: sdkCompactBoundary.summary ?? null,
                    compactSource: sdkCompactBoundary.compactSource || 'sdk',
                    metadata: sdkCompactBoundary.metadata || {},
                    createdAt: sdkCompactBoundary.createdAt || new Date().toISOString(),
                  },
                }
              }
              return [
                ...updated,
                {
                  contextVersion: typeof sdkCompactBoundary.contextVersion === 'number'
                    ? sdkCompactBoundary.contextVersion
                    : (updated[lastIdx]?.contextVersion ?? 0) + 1,
                  messages: [],
                  boundary: null,
                },
              ]
            })
          }
          const memory = event.memory as {
            injectedChars?: number
            retrievedCount?: number
            budgetChars?: number
            globalSummaryChars?: number
            projectSummaryChars?: number
            retrievedChars?: number
            rawRetrievedCount?: number
            truncated?: boolean
          } | null | undefined
          const retrievedCount = Number(memory?.retrievedCount || 0)
          const injectedChars = Number(memory?.injectedChars || 0)
          const candidateCount = Number(event.memoryCandidates || 0)
          const managedBySdk = Boolean((memory as Record<string, unknown> | null | undefined)?.managedBySdk)
          if (managedBySdk || retrievedCount > 0 || injectedChars > 0 || candidateCount > 0) {
            setMemoryNotice({
              retrievedCount,
              injectedChars,
              budgetChars: Number(memory?.budgetChars || 0),
              globalSummaryChars: Number(memory?.globalSummaryChars || 0),
              projectSummaryChars: Number(memory?.projectSummaryChars || 0),
              retrievedChars: Number(memory?.retrievedChars || 0),
              rawRetrievedCount: Number(memory?.rawRetrievedCount || 0),
              truncated: Boolean(memory?.truncated),
              candidateCount,
              extractionQueued: true,
              createdAt: Date.now(),
            })
          }
          if (candidateCount > 0) {
            requestMemoryPanelRefresh({
              reason: 'explicit_memory',
              sessionId,
              candidateCount,
              queuedAt: Date.now(),
            })
          }
          fetch(`/api/sessions/${sessionId}/memory/extract`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'after_message', async: true }),
          })
            .then(res => {
              if (res.ok) {
                requestMemoryPanelRefresh({
                  reason: 'after_message',
                  sessionId,
                  queuedAt: Date.now(),
                })
              }
            })
            .catch(() => {})
          return
        }

        if (event.type === 'error') { setError(event.error as string); return }

        updateLastGroup(msgs =>
          msgs.map(m => {
            if (m.id !== tempAssistantId) return m
            const blocks = [...m.blocks]
            switch (event.type) {
              case 'tool_use': {
                setIsThinking(false)
                const toolId = event.id as string
                if (!blocks.some(b => b.type === 'tool_use' && b.id === toolId)) {
                  blocks.push({ type: 'tool_use', id: toolId, name: event.name as string, input: event.input as Record<string, unknown> })
                }
                currentTextBlockIdx = -1
                break
              }
              case 'tool_raw_result': {
                if (!blocks.some(b => b.type === 'tool_raw_result' && b.tool_use_id === (event.tool_use_id as string))) {
                  blocks.push({ type: 'tool_raw_result', tool_use_id: event.tool_use_id as string, tool_name: event.tool_name as string, raw_content: event.raw_content as ContentBlock & { type: 'tool_raw_result' } extends { raw_content: infer R } ? R : never })
                }
                break
              }
              case 'tool_result': {
                if (!blocks.some(b => b.type === 'tool_result' && b.tool_use_id === (event.tool_use_id as string))) {
                  blocks.push({ type: 'tool_result', tool_use_id: event.tool_use_id as string, content: event.result as string, is_error: event.is_error as boolean })
                }
                const toolUseId = event.tool_use_id as string
                if (event.is_error as boolean) {
                  const permIdx = blocks.findIndex(b => b.type === 'permission_request' && b.toolUseId === toolUseId)
                  if (permIdx >= 0) { const pb = blocks[permIdx]; if (pb.type === 'permission_request') blocks[permIdx] = { ...pb, toolFailed: true } }
                }
                break
              }
              case 'permission_request': {
                blocks.push({ type: 'permission_request', requestId: event.requestId as string, toolName: event.toolName as string, toolInput: event.toolInput as Record<string, unknown>, status: 'pending', toolUseId: event.toolUseId as string | undefined })
                break
              }
              case 'ask_user_question_request': {
                const requestId = event.requestId as string
                const idx = blocks.findIndex(b => b.type === 'ask_user_question' && b.requestId === requestId)
                const block: ContentBlock = {
                  type: 'ask_user_question',
                  requestId,
                  questions: (event.questions as AskUserQuestionItem[]) || [],
                  status: 'pending',
                  toolUseId: event.toolUseId as string | undefined,
                }
                if (idx >= 0) blocks[idx] = block
                else blocks.push(block)
                break
              }
              case 'tool_progress': {
                const progressToolUseId = event.tool_use_id as string
                const existingProgressIdx = blocks.findIndex(b => b.type === 'tool_progress' && b.tool_use_id === progressToolUseId)
                const progressBlock: ContentBlock = { type: 'tool_progress', tool_use_id: progressToolUseId, tool_name: event.tool_name as string, elapsed_time_seconds: event.elapsed_time_seconds as number }
                if (existingProgressIdx >= 0) blocks[existingProgressIdx] = progressBlock; else blocks.push(progressBlock)
                break
              }
              case 'ask_user_question_resolved': {
                const reqId = event.requestId as string
                const action = event.action as string
                const status = action === 'submit' ? 'submitted' : action === 'timeout' ? 'timeout' : 'cancelled'
                const idx = blocks.findIndex(b => b.type === 'ask_user_question' && b.requestId === reqId)
                if (idx >= 0) {
                  const b = blocks[idx]
                  if (b.type === 'ask_user_question') {
                    blocks[idx] = {
                      ...b,
                      status,
                      answers: (event.answers as AskUserQuestionAnswers) || {},
                      annotations: (event.annotations as AskUserQuestionAnnotations) || {},
                    }
                  }
                }
                break
              }
              case 'permission_resolved': {
                const reqId = event.requestId as string
                const decision = event.decision as string
                const statusMap: Record<string, string> = { allow: 'allowed', allow_session: 'allowed_session', deny: 'denied', timeout: 'timeout' }
                const idx = blocks.findIndex(b => b.type === 'permission_request' && b.requestId === reqId)
                if (idx >= 0) { const b = blocks[idx]; if (b.type === 'permission_request') blocks[idx] = { ...b, status: (statusMap[decision] || 'denied') as 'allowed' | 'allowed_session' | 'denied' | 'timeout' } }
                break
              }
            }
            return { ...m, blocks }
          })
        )
      }

      const processLines = (lines: string[]) => {
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try { processEvent(JSON.parse(line.slice(6))) } catch { /* skip malformed */ }
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''
        processLines(lines)
      }
      if (buffer.trim()) processLines([buffer])
      combinedFlush()
    } catch (err) {
      if (turnTimer) clearInterval(turnTimer)
      if (pendingRaf !== null) cancelAnimationFrame(pendingRaf)
      combinedFlush()
      if (err instanceof DOMException && err.name === 'AbortError') {
        // User cancelled
      } else {
        if (isCurrentSession()) setError(err instanceof Error ? err.message : 'Failed to send message')
      }
      updateLastGroup(msgs => msgs.filter(m => m.id !== tempAssistantId || m.blocks.length > 0))
    } finally {
      streamingForSessionRef.current = null
      sessionMessagesCache.delete(sessionId)
      if (currentSessionRef.current === sessionId) {
        setStreaming(false)
        setIsThinking(false)
      }
      if (abortRef.current === controller) abortRef.current = null
      if (abortSessionRef.current === sessionId) abortSessionRef.current = null
      if (localStreamingForSessionRef.current === sessionId) localStreamingForSessionRef.current = null
    }
  }, [commitGroups, sessionId])

  const stopStreaming = useCallback(() => {
    const activeSessionId = currentSessionRef.current
    if (activeSessionId) {
      fetch('/api/runtime/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSessionId }),
      }).catch(() => {})
    }
    if (abortSessionRef.current === activeSessionId) abortRef.current?.abort()
  }, [])

  /**
   * Start streaming from an existing pending user message (created by scheduled task executor).
   * Does not insert a new user message — reads the pre-existing one from DB.
   */
  const streamPending = useCallback(async () => {
    if (!sessionId) return
    const lastGroup = groupsRef.current[groupsRef.current.length - 1]
    if (!lastGroup) return
    const msgs = lastGroup.messages
    if (!msgs.some(m => m.role === 'user')) return
    if (msgs.some(m => m.role === 'assistant')) return
    await sendMessage('', 'full', undefined, undefined, false, undefined, true)
  }, [sessionId, sendMessage])

  const sendPermissionDecision = useCallback(async (requestId: string, decision: 'allow' | 'allow_session' | 'deny') => {
    try {
      const res = await fetch('/api/runtime/permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, decision, sessionId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        console.error('Permission decision failed:', res.status, data)
      }
    } catch (err) {
      console.error('Failed to send permission decision:', err)
    }
  }, [sessionId])

  const sendAskUserQuestionResponse = useCallback(async (
    requestId: string,
    action: 'submit' | 'cancel',
    answers?: AskUserQuestionAnswers,
    annotations?: AskUserQuestionAnnotations,
  ) => {
    try {
      const res = await fetch('/api/runtime/ask-user-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, action, answers, annotations, sessionId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        console.error('AskUserQuestion response failed:', res.status, data)
      }
    } catch (err) {
      console.error('Failed to send AskUserQuestion response:', err)
    }
  }, [sessionId])

  return {
    groups,
    messages,
    streaming,
    isThinking,
    error,
    isCompacting,
    compactingText,
    tasks,
    memoryNotice,
    sendMessage,
    loadMessages,
    stopStreaming,
    streamPending,
    compact,
    clearMessages,
    sendPermissionDecision,
    sendAskUserQuestionResponse,
  }
}
