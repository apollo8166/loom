'use client'

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'loom_capture_area_shortcut'
const DEFAULT_SHORTCUT = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
  ? 'Command+Shift+X'
  : 'Control+Shift+X'

function displayShortcut(shortcut: string): string {
  return shortcut
    .replace('Command', '⌘')
    .replace('Control', 'Ctrl')
    .replace('Shift', '⇧')
    .replace(/\+/g, ' ')
}

export function ShortcutSettings() {
  const [shortcut, setShortcut] = useState(DEFAULT_SHORTCUT)
  const [draft, setDraft] = useState(DEFAULT_SHORTCUT)
  const [status, setStatus] = useState<string>('')

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) || DEFAULT_SHORTCUT
    setShortcut(stored)
    setDraft(stored)
    window.electronAPI?.registerCaptureShortcut(stored)
      .then(res => setStatus(res.ok ? '快捷键已注册' : '快捷键注册失败，可能被系统或其他应用占用'))
      .catch(() => setStatus('当前环境不支持全局快捷键'))
  }, [])

  const save = async () => {
    const next = draft.trim() || DEFAULT_SHORTCUT
    localStorage.setItem(STORAGE_KEY, next)
    setShortcut(next)
    try {
      const res = await window.electronAPI?.registerCaptureShortcut(next)
      setStatus(res?.ok ? '快捷键已保存并注册' : '快捷键保存成功，但注册失败')
    } catch {
      setStatus('快捷键已保存，当前环境无法注册')
    }
  }

  const reset = async () => {
    localStorage.setItem(STORAGE_KEY, DEFAULT_SHORTCUT)
    setDraft(DEFAULT_SHORTCUT)
    setShortcut(DEFAULT_SHORTCUT)
    try {
      const res = await window.electronAPI?.registerCaptureShortcut(DEFAULT_SHORTCUT)
      setStatus(res?.ok ? '已恢复默认快捷键' : '默认快捷键注册失败')
    } catch {
      setStatus('已恢复默认快捷键')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ padding: 16, borderRadius: 12, border: '1px solid var(--theme-border)', background: 'var(--theme-bg-surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 4 }}>Capture Area</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>全局区域截图，完成后附加到当前 Chat 输入框。</div>
          </div>
          <div style={{ height: 30, padding: '0 10px', borderRadius: 8, border: '1px solid var(--theme-border)', display: 'flex', alignItems: 'center', color: 'var(--color-text-secondary)', fontSize: 12, fontWeight: 700 }}>
            {displayShortcut(shortcut)}
          </div>
        </div>

        <label style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>Electron accelerator</label>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={DEFAULT_SHORTCUT}
          className="selectable"
          style={{
            width: '100%',
            height: 34,
            borderRadius: 8,
            border: '1px solid var(--theme-border)',
            background: 'var(--theme-bg-input)',
            color: 'var(--color-text-primary)',
            padding: '0 10px',
            outline: 'none',
            fontSize: 13,
            marginBottom: 10,
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={save} style={buttonStyle('primary')}>保存</button>
          <button onClick={reset} style={buttonStyle('secondary')}>恢复默认</button>
          {status && <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{status}</span>}
        </div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.7 }}>
        默认推荐 macOS 使用 Command+Shift+X，Windows/Linux 使用 Control+Shift+X，避免和系统截图快捷键冲突。
      </p>
    </div>
  )
}

function buttonStyle(kind: 'primary' | 'secondary'): React.CSSProperties {
  return {
    height: 32,
    padding: '0 14px',
    borderRadius: 8,
    border: kind === 'primary' ? 'none' : '1px solid var(--theme-border)',
    background: kind === 'primary' ? 'var(--color-accent-primary)' : 'var(--theme-bg-raised)',
    color: kind === 'primary' ? '#111827' : 'var(--color-text-secondary)',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
  }
}
