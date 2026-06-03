'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, FileCode2, Send, Sparkles, User, X } from 'lucide-react'
import { useProjects } from '@/modules/projects/use-projects'

// ── Types ───────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface SkillDraft {
  name: string
  displayName: string
  description: string
  category: string
  stage: string
  tags: string[]
  inputs: string[]
  outputs: string[]
  examples: string[]
  riskLevel: 'low' | 'medium' | 'high'
}

interface SkillCreateDialogProps {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

// ── Constants ───────────────────────────────────────────────────

const STEPS = ['使用场景', '输入输出', '边界风险', '示例', '预览确认', '创建完成']

const INITIAL_AI_MESSAGE =
  '你好！我是 Loom Skill 创建器。\n\n请告诉我你想创建一个什么样的 Skill？用自然语言描述就行，不需要填写格式。例如：\n\n"帮我根据产品资料写小红书笔记，输出标题、正文和标签。"'

// ── CREATE_SKILL tag extraction ─────────────────────────────────

function extractDraft(text: string): SkillDraft | null {
  const marker = '<!-- CREATE_SKILL '
  const start = text.indexOf(marker)
  if (start === -1) return null
  const end = text.indexOf(' -->', start)
  if (end === -1) return null
  try {
    return JSON.parse(text.slice(start + marker.length, end)) as SkillDraft
  } catch {
    return null
  }
}

function stripCreateSkillTag(text: string): string {
  return text.replace(/\n*<!-- CREATE_SKILL \{.*?\} -->/g, '').trim()
}

// ── Main Component ──────────────────────────────────────────────

export function SkillCreateDialog({ open, onClose, onCreated }: SkillCreateDialogProps) {
  const { projects } = useProjects()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [draft, setDraft] = useState<SkillDraft | null>(null)
  const [target, setTarget] = useState<'project' | 'global'>('global')
  const [projectId, setProjectId] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Derive current step
  const completedExchanges = Math.floor(messages.length / 2)
  const step = saved ? 5 : draft ? 4 : Math.min(3, completedExchanges)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  const reset = () => {
    setMessages([])
    setInputText('')
    setStreamingText('')
    setDraft(null)
    setTarget('global')
    setProjectId('')
    setSaving(false)
    setSaved(false)
    setError(null)
  }

  const close = () => {
    abortRef.current?.abort()
    reset()
    onClose()
  }

  const sendMessage = async (content: string) => {
    if (!content.trim() || streaming) return

    const userMsg: ChatMessage = { role: 'user', content: content.trim() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInputText('')
    setStreaming(true)
    setStreamingText('')
    setError(null)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const res = await fetch('/api/skills/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
        signal: ctrl.signal,
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: '请求失败' }))
        throw new Error(errData.error || '请求失败')
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullText = ''

      outer: while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') break outer
          try {
            const parsed = JSON.parse(data) as { text?: string; error?: string }
            if (parsed.error) throw new Error(parsed.error)
            if (parsed.text) {
              fullText += parsed.text
              setStreamingText(fullText)
            }
          } catch (e) {
            if (e instanceof Error && e.message !== 'DONE') throw e
          }
        }
      }

      setMessages(prev => [...prev, { role: 'assistant', content: fullText }])
      setStreamingText('')

      const extracted = extractDraft(fullText)
      if (extracted) setDraft(extracted)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(err instanceof Error ? err.message : '发送失败')
      }
    } finally {
      setStreaming(false)
    }
  }

  const handleSave = async () => {
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/skills/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...draft,
          target,
          projectId: target === 'project' ? projectId : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '创建失败')
      setSaved(true)
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  // Displayed messages (prepend static greeting as first AI turn)
  const displayMessages: ChatMessage[] = [
    { role: 'assistant', content: INITIAL_AI_MESSAGE },
    ...messages,
  ]

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/55"
        style={{ backdropFilter: 'blur(4px)' }}
        onClick={close}
      />
      <div
        className="relative flex flex-col overflow-hidden rounded-3xl border shadow-2xl"
        style={{
          width: 920,
          maxWidth: '94vw',
          height: 640,
          maxHeight: '90vh',
          background: 'var(--color-bg-surface)',
          borderColor: 'var(--color-border-strong)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <div
          className="flex shrink-0 items-center justify-between border-b px-5 py-3.5"
          style={{ borderColor: 'var(--color-border-subtle)' }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-xl"
              style={{ background: 'rgba(245,158,11,0.12)', color: '#F59E0B' }}
            >
              <Sparkles size={16} />
            </div>
            <div>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                创建 Skill
              </h2>
              <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                通过对话把你的经验沉淀成专业能力
              </p>
            </div>
          </div>
          <button
            onClick={close}
            className="rounded-lg p-1.5 hover:bg-[var(--color-bg-surface-high)]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* ── 3-panel body ───────────────────────────────────────── */}
        <div
          className="grid min-h-0 flex-1 overflow-hidden"
          style={{ gridTemplateColumns: '150px 1fr 260px' }}
        >
          {/* Left: steps + save location */}
          <div
            className="flex flex-col overflow-hidden border-r p-4"
            style={{ borderColor: 'var(--color-border-subtle)', background: 'var(--color-bg-surface-high)' }}
          >
            <div className="flex-1 space-y-0.5">
              {STEPS.map((label, i) => {
                const done = i < step
                const active = i === step
                return (
                  <div
                    key={label}
                    className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs"
                    style={{
                      color: active
                        ? 'var(--color-text-primary)'
                        : done
                          ? 'var(--color-text-secondary)'
                          : 'var(--color-text-muted)',
                      background: active ? 'var(--color-bg-surface)' : 'transparent',
                    }}
                  >
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px]"
                      style={{
                        background: done || active ? '#F59E0B' : 'var(--color-bg-surface)',
                        color: done || active ? '#000' : 'var(--color-text-muted)',
                      }}
                    >
                      {done ? <Check size={11} /> : i + 1}
                    </span>
                    {label}
                  </div>
                )
              })}
            </div>

            {/* Save location selector */}
            <div
              className="mt-3 border-t pt-3"
              style={{ borderColor: 'var(--color-border-subtle)' }}
            >
              <div
                className="mb-2 text-[10px] uppercase tracking-wide"
                style={{ color: 'var(--color-text-disabled)' }}
              >
                保存位置
              </div>
              <label className="mb-1.5 flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  checked={target === 'global'}
                  onChange={() => setTarget('global')}
                  className="accent-amber-400"
                />
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  全局
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  checked={target === 'project'}
                  onChange={() => setTarget('project')}
                  className="accent-amber-400"
                />
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  项目
                </span>
              </label>
              {target === 'project' && (
                <select
                  value={projectId}
                  onChange={e => setProjectId(e.target.value)}
                  className="mt-2 w-full rounded-lg border px-2 py-1.5 text-xs outline-none"
                  style={{
                    background: 'var(--color-bg-surface)',
                    borderColor: 'var(--color-border-subtle)',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  <option value="">选择项目</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Center: chat area */}
          <div className="flex min-w-0 flex-col overflow-hidden">
            {/* Messages */}
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {displayMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
                >
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                    style={{
                      background:
                        msg.role === 'assistant'
                          ? 'rgba(245,158,11,0.15)'
                          : 'var(--color-bg-surface-high)',
                      color:
                        msg.role === 'assistant' ? '#F59E0B' : 'var(--color-text-secondary)',
                    }}
                  >
                    {msg.role === 'assistant' ? <Sparkles size={13} /> : <User size={13} />}
                  </div>
                  <div
                    className="max-w-[80%] px-4 py-2.5 text-sm leading-6"
                    style={{
                      background:
                        msg.role === 'assistant'
                          ? 'var(--color-bg-surface-high)'
                          : 'rgba(245,158,11,0.1)',
                      color: 'var(--color-text-primary)',
                      borderRadius:
                        msg.role === 'assistant' ? '4px 16px 16px 16px' : '16px 4px 16px 16px',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {stripCreateSkillTag(msg.content)}
                  </div>
                </div>
              ))}

              {/* Streaming response */}
              {streaming && (
                <div className="flex gap-3">
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                    style={{ background: 'rgba(245,158,11,0.15)', color: '#F59E0B' }}
                  >
                    <Sparkles size={13} />
                  </div>
                  {streamingText ? (
                    <div
                      className="max-w-[80%] px-4 py-2.5 text-sm leading-6"
                      style={{
                        background: 'var(--color-bg-surface-high)',
                        color: 'var(--color-text-primary)',
                        borderRadius: '4px 16px 16px 16px',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {stripCreateSkillTag(streamingText)}
                      <span
                        className="ml-1 inline-block h-3.5 w-1.5 animate-pulse"
                        style={{ background: '#F59E0B' }}
                      />
                    </div>
                  ) : (
                    <div
                      className="rounded-2xl px-4 py-3"
                      style={{ background: 'var(--color-bg-surface-high)', borderRadius: '4px 16px 16px 16px' }}
                    >
                      <span className="flex gap-1">
                        {[0, 150, 300].map(delay => (
                          <span
                            key={delay}
                            className="h-2 w-2 animate-bounce rounded-full"
                            style={{ background: '#F59E0B', animationDelay: `${delay}ms` }}
                          />
                        ))}
                      </span>
                    </div>
                  )}
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            {!saved && (
              <div
                className="shrink-0 border-t p-3"
                style={{ borderColor: 'var(--color-border-subtle)' }}
              >
                {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
                <div className="flex items-end gap-2">
                  <textarea
                    value={inputText}
                    onChange={e => setInputText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        sendMessage(inputText)
                      }
                    }}
                    placeholder="描述你想要的 Skill…（Enter 发送，Shift+Enter 换行）"
                    disabled={streaming}
                    rows={2}
                    className="flex-1 resize-none rounded-xl border px-3 py-2 text-sm outline-none disabled:opacity-50"
                    style={{
                      background: 'var(--color-bg-canvas)',
                      borderColor: 'var(--color-border-subtle)',
                      color: 'var(--color-text-primary)',
                    }}
                  />
                  <button
                    onClick={() => sendMessage(inputText)}
                    disabled={streaming || !inputText.trim()}
                    className="flex h-[60px] w-10 shrink-0 items-center justify-center rounded-xl disabled:opacity-40"
                    style={{ background: '#F59E0B', color: '#000' }}
                  >
                    <Send size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right: live preview */}
          <div
            className="flex flex-col overflow-y-auto border-l p-4"
            style={{
              borderColor: 'var(--color-border-subtle)',
              background: 'var(--color-bg-surface-high)',
            }}
          >
            <div
              className="mb-3 flex items-center gap-1.5 text-xs font-semibold"
              style={{ color: 'var(--color-text-primary)' }}
            >
              <FileCode2 size={13} />
              实时草稿
            </div>

            {draft ? (
              <>
                {/* Preview card */}
                <div
                  className="mb-4 rounded-2xl border p-4"
                  style={{
                    borderColor: 'var(--color-border-subtle)',
                    background: 'var(--color-bg-surface)',
                  }}
                >
                  <div className="mb-3 flex items-center gap-2">
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                      style={{ background: 'rgba(245,158,11,0.15)', color: '#F59E0B' }}
                    >
                      <Sparkles size={16} />
                    </div>
                    <div className="min-w-0">
                      <div
                        className="truncate text-sm font-semibold"
                        style={{ color: 'var(--color-text-primary)' }}
                      >
                        {draft.displayName || draft.name}
                      </div>
                      <div className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                        {draft.stage || draft.category || '用户自建'}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs leading-5" style={{ color: 'var(--color-text-secondary)' }}>
                    {draft.description}
                  </p>
                </div>

                {/* Field status */}
                <div className="mb-4 space-y-1.5">
                  <StatusRow label="名称" filled={!!draft.name} detail={draft.name} />
                  <StatusRow label="描述" filled={!!draft.description} />
                  <StatusRow
                    label="输入"
                    filled={(draft.inputs?.length ?? 0) > 0}
                    detail={draft.inputs?.slice(0, 2).join('、')}
                  />
                  <StatusRow
                    label="输出"
                    filled={(draft.outputs?.length ?? 0) > 0}
                    detail={draft.outputs?.slice(0, 2).join('、')}
                  />
                  <StatusRow
                    label="示例"
                    filled={(draft.examples?.length ?? 0) > 0}
                  />
                </div>

                {/* Confirm button */}
                {saved ? (
                  <div
                    className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold"
                    style={{ background: 'rgba(52,211,153,0.15)', color: '#34D399' }}
                  >
                    <Check size={15} />
                    已创建
                  </div>
                ) : (
                  <button
                    onClick={handleSave}
                    disabled={saving || (target === 'project' && !projectId)}
                    className="w-full rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40"
                    style={{ background: '#F59E0B', color: '#000' }}
                  >
                    {saving ? '创建中…' : '确认创建'}
                  </button>
                )}
                {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
              </>
            ) : (
              <>
                <p
                  className="mb-4 text-[11px] leading-5"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  对话完成后，Skill 草稿会在这里预览。
                </p>
                <div className="space-y-1.5">
                  <StatusRow label="使用场景" filled={messages.length >= 2} />
                  <StatusRow label="输入输出" filled={messages.length >= 4} />
                  <StatusRow label="边界约束" filled={messages.length >= 6} />
                  <StatusRow label="示例说法" filled={messages.length >= 8} />
                  <StatusRow label="预览确认" filled={false} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ── StatusRow helper ────────────────────────────────────────────

function StatusRow({ label, filled, detail }: { label: string; filled: boolean; detail?: string }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span
        className="mt-0.5 shrink-0 text-[11px]"
        style={{ color: filled ? '#34D399' : 'var(--color-text-muted)' }}
      >
        {filled ? '✓' : '○'}
      </span>
      <div className="min-w-0">
        <span style={{ color: filled ? 'var(--color-text-secondary)' : 'var(--color-text-muted)' }}>
          {label}
        </span>
        {filled && detail && (
          <p
            className="mt-0.5 truncate text-[10px]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {detail}
          </p>
        )}
      </div>
    </div>
  )
}
