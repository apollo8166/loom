'use client'

import { useState } from 'react'
import { CheckCircle2, XCircle, Loader2, Circle, PauseCircle, StopCircle } from 'lucide-react'
import type { TaskInfo, TaskStatus } from '@/shared/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatElapsed(startedAt: number, endedAt?: number, totalPausedMs?: number): string {
  const elapsed = Math.floor(((endedAt ?? Date.now()) - startedAt - (totalPausedMs ?? 0)) / 1000)
  if (elapsed < 60) return `${elapsed}s`
  const m = Math.floor(elapsed / 60)
  const s = elapsed % 60
  return `${m}m${s > 0 ? `${s}s` : ''}`
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

/** Extract a likely file path from a description string */
function extractFilePath(description: string): string | null {
  // Match typical relative or absolute paths inside the description
  const match = description.match(/(?:^|\s)((?:\.\.?\/|\/|src\/|lib\/|app\/|components\/|pages\/|modules\/|shared\/)\S+)/i)
  if (match) return match[1].replace(/[,;:'"]+$/, '')
  return null
}

type StatusGroup = 'active' | 'queued' | 'done'

function getGroup(status: TaskStatus): StatusGroup {
  if (status === 'running' || status === 'paused') return 'active'
  if (status === 'pending') return 'queued'
  return 'done'
}

// ── StatusDot ─────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: TaskStatus }) {
  if (status === 'running') {
    return (
      <span style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: 'var(--color-accent-primary)',
        animation: 'task-pulse 1.4s ease-in-out infinite',
        display: 'inline-block',
      }} />
    )
  }
  if (status === 'paused') {
    return <PauseCircle size={12} style={{ color: '#fbbf24', flexShrink: 0 }} />
  }
  if (status === 'pending') {
    return <Circle size={12} style={{ color: 'var(--color-text-disabled)', flexShrink: 0 }} />
  }
  if (status === 'completed') {
    return <CheckCircle2 size={12} style={{ color: '#4ade80', flexShrink: 0 }} />
  }
  if (status === 'failed') {
    return <XCircle size={12} style={{ color: '#f87171', flexShrink: 0 }} />
  }
  // killed / stopped
  return <StopCircle size={12} style={{ color: 'var(--color-text-disabled)', flexShrink: 0 }} />
}

function statusLabel(status: TaskStatus): string {
  switch (status) {
    case 'running': return 'Running'
    case 'paused': return 'Paused'
    case 'pending': return 'Pending'
    case 'completed': return 'Done'
    case 'failed': return 'Failed'
    case 'killed': return 'Stopped'
    case 'stopped': return 'Stopped'
  }
}

function statusColor(status: TaskStatus): string {
  switch (status) {
    case 'running': return 'var(--color-accent-primary)'
    case 'paused': return '#fbbf24'
    case 'completed': return '#4ade80'
    case 'failed': return '#f87171'
    default: return 'var(--color-text-muted)'
  }
}

function leftBarColor(status: TaskStatus): string {
  switch (status) {
    case 'running': return 'var(--color-accent-primary)'
    case 'paused': return '#fbbf24'
    case 'completed': return '#4ade80'
    case 'failed': return '#f87171'
    default: return 'transparent'
  }
}

// ── Task Card ─────────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: TaskInfo
  onFilePathClick?: (path: string) => void
}

