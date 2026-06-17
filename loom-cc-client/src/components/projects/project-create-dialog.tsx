'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Plus, FolderOpen, ChevronRight, ArrowLeft, X } from 'lucide-react'

interface ProjectCreateDialogProps {
  open: boolean
  onClose: () => void
  onCreate: (name: string, workspacePath: string, description: string, defaultModel: string) => void | Promise<void>
}

type Step = 'choose' | 'scratch' | 'existing'

function getLastSegment(p: string) {
  return p.replace(/[/\\]$/, '').split(/[/\\]/).pop() || ''
}

function getFolderNameError(name: string): string | null {
  const value = name.trim()
  if (!value) return null
  if (/[<>:"/\\|?*\x00-\x1F]/.test(value)) {
    return '项目名称会作为文件夹名，不能包含 <>:"/\\|?*'
  }
  if (/^\.+$/.test(value)) {
    return '项目名称不能只包含点'
  }
  return null
}

function trimTrailingSeparators(value: string): string {
  const trimmed = value.trim()
  if (/^[A-Za-z]:[\\/]?$/.test(trimmed)) return trimmed.replace(/[\\/]$/, '')
  if (/^[/\\]+$/.test(trimmed)) return trimmed[0]
  return trimmed.replace(/[\\/]+$/, '')
}

function joinDirectory(base: string, child: string): string {
  const parent = trimTrailingSeparators(base)
  const segment = child.trim()
  const sep = parent.includes('\\') ? '\\' : '/'
  if (!parent) return segment
  if (parent === '/' || parent === '\\') return `${parent}${segment}`
  return `${parent}${sep}${segment}`
}

export function ProjectCreateDialog({ open, onClose, onCreate }: ProjectCreateDialogProps) {
  const [step, setStep] = useState<Step>('choose')
  const [name, setName] = useState('')
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false)
  const [instructions, setInstructions] = useState('')
  const [workspacePath, setWorkspacePath] = useState('')
  const [defaultModel, setDefaultModel] = useState('claude-sonnet-4-6')
  const [creating, setCreating] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    fetch('/api/config/provider')
      .then(r => r.json())
      .then(data => {
        const active = data.active ?? 'anthropic'
        const config = (data.configs ?? []).find((c: { id: string }) => c.id === active)
        if (config?.mainModel) setDefaultModel(config.mainModel)
      })
      .catch(() => {})
  }, [open])

  const reset = () => {
    setStep('choose')
    setName('')
    setNameManuallyEdited(false)
    setInstructions('')
    setWorkspacePath('')
    setCreating(false)
  }

  const handleClose = () => { reset(); onClose() }

  const handleCreate = useCallback(async () => {
    if (!name.trim() || creating) return
    const folderNameError = step === 'scratch' ? getFolderNameError(name) : null
    if (folderNameError) return
    const finalWorkspacePath = step === 'scratch'
      ? (workspacePath.trim() ? joinDirectory(workspacePath, name.trim()) : '')
      : workspacePath.trim()
    if ((step === 'scratch' || step === 'existing') && !finalWorkspacePath) return
    setCreating(true)
    try {
      await onCreate(name.trim(), finalWorkspacePath, instructions.trim(), defaultModel)
      reset()
    } finally {
      setCreating(false)
    }
  }, [step, name, workspacePath, instructions, defaultModel, creating, onCreate])

  const handleNameChange = useCallback((value: string) => {
    setName(value)
    setNameManuallyEdited(true)
  }, [])

  /* Pick folder (used in both existing step and scratch location picker) */
  const handleBrowseFolder = useCallback(async (mode: 'scratch' | 'existing') => {
    const dir = await window.electronAPI?.openDirectoryDialog()
    if (!dir) return
    setWorkspacePath(dir)
    if (mode === 'existing') {
      const seg = getLastSegment(dir)
      if (seg && (!name.trim() || !nameManuallyEdited)) {
        setName(seg)
        setTimeout(() => {
          nameRef.current?.select()
          nameRef.current?.focus()
        }, 50)
      }
      return
    }
    if (!name.trim()) setTimeout(() => nameRef.current?.focus(), 50)
  }, [name, nameManuallyEdited])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') handleClose()
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing &&   // 中文/日文输入法合成期间不触发
      (step === 'scratch' || step === 'existing') &&
      name.trim()
    ) {
      const tag = (e.target as HTMLElement).tagName
      if (tag !== 'TEXTAREA') { e.preventDefault(); handleCreate() }
    }
  }, [step, name, handleCreate])

  if (!open) return null

  /* ── shared form (scratch + existing share the lower fields) ── */
  const renderForm = (titleText: string, showFolderAtTop: boolean) => {
    const folderNameError = !showFolderAtTop ? getFolderNameError(name) : null
    const scratchWorkspacePath = !showFolderAtTop && workspacePath.trim() && name.trim() && !folderNameError
      ? joinDirectory(workspacePath, name.trim())
      : ''
    const canCreate = showFolderAtTop
      ? Boolean(name.trim() && workspacePath.trim())
      : Boolean(name.trim() && workspacePath.trim() && !folderNameError)

    return <div>
      <button onClick={() => setStep('choose')} style={styles.backBtn}>
        <ArrowLeft size={15} /> 返回
      </button>
      <h2 style={styles.title}>{titleText}</h2>

      {/* Folder picker — top for "existing", bottom for "scratch" */}
      {showFolderAtTop && (
        <div style={{ marginBottom: 18 }}>
          <label style={styles.label}>选择文件夹</label>
          <FolderPickerBtn path={workspacePath} onBrowse={() => handleBrowseFolder('existing')} />
        </div>
      )}

      {/* Name — only show for existing after folder picked; always show for scratch */}
      {(!showFolderAtTop || workspacePath) && (
        <div style={{ marginBottom: 18 }}>
          <label style={{ ...styles.label, display: 'flex', alignItems: 'center', gap: 4 }}>
            名称 <span style={{ color: '#e05252', fontSize: 12 }}>*</span>
          </label>
          <input
            ref={nameRef}
            type="text"
            value={name}
            onChange={e => handleNameChange(e.target.value)}
            placeholder="项目名称"
            autoFocus={!showFolderAtTop}
            className="w-full outline-none selectable"
            style={styles.input}
            onFocus={e => { e.currentTarget.style.borderColor = '#6366F1' }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border-strong)' }}
          />
          {folderNameError && (
            <div style={styles.fieldError}>{folderNameError}</div>
          )}
        </div>
      )}

      {/* Instructions — only show after folder picked (existing) or always (scratch) */}
      {(!showFolderAtTop || workspacePath) && (
        <div style={{ marginBottom: 18 }}>
          <label style={styles.label}>说明</label>
          <textarea
            value={instructions}
            onChange={e => setInstructions(e.target.value)}
            placeholder="告诉 Claude 如何在这个项目中工作（可选）"
            rows={4}
            className="w-full outline-none selectable resize-none"
            style={{ ...styles.input, lineHeight: 1.6, fontFamily: 'inherit' }}
            onFocus={e => { e.currentTarget.style.borderColor = '#6366F1' }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border-strong)' }}
          />
        </div>
      )}

      {/* Add files — shown after folder picked */}
      {(!showFolderAtTop || workspacePath) && (
        <div style={{ marginBottom: 20 }}>
          <label style={styles.label}>添加文件</label>
          <div style={{
            border: '1.5px dashed var(--color-border-strong)',
            borderRadius: 8, padding: '20px',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            color: 'var(--color-text-muted)', fontSize: 13,
          }}>
            <Plus size={16} />
            拖拽文件到此处，或点击浏览
          </div>
        </div>
      )}

      {/* Location picker — bottom for "scratch" */}
      {!showFolderAtTop && (
        <div style={{ marginBottom: 24 }}>
          <label style={styles.label}>选择父目录</label>
          <FolderPickerBtn path={workspacePath} onBrowse={() => handleBrowseFolder('scratch')} />
          {workspacePath && (
            <div style={styles.pathHint}>
              {scratchWorkspacePath
                ? <>将创建项目目录：<span style={styles.pathCode}>{scratchWorkspacePath}</span></>
                : '填写项目名称后，Loom 会在该父目录下创建同名文件夹。'}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
        <button onClick={handleClose} style={styles.cancelBtn}>取消</button>
        <button
          onClick={handleCreate}
          disabled={!canCreate || creating}
          style={{
            ...styles.createBtn,
            opacity: canCreate && !creating ? 1 : 0.45,
            cursor: canCreate && !creating ? 'pointer' : 'not-allowed',
          }}
        >
          {creating ? '创建中…' : '创建'}
        </button>
      </div>
    </div>
  }

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onKeyDown={handleKeyDown}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} onClick={handleClose} />

      <div style={{
        position: 'relative', borderRadius: 16, width: 480,
        maxHeight: '92vh', overflowY: 'auto', padding: '32px',
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-strong)',
        boxShadow: '0 32px 64px -12px rgba(0,0,0,0.5)',
      }}>
        {/* Close */}
        <button onClick={handleClose} style={styles.closeBtn}><X size={16} /></button>

        {/* ── Step: choose ── */}
        {step === 'choose' && (
          <div>
            <h2 style={styles.title}>新建项目</h2>
            <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--color-text-muted)', marginBottom: 28 }}>
              专为持续工作而设计的空间，让上下文随时间积累。文件和说明保存在您电脑上的文件夹中。
            </p>

            <OptionCard
              Icon={Plus}
              title="从头开始"
              desc="创建新文件夹，配置说明和文件"
              onClick={() => setStep('scratch')}
            />
            <div style={{ height: 10 }} />
            <OptionCard
              Icon={FolderOpen}
              title="使用现有文件夹"
              desc="选择一个已有的工作目录"
              onClick={() => setStep('existing')}
            />
          </div>
        )}

        {/* ── Step: existing folder ── */}
        {step === 'existing' && (
          <div>
            <button onClick={() => setStep('choose')} style={styles.backBtn}>
              <ArrowLeft size={15} /> 返回
            </button>
            <h2 style={styles.title}>使用现有文件夹</h2>
            <p style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--color-text-muted)', marginBottom: 22 }}>
              选择一个已有文件夹，Loom 将直接把这个目录作为项目工作目录。<br />
              您也可以添加说明来指导工作方式。
            </p>

            {/* Folder picker */}
            <div style={{ marginBottom: workspacePath ? 18 : 28 }}>
              <label style={styles.label}>选择文件夹</label>
              <FolderPickerBtn path={workspacePath} onBrowse={() => handleBrowseFolder('existing')} />
            </div>

            {/* Fields appear after folder is picked */}
            {workspacePath && (
              <>
                <div style={{ marginBottom: 18 }}>
                  <label style={{ ...styles.label, display: 'flex', alignItems: 'center', gap: 4 }}>
                    名称 <span style={{ color: '#e05252', fontSize: 12 }}>*</span>
                  </label>
                  <input
                    ref={nameRef}
                    type="text"
                    value={name}
                    onChange={e => handleNameChange(e.target.value)}
                    placeholder="项目名称"
                    className="w-full outline-none selectable"
                    style={styles.input}
                    onFocus={e => { e.currentTarget.style.borderColor = '#6366F1' }}
                    onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border-strong)' }}
                  />
                </div>
                <div style={{ marginBottom: 18 }}>
                  <label style={styles.label}>说明</label>
                  <textarea
                    value={instructions}
                    onChange={e => setInstructions(e.target.value)}
                    placeholder="告诉 Claude 如何在这个项目中工作（可选）"
                    rows={4}
                    className="w-full outline-none selectable resize-none"
                    style={{ ...styles.input, lineHeight: 1.6, fontFamily: 'inherit' }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#6366F1' }}
                    onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border-strong)' }}
                  />
                </div>
                <div style={{ marginBottom: 24 }}>
                  <label style={styles.label}>添加文件</label>
                  <div style={{
                    border: '1.5px dashed var(--color-border-strong)', borderRadius: 8,
                    padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    color: 'var(--color-text-muted)', fontSize: 13,
                  }}>
                    <Plus size={16} /> 拖拽文件到此处，或点击浏览
                  </div>
                </div>
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={handleClose} style={styles.cancelBtn}>取消</button>
              <button
                onClick={handleCreate}
                disabled={!name.trim() || !workspacePath || creating}
                style={{
                  ...styles.createBtn,
                  opacity: name.trim() && workspacePath && !creating ? 1 : 0.45,
                  cursor: name.trim() && workspacePath && !creating ? 'pointer' : 'not-allowed',
                }}
              >
                {creating ? '创建中…' : '创建'}
              </button>
            </div>
          </div>
        )}

        {/* ── Step: scratch ── */}
        {step === 'scratch' && renderForm('新建项目', false)}
      </div>
    </div>,
    document.body,
  )
}

