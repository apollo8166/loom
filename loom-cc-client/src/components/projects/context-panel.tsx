'use client'

import { useEffect, useRef, useState } from 'react'
import type { TaskInfo } from '@/shared/types'
import { TaskList } from '@/components/projects/task-list'
import { FileTreePanel } from '@/components/projects/file-tree-panel'
import { MemoryPanel } from '@/components/projects/memory-panel'

interface ContextPanelProps {
  projectId: string
  workspacePath: string
  projectName: string
  tasks: Map<string, TaskInfo>
  onPreviewChange?: (open: boolean) => void
}

export function ContextPanel({
  projectId, workspacePath, projectName, tasks, onPreviewChange,
}: ContextPanelProps) {
  const [activeTab, setActiveTab] = useState<'tasks' | 'files' | 'memory'>('files')
  const [deferFileTree, setDeferFileTree] = useState(true)
  const [highlightPath, setHighlightPath] = useState<string | null>(null)
  const prevRunningCountRef = useRef(0)

  const runningCount = Array.from(tasks.values()).filter(t => t.status === 'running').length

  useEffect(() => {
    if (runningCount > 0 && prevRunningCountRef.current === 0) {
      setActiveTab('tasks')
    }
    prevRunningCountRef.current = runningCount
  }, [runningCount])

  useEffect(() => {
    setDeferFileTree(true)
    let idleId: number | null = null
    let timerId: ReturnType<typeof setTimeout> | null = null
    const reveal = () => setDeferFileTree(false)
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(reveal, { timeout: 1200 })
    } else {
      timerId = setTimeout(reveal, 350)
    }
    return () => {
      if (idleId !== null) window.cancelIdleCallback?.(idleId)
      if (timerId !== null) clearTimeout(timerId)
    }
  }, [projectId])

  const handleFilePathClick = (path: string) => {
    setHighlightPath(path)
    setActiveTab('files')
  }

  return (
    <div style={{
      width: 260, flexShrink: 0,
      display: 'flex', flexDirection: 'column',
      height: '100%',
      border: '1px solid var(--shell-panel-border)',
      borderRadius: 'var(--shell-radius-lg)',
      background: 'var(--shell-panel-bg-muted)',
      boxShadow: 'var(--shell-panel-shadow-soft)',
      overflow: 'hidden',
    }}>
      {/* Tab bar */}
      <div style={{
        height: 48, flexShrink: 0,
        display: 'flex', alignItems: 'center',
        margin: 10,
        marginBottom: 6,
        padding: 4,
        gap: 4,
        borderRadius: 10,
        background: 'var(--theme-bg-surface)',
        border: '1px solid var(--shell-panel-border)',
      }}>
        <TabButton
          active={activeTab === 'tasks'}
          onClick={() => setActiveTab('tasks')}
        >
          Tasks
          {runningCount > 0 && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              marginLeft: 5, fontSize: 9, fontWeight: 700,
              color: 'var(--color-accent-primary)',
            }}>
              <span style={{
                width: 5, height: 5, borderRadius: '50%', background: 'var(--color-accent-primary)',
                animation: 'ctx-pulse 1.4s ease-in-out infinite', display: 'inline-block',
              }} />
              {runningCount}
            </span>
          )}
        </TabButton>
        <TabButton
          active={activeTab === 'files'}
          onClick={() => setActiveTab('files')}
        >
          Files
        </TabButton>
        <TabButton
          active={activeTab === 'memory'}
          onClick={() => setActiveTab('memory')}
        >
          Memory
        </TabButton>

        <style>{`
          @keyframes ctx-pulse {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.5); opacity: 0.6; }
          }
        `}</style>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, padding: '0 10px 10px' }}>
        {activeTab === 'tasks' ? (
          <TaskList tasks={tasks} onFilePathClick={handleFilePathClick} />
        ) : activeTab === 'files' ? (
          deferFileTree ? <FileTreeSkeleton /> : (
            <FileTreePanel
              projectId={projectId}
              workspacePath={workspacePath}
              projectName={projectName}
              onPreviewChange={onPreviewChange}
              highlightPath={highlightPath}
            />
          )
        ) : (
          <MemoryPanel projectId={projectId} workspacePath={workspacePath} />
        )}
      </div>
    </div>
  )
}

function FileTreeSkeleton() {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--color-text-muted)',
      fontSize: 11,
    }}>
      Loading files...
    </div>
  )
}

// ── Tab button ────────────────────────────────────────────────────────────────

function TabButton({
  active, onClick, children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 12px',
        fontSize: 12, fontWeight: active ? 600 : 400,
        color: active ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
        background: active ? 'var(--theme-bg-active)' : 'transparent',
        border: 'none',
        cursor: 'pointer',
        borderRadius: 8,
        transition: 'color 0.15s, background 0.15s',
        height: 34,
        flex: 1,
      }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-secondary)' }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-muted)' }}
    >
      {children}
    </button>
  )
}
