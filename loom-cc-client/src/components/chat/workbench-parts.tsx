'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import type { CSSProperties } from 'react'
import {
  ArrowUp, Square, ChevronDown, ChevronRight, XCircle, Loader2, ShieldAlert,
  X, Check, Copy, Shield, ShieldOff, Globe, Terminal, FileText, Search, FileDiff,
  ZapOff, Zap, Sparkles, Bot, Crown, Rabbit, Route, PenLine, MessageCircle,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import type { Message, ContentBlock, PermissionStatus, SessionBoundary, AskUserQuestionItem, AskUserQuestionAnswers, AskUserQuestionAnnotations, AskUserQuestionStatus } from '@/shared/types'
import type { PreviewFile } from '@/components/chat/file-preview-panel'
import { MarkdownRenderer } from '@/components/chat/markdown-renderer'
import { AgentBlock, ParallelAgentIndicator, isAgentToolCall } from '@/components/chat/agent-block'
import { BUILTIN_MODELS, PROVIDER_MODEL_CATALOGS } from '@/shared/config/models'
import type { AgentSubBlock } from '@/shared/types'

/* ── Tool helpers ── */

export function getToolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read': return String(input.file_path || '')
    case 'Write': return String(input.file_path || '')
    case 'Edit': return String(input.file_path || '')
    case 'Bash': return String(input.command || '').slice(0, 80)
    case 'Glob': return String(input.pattern || '')
    case 'Grep': return String(input.pattern || '').slice(0, 60)
    case 'Agent': return String(input.description || '')
    case 'WebFetch': return String(input.url || '').slice(0, 80)
    case 'WebSearch': return String(input.query || '').slice(0, 80)
    case 'ToolSearch': return String(input.query || '').slice(0, 80)
    case 'NotebookEdit': return String(input.file_path || '')
    case 'Skill': return String(input.skill || '')
  default: return ''
  }
}

export function getToolIcon(name: string): React.ElementType {
  if (name === 'Bash' || name === 'run_command') return Terminal
  if (name === 'WebSearch') return Search
  if (name === 'WebFetch') return Globe
  if (name === 'Write' || name === 'Edit' || name === 'Read') return FileText
  if (name === 'Glob' || name === 'Grep') return Search
  if (name === 'Agent') return () => (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="8" r="4" /><path d="M6 20v-2a6 6 0 0 1 12 0v2" />
    </svg>
  )
  return FileDiff
}

function normalizeAskUserQuestions(input: Record<string, unknown>): AskUserQuestionItem[] {
  const rawQuestions = input.questions
  if (!Array.isArray(rawQuestions)) return []
  return rawQuestions.map((item) => {
    const raw = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {}
    const rawOptions = Array.isArray(raw.options) ? raw.options : []
    const options = rawOptions.map((opt) => {
      const rawOpt = opt && typeof opt === 'object' && !Array.isArray(opt) ? opt as Record<string, unknown> : {}
      return {
        label: String(rawOpt.label || '').trim(),
        description: String(rawOpt.description || '').trim(),
        ...(typeof rawOpt.preview === 'string' && rawOpt.preview.trim() ? { preview: rawOpt.preview } : {}),
      }
    }).filter(opt => opt.label)
    return {
      question: String(raw.question || '').trim(),
      header: String(raw.header || '').trim() || '问题',
      options,
      multiSelect: Boolean(raw.multiSelect),
    }
  }).filter(q => q.question && q.options.length >= 2).slice(0, 4)
}

function sanitizePreviewHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/\s(href|src)=["']javascript:[^"']*["']/gi, '')
}

export function formatModelShort(model: string): string {
  const entry = BUILTIN_MODELS.find(m => m.id === model)
  if (entry) return entry.label.replace(/^Claude\s+/, '')
  // Check provider catalogs
  for (const catalog of Object.values(PROVIDER_MODEL_CATALOGS)) {
    const catalogEntry = catalog.find(m => m.id === model)
    if (catalogEntry) return catalogEntry.label
  }
  if (model.includes('opus')) return 'Opus'
  if (model.includes('haiku')) return 'Haiku'
  if (model.includes('sonnet')) return 'Sonnet'
  return model
}

/* ── Streaming Cursor ── */

export function StreamingCursor() {
  return <span className="inline-block w-2 h-4 animate-pulse rounded-sm" style={{ background: 'rgba(99, 102, 241, 0.6)' }} />
}

function formatTokenCount(value: number): string {
  return Math.max(0, Math.round(value || 0)).toLocaleString()
}

