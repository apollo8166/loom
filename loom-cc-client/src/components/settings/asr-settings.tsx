'use client'

import { useState, useEffect, useCallback } from 'react'
import { Eye, EyeOff, Loader2, CheckCircle, XCircle } from 'lucide-react'

/* ── Settings type ── */
interface AliyunNlsConfig {
  apiKey?: string       // packed as "accessKeyId:accessKeySecret"
  appKey?: string
  region?: string
}

interface AsrSettings {
  activeProvider: string
  providers: {
    'aliyun-nls': AliyunNlsConfig
  }
}

const DEFAULT_SETTINGS: AsrSettings = {
  activeProvider: 'aliyun-nls',
  providers: { 'aliyun-nls': {} },
}

const REGION_OPTIONS = [
  { value: 'cn-shanghai', label: '上海（默认）' },
  { value: 'ap-southeast-1', label: '新加坡' },
]

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; tokenId: string }
  | { status: 'error'; message: string }

/* ── Component ── */
export function AsrSettings() {
  const [settings, setSettings] = useState<AsrSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [showKey, setShowKey] = useState(false)
  const [activateMsg, setActivateMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testState, setTestState] = useState<TestState>({ status: 'idle' })

  useEffect(() => {
    fetch('/api/config/settings?key=asr_settings')
      .then(r => r.json())
      .then(data => {
        if (data.value) {
          try {
            const parsed = JSON.parse(data.value) as AsrSettings
            setSettings(parsed)
          } catch { /* use defaults */ }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const config = settings.providers['aliyun-nls'] ?? {}
  const rawKey = config.apiKey || ''
  const colonIdx = rawKey.indexOf(':')
  const accessKeyId = colonIdx >= 0 ? rawKey.slice(0, colonIdx) : rawKey
  const accessKeySecret = colonIdx >= 0 ? rawKey.slice(colonIdx + 1) : ''
  const appKey = config.appKey ?? ''
  const region = config.region ?? 'cn-shanghai'

  const setAliyunField = useCallback((id: string, secret: string, ak: string, rg: string) => {
    const packed = id && secret ? `${id}:${secret}` : id || secret
    setSettings(prev => ({
      ...prev,
      providers: {
        ...prev.providers,
        'aliyun-nls': { apiKey: packed, appKey: ak, region: rg },
      },
    }))
    setTestState({ status: 'idle' })
  }, [])

  const handleActivate = async () => {
    setSaving(true)
    const next = { ...settings, activeProvider: 'aliyun-nls' }
    setSettings(next)
    try {
      await fetch('/api/config/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'asr_settings', value: JSON.stringify(next) }),
      })
      setActivateMsg('✓ 已激活')
      setTimeout(() => setActivateMsg(null), 2000)
    } catch { setActivateMsg('保存失败') }
    setSaving(false)
  }

  const handleTest = async () => {
    if (!accessKeyId || !accessKeySecret) return
    setTestState({ status: 'testing' })
    try {
      const res = await fetch('/api/asr-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessKeyId, accessKeySecret, region }),
      })
      const json = await res.json() as { ok: boolean; tokenId?: string; error?: string }
      if (json.ok) {
        setTestState({ status: 'ok', tokenId: json.tokenId ?? '' })
      } else {
        setTestState({ status: 'error', message: json.error ?? '鉴权失败' })
      }
    } catch (e) {
      setTestState({ status: 'error', message: e instanceof Error ? e.message : '网络错误' })
    }
  }

  const hasCredentials = !!(accessKeyId && accessKeySecret)

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
        {(['aliyun-nls'] as const).map(id => {
          const isActive = true
          const isCurrent = id === settings.activeProvider
          return (
            <button
              key={id}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '5px 12px', borderRadius: 8, whiteSpace: 'nowrap',
                border: isActive
                  ? '1px solid rgba(245,158,11,0.45)'
                  : '1px solid var(--color-border-subtle)',
                background: isActive ? 'rgba(245,158,11,0.1)' : 'transparent',
                color: isActive ? '#F59E0B' : 'var(--color-text-muted)',
                fontSize: 12, cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              阿里云 NLS
              {isCurrent && (
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#F59E0B', flexShrink: 0 }} />
              )}
            </button>
          )
        })}
      </div>

      {/* Config Panel */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 16,
        padding: 16,
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 10,
      }}>
        {/* AccessKey ID */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={labelStyle}>AccessKey ID</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type={showKey ? 'text' : 'password'}
              value={accessKeyId}
              onChange={e => setAliyunField(e.target.value, accessKeySecret, appKey, region)}
              placeholder="LTAI5t..."
              autoComplete="new-password"
              style={inputStyle}
            />
            <button onClick={() => setShowKey(v => !v)} title={showKey ? '隐藏' : '显示'} style={eyeButtonStyle}>
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        {/* AccessKey Secret */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={labelStyle}>AccessKey Secret</label>
          <input
            type={showKey ? 'text' : 'password'}
            value={accessKeySecret}
            onChange={e => setAliyunField(accessKeyId, e.target.value, appKey, region)}
            placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            autoComplete="new-password"
            style={inputStyle}
          />
          <p style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: '1.6' }}>
            在阿里云控制台 → 右上角账号头像 → AccessKey 管理 中获取
          </p>
        </div>

        {/* AppKey */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={labelStyle}>AppKey</label>
          <input
            type="text"
            value={appKey}
            onChange={e => setAliyunField(accessKeyId, accessKeySecret, e.target.value, region)}
            placeholder="NLS 项目 Appkey"
            style={inputStyle}
          />
          <p style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: '1.6' }}>
            在阿里云 NLS 控制台 → 项目管理 → 创建项目后获取 Appkey
          </p>
        </div>

        {/* Region */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={labelStyle}>接入地域</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {REGION_OPTIONS.map(opt => {
              const active = region === opt.value
              return (
                <button
                  key={opt.value}
                  onClick={() => setAliyunField(accessKeyId, accessKeySecret, appKey, opt.value)}
                  style={{
                    padding: '5px 14px', borderRadius: 7, fontSize: 12, cursor: 'pointer',
                    border: active
                      ? '1px solid rgba(245,158,11,0.45)'
                      : '1px solid var(--color-border-subtle)',
                    background: active ? 'rgba(245,158,11,0.1)' : 'var(--color-bg-surface-high)',
                    color: active ? '#F59E0B' : 'var(--color-text-muted)',
                    transition: 'all 0.15s',
                  }}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* WebSocket endpoint info */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={labelStyle}>接入地址</label>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>
            wss://nls-gateway.{region}.aliyuncs.com/ws/v1
          </p>
          <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            实时流式语音识别 · PCM 16kHz 单声道
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
          激活此语音识别
        </button>

        <button
          onClick={handleTest}
          disabled={!hasCredentials || testState.status === 'testing'}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 16px', borderRadius: 8, fontSize: 13,
            cursor: hasCredentials && testState.status !== 'testing' ? 'pointer' : 'not-allowed',
            border: '1px solid var(--color-border-strong)',
            background: 'var(--color-bg-surface-high)',
            color: hasCredentials ? 'var(--color-text-secondary)' : 'var(--color-text-disabled)',
            opacity: hasCredentials ? 1 : 0.5, transition: 'all 0.15s',
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
          <div>
            <p style={{ fontSize: 12, color: '#16a34a', marginBottom: 2 }}>
              鉴权成功，Token 已签发
            </p>
            {testState.tokenId && (
              <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                Token: {testState.tokenId}
              </p>
            )}
          </div>
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

      {!hasCredentials && (
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          填写 AccessKey ID 和 AccessKey Secret 后可激活和测试连通性
        </p>
      )}
    </div>
  )
}
