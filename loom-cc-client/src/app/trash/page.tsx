'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Trash2, MoreHorizontal, RotateCcw, AlertTriangle, Loader2 } from 'lucide-react'
import type { Project } from '@/shared/types'

/* ── helpers ── */
function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

/* ── Confirmation dialog ── */
function ConfirmDeleteDialog({
  project,
  onConfirm,
  onCancel,
}: {
  project: Project
  onConfirm: () => void
  onCancel: () => void
}) {
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} onClick={onCancel} />
      <div style={{
        position: 'relative', borderRadius: 14, width: 400, padding: '28px 28px 24px',
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-strong)',
        boxShadow: '0 24px 48px -8px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 20 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(239,68,68,0.1)',
          }}>
            <AlertTriangle size={20} style={{ color: '#ef4444' }} />
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 6 }}>
              永久删除项目
            </h3>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.65 }}>
              确定要永久删除 <strong style={{ color: 'var(--color-text-primary)' }}>「{project.name}」</strong> 吗？
              此操作无法撤销，项目的所有会话和消息将被彻底清除。
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 20px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
              color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border-strong)',
              background: 'var(--color-bg-surface-high)',
            }}
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              cursor: 'pointer', border: 'none',
              color: '#fff', background: '#ef4444',
            }}
          >
            永久删除
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* ── Trash card three-dot menu ── */
function TrashCardMenu({
  onRestore,
  onDelete,
}: {
  onRestore: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, right: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
    }
    setOpen(v => !v)
  }

  const close = () => setOpen(false)

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleOpen}
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

      {open && typeof window !== 'undefined' && createPortal(
        <>
          {/* Transparent overlay catches outside clicks */}
          <div style={{ position: 'fixed', inset: 0, zIndex: 9990 }} onClick={close} />
          <div
            style={{
              position: 'fixed', top: pos.top, right: pos.right,
              width: 148, borderRadius: 10, overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.36)',
              border: '1px solid var(--color-border-strong)',
              background: 'var(--color-bg-surface)',
              zIndex: 9991, padding: '4px 0',
            }}
          >
            <TrashMenuItem
              icon={<RotateCcw size={14} />}
              label="恢复"
              onClick={(e) => { e.stopPropagation(); close(); onRestore() }}
            />
            <div style={{ borderTop: '1px solid var(--color-border-subtle)', margin: '4px 0' }} />
            <TrashMenuItem
              icon={<Trash2 size={14} />}
              label="永久删除"
              danger
              onClick={(e) => { e.stopPropagation(); close(); onDelete() }}
            />
          </div>
        </>,
        document.body,
      )}
    </>
  )
}

function TrashMenuItem({
  icon, label, danger, onClick,
}: {
  icon: React.ReactNode; label: string; danger?: boolean; onClick: (e: React.MouseEvent) => void
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
        e.currentTarget.style.background = danger ? 'rgba(239,68,68,0.08)' : 'var(--color-bg-surface-high)'
      }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{ flexShrink: 0, opacity: 0.75 }}>{icon}</span>
      <span>{label}</span>
    </button>
  )
}

/* ── Trash card ── */
function TrashCard({
  project,
  onRestore,
  onDelete,
}: {
  project: Project
  onRestore: (id: string) => void
  onDelete: (project: Project) => void
}) {
  return (
    <div style={{
      padding: '20px', borderRadius: 12, minHeight: 100,
      background: 'var(--color-bg-surface)',
      border: '1px solid var(--color-border-subtle)',
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
    }}>
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)', wordBreak: 'break-word', flex: 1 }}>
          {project.name}
        </h3>
        <TrashCardMenu
          onRestore={() => onRestore(project.id)}
          onDelete={() => onDelete(project)}
        />
      </div>

      {/* Bottom */}
      <div style={{ marginTop: 20 }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          归档于 {formatDate(project.updatedAt)}
        </span>
      </div>
    </div>
  )
}

/* ── Page ── */
export default function TrashPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmProject, setConfirmProject] = useState<Project | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchTrash = useCallback(async () => {
    try {
      setError(null)
      const res = await fetch('/api/trash')
      if (!res.ok) throw new Error('Failed to fetch trash')
      const data = await res.json()
      setProjects(data.projects)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchTrash() }, [fetchTrash])

  const handleRestore = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/projects/${id}/restore`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to restore')
      await fetchTrash()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed')
    }
  }, [fetchTrash])

  const handleHardDelete = useCallback(async () => {
    if (!confirmProject) return
    setDeletingId(confirmProject.id)
    setConfirmProject(null)
    try {
      const res = await fetch(`/api/projects/${confirmProject.id}/hard-delete`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      await fetchTrash()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeletingId(null)
    }
  }, [confirmProject, fetchTrash])

  return (
    <div className="flex-1 overflow-y-auto" style={{ padding: '32px 40px', minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ marginBottom: '16px' }}>
        <h1 className="text-[20px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          Trash
        </h1>
      </div>

      {/* Divider */}
      <div style={{ borderBottom: '1px solid var(--color-border-subtle)', marginBottom: '28px' }} />

      {/* Error */}
      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg" style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
          <span className="text-[12px]" style={{ color: '#ef4444' }}>{error}</span>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center" style={{ paddingTop: 80 }}>
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
        </div>
      )}

      {/* Empty state */}
      {!loading && projects.length === 0 && (
        <div className="flex items-center justify-center" style={{ flex: 1, minHeight: 360 }}>
          <div style={{
            width: 'min(400px, 100%)',
            padding: '30px 28px',
            borderRadius: 16,
            border: '1px solid var(--theme-border)',
            background: 'var(--theme-bg-surface)',
            boxShadow: 'var(--shell-panel-shadow-soft)',
            textAlign: 'center',
          }}>
            <div className="flex items-center justify-center"
              style={{
                width: 58,
                height: 58,
                borderRadius: 15,
                margin: '0 auto 16px',
                background: 'var(--theme-bg-active)',
                border: '1px solid var(--theme-border-strong)',
                color: 'var(--color-text-muted)',
              }}>
              <Trash2 size={26} />
            </div>
            <h2 className="text-[16px] font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
              回收站为空
            </h2>
            <p className="text-[12px]" style={{ color: 'var(--color-text-muted)', lineHeight: 1.7 }}>
              归档项目会先保存在这里。你可以恢复项目，或在确认后永久删除。
            </p>
          </div>
        </div>
      )}

      {/* Card grid */}
      {!loading && projects.length > 0 && (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {projects.map(p => (
            <div key={p.id} style={{ opacity: deletingId === p.id ? 0.4 : 1, transition: 'opacity 0.2s' }}>
              <TrashCard
                project={p}
                onRestore={handleRestore}
                onDelete={setConfirmProject}
              />
            </div>
          ))}
        </div>
      )}

      {/* Confirm delete dialog */}
      {confirmProject && (
        <ConfirmDeleteDialog
          project={confirmProject}
          onConfirm={handleHardDelete}
          onCancel={() => setConfirmProject(null)}
        />
      )}
    </div>
  )
}