function TaskCard({ task, onFilePathClick }: TaskCardProps) {
  const [expanded, setExpanded] = useState(false)
  const isRunning = task.status === 'running'
  const filePath = task.description ? extractFilePath(task.description) : null
  const elapsed = formatElapsed(task.startedAt, task.endedAt, task.totalPausedMs)

  return (
    <div
      onClick={() => setExpanded(e => !e)}
      style={{
        position: 'relative',
        borderRadius: 6,
        marginBottom: 6,
        background: 'var(--color-bg-surface)',
        border: `1px solid ${task.status === 'failed' ? 'rgba(248,113,113,0.25)' : 'var(--color-border-subtle)'}`,
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'border-color 0.2s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = task.status === 'failed' ? 'rgba(248,113,113,0.5)' : 'var(--color-border-strong)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = task.status === 'failed' ? 'rgba(248,113,113,0.25)' : 'var(--color-border-subtle)' }}
    >
      {/* Left color bar */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 2,
        background: leftBarColor(task.status),
        animation: isRunning ? 'task-flow-bar 2s linear infinite' : 'none',
      }} />

      {/* Top shimmer (running only) */}
      {isRunning && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 1,
          background: 'linear-gradient(90deg, transparent 0%, var(--color-accent-primary) 50%, transparent 100%)',
          backgroundSize: '200% 100%',
          animation: 'task-shimmer 2s linear infinite',
          opacity: 0.6,
        }} />
      )}

      {/* Card body */}
      <div style={{ padding: '8px 10px 8px 12px' }}>
        {/* Row 1: status + elapsed */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
          <StatusDot status={task.status} />
          <span style={{ fontSize: 10, fontWeight: 600, color: statusColor(task.status), textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {statusLabel(task.status)}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>
            {elapsed}
          </span>
        </div>

        {/* Row 2: description */}
        <div style={{
          fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: expanded ? 'normal' : 'nowrap',
          lineHeight: 1.4, marginBottom: 2,
        }}>
          {task.description}
        </div>

        {/* Row 3: tool name or file path chip */}
        {(task.lastToolName || filePath) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
            {task.lastToolName && (
              <span style={{
                fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3,
                background: 'var(--color-bg-surface-high)',
                color: 'var(--color-text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase',
              }}>
                {task.lastToolName}
              </span>
            )}
            {filePath && onFilePathClick && (
              <span
                onClick={e => { e.stopPropagation(); onFilePathClick(filePath) }}
                title={filePath}
                style={{
                  fontSize: 10, color: 'var(--color-accent-primary)',
                  fontFamily: 'monospace', cursor: 'pointer',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180,
                  textDecoration: 'underline', textDecorationStyle: 'dotted',
                }}
              >
                {filePath.split('/').pop()}
              </span>
            )}
          </div>
        )}

        {/* Running shimmer bar */}
        {isRunning && (
          <div style={{
            marginTop: 6, height: 2, borderRadius: 1,
            background: 'var(--color-bg-surface-high)',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', width: '40%',
              background: 'linear-gradient(90deg, transparent, var(--color-accent-primary), transparent)',
              animation: 'task-shimmer 1.5s linear infinite',
            }} />
          </div>
        )}

        {/* Expanded details */}
        {expanded && (
          <div style={{ marginTop: 8, borderTop: '1px solid var(--color-border-subtle)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {task.summary && (
              <p style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.5, margin: 0 }}>
                {task.summary}
              </p>
            )}
            {task.error && (
              <p style={{ fontSize: 11, color: '#f87171', lineHeight: 1.5, margin: 0 }}>
                {task.error}
              </p>
            )}
            {task.usage && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, color: 'var(--color-text-disabled)' }}>
                  {formatTokens(task.usage.totalTokens)} tokens
                </span>
                <span style={{ fontSize: 10, color: 'var(--color-text-disabled)' }}>
                  {task.usage.toolUses} tool uses
                </span>
                <span style={{ fontSize: 10, color: 'var(--color-text-disabled)' }}>
                  {Math.round(task.usage.durationMs / 1000)}s
                </span>
              </div>
            )}
            {(task.subagentType || task.taskType) && (
              <div style={{ display: 'flex', gap: 6 }}>
                {task.subagentType && (
                  <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(99,102,241,0.1)', color: 'var(--color-accent-primary)', fontWeight: 600 }}>
                    {task.subagentType}
                  </span>
                )}
                {task.taskType && task.taskType !== 'subagent' && (
                  <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--color-bg-surface-high)', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                    {task.taskType}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
      color: 'var(--color-text-disabled)', padding: '8px 2px 4px',
    }}>
      {label} <span style={{ fontWeight: 400 }}>({count})</span>
    </div>
  )
}

// ── Scheduled Task Card (Loom-style) ─────────────────────────────────────────

