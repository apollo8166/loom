'use client'

import { useState, useEffect } from 'react'
import { Eye, EyeOff, Loader2, CheckCircle, XCircle } from 'lucide-react'

/* ── Settings type ── */
interface MineruConfig {
  apiKey?: string
  baseUrl?: string
}

interface PdfSettings {
  activeProvider: string
  providers: {
    'mineru-cloud': MineruConfig
  }
}

const DEFAULT_SETTINGS: PdfSettings = {
  activeProvider: 'mineru-cloud',
  providers: { 'mineru-cloud': {} },
}

const MINERU_CLOUD_DEFAULT_BASE = 'https://mineru.net/api/v4'

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok' }
  | { status: 'error'; message: string }

/* ── Component ── */
export function PdfSettings() {
  const [settings, setSettings] = useState<PdfSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [showKey, setShowKey] = useState(false)
  const [activateMsg, setActivateMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testState, setTestState] = useState<TestState>({ status: 'idle' })

  useEffect(() => {
    fetch('/api/config/settings?key=pdf_settings')
      .then(r => r.json())
      .then(data => {
        if (data.value) {
          try {
            const parsed = JSON.parse(data.value) as PdfSettings
            setSettings(parsed)
          } catch { /* use defaults */ }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const config = settings.providers['mineru-cloud'] ?? {}
  const apiKey = config.apiKey || ''
  const baseUrl = config.baseUrl || ''
  const effectiveBase = baseUrl || MINERU_CLOUD_DEFAULT_BASE

  const updateConfig = (patch: Partial<MineruConfig>) => {
    setSettings(prev => ({
      ...prev,
      providers: {
        ...prev.providers,
        'mineru-cloud': { ...prev.providers['mineru-cloud'], ...patch },
      },
    }))
    setTestState({ status: 'idle' })
  }

  const handleActivate = async () => {
    setSaving(true)
    const next = { ...settings, activeProvider: 'mineru-cloud' }
    setSettings(next)
    try {
      await fetch('/api/config/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'pdf_settings', value: JSON.stringify(next) }),
      })
      setActivateMsg('✓ 已激活')
      setTimeout(() => setActivateMsg(null), 2000)
    } catch { setActivateMsg('保存失败') }
    setSaving(false)
  }

  const handleTest = async () => {
    if (!apiKey) return
    setTestState({ status: 'testing' })
    try {
      const res = await fetch('/api/pdf-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, baseUrl: baseUrl || undefined }),
      })
      const json = await res.json() as { ok: boolean; error?: string }
      if (json.ok) {
        setTestState({ status: 'ok' })
      } else {
        setTestState({ status: 'error', message: json.error ?? '连接失败' })
      }
    } catch (e) {
      setTestState({ status: 'error', message: e instanceof Error ? e.message : '网络错误' })
    }
  }

  const hasApiKey = !!apiKey

  const inputStyle: React.CSSProperties = {
    fontSize: 13,
    color: 'var(--color-text-primary)',
    background: 'var(--color-bg-input)',
    border: '1px solid var(--color-border-strong)',
    borderRadius: 7, padding: '7px 12px', outline: 'none',
    width: '100%', boxSizing: 'border-box' as const,
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 11, color: 'var(--color-text-muted)',
    letterSpacing: '0.04em', textTransform: 'uppercase' as const,
  }

  const eyeButtonStyle: React.CSSProperties = {
    padding: '7px 10px', borderRadius: 7, cursor: 'pointer',
    border: '1px solid var(--color-border-strong)',
    background: 'var(--color-bg-surface-high)',
    color: 'var(--color-text-muted)',
    display: 'flex', alignItems: 'center', flexShrink: 0,
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 size={20} className="animate-spin" style={{ color: 'var(--color-accent-primary)' }} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Provider Tabs */}
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '5px 12px', borderRadius: 8,
            border: '1px solid rgba(245,158,11,0.45)',
            background: 'rgba(245,158,11,0.1)',
            color: '#F59E0B',
            fontSize: 12, cursor: 'pointer',
          }}
        >
          MinerU Cloud
          {settings.activeProvider === 'mineru-cloud' && (
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#F59E0B', flexShrink: 0 }} />
          )}
        </button>
      </div>

      {/* Config Panel */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 16,
        padding: 16,
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 10,
      }}>
        {/* API Key */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={labelStyle}>API Key</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => updateConfig({ apiKey: e.target.value })}
              placeholder="Bearer token..."
              autoComplete="new-password"
              style={inputStyle}
            />
            <button onClick={() => setShowKey(v => !v)} title={showKey ? '隐藏' : '显示'} style={eyeButtonStyle}>
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: '1.6' }}>
            在 MinerU 控制台 → API 管理 → 创建 Token 中获取
          </p>
        </div>

        {/* Base URL */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ ...labelStyle, display: 'flex', gap: 6, alignItems: 'center' }}>
            Base URL
            <span style={{
              fontSize: 10, textTransform: 'none', fontStyle: 'italic',
              color: 'var(--color-text-muted)', letterSpacing: 0,
            }}>（可选）</span>
          </label>
          <input
            type="text"
            value={baseUrl}
            onChange={e => updateConfig({ baseUrl: e.target.value })}
            placeholder="https://mineru.net/api/v4"
            style={inputStyle}
          />
        </div>

        {/* Endpoint info */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={labelStyle}>请求地址</label>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>
            {effectiveBase}/file-urls/batch
          </p>
          <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            PDF 上传 → 异步解析（文本 · 图片 · 表格 · 公式 · 版面分析）
          </p>
        </div>
      </div>

      {/* Action Row */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={handleActivate}
          disabled={saving}
          style={{
            padding: '8px 20px', borderRadius: 8,
            fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer',
            background: '#F59E0B', border: 'none',
            color: '#12100a', fontWeight: 600, opacity: saving ? 0.7 : 1,
          }}
        >
          激活此 PDF 解析
        </button>

        <button
          onClick={handleTest}
          disabled={!hasApiKey || testState.status === 'testing'}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 16px', borderRadius: 8, fontSize: 13,
            cursor: hasApiKey && testState.status !== 'testing' ? 'pointer' : 'not-allowed',
            border: '1px solid var(--color-border-strong)',
            background: 'var(--color-bg-surface-high)',
            color: hasApiKey ? 'var(--color-text-secondary)' : 'var(--color-text-disabled)',
            opacity: hasApiKey ? 1 : 0.5, transition: 'all 0.15s',
          }}
        >
          {testState.status === 'testing'
            ? <><Loader2 size={13} className="animate-spin" />测试中…</>
            : '测试连通性'}
        </button>

        {activateMsg && (
          <span style={{ fontSize: 12, color: activateMsg.startsWith('✓') ? '#16a34a' : '#dc2626' }}>
            {activateMsg}
          </span>
        )}
      </div>

      {/* Test Result */}
      {testState.status === 'ok' && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          padding: '10px 14px', borderRadius: 8,
          background: 'rgba(34,197,94,0.08)',
          border: '1px solid rgba(34,197,94,0.25)',
        }}>
          <CheckCircle size={14} style={{ color: '#16a34a', flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 12, color: '#16a34a' }}>
            连接成功，API Key 有效
          </p>
        </div>
      )}

      {testState.status === 'error' && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          padding: '10px 14px', borderRadius: 8,
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.25)',
        }}>
          <XCircle size={14} style={{ color: '#dc2626', flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 12, color: '#dc2626', wordBreak: 'break-all' }}>
            {testState.message}
          </p>
        </div>
      )}

      {!hasApiKey && (
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          填写 API Key 后可激活和测试连通性
        </p>
      )}
    </div>
  )
}
