'use client'

import { useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { FolderOpen, X } from 'lucide-react'
import type { Project } from '@/shared/types'

interface ProjectEditDialogProps {
  open: boolean
  project: Project
  onClose: () => void
  onSave: (updates: Partial<Pick<Project, 'name' | 'description' | 'workspacePath'>>) => void
}

function getLastSegment(p: string) {
  return p.replace(/[/\\]$/, '').split(/[/\\]/).pop() || ''
}

export function ProjectEditDialog({ open, project, onClose, onSave }: ProjectEditDialogProps) {
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description)
  const [workspacePath, setWorkspacePath] = useState(project.workspacePath)
  const [saving, setSaving] = useState(false)

  // Sync if project prop changes
  useEffect(() => {
    if (open) {
      setName(project.name)
      setDescription(project.description)
      setWorkspacePath(project.workspacePath)
    }
  }, [open, project])

  const handleBrowse = useCallback(async () => {
    const dir = await window.electronAPI?.openDirectoryDialog()
    if (!dir) return
    setWorkspacePath(dir)
    // Auto-fill name if it's still the default
    if (!name.trim() || name === getLastSegment(workspacePath)) {
      setName(getLastSegment(dir))
    }
  }, [name, workspacePath])

  const handleSave = useCallback(() => {
    if (!name.trim() || saving) return
    setSaving(true)
    onSave({ name: name.trim(), description: description.trim(), workspacePath: workspacePath.trim() })
    setSaving(false)
  }, [name, description, workspacePath, saving, onSave])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Enter' && !e.shiftKey && name.trim()) {
      const tag = (e.target as HTMLElement).tagName
      if (tag !== 'TEXTAREA') { e.preventDefault(); handleSave() }
    }
  }, [name, handleSave, onClose])

  if (!open) return null

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onKeyDown={handleKeyDown}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} onClick={onClose} />

      <div style={{
        position: 'relative', borderRadius: 16, width: 460,
        maxHeight: '90vh', overflowY: 'auto', padding: '32px',
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-strong)',
        boxShadow: '0 32px 64px -12px rgba(0,0,0,0.5)',
      }}>
        <button onClick={onClose} style={styles.closeBtn}><X size={16} /></button>

        <h2 style={styles.title}>编辑项目</h2>

        {/* Name */}
        <div style={{ marginBottom: 18 }}>
          <label style={{ ...styles.label, display: 'flex', alignItems: 'center', gap: 4 }}>
            名称 <span style={{ color: '#e05252', fontSize: 12 }}>*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="项目名称"
            autoFocus
            className="w-full outline-none selectable"
            style={styles.input}
            onFocus={e => { e.currentTarget.style.borderColor = '#6366F1' }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border-strong)' }}
          />
        </div>

        {/* Description */}
        <div style={{ marginBottom: 18 }}>
          <label style={styles.label}>说明</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="告诉 Claude 如何在这个项目中工作（可选）"
            rows={4}
            className="w-full outline-none selectable resize-none"
            style={{ ...styles.input, lineHeight: 1.6, fontFamily: 'inherit' }}
            onFocus={e => { e.currentTarget.style.borderColor = '#6366F1' }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border-strong)' }}
          />
        </div>

        {/* Workspace folder */}
        <div style={{ marginBottom: 28 }}>
          <label style={styles.label}>工作目录</label>
          <button
            onClick={handleBrowse}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 10,
              padding: '11px 14px', borderRadius: 8, textAlign: 'left',
              background: 'var(--color-bg-input)',
              border: '1.5px solid var(--color-border-strong)',
              cursor: 'pointer', transition: 'border-color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-accent-primary)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border-strong)')}
          >
            <div style={{
              width: 28, height: 28, borderRadius: 6, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--color-bg-surface-highest)',
              border: '1px solid var(--color-border-subtle)',
            }}>
              <FolderOpen size={14} style={{ color: 'var(--color-text-muted)' }} />
            </div>
            <span style={{
              flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              color: workspacePath ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              fontFamily: workspacePath ? 'ui-monospace, monospace' : 'inherit',
            }}>
              {workspacePath || '选择文件夹…'}
            </span>
          </button>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={styles.cancelBtn}>取消</button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            style={{
              ...styles.saveBtn,
              opacity: name.trim() && !saving ? 1 : 0.45,
              cursor: name.trim() && !saving ? 'pointer' : 'not-allowed',
            }}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

const styles = {
  title: { fontSize: 20, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 24 } as React.CSSProperties,
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 8 } as React.CSSProperties,
  input: {
    width: '100%', padding: '10px 14px', borderRadius: 8, fontSize: 14,
    background: 'var(--color-bg-input)', color: 'var(--color-text-primary)',
    border: '1.5px solid var(--color-border-strong)', transition: 'border-color 0.15s',
  } as React.CSSProperties,
  cancelBtn: {
    padding: '9px 22px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
    color: 'var(--color-text-secondary)',
    border: '1px solid var(--color-border-strong)',
    background: 'var(--color-bg-surface-high)',
  } as React.CSSProperties,
  saveBtn: {
    padding: '9px 26px', borderRadius: 8, fontSize: 13, fontWeight: 600,
    color: '#ffffff', background: 'var(--color-accent-primary)', border: 'none',
    transition: 'opacity 0.15s',
  } as React.CSSProperties,
  closeBtn: {
    position: 'absolute', top: 20, right: 20,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: 28, borderRadius: 6,
    border: 'none', background: 'transparent',
    color: 'var(--color-text-muted)', cursor: 'pointer',
  } as React.CSSProperties,
}