function ScheduledTaskCard({ task }: { task: TaskInfo }) {
  const isRunning = task.status === 'running'
  const isDone = task.status === 'completed'
  const elapsed = formatElapsed(task.startedAt, task.endedAt, task.totalPausedMs)

  return (
    <div style={{
      borderRadius: 8, marginBottom: 10,
      background: 'var(--color-bg-surface)',
      border: `1px solid ${
        task.status === 'failed' ? 'rgba(239,68,68,0.25)'
        : isDone ? 'rgba(50,213,131,0.2)'
        : 'var(--color-border-subtle)'
      }`,
      padding: '11px 13px',
    }}>
      {/* Header: icon + name + badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        {isRunning
          ? <Loader2 size={13} className="animate-spin" style={{ color: 'var(--color-accent-primary)', flexShrink: 0 }} />
          : isDone
            ? <CheckCircle2 size={13} style={{ color: 'var(--color-accent-success)', flexShrink: 0 }} />
            : <XCircle size={13} style={{ color: 'var(--color-accent-danger)', flexShrink: 0 }} />
        }
        <span style={{
          flex: 1, fontSize: 12, fontWeight: 600,
          color: 'var(--color-text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {task.description}
        </span>
        <span style={{
          flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', gap: 3,
          fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
          ...(isRunning ? {
            background: 'rgba(245,158,11,0.12)',
            color: 'var(--color-accent-primary)',
            border: '1px solid rgba(245,158,11,0.3)',
          } : isDone ? {
            background: 'rgba(50,213,131,0.12)',
            color: 'var(--color-accent-success)',
            border: '1px solid rgba(50,213,131,0.25)',
          } : {
            background: 'rgba(239,68,68,0.12)',
            color: 'var(--color-accent-danger)',
            border: '1px solid rgba(239,68,68,0.25)',
          }),
        }}>
          {isRunning ? '执行中' : isDone ? '完成' : '失败'}
        </span>
      </div>

      {/* Elapsed */}
      <div style={{ fontSize: 10, color: 'var(--color-text-disabled)', marginTop: 5, paddingLeft: 20 }}>
        {elapsed}
      </div>

      {/* Summary preview (completed only) */}
      {task.summary && (
        <div style={{
          marginTop: 8, paddingTop: 8,
          borderTop: '1px solid var(--color-border-subtle)',
          fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.55,
          overflow: 'hidden', display: '-webkit-box',
          WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
        }}>
          {task.summary}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface TaskListProps {
  tasks: Map<string, TaskInfo>
  onFilePathClick?: (path: string) => void
}

export function TaskList({ tasks, onFilePathClick }: TaskListProps) {
  const all = Array.from(tasks.values())
  const scheduled = all.filter(t => t.subagentType === 'Scheduled')
  const agentTasks = all.filter(t => t.subagentType !== 'Scheduled')
  const active = agentTasks.filter(t => getGroup(t.status) === 'active')
  const queued = agentTasks.filter(t => getGroup(t.status) === 'queued')
  const done = agentTasks.filter(t => getGroup(t.status) === 'done').sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))

  const runningCount = active.filter(t => t.status === 'running').length
  const failedCount = done.filter(t => t.status === 'failed').length

  const hasAgentTasks = active.length > 0 || queued.length > 0 || done.length > 0

  if (scheduled.length === 0 && !hasAgentTasks) {
    return (
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 8,
        color: 'var(--color-text-disabled)', padding: 24,
      }}>
        <Loader2 size={20} style={{ opacity: 0.3 }} />
        <p style={{ fontSize: 12, textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
          当 AI 启动子任务时，<br />执行轨迹会显示在这里
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <style>{`
        @keyframes task-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.35); opacity: 0.7; }
        }
        @keyframes task-shimmer {
          0% { transform: translateX(-200%); }
          100% { transform: translateX(400%); }
        }
        @keyframes task-flow-bar {
          0% { opacity: 0.4; }
          50% { opacity: 1; }
          100% { opacity: 0.4; }
        }
      `}</style>

      {/* Agent task summary bar — only when agent tasks exist */}
      {hasAgentTasks && (
        <div style={{
          flexShrink: 0, padding: '8px 12px',
          borderBottom: '1px solid var(--color-border-subtle)',
          display: 'flex', gap: 12, alignItems: 'center',
        }}>
          {runningCount > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-accent-primary)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-accent-primary)', animation: 'task-pulse 1.4s ease-in-out infinite', display: 'inline-block' }} />
              {runningCount} running
            </span>
          )}
          {done.length - failedCount > 0 && (
            <span style={{ fontSize: 11, color: '#4ade80' }}>
              ✓ {done.length - failedCount} done
            </span>
          )}
          {failedCount > 0 && (
            <span style={{ fontSize: 11, color: '#f87171' }}>
              ✕ {failedCount} failed
            </span>
          )}
          {queued.length > 0 && (
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              ○ {queued.length} queued
            </span>
          )}
        </div>
      )}

      {/* Scrollable task list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 10px 12px' }}>
        {/* Scheduled task entry — Loom-style, rendered above agent subtasks */}
        {scheduled.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {scheduled.map(t => <ScheduledTaskCard key={t.id} task={t} />)}
            {hasAgentTasks && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                margin: '4px 0 8px',
              }}>
                <div style={{ flex: 1, height: 1, background: 'var(--color-border-subtle)' }} />
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-disabled)', flexShrink: 0 }}>
                  子任务
                </span>
                <div style={{ flex: 1, height: 1, background: 'var(--color-border-subtle)' }} />
              </div>
            )}
          </div>
        )}

        {active.length > 0 && (
          <>
            <SectionHeader label="Active" count={active.length} />
            {active.map(t => <TaskCard key={t.id} task={t} onFilePathClick={onFilePathClick} />)}
          </>
        )}
        {queued.length > 0 && (
          <>
            <SectionHeader label="Queued" count={queued.length} />
            {queued.map(t => <TaskCard key={t.id} task={t} onFilePathClick={onFilePathClick} />)}
          </>
        )}
        {done.length > 0 && (
          <>
            <SectionHeader label="Done" count={done.length} />
            {done.map(t => <TaskCard key={t.id} task={t} onFilePathClick={onFilePathClick} />)}
          </>
        )}
      </div>
    </div>
  )
}