function TokenUsagePopover({
  inputTokens,
  outputTokens,
}: {
  inputTokens: number
  outputTokens: number
}) {
  const [open, setOpen] = useState(false)
  const input = Math.max(0, Math.round(inputTokens || 0))
  const output = Math.max(0, Math.round(outputTokens || 0))
  const totalRows = [
    { label: '输入总量', value: formatTokenCount(input), note: 'SDK/provider 返回' },
    { label: '输出总量', value: formatTokenCount(output), note: 'SDK/provider 返回' },
  ]
  const inputParts = [
    { title: '系统与 SDK 上下文', desc: 'Claude Agent SDK / Claude Code runtime 内部注入。' },
    { title: '项目与工作区上下文', desc: '当前 project、workspace、attached folders、worktree 等。' },
    { title: '会话历史 / resume context', desc: 'SDK resume 的历史上下文，或 Loom fallback 时拼接的 recent messages。' },
    { title: 'Compact 摘要', desc: '仅 Loom fallback compact 时注入；SDK compact 时由 SDK 自己管理。' },
    { title: 'Memory 文件', desc: 'Claude Agent SDK / Claude Code 从全局与项目 .claude memory 按需加载。' },
    { title: 'Skills / Agents / MCP / Hooks', desc: '由 Claude Agent SDK、Claude Code 配置和项目 .claude 配置带入。' },
    { title: '工具 schema 与权限上下文', desc: '可用 tools、permission mode、plan mode、thinking mode 等。' },
    { title: '附件', desc: '图片、PDF、文本文件等；具体是否进入上下文取决于类型和 SDK 处理。' },
    { title: '当前用户输入', desc: '用户本轮输入或任务触发输入。' },
  ]

  return (
    <div
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      style={{ position: 'relative', display: 'inline-flex' }}
    >
      <span style={{
        fontSize: 10, color: 'var(--color-text-muted)',
        background: 'rgba(255,255,255,0.04)', padding: '2px 8px', borderRadius: 10,
        border: '1px solid var(--color-border-subtle)', cursor: 'help',
      }}>
        In {formatTokenCount(input)} · Out {formatTokenCount(output)}
      </span>

      {open && (
        <div style={{
          position: 'absolute',
          bottom: 'calc(100% + 8px)',
          left: 0,
          zIndex: 80,
          width: 620,
          padding: 10,
          borderRadius: 12,
          border: '1px solid var(--theme-border-strong)',
          background: 'var(--theme-bg-raised)',
          boxShadow: 'var(--theme-shadow-popover)',
          color: 'var(--color-text-secondary)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-primary)' }}>Token 用量</span>
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>真实总量</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {totalRows.map((row, idx) => (
                <tr key={row.label} style={{ borderTop: idx === 0 ? 'none' : '1px solid var(--color-border-subtle)' }}>
                  <td style={{ padding: '6px 0', fontSize: 11, color: 'var(--color-text-secondary)' }}>{row.label}</td>
                  <td style={{
                    padding: '6px 8px',
                    textAlign: 'right',
                    fontSize: 11,
                    fontWeight: 700,
                    color: idx < 2 ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
                    whiteSpace: 'nowrap',
                  }}>
                    {row.value}
                  </td>
                  <td style={{ padding: '6px 0', textAlign: 'right', fontSize: 10, color: 'var(--color-text-disabled)', whiteSpace: 'nowrap' }}>{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{
            marginTop: 8,
            paddingTop: 8,
            borderTop: '1px solid var(--color-border-subtle)',
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--color-text-muted)',
          }}>
            输入Token组成分类
          </div>
          <table style={{
            width: '100%',
            marginTop: 4,
            borderCollapse: 'collapse',
          }}>
            <tbody>
              {inputParts.map((part, idx) => (
                <tr key={part.title} style={{ borderTop: idx === 0 ? 'none' : '1px solid var(--color-border-subtle)' }}>
                  <td style={{ padding: '7px 8px 7px 0', width: 24, verticalAlign: 'middle', textAlign: 'center' }}>
                    <span style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: 16,
                    }}>
                    <span style={{
                      width: 16,
                      height: 16,
                      borderRadius: 999,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 8,
                      fontWeight: 700,
                      color: 'var(--color-text-muted)',
                      background: 'var(--theme-bg-surface)',
                      border: '1px solid var(--color-border-subtle)',
                    }}>
                      {idx + 1}
                    </span>
                    </span>
                  </td>
                  <td style={{ padding: '7px 12px 7px 0', width: 150, verticalAlign: 'middle', fontSize: 11, lineHeight: '18px', fontWeight: 700, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                    {part.title}
                  </td>
                  <td style={{ padding: '7px 0', verticalAlign: 'middle', fontSize: 10, lineHeight: '18px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                    {part.desc}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ── Waiting Indicator ── */

export function WaitingIndicator({ label }: { label?: string }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [])
  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '5px 12px', borderRadius: 20,
      background: 'rgba(99, 102, 241, 0.06)', border: '1px solid rgba(99, 102, 241, 0.15)',
    }}>
      <Loader2 size={13} style={{ color: 'var(--color-accent-primary)', flexShrink: 0 }} className="animate-spin" />
      {label && <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{label}</span>}
      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums' }}>
        {mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}
      </span>
    </div>
  )
}

/* ── Session Boundary Divider ── */

export function SessionBoundaryDivider({ boundary }: { boundary: SessionBoundary | null }) {
  if (!boundary) return null
  return (
    <div className="flex items-center gap-3 py-4 px-6">
      <div className="flex-1 border-t" style={{ borderColor: 'var(--color-border-subtle)' }} />
      <span className="text-xs px-2 py-1 rounded" style={{ color: 'var(--color-text-muted)', background: 'var(--color-bg-surface)' }}>
        {boundary.boundaryType === 'compact' ? `Compacted${boundary.summary ? ` -- ${boundary.summary.slice(0, 80)}` : ''}` : 'Context Cleared'}
      </span>
      <div className="flex-1 border-t" style={{ borderColor: 'var(--color-border-subtle)' }} />
    </div>
  )
}

/* ── Permission Block ── */

const confirmationStyles: Record<string, CSSProperties> = {
  shell: {
    width: 'min(100%, 760px)',
    margin: '12px 0',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    borderRadius: 14,
    background: 'var(--color-bg-surface)',
    boxShadow: '0 12px 34px rgba(15, 23, 42, 0.08)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '16px 18px 12px',
  },
  headerIcon: {
    width: 28,
    height: 28,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderRadius: 999,
    background: 'var(--color-bg-surface-high)',
    border: '1px solid var(--color-border-subtle)',
  },
  headerTitle: {
    fontSize: 12,
    lineHeight: '17px',
    fontWeight: 800,
  },
  headerStatus: {
    marginLeft: 'auto',
    whiteSpace: 'nowrap',
    fontSize: 10,
    lineHeight: '15px',
    color: 'var(--color-text-muted)',
  },
  body: {
    display: 'grid',
    gap: 16,
    padding: '0 18px 18px',
  },
  questionCard: {
    display: 'grid',
    gap: 11,
    padding: 14,
    borderRadius: 12,
    border: '1px solid var(--color-border-subtle)',
    background: 'var(--color-bg-canvas)',
  },
  questionHead: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
  },
  questionBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 22,
    maxWidth: 140,
    padding: '2px 8px',
    borderRadius: 7,
    border: '1px solid rgba(245,158,11,0.28)',
    background: 'rgba(245,158,11,0.10)',
    color: 'var(--color-accent-primary)',
    fontSize: 10,
    lineHeight: '14px',
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
  questionText: {
    margin: 0,
    minWidth: 0,
    fontSize: 13,
    lineHeight: '20px',
    fontWeight: 650,
    color: 'var(--color-text-primary)',
  },
  options: {
    display: 'grid',
    gap: 9,
  },
  option: {
    width: '100%',
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    textAlign: 'left',
    borderRadius: 12,
    padding: '12px 14px',
    transition: 'border-color 0.15s ease, background 0.15s ease, opacity 0.15s ease',
  },
  checkbox: {
    width: 18,
    height: 18,
    marginTop: 2,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderRadius: 5,
  },
  optionText: {
    minWidth: 0,
    display: 'grid',
    gap: 4,
  },
  optionLabel: {
    display: 'block',
    fontSize: 12,
    lineHeight: '17px',
    fontWeight: 750,
    color: 'var(--color-text-primary)',
  },
  optionDescription: {
    display: 'block',
    fontSize: 10,
    lineHeight: '16px',
    color: 'var(--color-text-muted)',
  },
  preview: {
    maxHeight: 240,
    overflow: 'auto',
    padding: 12,
    borderRadius: 10,
    border: '1px solid var(--color-border-subtle)',
    background: 'var(--color-bg-surface)',
    color: 'var(--color-text-secondary)',
    fontSize: 10,
    lineHeight: '17px',
  },
  textarea: {
    width: '100%',
    minHeight: 72,
    resize: 'vertical',
    borderRadius: 10,
    padding: '10px 12px',
    outline: 'none',
    color: 'var(--color-text-primary)',
    background: 'var(--color-bg-surface)',
    border: '1px solid var(--color-border-subtle)',
    fontSize: 11,
    lineHeight: '17px',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    padding: '13px 18px',
    borderTop: '1px solid var(--color-border-subtle)',
    background: 'var(--color-bg-canvas)',
  },
  outlineButton: {
    height: 34,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    padding: '0 14px',
    border: '1px solid var(--color-border-strong)',
    background: 'var(--color-bg-surface)',
    color: 'var(--color-text-secondary)',
    fontSize: 10,
    lineHeight: '15px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  primaryButton: {
    height: 34,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    padding: '0 15px',
    border: '1px solid transparent',
    background: 'var(--color-accent-primary)',
    color: '#fff',
    fontSize: 10,
    lineHeight: '15px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  commandPanel: {
    display: 'grid',
    gap: 8,
    padding: '0 18px 18px',
  },
  commandSummary: {
    margin: 0,
    fontSize: 11,
    lineHeight: '17px',
    fontWeight: 650,
    color: 'var(--color-text-primary)',
  },
  commandText: {
    margin: 0,
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid var(--color-border-subtle)',
    background: 'var(--color-bg-canvas)',
    color: 'var(--color-text-secondary)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: 10,
    lineHeight: '17px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
  failure: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    margin: '0 18px 12px',
    padding: '8px 10px',
    borderRadius: 9,
    background: 'rgba(232,90,79,0.1)',
    border: '1px solid rgba(232,90,79,0.2)',
    color: 'var(--color-accent-danger)',
    fontSize: 10,
    lineHeight: '15px',
    fontWeight: 650,
  },
}

interface PermissionBlockProps {
  requestId: string
  toolName: string
  toolInput: Record<string, unknown>
  status: PermissionStatus
  toolUseId?: string
  toolFailed?: boolean
  onDecision?: (requestId: string, decision: 'allow' | 'allow_session' | 'deny') => void
}

export function PermissionBlock({ requestId, toolName, toolInput, status, toolFailed, onDecision }: PermissionBlockProps) {
  const [inputExpanded, setInputExpanded] = useState(false)
  const [remaining, setRemaining] = useState(120)
  const isPending = status === 'pending'
  const isAllowed = status === 'allowed' || status === 'allowed_session'

  useEffect(() => {
    if (!isPending) return
    const start = Date.now()
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - start) / 1000)
      const left = Math.max(0, 120 - elapsed)
      setRemaining(left)
      if (left === 0) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [isPending])

  const summary = getToolSummary(toolName, toolInput)
  const commandStr = toolName === 'Bash' ? String(toolInput.command || '') : null
  const isLongCommand = commandStr && commandStr.length > 100

  const statusTitle = isPending ? '需要授权'
    : status === 'denied' ? '已拒绝授权'
    : status === 'timeout' ? '授权已超时'
    : status === 'allowed_session' ? '本会话已授权'
    : '已授权'

  const statusColor = isPending ? 'var(--color-accent-warning)'
    : status === 'timeout' ? 'var(--color-accent-warning)'
    : status === 'denied' ? 'var(--color-accent-danger)'
    : 'var(--color-accent-success)'
  const panelBorder = isPending ? 'rgba(245,158,11,0.38)'
    : status === 'denied' ? 'rgba(248,81,73,0.30)'
    : status === 'timeout' ? 'rgba(245,158,11,0.30)'
    : 'rgba(46,160,91,0.30)'

  return (
    <div
      style={{
        ...confirmationStyles.shell,
        border: `1px solid ${panelBorder}`,
      }}
    >
      <div style={confirmationStyles.header}>
        <span style={{ ...confirmationStyles.headerIcon, color: statusColor }}>
          <ShieldAlert size={16} />
        </span>
        <span style={{ ...confirmationStyles.headerTitle, color: statusColor }}>{statusTitle}</span>
        {isPending && remaining > 0 && (
          <span className={cn('font-mono tabular-nums')} style={{ ...confirmationStyles.headerStatus, color: remaining <= 30 ? 'var(--color-accent-danger)' : 'var(--color-text-muted)' }}>
            {remaining}s
          </span>
        )}
      </div>

      {isAllowed && toolFailed && (
        <div style={confirmationStyles.failure}>
          <XCircle size={13} style={{ color: 'var(--color-accent-danger)', flexShrink: 0 }} />
          <span>授权后工具执行失败</span>
        </div>
      )}

      <div style={confirmationStyles.commandPanel}>
        <p style={confirmationStyles.commandSummary}>
          {toolName}{summary ? `  ${summary}` : ''}
        </p>
        {commandStr && (
          <div>
            <p style={confirmationStyles.commandText}>
              {isLongCommand && !inputExpanded ? commandStr.slice(0, 100) + '...' : commandStr}
            </p>
            {isLongCommand && (
              <button
                onClick={() => setInputExpanded(!inputExpanded)}
                style={{
                  marginTop: 6,
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--color-accent-primary)',
                  fontSize: 12,
                  lineHeight: '18px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {inputExpanded ? '收起命令' : '展开完整命令'}
              </button>
            )}
          </div>
        )}
      </div>

      {isPending && onDecision && (
        <div style={confirmationStyles.footer}>
          <button onClick={() => onDecision(requestId, 'deny')}
            style={confirmationStyles.outlineButton}>拒绝</button>
          <button onClick={() => onDecision(requestId, 'allow_session')}
            style={{ ...confirmationStyles.outlineButton, borderColor: 'rgba(245,158,11,0.40)', color: 'var(--color-accent-primary)', background: 'rgba(245,158,11,0.08)' }}>本会话允许</button>
          <button onClick={() => onDecision(requestId, 'allow')}
            style={confirmationStyles.primaryButton}>允许一次</button>
        </div>
      )}
    </div>
  )
}

/* ── Tool Use Block ── */

export function ToolUseBlock({
  id, name, input, result, toolFailed, streaming,
}: {
  id: string
  name: string
  input: Record<string, unknown>
  result?: { content: string; is_error: boolean }
  toolFailed?: boolean
  streaming: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const summary = getToolSummary(name, input)
  const isDone = !!result
  const isError = result?.is_error
  const Icon = getToolIcon(name)

  if (name === 'AskUserQuestion') {
    return (
      <AskUserQuestionBlock
        requestId={`tool-${id}`}
        questions={normalizeAskUserQuestions(input)}
        status={isDone ? 'submitted' : 'pending'}
        answers={{}}
        readonly
      />
    )
  }

  return (
    <div style={{
      margin: '2px 0', padding: '6px 10px', borderRadius: 8,
      background: 'rgba(255,255,255,0.025)', border: '1px solid var(--color-border-subtle)',
    }}>
      <button
        onClick={() => isDone && setExpanded(!expanded)}
        className={cn(
          'flex items-center gap-2 w-full text-left rounded transition-opacity',
          isDone ? 'hover:opacity-80 cursor-pointer' : 'cursor-default',
        )}
      >
        <span className="shrink-0" style={{ color: isDone && !isError ? 'var(--color-accent-success)' : isError ? 'var(--color-accent-danger)' : 'var(--color-accent-primary)' }}>
          <Icon size={13} />
        </span>
        <span className="text-[12px] font-semibold shrink-0" style={{ color: isDone && !isError ? 'var(--color-accent-success)' : isError ? 'var(--color-accent-danger)' : 'var(--color-text-primary)' }}>
          {name}
        </span>
        {summary && <span className="text-[12px] truncate flex-1" style={{ color: 'var(--color-text-muted)' }}>{summary}</span>}
        {!isDone && (
          <Loader2 size={11} className="animate-spin shrink-0 ml-auto" style={{ color: 'var(--color-accent-primary)' }} />
        )}
        {isDone && (
          <ChevronRight size={10} className={cn('shrink-0 ml-auto transition-transform', expanded && 'rotate-90')} style={{ color: 'var(--color-text-muted)' }} />
        )}
      </button>
      {expanded && result && (
        <div className="mt-1 pl-5">
          {toolFailed && (
            <p className="text-[11px] mb-1" style={{ color: 'var(--color-accent-danger)' }}>Tool execution failed</p>
          )}
          <pre className="text-[11px] font-mono whitespace-pre-wrap max-h-[300px] overflow-y-auto leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            {result.content}
          </pre>
        </div>
      )}
    </div>
  )
}

export function AskUserQuestionBlock({
  requestId, questions, status, answers, annotations, readonly = false, onResponse,
}: {
  requestId: string
  questions: AskUserQuestionItem[]
  status: AskUserQuestionStatus
  answers?: AskUserQuestionAnswers
  annotations?: AskUserQuestionAnnotations
  readonly?: boolean
  onResponse?: (requestId: string, action: 'submit' | 'cancel', answers?: AskUserQuestionAnswers, annotations?: AskUserQuestionAnnotations) => void
}) {
  const initialSelections = useMemo(() => {
    const selected: Record<string, string[]> = {}
    for (const question of questions) {
      const existing = answers?.[question.question]
      selected[question.question] = existing
        ? existing.split(',').map(s => s.trim()).filter(Boolean)
        : []
    }
    return selected
  }, [answers, questions])
  const [selected, setSelected] = useState<Record<string, string[]>>(initialSelections)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [activePreview, setActivePreview] = useState<Record<string, string>>({})
  const isPending = status === 'pending'
  const interactive = isPending && !readonly && !!onResponse

  useEffect(() => {
    setSelected(initialSelections)
  }, [initialSelections])

  const setSingle = (question: AskUserQuestionItem, label: string, preview?: string) => {
    setSelected(prev => ({ ...prev, [question.question]: [label] }))
    if (preview) setActivePreview(prev => ({ ...prev, [question.question]: preview }))
  }

  const toggleMulti = (question: AskUserQuestionItem, label: string, preview?: string) => {
    setSelected(prev => {
      const current = prev[question.question] || []
      const next = current.includes(label) ? current.filter(v => v !== label) : [...current, label]
      return { ...prev, [question.question]: next }
    })
    if (preview) setActivePreview(prev => ({ ...prev, [question.question]: preview }))
  }

  const canSubmit = questions.every(q => (selected[q.question] || []).length > 0)
  const statusLabel = status === 'pending' ? '等待用户选择'
    : status === 'submitted' ? '已提交选择'
    : status === 'timeout' ? '选择超时'
    : '已取消选择'
  const statusColor = status === 'pending' ? 'var(--color-accent-warning)'
    : status === 'submitted' ? 'var(--color-accent-success)'
    : 'var(--color-accent-danger)'
  const panelBorder = status === 'pending' ? 'rgba(245,158,11,0.38)'
    : status === 'submitted' ? 'rgba(46,160,91,0.30)'
    : 'rgba(248,81,73,0.30)'

  const submit = () => {
    const outAnswers: AskUserQuestionAnswers = {}
    const outAnnotations: AskUserQuestionAnnotations = {}
    for (const question of questions) {
      outAnswers[question.question] = (selected[question.question] || []).join(', ')
      const note = (notes[question.question] || '').trim()
      const preview = activePreview[question.question]
      if (note || preview) outAnnotations[question.question] = { ...(preview ? { preview } : {}), ...(note ? { notes: note } : {}) }
    }
    onResponse?.(requestId, 'submit', outAnswers, outAnnotations)
  }

  return (
    <div
      style={{
        ...confirmationStyles.shell,
        border: `1px solid ${panelBorder}`,
      }}
    >
      <div style={confirmationStyles.header}>
        <span style={{ ...confirmationStyles.headerIcon, color: statusColor }}>
          <MessageCircle size={16} />
        </span>
        <span style={{ ...confirmationStyles.headerTitle, color: statusColor }}>需要确认</span>
        <span style={confirmationStyles.headerStatus}>{statusLabel}</span>
      </div>

      <div style={confirmationStyles.body}>
        {questions.map((question, qi) => {
          const values = selected[question.question] || []
          const preview = activePreview[question.question] || question.options.find(opt => values.includes(opt.label))?.preview
          return (
            <div key={`${requestId}-${qi}`} style={confirmationStyles.questionCard}>
              <div style={confirmationStyles.questionHead}>
                <span style={confirmationStyles.questionBadge}>
                  {question.header}
                </span>
                <p style={confirmationStyles.questionText}>{question.question}</p>
              </div>
              <div style={confirmationStyles.options}>
                {question.options.map((option) => {
                  const checked = values.includes(option.label)
                  return (
                    <button
                      key={option.label}
                      type="button"
                      disabled={!interactive}
                      onClick={() => question.multiSelect ? toggleMulti(question, option.label, option.preview) : setSingle(question, option.label, option.preview)}
                      style={{
                        ...confirmationStyles.option,
                        border: `1px solid ${checked ? 'rgba(99,102,241,0.45)' : 'var(--color-border-subtle)'}`,
                        background: checked ? 'rgba(99,102,241,0.12)' : 'var(--color-bg-surface)',
                        opacity: interactive ? 1 : 0.86,
                        cursor: interactive ? 'pointer' : 'default',
                      }}
                    >
                      <span
                        style={{
                          ...confirmationStyles.checkbox,
                          border: `1px solid ${checked ? 'var(--color-accent-primary)' : 'var(--color-border-strong)'}`,
                          background: checked ? 'var(--color-accent-primary)' : 'transparent',
                        }}
                      >
                        {checked && <Check size={12} color="#fff" />}
                      </span>
                      <span style={confirmationStyles.optionText}>
                        <span style={confirmationStyles.optionLabel}>{option.label}</span>
                        {option.description && (
                          <span style={confirmationStyles.optionDescription}>{option.description}</span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
              {preview && (
                <div
                  style={confirmationStyles.preview}
                  dangerouslySetInnerHTML={{ __html: sanitizePreviewHtml(preview) }}
                />
              )}
              {interactive && (
                <textarea
                  value={notes[question.question] || ''}
                  onChange={(e) => setNotes(prev => ({ ...prev, [question.question]: e.target.value }))}
                  placeholder="可选：补充说明"
                  style={confirmationStyles.textarea}
                />
              )}
            </div>
          )
        })}
      </div>

      {interactive && (
        <div style={confirmationStyles.footer}>
          <button onClick={() => onResponse?.(requestId, 'cancel')}
            style={confirmationStyles.outlineButton}>取消</button>
          <button onClick={submit} disabled={!canSubmit}
            style={{ ...confirmationStyles.primaryButton, opacity: canSubmit ? 1 : 0.45, cursor: canSubmit ? 'pointer' : 'default' }}>提交选择</button>
        </div>
      )}
    </div>
  )
}

/* ── Thinking Block ── */

export function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '4px 12px 4px 8px', borderRadius: 20,
          background: expanded ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.07)',
          border: '1px solid rgba(99,102,241,0.22)',
          fontSize: 11, color: 'var(--color-accent-primary)', cursor: 'pointer', transition: 'background 0.15s',
        }}
      >
        {streaming && !expanded
          ? <Loader2 size={11} style={{ color: 'var(--color-accent-primary)', animation: 'spin 1s linear infinite' }} />
          : expanded
          ? <ChevronDown size={11} />
          : <ChevronRight size={11} />
        }
        <span style={{ fontStyle: 'italic' }}>
          {streaming ? 'Thinking...' : 'Thinking'}
        </span>
      </button>
      {expanded && (
        <div style={{
          marginTop: 8, paddingLeft: 12, paddingTop: 12, paddingBottom: 12, paddingRight: 8,
          borderLeft: '2px solid rgba(99,102,241,0.25)', borderRadius: '0 6px 6px 0',
          background: 'rgba(99,102,241,0.04)',
          fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic', lineHeight: 1.7,
          maxHeight: 300, overflowY: 'auto', whiteSpace: 'pre-wrap',
        }}>
          {text}
        </div>
      )}
    </div>
  )
}

/* ── User Message ── */

function getMimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    pdf: 'application/pdf',
  }
  return map[ext] || 'application/octet-stream'
}

export function UserMessage({ blocks, fallbackContent, onPreviewFile }: {
  blocks: ContentBlock[]
  fallbackContent: string
  onPreviewFile?: (file: PreviewFile) => void
}) {
  const [copied, setCopied] = useState(false)
  const textBlocks = blocks.filter(b => b.type === 'text')
  const imageBlocks = blocks.filter(b => b.type === 'image_attachment')
  const fileBlocks = blocks.filter(b => b.type === 'file_attachment')
  const text = textBlocks.map(b => b.type === 'text' ? b.text : '').join('\n') || fallbackContent

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])

  return (
    <div className="flex justify-end">
      <div style={{ maxWidth: '70%', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>

        {/* ── Image attachments ── */}
        {imageBlocks.map((b, i) => {
          if (b.type !== 'image_attachment') return null
          const canPreview = !!onPreviewFile
          return (
            <div
              key={`img-${i}`}
              onClick={() => onPreviewFile?.({ url: b.url, name: b.name, mimeType: getMimeFromName(b.name) })}
              style={{
                borderRadius: 10, overflow: 'hidden',
                border: '1px solid var(--color-border-subtle)',
                cursor: canPreview ? 'pointer' : 'default',
                maxWidth: 260,
                position: 'relative',
              }}
              title={canPreview ? '点击预览' : b.name}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={b.url}
                alt={b.name}
                style={{ display: 'block', width: '100%', maxHeight: 200, objectFit: 'cover' }}
              />
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                padding: '4px 8px',
                background: 'linear-gradient(to top, rgba(0,0,0,0.6), transparent)',
              }}>
                <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.name}
                </p>
              </div>
            </div>
          )
        })}

        {/* ── File attachments ── */}
        {fileBlocks.map((b, i) => {
          if (b.type !== 'file_attachment') return null
          const ext = b.name.split('.').pop()?.toLowerCase() || ''
          const isPptLike = ['ppt', 'pptx', 'odp'].includes(ext)
          const canPreview = !!onPreviewFile && !isPptLike
          const cfg = getChipConfig(b.name, b.mimeType.includes('pdf') ? 'pdf' : 'text')
          return (
            <div
              key={`file-${i}`}
              onClick={() => canPreview && onPreviewFile?.({ url: b.url, originalFilename: b.originalFilename, name: b.name, mimeType: b.mimeType })}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', borderRadius: 10,
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border-strong)',
                cursor: canPreview ? 'pointer' : 'default',
                minWidth: 180, maxWidth: 260,
              }}
              title={canPreview ? '点击预览' : (isPptLike ? 'PPT 暂不支持预览' : b.name)}
            >
              <div style={{
                width: 36, height: 36, borderRadius: 6, flexShrink: 0,
                background: cfg.color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ fontSize: cfg.letter.length > 2 ? 9 : cfg.letter.length > 1 ? 11 : 14, fontWeight: 700, color: 'white', fontFamily: 'monospace', lineHeight: 1 }}>
                  {cfg.letter}
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.name}
                </p>
                <p style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  {cfg.typeLabel}{b.size > 0 ? ` · ${formatFileSize(b.size)}` : ''}{isPptLike ? ' · 暂不支持预览' : ''}
                </p>
              </div>
            </div>
          )
        })}

        {/* ── Text bubble ── */}
        {text && (
          <div className="relative group/ububble" style={{ alignSelf: 'flex-end' }}>
            <div style={{ padding: '10px 18px', borderRadius: 10, backgroundColor: 'var(--color-accent-primary)', minHeight: 0 }} className="text-white select-text">
              <p style={{ fontSize: 13, lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>{text}</p>
            </div>
            <button
              onClick={handleCopy}
              className="absolute -bottom-6 right-0 opacity-0 group-hover/ububble:opacity-100 transition-opacity flex items-center gap-1 text-[11px]"
              style={{ color: copied ? 'var(--color-accent-success)' : 'var(--color-text-muted)' }}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Assistant Message ── */

export function AssistantMessage({
  blocks, streaming, isThinking, thinkingMode, onPermissionDecision, onAskUserQuestionResponse, elapsedSeconds, inputTokens, outputTokens,
}: {
  blocks: ContentBlock[]
  streaming: boolean
  isThinking: boolean
  thinkingMode?: string
  onPermissionDecision?: (requestId: string, decision: 'allow' | 'allow_session' | 'deny') => void
  onAskUserQuestionResponse?: (requestId: string, action: 'submit' | 'cancel', answers?: AskUserQuestionAnswers, annotations?: AskUserQuestionAnnotations) => void
  elapsedSeconds?: number
  inputTokens?: number
  outputTokens?: number
}) {
  const [copied, setCopied] = useState(false)

  const allText = blocks.filter(b => b.type === 'text').map(b => b.type === 'text' ? b.text : '').join('\n\n').trim()

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(allText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [allText])

  const isEmpty = blocks.length === 0

  if (isEmpty && streaming) {
    const label = thinkingMode === 'max' && isThinking ? 'Thinking...' : undefined
    return <div className="flex flex-col gap-1"><WaitingIndicator label={label} /></div>
  }

  const toolResults = new Map<string, { content: string; is_error: boolean }>()
  const toolFailures = new Set<string>()
  const bridgedAskQuestionToolIds = new Set<string>()
  for (const b of blocks) {
    if (b.type === 'tool_result') toolResults.set(b.tool_use_id, { content: b.content, is_error: b.is_error })
    if (b.type === 'permission_request' && b.toolFailed && b.toolUseId) toolFailures.add(b.toolUseId)
    if (b.type === 'ask_user_question' && b.toolUseId) bridgedAskQuestionToolIds.add(b.toolUseId)
  }

  const agentSubBlocksMap = new Map<string, AgentSubBlock[]>()
  for (const b of blocks) {
    if (b.type === 'agent_content') {
      const existing = agentSubBlocksMap.get(b.parent_tool_use_id) || []
      agentSubBlocksMap.set(b.parent_tool_use_id, [...existing, ...b.blocks])
    }
  }

  const runningAgents = blocks.filter(b => b.type === 'tool_use' && isAgentToolCall(b.name) && !toolResults.has(b.id))
  const parallelCount = streaming ? runningAgents.length : 0

  const lastTextOrThinkingIdx = blocks.reduce((acc, b, i) => (b.type === 'text' || b.type === 'thinking') ? i : acc, -1)
  const hasAnyText = blocks.some(b => b.type === 'text' || b.type === 'thinking')

  return (
    <div className="flex flex-col gap-3">
      {parallelCount >= 2 && <ParallelAgentIndicator count={parallelCount} />}

      {blocks.map((block, i) => {
        switch (block.type) {
          case 'text':
            return (
              <div key={`text-${i}`} className="text-[13px] leading-relaxed select-text">
                <MarkdownRenderer content={block.text} />
                {streaming && i === lastTextOrThinkingIdx && !hasAnyText && <StreamingCursor />}
              </div>
            )
          case 'thinking':
            return <ThinkingBlock key={`think-${i}`} text={block.text} streaming={streaming && i === blocks.length - 1} />
          case 'tool_use': {
            if (block.name === 'AskUserQuestion' && bridgedAskQuestionToolIds.has(block.id)) return null
            if (isAgentToolCall(block.name)) {
              const agentTask = String(block.input.description || block.input.prompt || '')
              const result = toolResults.get(block.id)
              return (
                <AgentBlock key={block.id} toolUseId={block.id}
                  agentName={String(block.input.description || block.name || 'agent').slice(0, 30)}
                  task={agentTask} hasResult={!!result} isResultError={!!result?.is_error}
                  resultContent={result?.content} elapsedSeconds={0} streaming={streaming}
                  agentSubBlocks={agentSubBlocksMap.get(block.id)} />
              )
            }
            return (
              <ToolUseBlock key={block.id} id={block.id} name={block.name} input={block.input}
                result={toolResults.get(block.id)} toolFailed={toolFailures.has(block.id)} streaming={streaming} />
            )
          }
          case 'tool_raw_result': case 'tool_result': case 'agent_content': case 'tool_progress':
            return null
          case 'permission_request':
            return <PermissionBlock key={`perm-${block.requestId}`} requestId={block.requestId}
              toolName={block.toolName} toolInput={block.toolInput} status={block.status}
              toolUseId={block.toolUseId} toolFailed={block.toolFailed} onDecision={onPermissionDecision} />
          case 'ask_user_question':
            return <AskUserQuestionBlock key={`ask-${block.requestId}`} requestId={block.requestId}
              questions={block.questions} status={block.status} answers={block.answers} annotations={block.annotations}
              onResponse={onAskUserQuestionResponse} />
          default: return null
        }
      })}

      {/* Streaming status */}
      {streaming && blocks.length > 0 && (() => {
        const resultIds = new Set(blocks.filter(b => b.type === 'tool_result').map(b => b.type === 'tool_result' ? b.tool_use_id : ''))
        const runningTool = [...blocks].reverse().find(b => b.type === 'tool_use' && !resultIds.has(b.id))
        const label = runningTool?.type === 'tool_use'
          ? runningTool.name
          : blocks[blocks.length - 1]?.type === 'thinking' ? 'Thinking' : blocks.some(b => b.type === 'text') ? 'Writing' : 'Processing'
        return (
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0" style={{ background: 'var(--color-accent-primary)' }} />
            <span className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
          </div>
        )
      })()}

      {/* Bottom bar: copy + stats */}
      {!streaming && (allText || inputTokens || outputTokens || elapsedSeconds) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 4 }}>
          {allText && (
            <button onClick={handleCopy} style={{
              display: 'flex', alignItems: 'center', gap: 4, fontSize: 10,
              color: copied ? 'var(--color-accent-success)' : 'var(--color-text-muted)',
              background: 'rgba(255,255,255,0.04)', padding: '2px 8px', borderRadius: 10,
              border: '1px solid var(--color-border-subtle)', cursor: 'pointer',
            }}>
              {copied ? <Check size={10} /> : <Copy size={10} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
          {elapsedSeconds !== undefined && elapsedSeconds > 0 && (
            <span style={{
              fontSize: 10, color: 'var(--color-text-muted)',
              background: 'rgba(255,255,255,0.04)', padding: '2px 8px', borderRadius: 10,
              border: '1px solid var(--color-border-subtle)',
            }}>
              {elapsedSeconds < 60 ? `${elapsedSeconds}s` : `${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s`}
            </span>
          )}
          {(inputTokens || outputTokens) ? (
            <TokenUsagePopover inputTokens={inputTokens || 0} outputTokens={outputTokens || 0} />
          ) : null}
        </div>
      )}
    </div>
  )
}

/* ── Attachment helpers ── */

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export const SUPPORTED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp',
  '.pdf',
  '.txt', '.md', '.mdx', '.rst', '.log', '.csv', '.tsv', '.jsonl',
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java',
  '.cpp', '.c', '.h', '.hpp', '.rb', '.php', '.swift', '.kt',
  '.sh', '.bash', '.zsh', '.fish', '.sql',
  '.json', '.yaml', '.yml', '.toml', '.xml', '.env', '.ini', '.cfg',
  '.html', '.htm', '.css', '.scss', '.less', '.sass', '.svg',
  '.graphql', '.gql',
  // Office documents
  '.doc', '.docx', '.odt',
  '.xls', '.xlsx', '.xlsm', '.xlsb', '.ods',
  '.ppt', '.pptx', '.odp',
])

export interface ChipConfig { letter: string; color: string; typeLabel: string }

export function getChipConfig(name: string, tier: string): ChipConfig {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (tier === 'pdf' || ext === 'pdf') return { letter: 'PDF', color: '#ef4444', typeLabel: 'PDF' }
  if (['doc', 'docx', 'odt'].includes(ext)) return { letter: 'W', color: '#2b579a', typeLabel: 'Word' }
  if (['xls', 'xlsx', 'xlsm', 'xlsb', 'ods'].includes(ext)) return { letter: 'X', color: '#217346', typeLabel: 'Excel' }
  if (['ppt', 'pptx', 'odp'].includes(ext)) return { letter: 'P', color: '#d24726', typeLabel: 'PowerPoint' }
  if (['md', 'mdx'].includes(ext)) return { letter: 'MD', color: '#22c55e', typeLabel: 'Markdown' }
  if (ext === 'csv') return { letter: 'CSV', color: '#16a34a', typeLabel: 'CSV' }
  if (ext === 'txt') return { letter: 'TXT', color: '#6b7280', typeLabel: 'Text' }
  if (ext === 'json') return { letter: '{ }', color: '#8b5cf6', typeLabel: 'JSON' }
  if (['yaml', 'yml'].includes(ext)) return { letter: 'YML', color: '#8b5cf6', typeLabel: 'YAML' }
  if (['ts', 'tsx'].includes(ext)) return { letter: 'TS', color: '#3b82f6', typeLabel: ext === 'tsx' ? 'TSX' : 'TypeScript' }
  if (['js', 'jsx'].includes(ext)) return { letter: 'JS', color: '#f59e0b', typeLabel: ext === 'jsx' ? 'JSX' : 'JavaScript' }
  if (ext === 'py') return { letter: 'PY', color: '#3b82f6', typeLabel: 'Python' }
  return { letter: 'FILE', color: '#6b7280', typeLabel: 'File' }
}

/* ── Exports for toolbar ── */

export const PERMISSION_OPTIONS = [
  { value: 'confirm', label: 'Confirm', icon: Shield },
  { value: 'accept_edits', label: 'Accept Edits', icon: PenLine },
  { value: 'plan', label: 'Plan', icon: Route },
  { value: 'full', label: 'Full Access', icon: ShieldOff },
]

export const THINKING_OPTIONS = [
  { value: 'off', label: 'Off', icon: ZapOff, desc: 'No reasoning' },
  { value: 'auto', label: 'Auto', icon: Zap, desc: 'Automatic' },
  { value: 'max', label: 'Max', icon: Sparkles, desc: 'Deep reasoning' },
]

export const MODEL_ICONS: Record<string, React.ElementType> = {
  'claude-sonnet-4-6': Bot,
  'claude-opus-4-6': Crown,
  'claude-haiku-4-5': Rabbit,
}

export { ArrowUp, Square, ChevronDown, X, Check, Loader2, Bot }
