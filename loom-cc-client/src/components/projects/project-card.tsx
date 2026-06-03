'use client'

import { useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { MoreHorizontal, Pin, PinOff, Pencil, Archive } from 'lucide-react'
import type { Project } from '@/shared/types'
import { ProjectEditDialog } from './project-edit-dialog'

interface ProjectCardProps {
  project: Project
  onTogglePin: (id: string, pinned: boolean) => void
  onArchive: (id: string) => void
  onUpdate: (id: string, updates: Partial<Pick<Project, 'name' | 'description' | 'workspacePath'>>) => void
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '从未打开'
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return '刚刚'
  if (diffMins < 60) return `${diffMins} 分钟前`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours} 小时前`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays} 天前`
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

export function ProjectCard({ project, onTogglePin, onArchive, onUpdate }: ProjectCardProps) {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 })
  const [editOpen, setEditOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  const handleCardClick = useCallback(() => {
    router.push(`/projects/${project.id}`)
  }, [router, project.id])

  const handleMenuClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
    }
    setMenuOpen(v => !v)
  }, [])

  const closeMenu = useCallback(() => setMenuOpen(false), [])

  const handlePin = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    closeMenu()
    onTogglePin(project.id, !project.isPinned)
  }, [project.id, project.isPinned, onTogglePin, closeMenu])

  const handleEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    closeMenu()
    setEditOpen(true)
  }, [closeMenu])

  const handleArchive = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    closeMenu()
    onArchive(project.id)
  }, [project.id, onArchive, closeMenu])

  return (
    <>
      <div
        onClick={handleCardClick}
        className="relative flex flex-col justify-between cursor-pointer transition-all duration-150"
        style={{
          padding: '20px',
          borderRadius: 12,
          minHeight: 100,
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border-subtle)',
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-strong)'
          ;(e.currentTarget as HTMLElement).style.background = 'var(--color-bg-surface-high)'
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-subtle)'
          ;(e.currentTarget as HTMLElement).style.background = 'var(--color-bg-surface)'
        }}
      >
        {/* Top row: name + three-dot menu */}
        <div>
          <div className="flex items-start justify-between gap-3">
            <h3
              className="flex-1 min-w-0 text-[16px] font-bold leading-snug"
              style={{ color: 'var(--color-text-primary)', wordBreak: 'break-word' }}
            >
              {project.name}
            </h3>

            <button
              ref={btnRef}
              onClick={handleMenuClick}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                border: '1px solid var(--color-border-strong)',
                background: 'var(--color-bg-surface-high)',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
              }}
            >
              <MoreHorizontal size={14} />
            </button>
          </div>

          <p
            style={{
              marginTop: 9,
              minHeight: 36,
              fontSize: 12,
              lineHeight: 1.5,
              color: project.description ? 'var(--color-text-muted)' : 'var(--color-text-disabled)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {project.description || '暂无项目说明'}
          </p>
        </div>

        {/* Bottom: last opened time */}
        <div style={{ marginTop: 20 }}>
          <span className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
            {formatRelativeTime(project.lastOpenedAt)}
          </span>
        </div>
      </div>

      {/* Portal dropdown — invisible overlay catches outside clicks */}
      {menuOpen && typeof window !== 'undefined' && createPortal(
        <>
          {/* Transparent full-screen overlay — click closes menu */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9990 }}
            onClick={closeMenu}
          />
          {/* Dropdown menu */}
          <div
            style={{
              position: 'fixed',
              top: menuPos.top,
              right: menuPos.right,
              width: 168,
              borderRadius: 10,
              overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.36)',
              border: '1px solid var(--color-border-strong)',
              background: 'var(--color-bg-surface)',
              zIndex: 9991,
              padding: '4px 0',
            }}
          >
            <MenuItem
              icon={project.isPinned ? <PinOff size={14} /> : <Pin size={14} />}
              label={project.isPinned ? '取消固定' : '固定到顶部'}
              onClick={handlePin}
            />
            <MenuItem
              icon={<Pencil size={14} />}
              label="编辑详情"
              onClick={handleEdit}
            />
            <div style={{ borderTop: '1px solid var(--color-border-subtle)', margin: '4px 0' }} />
            <MenuItem
              icon={<Archive size={14} />}
              label="归档"
              danger
              onClick={handleArchive}
            />
          </div>
        </>,
        document.body,
      )}

      {/* Edit dialog */}
      {editOpen && (
        <ProjectEditDialog
          open={editOpen}
          project={project}
          onClose={() => setEditOpen(false)}
          onSave={updates => { onUpdate(project.id, updates); setEditOpen(false) }}
        />
      )}
    </>
  )
}

function MenuItem({
  icon, label, danger, onClick,
}: {
  icon: React.ReactNode
  label: string
  danger?: boolean
  onClick: (e: React.MouseEvent) => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 14px', background: 'transparent', border: 'none',
        color: danger ? '#ef4444' : 'var(--color-text-primary)',
        fontSize: 13, cursor: 'pointer',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = danger
          ? 'rgba(239,68,68,0.08)'
          : 'var(--color-bg-surface-high)'
      }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{ flexShrink: 0, opacity: 0.75 }}>{icon}</span>
      <span>{label}</span>
    </button>
  )
}
