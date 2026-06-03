'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Trash2, Pencil, Check, X, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import type { Session } from '@/shared/types'

interface SessionPanelProps {
  sessions: Session[]
  activeSessionId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
}

function formatTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface ContextMenuState { sessionId: string; x: number; y: number }

export function SessionPanel({
  sessions,
  activeSessionId,
  onSelect,
  onNew,
  onDelete,
  onRename,
}: SessionPanelProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!contextMenu) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setContextMenu(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [contextMenu])

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingId])

  const handleContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault()
    setContextMenu({ sessionId: id, x: e.clientX, y: e.clientY })
  }, [])

  const startRename = useCallback((id: string, currentTitle: string) => {
    setContextMenu(null)
    setEditingId(id)
    setEditTitle(currentTitle)
  }, [])

  const commitRename = useCallback(() => {
    if (editingId && editTitle.trim()) onRename(editingId, editTitle.trim())
    setEditingId(null)
  }, [editingId, editTitle, onRename])

  const cancelRename = useCallback(() => { setEditingId(null) }, [])

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitRename()
    if (e.key === 'Escape') cancelRename()
  }

  const handleDelete = useCallback((id: string) => {
    setContextMenu(null)
    setDeleteConfirmId(id)
  }, [])

  const confirmDelete = useCallback(() => {
    if (deleteConfirmId) { onDelete(deleteConfirmId); setDeleteConfirmId(null) }
  }, [deleteConfirmId, onDelete])

  return (
    <div className={cn(
      'flex flex-col shrink-0 h-full transition-all duration-200',
      isCollapsed ? 'w-[48px]' : 'w-[220px]',
    )} style={{
      background: 'var(--color-bg-nav)',
      borderRight: '1px solid var(--color-border-subtle)',
    }}>
      <div style={{ padding: '10px 10px 8px 10px' }} className="shrink-0">
        {isCollapsed ? (
          <button
            onClick={() => setIsCollapsed(false)}
            title="Expand session list"
            style={{ height: 37 }}
            className="w-full flex items-center justify-center rounded-lg transition-colors"
          >
            <PanelLeftOpen size={14} style={{ color: 'var(--color-text-muted)' }} />
          </button>
        ) : (
          <div className="flex" style={{ gap: 6 }}>
            <button
              onClick={onNew}
              style={{ height: 37, border: '1px solid var(--color-border-subtle)' }}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg text-[13px] transition-colors"
            >
              <Plus size={13} style={{ color: 'var(--color-text-muted)' }} />
              <span style={{ color: 'var(--color-text-muted)' }}>New Session</span>
            </button>
            <button
              onClick={() => setIsCollapsed(true)}
              title="Collapse session list"
              style={{ height: 37, width: 37, border: '1px solid var(--color-border-subtle)' }}
              className="flex items-center justify-center rounded-lg transition-colors shrink-0"
            >
              <PanelLeftClose size={14} style={{ color: 'var(--color-text-muted)' }} />
            </button>
          </div>
        )}
      </div>

      {!isCollapsed && (
        <div className="flex-1 overflow-y-auto" style={{ padding: '4px 8px 8px 8px' }}>
          {sessions.map(s => (
            <div
              key={s.id}
              onContextMenu={e => handleContextMenu(e, s.id)}
              onClick={() => onSelect(s.id)}
              style={{ padding: '8px 10px', minHeight: 50, marginBottom: 2 }}
              className={cn(
                'group flex items-center gap-1 rounded-lg cursor-pointer transition-colors',
              )}
              onMouseEnter={e => {
                if (s.id !== activeSessionId) (e.currentTarget as HTMLElement).style.background = 'var(--color-bg-surface)'
              }}
              onMouseLeave={e => {
                if (s.id !== activeSessionId) (e.currentTarget as HTMLElement).style.background = 'transparent'
              }}
              ref={el => {
                if (el) el.style.background = s.id === activeSessionId ? 'var(--color-bg-surface-high)' : 'transparent'
              }}
            >
              {editingId === s.id ? (
                <div className="flex-1 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  <input
                    ref={editInputRef}
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    onKeyDown={handleEditKeyDown}
                    className="flex-1 rounded px-1.5 py-0.5 text-[12px] outline-none w-0 min-w-0"
                    style={{
                      background: 'var(--color-bg-input)',
                      border: '1px solid rgba(99, 102, 241, 0.4)',
                      color: 'var(--color-text-primary)',
                    }}
                  />
                  <button onClick={commitRename} style={{ color: 'var(--color-accent-success)' }} className="shrink-0"><Check size={12} /></button>
                  <button onClick={cancelRename} style={{ color: 'var(--color-text-muted)' }} className="shrink-0"><X size={12} /></button>
                </div>
              ) : (
                <>
                  <div className="flex-1 min-w-0 flex flex-col">
                    <span className="text-[13px] truncate leading-snug" style={{ color: 'var(--color-text-secondary)' }}>{s.title}</span>
                    <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
                      <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                        {formatTime(s.lastMessageAt || s.updatedAt)}
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--color-text-disabled)' }}>
                        {s.model.replace('claude-', '').replace(/-/g, ' ')}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(s.id) }}
                    className="hidden group-hover:flex items-center justify-center w-5 h-5 rounded transition-colors shrink-0"
                    style={{ color: 'var(--color-text-muted)' }}
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {deleteConfirmId && createPortal(
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)' }} onClick={() => setDeleteConfirmId(null)} />
          <div style={{ position: 'relative', borderRadius: 12, minWidth: 280, padding: 24, background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-strong)', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)' }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 6 }}>Delete session?</p>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 24 }}>This will permanently delete this session and all its messages.</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setDeleteConfirmId(null)}
                style={{ padding: '8px 20px', borderRadius: 8, fontSize: 12, cursor: 'pointer', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border-strong)', background: 'var(--color-bg-surface-high)' }}
              >Cancel</button>
              <button
                onClick={confirmDelete}
                style={{ padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer', color: '#ffffff', background: '#ef4444', border: 'none' }}
              >Delete</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {contextMenu && (
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 50, minWidth: 140, background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', padding: '4px 0' }}
        >
          <button
            onClick={() => {
              const s = sessions.find(s => s.id === contextMenu.sessionId)
              if (s) startRename(s.id, s.title)
            }}
            className="flex items-center gap-2 w-full pl-4 pr-5 h-8 text-left text-[12px] transition-colors"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <Pencil size={12} style={{ color: 'var(--color-text-muted)' }} />
            Rename
          </button>
          <button
            onClick={() => handleDelete(contextMenu.sessionId)}
            className="flex items-center gap-2 w-full pl-4 pr-5 h-8 text-left text-[12px] transition-colors"
            style={{ color: 'var(--color-accent-danger)' }}
          >
            <Trash2 size={12} />
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
