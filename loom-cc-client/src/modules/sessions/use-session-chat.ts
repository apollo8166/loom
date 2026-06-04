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

  const messages = useMemo(() => groups.flatMap(g => g.messages), [groups])

  const streamingForSessionRef = useRef<string | null>(null)
  const currentSessionRef = useRef<string | null>(null)
  // Keep a ref to groups so streamPending() can read current state without being in its dep array
  const groupsRef = useRef<SessionBoundaryGroup[]>(groups)
  useEffect(() => { currentSessionRef.current = sessionId }, [sessionId])
  useEffect(() => { groupsRef.current = groups }, [groups])
  useEffect(() => {
    abortRef.current?.abort()
    streamingForSessionRef.current = null
    setGroups(sessionId ? [{ contextVersion: 0, messages: [], boundary: null }] : [])
    setStreaming(false)
    setIsThinking(false)
    setError(null)
    setIsCompacting(false)
    setCompactingText('')
    setTasks(new Map())
    setMemoryNotice(null)
  }, [sessionId])

  const loadMessages = useCallback(async (sid: string) => {
    try {
      const cached = sessionMessagesCache.get(sid)
      if (cached && Date.now() - cached.at < SESSION_MESSAGES_CACHE_TTL && streamingForSessionRef.current !== sid) {
        setGroups(cloneGroups(cached.groups))
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

      setGroups(newGroups)
      const rebuiltTasks = rebuildTasksFromMessages(mapped)
      setTasks(rebuiltTasks)
      sessionMessagesCache.set(sid, {
        at: Date.now(),
        groups: cloneGroups(newGroups),
        tasks: new Map(rebuiltTasks),
      })
      setStreaming(false)
      setError(null)
    } catch (err) {
      console.error('Failed to load messages:', err)
    }
  }, [])

  const clearMessages = useCallback(async () => {
    if (!sessionId) return
    try {
      const res = await fetch(`/api/sessions/${sessionId}/clear`, { method: 'POST' })
      if (!res.ok) return
      const data = await res.json()
      const newContextVersion = data.session?.context_version ?? 0

      // Mark previous groups as having a 'clear' boundary and add empty new group
      setGroups(prev => {
        const updated = prev.map((g, i) =>
          i === prev.length - 1
            ? {
                ...g,
                boundary: {
                  id: `clear-${Date.now()}`,
                  sessionId: sessionId,
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
      sessionMessagesCache.delete(sessionId)
    } catch (err) {
      console.error('Failed to clear:', err)
    }
  }, [sessionId])

  const compact = useCallback(async (): Promise<{ summary: string; contextVersion: number; memoryFlushStatus?: string } | null> => {
    if (!sessionId || isCompacting) return null
    setIsCompacting(true)
    setCompactingText('')

    try {
      // First, get the current messages count to check if there's anything to compact
      const activeGroup = groups[groups.length - 1]
      if (!activeGroup || activeGroup.messages.length === 0) {
        setError('No messages to compact')
        return null
      }

      // Call compact endpoint with summary generation
      const res = await fetch(`/api/sessions/${sessionId}/compact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: '' }),
      })

      if (!res.ok) {
        if (res.status === 400) {
          setError('No messages to compact')
          return null
        }
        throw new Error(`Compact request failed (${res.status})`)
      }

      const data = await res.json()
      const newContextVersion = data.session?.context_version ?? 0
      const summary = data.summary ?? data.session?.compact_summary ?? ''
      const metadata = data.compactMetadata && typeof data.compactMetadata === 'object'
        ? data.compactMetadata as Record<string, unknown>
        : {}

      // Update groups: add boundary to current group, create new empty group
      setGroups(prev => {
        const updated = prev.map((g, i) =>
          i === prev.length - 1
            ? {
                ...g,
                boundary: {
                  id: `compact-${Date.now()}`,
                  sessionId: sessionId,
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
      sessionMessagesCache.delete(sessionId)

      if (data.memoryFlushStatus === 'queued') {
        requestMemoryPanelRefresh({
          reason: 'compact_flush',
          sessionId,
          queuedAt: Date.now(),
        })
      }

      return { summary, contextVersion: newContextVersion, memoryFlushStatus: data.memoryFlushStatus }
    } catch (err) {
      console.error('[compact]', err)
      return null
    } finally {
      setIsCompacting(false)
      setCompactingText('')
    }
  }, [sessionId, isCompacting, groups])

  const sendMessage = useCallback(async (
    content: string,
    permissionMode?: string,
    thinkingMode?: string,
    attachments?: Array<{ name: string; filename: string; mimeType: string; tier: string; originalFilename?: string }>,
    planMode?: boolean,
    displayContent?: string,
    resumePending?: boolean,
    enabledSkills?: string[],
  ) => {
    if (!sessionId) return
    if (!resumePending && !content.trim() && (!attachments || attachments.length === 0)) return
    if (streamingForSessionRef.current === sessionId) return

    streamingForSessionRef.current = sessionId
    setError(null)

    // Clean up orphaned temp messages
    setGroups(prev => prev.map(g => ({
      ...g,
      messages: g.messages.reduce<Message[]>((acc, m) => {
        if (m.id.startsWith('temp-')) {
          if (m.blocks.length > 0) acc.push({ ...m, id: `orphan-${Date.now()}-${acc.length}` })
        } else {
          acc.push(m)
        }
        return acc
      }, []),
    })))

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
            userBlocks.push({
              type: 'file_attachment', url: `/api/files/serve/${a.filename}`, name: a.name,
              size: 0, mimeType: a.mimeType,
              ...(a.originalFilename ? { originalFilename: a.originalFilename } : {}),
            })
          }
        }
      }
      if (userBlocks.length === 0) userBlocks.push({ type: 'text', text: displayText.trim() })
      tempUserMsg = {
        id: `temp-${Date.now()}`,
        sessionId,
        role: 'user',
        content: displayText.trim(),
        blocks: userBlocks,
        createdAt: new Date().toISOString(),
      }
    }

    const tempAssistantId = `temp-assistant-${Date.now()}`
    const tempAssistantMsg: Message = {
      id: tempAssistantId,
      sessionId,
      role: 'assistant',
      content: '',
      blocks: [],
      createdAt: new Date().toISOString(),
    }

    // Append temp messages to the last group
    setGroups(prev => {
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

    setStreaming(true)
    const controller = new AbortController()
    abortRef.current = controller

    const updateLastGroup = (updater: (messages: Message[]) => Message[]) => {
      setGroups(prev => {
        const updated = [...prev]
        const lastIdx = updated.length - 1
        if (lastIdx >= 0) {
          updated[lastIdx] = { ...updated[lastIdx], messages: updater(updated[lastIdx].messages) }
        }
        return updated
      })
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
          ...(enabledSkills && enabledSkills.length > 0 ? { enabledSkills } : {}),
          ...(attachments && attachments.length > 0 ? { attachments } : {}),
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        if (turnTimer) clearInterval(turnTimer)
        let errorMsg = 'Request failed'
        try { const errData = await res.json(); errorMsg = errData.error || errorMsg } catch { /* non-JSON */ }
        setError(errorMsg)
        updateLastGroup(msgs => msgs.filter(m => m.id !== tempAssistantId))
        setStreaming(false)
        streamingForSessionRef.current = null
        return
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No reader')
      const decoder = new TextDecoder()
      let buffer = ''

      const processEvent = (event: Record<string, unknown>) => {
        startTurnTimer()

        if (event.type === 'task_started') {
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
          const finalElapsed = turnStartTime > 0 ? Math.floor((Date.now() - turnStartTime) / 1000) : 0
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
          updateLastGroup(msgs =>
            msgs.map(m => {
              if (m.id === tempAssistantId) return { ...m, id: event.messageId as string, elapsedSeconds: finalElapsed, inputTokens: inTokens, outputTokens: outTokens, sdkContextUsage }
              if (!resumePending && userMsgId && tempUserMsg && m.id === tempUserMsg.id) return { ...m, id: userMsgId }
              return m
            })
          )
          if (sdkCompactBoundary?.boundaryType === 'compact') {
            setGroups(prev => {
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
        setError(err instanceof Error ? err.message : 'Failed to send message')
      }
      updateLastGroup(msgs => msgs.filter(m => m.id !== tempAssistantId || m.blocks.length > 0))
    } finally {
      streamingForSessionRef.current = null
      sessionMessagesCache.delete(sessionId)
      if (currentSessionRef.current === sessionId) {
        setStreaming(false)
        setIsThinking(false)
      }
      abortRef.current = null
    }
  }, [sessionId])

  const stopStreaming = useCallback(() => { abortRef.current?.abort() }, [])

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