/* ── Sub-components ── */

function OptionCard({ Icon, title, desc, onClick }: {
  Icon: React.ElementType; title: string; desc: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 16,
        padding: '16px 18px', borderRadius: 10, textAlign: 'left',
        border: '1px solid var(--color-border-strong)',
        background: 'var(--color-bg-surface-high)', cursor: 'pointer',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-accent-primary)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border-strong)')}
    >
      <div style={{
        width: 44, height: 44, borderRadius: 8, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--color-bg-surface-highest)',
        border: '1px solid var(--color-border-subtle)',
      }}>
        <Icon size={20} style={{ color: 'var(--color-text-muted)' }} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 3 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{desc}</div>
      </div>
      <ChevronRight size={16} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
    </button>
  )
}

function FolderPickerBtn({ path, onBrowse }: { path: string; onBrowse: () => void }) {
  return (
    <button
      onClick={onBrowse}
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
        color: path ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
        fontFamily: path ? 'ui-monospace, monospace' : 'inherit',
      }}>
        {path || '选择文件夹…'}
      </span>
    </button>
  )
}

/* ── Shared styles ── */
const styles = {
  title: { fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 20 } as React.CSSProperties,
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 8 } as React.CSSProperties,
  input: {
    width: '100%', padding: '10px 14px', borderRadius: 8, fontSize: 14,
    background: 'var(--color-bg-input)', color: 'var(--color-text-primary)',
    border: '1.5px solid var(--color-border-strong)', transition: 'border-color 0.15s',
  } as React.CSSProperties,
  fieldError: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 1.5,
    color: '#ef4444',
  } as React.CSSProperties,
  pathHint: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 1.55,
    color: 'var(--color-text-muted)',
  } as React.CSSProperties,
  pathCode: {
    marginLeft: 6,
    fontFamily: 'ui-monospace, monospace',
    color: 'var(--color-text-primary)',
    wordBreak: 'break-all',
  } as React.CSSProperties,
  backBtn: {
    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20,
    fontSize: 13, color: 'var(--color-text-muted)',
    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
  } as React.CSSProperties,
  cancelBtn: {
    padding: '9px 22px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
    color: 'var(--color-text-secondary)',
    border: '1px solid var(--color-border-strong)',
    background: 'var(--color-bg-surface-high)',
  } as React.CSSProperties,
  createBtn: {
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
