'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  Plus, Trash2, Pencil, Check, X,
  PanelLeftClose, PanelLeftOpen, FolderOpen, Search,
  MessageSquare, Wrench, Radio, Clock, Package, Settings, ArrowLeft,
} from 'lucide-react'
import type { Session, Project } from '@/shared/types'

export type ProjectPane = 'chat' | 'manage' | 'im' | 'schedule' | 'marketplace' | 'settings'

const BOTTOM_NAV: { id: ProjectPane; label: string; Icon: React.ElementType }[] = [
  { id: 'chat',        label: 'Chat',        Icon: MessageSquare },
  { id: 'manage',      label: 'Manage',      Icon: Wrench },
  { id: 'im',          label: 'IM Channels', Icon: Radio },
  { id: 'schedule',    label: 'Schedule',    Icon: Clock },
  { id: 'marketplace', label: 'Marketplace', Icon: Package },
  { id: 'settings',    label: '设置',        Icon: Settings },
]

function formatTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return '刚刚'
  if (diffMins < 60) return `${diffMins}分钟前`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}小时前`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return `${diffDays}天前`
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

interface ProjectSidebarProps {
  project: Project
  sessions: Session[]
  activeSessionId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
  activePane: ProjectPane
  onPaneChange: (p: ProjectPane) => void
  runningSessionIds?: Set<string>
  onBack?: () => void
  forceCollapsed?: boolean
  chatOnly?: boolean
}

interface ContextMenuState { sessionId: string; x: number; y: number }

export function ProjectSidebar({
  project, sessions,
  activeSessionId, onSelect, onNew, onDelete, onRename,
  activePane, onPaneChange, runningSessionIds = new Set(), onBack, forceCollapsed,
  chatOnly = false,
}: ProjectSidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const effectiveCollapsed = isCollapsed || (forceCollapsed ?? false)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setContextMenu(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [contextMenu])

  // Focus edit input
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

  const cancelRename = useCallback(() => setEditingId(null), [])

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

  const filteredSessions = sessions.filter(s =>
    !search || s.title.toLowerCase().includes(search.toLowerCase())
  )

  /* ── Collapsed state ── */
  if (effectiveCollapsed) {
    return (
      <div style={{
        width: 48, flexShrink: 0, height: '100%',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        background: 'var(--shell-panel-bg-muted)',
        border: '1px solid var(--shell-panel-border)',
        borderRadius: 'var(--shell-radius-md)',
        boxShadow: 'var(--shell-panel-shadow-soft)',
        transition: 'width 0.2s',
        overflow: 'hidden',
      }}>
        {/* Back button */}
        {onBack && !chatOnly && (
          <button
            onClick={onBack}
            title="返回项目列表"
            style={{
              width: 48, height: 36, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-muted)',
            }}
          >
            <ArrowLeft size={14} />
          </button>
        )}
        {/* Expand button */}
        <button
          onClick={() => setIsCollapsed(false)}
          title="展开菜单"
          style={{
            width: 48, height: onBack && !chatOnly ? 36 : 48, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--color-text-muted)',
            borderBottom: '1px solid var(--shell-panel-border)',
          }}
        >
          <PanelLeftOpen size={15} />
        </button>

        {/* Session dots */}
        <div style={{ flex: 1, overflowY: 'auto', width: '100%', padding: '4px 0' }}>
          {sessions.slice(0, 20).map(s => {
            const isActive = s.id === activeSessionId
            const isRunning = runningSessionIds.has(s.id)
            return (
              <button
                key={s.id}
                onClick={() => { onSelect(s.id); setIsCollapsed(false) }}
                title={isRunning ? `${s.title} · 执行中` : s.title}
                style={{
                  width: '100%', height: 36,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  position: 'relative',
                  background: isActive ? 'var(--theme-bg-active)' : 'none',
                  border: 'none', cursor: 'pointer',
                  borderLeft: 'none',
                  color: isActive || isRunning ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
                }}
              >
                <MessageSquare size={13} />
                {isRunning && (
                  <span
                    className="session-running-dot"
                    style={{
                      position: 'absolute',
                      right: 8,
                      top: 9,
                      width: 6,
                      height: 6,
                      borderRadius: 999,
                      background: 'var(--color-accent-primary)',
                    }}
                  />
                )}
              </button>
            )
          })}
        </div>

        {/* Bottom nav icons */}
        {!chatOnly && <div style={{
          borderTop: '1px solid var(--shell-panel-border)',
          width: '100%', padding: '4px 0 20px',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
        }}>
          {BOTTOM_NAV.map(({ id, label, Icon }) => {
            const isActive = activePane === id
            return (
              <button
                key={id}
                onClick={() => onPaneChange(id)}
                title={label}
                style={{
                  width: '100%', height: 36,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: isActive ? 'var(--theme-bg-active)' : 'none',
                  border: 'none',
                  borderRight: 'none',
        borderRadius: 8,
                  cursor: 'pointer',
                  color: isActive ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
                }}
              >
                <Icon size={14} />
              </button>
            )
          })}
        </div>}
      </div>
    )
  }

  /* ── Expanded state ── */
  return (
    <div style={{
      width: 260, flexShrink: 0, height: '100%',
      display: 'flex', flexDirection: 'column',
      background: 'var(--shell-panel-bg-muted)',
      border: '1px solid var(--shell-panel-border)',
      borderRadius: 'var(--shell-radius-lg)',
      boxShadow: 'var(--shell-panel-shadow-soft)',
      transition: 'width 0.2s',
      overflow: 'hidden',
    }}>
      {/* ── Header ── */}
      <div style={{
        height: 48, flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '0 10px',
        margin: 10,
        marginBottom: 6,
        borderRadius: 10,
        background: 'var(--theme-bg-surface)',
        border: '1px solid var(--shell-panel-border)',
      }}>
        {onBack && !chatOnly && (
          <button
            onClick={onBack}
            title="返回项目列表"
            style={{
              width: 28, height: 28, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-muted)', borderRadius: 6,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'; (e.currentTarget as HTMLElement).style.background = 'var(--theme-bg-hover)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'; (e.currentTarget as HTMLElement).style.background = 'none' }}
          >
            <ArrowLeft size={14} />
          </button>
        )}
        <FolderOpen size={14} style={{ color: 'var(--color-accent-primary)', flexShrink: 0 }} />
        <span style={{
          flex: 1, fontSize: 13, fontWeight: 600,
          color: 'var(--color-text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {project.name}
        </span>
        <button
          onClick={() => setIsCollapsed(true)}
          title="折叠菜单"
          style={{
            width: 28, height: 28, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--color-text-muted)', borderRadius: 6,
          }}
        >
          <PanelLeftClose size={14} />
        </button>
      </div>

      {/* ── Session area ── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* New Session button */}
        <div style={{ padding: '4px 10px 4px' }}>
          <button
            onClick={onNew}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 12px', borderRadius: 9, fontSize: 13, cursor: 'pointer',
              background: 'var(--theme-bg-active)',
              border: '1px solid var(--theme-border-strong)',
              color: 'var(--color-accent-primary)',
            }}
          >
            <Plus size={13} />
            New Session
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: '4px 10px 8px', position: 'relative' }}>
          <Search
            size={11}
            style={{
              position: 'absolute', left: 22, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--color-text-disabled)', pointerEvents: 'none',
            }}
          />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索会话…"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '7px 10px 7px 28px', borderRadius: 8, fontSize: 12, outline: 'none',
              background: 'var(--theme-bg-input)',
              border: '1px solid var(--shell-panel-border)',
              color: 'var(--color-text-primary)',
            }}
          />
        </div>

        {/* Session list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 10px 10px' }}>
          {filteredSessions.length === 0 && (
            <p style={{
              fontSize: 11, color: 'var(--color-text-disabled)',
              textAlign: 'center', padding: '16px 0',
            }}>
              {search ? '无匹配会话' : '暂无会话'}
            </p>
          )}
          {filteredSessions.map(s => {
            const isActive = s.id === activeSessionId
            const isRunning = runningSessionIds.has(s.id)
            return (
              <div
                key={s.id}
                onContextMenu={e => handleContextMenu(e, s.id)}
                onClick={() => onSelect(s.id)}
                style={{
                  padding: '9px 10px',
                  marginBottom: 6,
                  borderRadius: 9,
                  cursor: 'pointer',
                  position: 'relative',
                  background: isActive ? 'var(--theme-bg-active)' : isRunning ? 'rgba(245, 158, 11, 0.06)' : 'transparent',
                  border: isRunning
                    ? '1px solid rgba(245, 158, 11, 0.45)'
                    : isActive ? '1px solid var(--theme-border-strong)' : '1px solid transparent',
                  boxShadow: isRunning ? '0 0 0 1px rgba(245, 158, 11, 0.12), 0 0 18px rgba(245, 158, 11, 0.18)' : 'none',
                  display: 'flex', alignItems: 'flex-start', gap: 4,
                }}
                onMouseEnter={e => {
                  if (!isActive && !isRunning) (e.currentTarget as HTMLElement).style.background = 'var(--theme-bg-hover)'
                }}
                onMouseLeave={e => {
                  if (!isActive && !isRunning) (e.currentTarget as HTMLElement).style.background = 'transparent'
                }}
              >
                {editingId === s.id ? (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}
                    onClick={e => e.stopPropagation()}>
                    <input
                      ref={editInputRef}
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      onKeyDown={handleEditKeyDown}
                      style={{
                        flex: 1, minWidth: 0, fontSize: 12, borderRadius: 4,
                        padding: '2px 6px', outline: 'none',
                        background: 'var(--color-bg-input)',
                        border: '1px solid rgba(99,102,241,0.4)',
                        color: 'var(--color-text-primary)',
                      }}
                    />
                    <button onClick={commitRename} style={{ color: 'var(--color-accent-success)', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
                      <Check size={12} />
                    </button>
                    <button onClick={cancelRename} style={{ color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      fontSize: 12, fontWeight: isActive ? 500 : 400,
                      color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      marginBottom: 2,
                    }}>
                      {s.title}
                    </p>
                    <p style={{ fontSize: 10, color: isRunning ? '#b45309' : 'var(--color-text-muted)' }}>
                      {isRunning ? '执行中' : formatTime(s.lastMessageAt || s.updatedAt)}
                    </p>
                  </div>
                )}
                {isRunning && (
                  <span
                    className="session-running-dot"
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 999,
                      background: '#F59E0B',
                      flexShrink: 0,
                      marginTop: 4,
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Bottom Nav ── */}
      {!chatOnly && <div style={{
        flexShrink: 0,
        borderTop: 'none',
        display: 'flex', flexDirection: 'column',
        padding: '8px',
        margin: '0 10px 10px',
        borderRadius: 10,
        background: 'var(--theme-bg-surface)',
        border: '1px solid var(--shell-panel-border)',
      }}>
        {BOTTOM_NAV.map(({ id, label, Icon }) => {
          const isActive = activePane === id
          return (
            <button
              key={id}
              onClick={() => onPaneChange(id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px',
                borderRadius: 8,
                background: isActive ? 'var(--theme-bg-active)' : 'none',
                border: 'none',
                cursor: 'pointer',
                color: isActive ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
                textAlign: 'left',
              }}
              onMouseEnter={e => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = 'var(--theme-bg-hover)'
                  ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'
                }
              }}
              onMouseLeave={e => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = 'none'
                  ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'
                }
              }}
            >
              <Icon size={14} style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{label}</span>
            </button>
          )
        })}
      </div>}

      {/* ── Delete confirm dialog ── */}
      {deleteConfirmId && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'var(--theme-bg-overlay)' }} onClick={() => setDeleteConfirmId(null)} />
          <div style={{
            position: 'relative', borderRadius: 12, minWidth: 280, padding: 24,
            background: 'var(--theme-bg-surface)',
            border: '1px solid var(--theme-border-strong)',
            boxShadow: 'var(--theme-shadow-popover)',
          }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 6 }}>删除会话？</p>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 24 }}>此操作将永久删除该会话及其所有消息。</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setDeleteConfirmId(null)}
                style={{
                  padding: '8px 20px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                  color: 'var(--color-text-secondary)',
                  border: '1px solid var(--theme-border-strong)',
                  background: 'var(--theme-bg-raised)',
                }}
              >取消</button>
              <button
                onClick={confirmDelete}
                style={{
                  padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer',
                  color: '#fff', background: '#ef4444', border: 'none',
                }}
              >删除</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Context menu ── */}
      {contextMenu && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed', top: contextMenu.y, left: contextMenu.x,
            zIndex: 50, minWidth: 140,
            background: 'var(--theme-bg-surface)',
            border: '1px solid var(--theme-border)',
            borderRadius: 10, boxShadow: 'var(--theme-shadow-popover)',
            padding: '4px 0',
          }}
        >
          <button
            onClick={() => {
              const s = sessions.find(s => s.id === contextMenu.sessionId)
              if (s) startRename(s.id, s.title)
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', padding: '6px 16px', fontSize: 12, textAlign: 'left',
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-secondary)',
            }}
          >
            <Pencil size={12} style={{ color: 'var(--color-text-muted)' }} />
            重命名
          </button>
          <button
            onClick={() => handleDelete(contextMenu.sessionId)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', padding: '6px 16px', fontSize: 12, textAlign: 'left',
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-accent-danger)',
            }}
          >
            <Trash2 size={12} />
            删除
          </button>
        </div>
      )}
    </div>
  )
}
