'use client'

import { useState, useEffect } from 'react'
import { Brain, FolderOpen, Loader2, AlertTriangle, RefreshCw } from 'lucide-react'
import {
  CONTEXT_WINDOW_FALLBACK_SETTING_KEY,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  formatContextWindowTokens,
  normalizeContextWindowTokens,
} from '@/shared/config/context-window'

export function AdvancedSettings() {
  const [cliPath, setCliPath] = useState('')
  const [loadingCliPath, setLoadingCliPath] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [globalMemory, setGlobalMemory] = useState<{
    rootDir: string
    initialized: boolean
    files: Array<{ name: string; content: string; exists: boolean }>
    candidates: Array<{ id: string; type: string; confidence: string; status: string; content: string; evidence?: string }>
  } | null>(null)
  const [loadingMemory, setLoadingMemory] = useState(true)
  const [savingMemory, setSavingMemory] = useState(false)
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null)
  const [editingMemoryContent, setEditingMemoryContent] = useState('')
  const [busyMemoryCandidateId, setBusyMemoryCandidateId] = useState<string | null>(null)
  const [memoryStatusMessage, setMemoryStatusMessage] = useState<string | null>(null)
  const [memoryDebugVisible, setMemoryDebugVisible] = useState(false)
  const [sdkAutoCompactEnabled, setSdkAutoCompactEnabled] = useState(true)
  const [sdkAutoCompactWindow, setSdkAutoCompactWindow] = useState('')
  const [defaultContextWindow, setDefaultContextWindow] = useState('')
  const [logPaths, setLogPaths] = useState<{ dir: string; main: string; error: string } | null>(null)

  const dataPath = (typeof window !== 'undefined' && window.electronAPI?.loomDataPath) || '~/.loom-cc'

  useEffect(() => {
    fetch('/api/config/settings?key=claude_cli_path')
      .then(r => r.json())
      .then(data => {
        if (data.value) setCliPath(data.value)
      })
      .catch(err => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoadingCliPath(false))
  }, [])

  useEffect(() => {
    Promise.all([
      fetch('/api/config/settings?key=memory_debug_visible').then(r => r.json()).catch(() => ({ value: null })),
      fetch('/api/config/settings?key=sdk_auto_compact_enabled').then(r => r.json()).catch(() => ({ value: null })),
      fetch('/api/config/settings?key=sdk_auto_compact_window').then(r => r.json()).catch(() => ({ value: null })),
      fetch(`/api/config/settings?key=${CONTEXT_WINDOW_FALLBACK_SETTING_KEY}`).then(r => r.json()).catch(() => ({ value: null })),
    ]).then(([debugData, compactData, windowData, fallbackData]) => {
      setMemoryDebugVisible(debugData.value === 'true')
      setSdkAutoCompactEnabled(compactData.value == null ? true : compactData.value === 'true')
      setSdkAutoCompactWindow(windowData.value || '')
      setDefaultContextWindow(fallbackData.value || '')
    }).catch(() => {
      setMemoryDebugVisible(false)
      setSdkAutoCompactEnabled(true)
      setSdkAutoCompactWindow('')
      setDefaultContextWindow('')
    })
  }, [])

  useEffect(() => {
    fetch('/api/log/paths')
      .then(r => r.json())
      .then(data => setLogPaths(data))
      .catch(() => setLogPaths(null))
  }, [])

  const loadGlobalMemory = async () => {
    setLoadingMemory(true)
    try {
      const res = await fetch('/api/memory/global')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '加载全局记忆失败')
      setGlobalMemory(data.memory)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载全局记忆失败')
    } finally {
      setLoadingMemory(false)
    }
  }

  useEffect(() => { loadGlobalMemory() }, [])

  const initializeGlobalMemory = async () => {
    setSavingMemory(true)
    setError(null)
    try {
      const res = await fetch('/api/memory/global', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initialize: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '初始化全局记忆失败')
      setGlobalMemory(data.memory)
    } catch (err) {
      setError(err instanceof Error ? err.message : '初始化全局记忆失败')
    } finally {
      setSavingMemory(false)
    }
  }

  const pendingGlobalCandidates = globalMemory?.candidates.filter(c => c.status === 'pending') ?? []

  const updateGlobalCandidate = async (
    candidate: { id: string; type: string; confidence: string; content: string; evidence?: string },
    action: 'approve' | 'reject',
  ) => {
    setError(null)
    setMemoryStatusMessage(null)
    setBusyMemoryCandidateId(candidate.id)
    try {
      const res = await fetch(`/api/memory/candidates/${candidate.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, scope: 'global' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '更新候选记忆失败')
      setMemoryStatusMessage(action === 'approve'
        ? `已确认，并写入 ${data.targetFile || '全局记忆文件'}`
        : '已忽略候选记忆')
      await loadGlobalMemory()
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新候选记忆失败')
    } finally {
      setBusyMemoryCandidateId(null)
    }
  }

  const saveGlobalCandidate = async (
    candidate: { id: string; type: string; confidence: string; content: string; evidence?: string },
  ) => {
    setError(null)
    setMemoryStatusMessage(null)
    setBusyMemoryCandidateId(candidate.id)
    try {
      const res = await fetch(`/api/memory/candidates/${candidate.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'global',
          type: candidate.type,
          confidence: candidate.confidence,
          content: editingMemoryContent,
          evidence: candidate.evidence,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '保存候选记忆失败')
      setEditingMemoryId(null)
      setEditingMemoryContent('')
      setMemoryStatusMessage('候选记忆已保存，尚未写入正式记忆')
      await loadGlobalMemory()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存候选记忆失败')
    } finally {
      setBusyMemoryCandidateId(null)
    }
  }

  const handleSaveCliPath = async () => {
    setSaving(true)
    setSaveMsg(null)
    setError(null)
    try {
      const res = await fetch('/api/config/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'claude_cli_path', value: cliPath }),
      })
      if (!res.ok) throw new Error('保存失败')
      setSaveMsg('已保存')
      setTimeout(() => setSaveMsg(null), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const updateMemoryDebugVisible = async (enabled: boolean) => {
    setMemoryDebugVisible(enabled)
    try {
      await fetch('/api/config/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'memory_debug_visible', value: enabled ? 'true' : 'false' }),
      })
    } catch (err) {
      setMemoryDebugVisible(!enabled)
      setError(err instanceof Error ? err.message : '保存 Memory 调试设置失败')
    }
  }

  const updateSdkAutoCompactEnabled = async (enabled: boolean) => {
    setSdkAutoCompactEnabled(enabled)
    try {
      await fetch('/api/config/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'sdk_auto_compact_enabled', value: enabled ? 'true' : 'false' }),
      })
    } catch (err) {
      setSdkAutoCompactEnabled(!enabled)
      setError(err instanceof Error ? err.message : '保存 SDK 自动压缩设置失败')
    }
  }

  const saveSdkAutoCompactWindow = async () => {
    setError(null)
    const trimmed = sdkAutoCompactWindow.trim()
    if (trimmed && (!Number.isFinite(Number(trimmed)) || Number(trimmed) <= 0)) {
      setError('自动压缩窗口必须是正整数，或留空使用 SDK 默认值')
      return
    }
    try {
      await fetch('/api/config/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'sdk_auto_compact_window', value: trimmed }),
      })
      setSaveMsg('已保存')
      setTimeout(() => setSaveMsg(null), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存 SDK 自动压缩窗口失败')
    }
  }

  const saveDefaultContextWindow = async () => {
    setError(null)
    const trimmed = defaultContextWindow.trim()
    if (trimmed && !normalizeContextWindowTokens(trimmed)) {
      setError('默认上下文窗口必须是正整数，或留空使用 Loom 默认值')
      return
    }
    try {
      await fetch('/api/config/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: CONTEXT_WINDOW_FALLBACK_SETTING_KEY, value: trimmed }),
      })
      setSaveMsg('已保存')
      setTimeout(() => setSaveMsg(null), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存默认上下文窗口失败')
    }
  }

  const handleOpenInFinder = () => {
    if (window.electronAPI?.showInFolder) {
      window.electronAPI.showInFolder(dataPath)
    } else if (window.electronAPI?.openPath) {
      window.electronAPI.openPath(dataPath)
    }
  }

  const handleOpenLogs = () => {
    const target = logPaths?.dir || `${dataPath}/logs`
    if (window.electronAPI?.openPath) {
      window.electronAPI.openPath(target)
    } else if (window.electronAPI?.showInFolder) {
      window.electronAPI.showInFolder(target)
    }
  }

  const inputStyle = {
    color: 'var(--color-text-primary)',
    background: 'var(--color-bg-input)',
    border: '1px solid var(--color-border-strong)',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {error && (
        <div style={{
          fontSize: 12, padding: '8px 12px', borderRadius: 8,
          color: 'var(--color-accent-danger)',
          background: 'rgba(232,90,79,0.08)',
          border: '1px solid rgba(232,90,79,0.2)',
        }}>
          {error}
        </div>
      )}

      {/* Data Directory */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 12,
        padding: 16, borderRadius: 12,
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-subtle)',
      }}>
        <label style={{ fontSize: 11, letterSpacing: '0.04em', color: 'var(--color-text-muted)' }}>
          数据目录
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <code style={{
            flex: 1, fontSize: 12, padding: '8px 12px', borderRadius: 8,
            color: 'var(--color-text-secondary)',
            background: 'var(--color-bg-surface-high)',
            border: '1px solid var(--color-border-subtle)',
            fontFamily: 'monospace',
          }}>
            {dataPath}
          </code>
          <button
            onClick={handleOpenInFinder}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer', flexShrink: 0,
              background: 'transparent',
              border: '1px solid var(--color-border-subtle)',
              color: 'var(--color-text-secondary)',
            }}
          >
            <FolderOpen size={14} />
            在 Finder 中打开
          </button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          数据库、工作区、日志等数据文件存储位置
        </p>
      </div>

      {/* Logs */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 12,
        padding: 16, borderRadius: 12,
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-subtle)',
      }}>
        <label style={{ fontSize: 11, letterSpacing: '0.04em', color: 'var(--color-text-muted)' }}>
          系统日志
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <code style={{
            flex: 1, fontSize: 12, padding: '8px 12px', borderRadius: 8,
            color: 'var(--color-text-secondary)',
            background: 'var(--color-bg-surface-high)',
            border: '1px solid var(--color-border-subtle)',
            fontFamily: 'monospace',
            wordBreak: 'break-all',
          }}>
            {logPaths?.main || `${dataPath}/logs/loom.log`}
          </code>
          <button
            onClick={handleOpenLogs}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer', flexShrink: 0,
              background: 'transparent',
              border: '1px solid var(--color-border-subtle)',
              color: 'var(--color-text-secondary)',
            }}
          >
            <FolderOpen size={14} />
            打开日志目录
          </button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          业务链路日志写入 loom.log，错误和警告同时写入 error.log。
        </p>
      </div>

      {/* Claude CLI Path */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 12,
        padding: 16, borderRadius: 12,
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-subtle)',
      }}>
        <label style={{ fontSize: 11, letterSpacing: '0.04em', color: 'var(--color-text-muted)' }}>
          Claude CLI 路径
        </label>
        {loadingCliPath ? (
          <div style={{ display: 'flex', alignItems: 'center', padding: '4px 0' }}>
            <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
          </div>
        ) : (
          <>
            <input
              type="text"
              value={cliPath}
              onChange={e => { setCliPath(e.target.value); setSaveMsg(null) }}
              placeholder="留空使用默认路径（自动检测）"
              style={{
                ...inputStyle,
                fontSize: 13, borderRadius: 7, padding: '7px 12px', outline: 'none',
                width: '100%', boxSizing: 'border-box' as const,
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={handleSaveCliPath}
                disabled={saving}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  cursor: saving ? 'not-allowed' : 'pointer',
                  background: 'var(--color-accent-primary)',
                  border: 'none',
                  color: '#fff',
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving && <Loader2 size={12} className="animate-spin" />}
                {saving ? '保存中...' : '保存'}
              </button>
              {saveMsg && (
                <span style={{
                  fontSize: 12,
                  color: saveMsg === '已保存' ? 'var(--color-accent-success)' : 'var(--color-accent-danger)',
                }}>
                  {saveMsg}
                </span>
              )}
            </div>
          </>
        )}
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          自定义 claude 二进制文件路径，留空则自动从 PATH 中查找
        </p>
      </div>

      {/* Token Progress Context */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 12,
        padding: 16, borderRadius: 12,
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-subtle)',
      }}>
        <label style={{ fontSize: 11, letterSpacing: '0.04em', color: 'var(--color-text-muted)' }}>
          Token 进度条默认窗口
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="number"
            min={1}
            value={defaultContextWindow}
            onChange={e => setDefaultContextWindow(e.target.value)}
            placeholder={`留空使用 ${formatContextWindowTokens(DEFAULT_CONTEXT_WINDOW_TOKENS)} tokens`}
            style={{
              ...inputStyle,
              fontSize: 13, borderRadius: 7, padding: '7px 12px', outline: 'none',
              width: '100%', boxSizing: 'border-box' as const,
            }}
          />
          <button
            onClick={saveDefaultContextWindow}
            style={{
              flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              cursor: 'pointer',
              background: 'var(--color-accent-primary)',
              border: 'none',
              color: '#fff',
            }}
          >
            保存
          </button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          仅用于输入框下方的本地累计 token 进度条；优先使用 Provider 层级配置和模型内置窗口。
        </p>
      </div>

      {/* SDK Context */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 12,
        padding: 16, borderRadius: 12,
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-subtle)',
      }}>
        <label style={{ fontSize: 11, letterSpacing: '0.04em', color: 'var(--color-text-muted)' }}>
          SDK 上下文管理
        </label>
        <label style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '9px 10px',
          borderRadius: 9,
          background: 'var(--color-bg-surface-high)',
          border: '1px solid var(--color-border-subtle)',
          cursor: 'pointer',
        }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 12, fontWeight: 650, color: 'var(--color-text-primary)' }}>启用 Claude Agent SDK 自动压缩</span>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>真实上下文窗口与阈值由 SDK 判断；Loom 只记录和展示结果。</span>
          </span>
          <input
            type="checkbox"
            checked={sdkAutoCompactEnabled}
            onChange={e => updateSdkAutoCompactEnabled(e.target.checked)}
          />
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="number"
            min={1}
            value={sdkAutoCompactWindow}
            onChange={e => setSdkAutoCompactWindow(e.target.value)}
            placeholder="留空使用 SDK 默认窗口"
            style={{
              ...inputStyle,
              fontSize: 13, borderRadius: 7, padding: '7px 12px', outline: 'none',
              width: '100%', boxSizing: 'border-box' as const,
            }}
          />
          <button
            onClick={saveSdkAutoCompactWindow}
            style={{
              flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              cursor: 'pointer',
              background: 'var(--color-accent-primary)',
              border: 'none',
              color: '#fff',
            }}
          >
            保存
          </button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          不建议手动填写窗口值；除非要调试 SDK 自动 compact 行为，否则留空。
        </p>
      </div>

      {/* Claude Memory */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 12,
        padding: 16, borderRadius: 12,
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-subtle)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Brain size={14} style={{ color: 'var(--color-accent-primary)' }} />
          <label style={{ flex: 1, fontSize: 11, letterSpacing: '0.04em', color: 'var(--color-text-muted)' }}>
            全局 Claude Memory
          </label>
          <button
            onClick={loadGlobalMemory}
            disabled={loadingMemory}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28, borderRadius: 8, cursor: 'pointer',
              background: 'transparent',
              border: '1px solid var(--color-border-subtle)',
              color: 'var(--color-text-muted)',
            }}
            title="刷新"
          >
            <RefreshCw size={13} className={loadingMemory ? 'animate-spin' : ''} />
          </button>
        </div>
        <code style={{
          flex: 1, fontSize: 12, padding: '8px 12px', borderRadius: 8,
          color: 'var(--color-text-secondary)',
          background: 'var(--color-bg-surface-high)',
          border: '1px solid var(--color-border-subtle)',
          fontFamily: 'monospace',
          wordBreak: 'break-all',
        }}>
          {globalMemory?.rootDir || '~/.claude/memory'}
        </code>
        {loadingMemory ? (
          <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
        ) : !globalMemory?.initialized ? (
          <button
            onClick={initializeGlobalMemory}
            disabled={savingMemory}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              alignSelf: 'flex-start',
              padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              cursor: savingMemory ? 'not-allowed' : 'pointer',
              background: 'var(--color-accent-primary)',
              border: 'none',
              color: '#fff',
              opacity: savingMemory ? 0.7 : 1,
            }}
          >
            {savingMemory && <Loader2 size={12} className="animate-spin" />}
            初始化全局记忆
          </button>
        ) : (
          <>
            <pre style={{
              margin: 0,
              maxHeight: 160,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 11,
              lineHeight: 1.6,
              color: 'var(--color-text-secondary)',
              fontFamily: 'monospace',
            }}>
              {globalMemory.files.find(f => f.name === 'MEMORY.md')?.content || ''}
            </pre>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {memoryStatusMessage && (
                <div style={{
                  fontSize: 11,
                  color: 'var(--color-accent-success)',
                  background: 'rgba(46,160,91,0.08)',
                  border: '1px solid rgba(46,160,91,0.18)',
                  borderRadius: 8,
                  padding: '8px 10px',
                }}>
                  {memoryStatusMessage}
                </div>
              )}
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                全局待确认记忆 · {pendingGlobalCandidates.length}
              </div>
              {pendingGlobalCandidates.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                  暂无全局候选记忆。跨项目偏好和通用工作方式会出现在这里。
                </div>
              ) : pendingGlobalCandidates.map(candidate => (
                <div key={candidate.id} style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  padding: 10,
                  borderRadius: 10,
                  background: 'var(--color-bg-surface-high)',
                  border: '1px solid var(--color-border-subtle)',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                    {candidate.type} · {candidate.confidence}
                  </div>
                  {editingMemoryId === candidate.id ? (
                    <textarea
                      value={editingMemoryContent}
                      onChange={e => setEditingMemoryContent(e.target.value)}
                      rows={4}
                      style={{
                        resize: 'vertical',
                        borderRadius: 8,
                        border: '1px solid var(--color-border-strong)',
                        background: 'var(--color-bg-input)',
                        color: 'var(--color-text-primary)',
                        outline: 'none',
                        padding: 8,
                        fontSize: 12,
                        lineHeight: 1.5,
                      }}
                    />
                  ) : (
                    <div style={{ fontSize: 11, lineHeight: 1.55, color: 'var(--color-text-secondary)' }}>
                      {candidate.content}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6 }}>
                    {editingMemoryId === candidate.id ? (
                      <>
                        <button onClick={() => saveGlobalCandidate(candidate)} style={miniPrimaryButtonStyle}>保存</button>
                        <button onClick={() => setEditingMemoryId(null)} style={miniGhostButtonStyle}>取消</button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => updateGlobalCandidate(candidate, 'approve')}
                          disabled={busyMemoryCandidateId === candidate.id}
                          style={{ ...miniPrimaryButtonStyle, opacity: busyMemoryCandidateId === candidate.id ? 0.65 : 1 }}
                        >
                          {busyMemoryCandidateId === candidate.id ? '处理中' : '确认'}
                        </button>
                        <button onClick={() => { setEditingMemoryId(candidate.id); setEditingMemoryContent(candidate.content) }} style={miniGhostButtonStyle}>编辑</button>
                        <button
                          onClick={() => updateGlobalCandidate(candidate, 'reject')}
                          disabled={busyMemoryCandidateId === candidate.id}
                          style={{ ...miniGhostButtonStyle, opacity: busyMemoryCandidateId === candidate.id ? 0.65 : 1 }}
                        >
                          忽略
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          Loom 不创建 .loom；全局长期记忆写入 ~/.claude/memory，并通过 ~/.claude/CLAUDE.md 的 managed block 引入。
        </p>
        <label style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '9px 10px',
          borderRadius: 9,
          background: 'var(--color-bg-surface-high)',
          border: '1px solid var(--color-border-subtle)',
          cursor: 'pointer',
        }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 12, fontWeight: 650, color: 'var(--color-text-primary)' }}>显示上下文调试信息</span>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>聊天区显示 memory 注入、候选数量和发送前输入结构预览。</span>
          </span>
          <input
            type="checkbox"
            checked={memoryDebugVisible}
            onChange={e => updateMemoryDebugVisible(e.target.checked)}
          />
        </label>
      </div>

      {/* Danger Zone */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 12,
        padding: 16, borderRadius: 12,
        background: 'var(--color-bg-surface)',
        border: '1px solid rgba(232,90,79,0.2)',
      }}>
        <label style={{ fontSize: 11, letterSpacing: '0.04em', color: 'var(--color-accent-danger)' }}>
          危险操作
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            disabled
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'not-allowed',
              background: 'rgba(232,90,79,0.06)',
              border: '1px solid rgba(232,90,79,0.2)',
              color: 'var(--color-text-disabled)',
            }}
            title="功能开发中，敬请期待"
          >
            <AlertTriangle size={13} />
            重置应用数据
          </button>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            功能开发中，敬请期待
          </span>
        </div>
      </div>
    </div>
  )
}

const miniPrimaryButtonStyle: React.CSSProperties = {
  padding: '5px 9px',
  borderRadius: 7,
  border: 'none',
  background: 'var(--color-accent-primary)',
  color: '#fff',
  fontSize: 10,
  fontWeight: 700,
  cursor: 'pointer',
}

const miniGhostButtonStyle: React.CSSProperties = {
  padding: '5px 9px',
  borderRadius: 7,
  border: '1px solid var(--color-border-subtle)',
  background: 'transparent',
  color: 'var(--color-text-muted)',
  fontSize: 10,
  fontWeight: 700,
  cursor: 'pointer',
}
