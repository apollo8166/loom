'use client'

import { useState, useEffect, useCallback } from 'react'
import { Eye, EyeOff, Loader2, CheckCircle, XCircle } from 'lucide-react'

/* ── Provider data ── */
const WEB_SEARCH_ORDER = ['tavily', 'tencent-hunyuan'] as const
type WebSearchTabId = (typeof WEB_SEARCH_ORDER)[number]

const WEB_SEARCH_PROVIDERS: Record<WebSearchTabId, { name: string; defaultBaseUrl: string; apiKeyHint: string }> = {
  tavily: {
    name: 'Tavily',
    defaultBaseUrl: 'https://api.tavily.com',
    apiKeyHint: '从 app.tavily.com 获取 API Key',
  },
  'tencent-hunyuan': {
    name: '腾讯云联网搜索',
    defaultBaseUrl: 'https://wsa.tencentcloudapi.com',
    apiKeyHint: '在腾讯云控制台 → 访问管理 → API 密钥管理 中获取 SecretId 和 SecretKey',
  },
}

/* ── Settings type ── */
interface WebSearchProviderConfig {
  apiKey?: string   // for tencent: packed as "secretId:secretKey"
  baseUrl?: string
}

interface WebSearchSettings {
  activeProvider: WebSearchTabId
  providers: Partial<Record<WebSearchTabId, WebSearchProviderConfig>>
}

const DEFAULT_SETTINGS: WebSearchSettings = {
  activeProvider: 'tavily',
  providers: {},
}

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; sourceCount: number; firstTitle: string }
  | { status: 'error'; message: string }

/* ── Component ── */
export function WebSearchSettings() {
  const [settings, setSettings] = useState<WebSearchSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<WebSearchTabId>('tavily')
  const [showKey, setShowKey] = useState(false)
  const [activateMsg, setActivateMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testState, setTestState] = useState<TestState>({ status: 'idle' })

  useEffect(() => {
    fetch('/api/config/settings?key=web_search_settings')
      .then(r => r.json())
      .then(data => {
        if (data.value) {
          try {
            const parsed = JSON.parse(data.value) as WebSearchSettings
            setSettings(parsed)
            setActiveTab(parsed.activeProvider)
          } catch { /* use defaults */ }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const provider = WEB_SEARCH_PROVIDERS[activeTab]
  const config = settings.providers[activeTab] ?? {}
  const isTencent = activeTab === 'tencent-hunyuan'

  const rawKey = config.apiKey || ''
  const colonIdx = rawKey.indexOf(':')
  const tencentSecretId = isTencent ? (colonIdx >= 0 ? rawKey.slice(0, colonIdx) : rawKey) : ''
  const tencentSecretKey = isTencent ? (colonIdx >= 0 ? rawKey.slice(colonIdx + 1) : '') : ''

  const setTencentKey = useCallback((secretId: string, secretKey: string) => {
    const packed = secretId && secretKey ? `${secretId}:${secretKey}` : secretId || secretKey
    setSettings(prev => ({
      ...prev,
      providers: { ...prev.providers, [activeTab]: { ...prev.providers[activeTab], apiKey: packed } },
    }))
    setTestState({ status: 'idle' })
  }, [activeTab])

  const updateConfig = (patch: Partial<WebSearchProviderConfig>) => {
    setSettings(prev => ({
      ...prev,
      providers: { ...prev.providers, [activeTab]: { ...prev.providers[activeTab], ...patch } },
    }))
    setTestState({ status: 'idle' })
  }

  const handleTabChange = (id: WebSearchTabId) => {
    setActiveTab(id)
    setShowKey(false)
    setActivateMsg(null)
    setTestState({ status: 'idle' })
  }

  const handleActivate = async () => {
    setSaving(true)
    const next = { ...settings, activeProvider: activeTab }
    setSettings(next)
    try {
      await fetch('/api/config/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'web_search_settings', value: JSON.stringify(next) }),
      })
      setActivateMsg('✓ 已激活')
      setTimeout(() => setActivateMsg(null), 2000)
    } catch { setActivateMsg('保存失败') }
    setSaving(false)
  }

  const handleTest = async () => {
    const apiKey = config.apiKey || ''
    if (!apiKey) return
    setTestState({ status: 'testing' })
    try {
      const res = await fetch('/api/web-search-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: activeTab,
          apiKey,
          baseUrl: config.baseUrl || undefined,
        }),
      })
      const json = await res.json() as {
        ok: boolean; sourceCount?: number; firstTitle?: string; error?: string
      }
      if (json.ok) {
        setTestState({ status: 'ok', sourceCount: json.sourceCount ?? 0, firstTitle: json.firstTitle ?? '' })
      } else {
        setTestState({ status: 'error', message: json.error ?? '请求失败' })
      }
    } catch (e) {
      setTestState({ status: 'error', message: e instanceof Error ? e.message : '网络错误' })
    }
  }

  const effectiveBaseUrl = config.baseUrl || provider.defaultBaseUrl
  const apiKey = config.apiKey || ''
  const hasKey = isTencent ? !!(tencentSecretId && tencentSecretKey) : !!apiKey

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
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {WEB_SEARCH_ORDER.map(id => {
          const isActive = id === activeTab
          const isCurrent = id === settings.activeProvider
          return (
            <button
              key={id}
              onClick={() => handleTabChange(id)}
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
              {WEB_SEARCH_PROVIDERS[id].name}
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
        {isTencent ? (
          <>
            {/* SecretId */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>SecretId</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type={showKey ? 'text' : 'password'}
                  value={tencentSecretId}
                  onChange={e => setTencentKey(e.target.value, tencentSecretKey)}
                  placeholder="AKIDxxxxxxxxxxxxxxxxx"
                  autoComplete="new-password"
                  style={inputStyle}
                />
                <button onClick={() => setShowKey(v => !v)} title={showKey ? '隐藏' : '显示'} style={eyeButtonStyle}>
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {/* SecretKey */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>SecretKey</label>
              <input
                type={showKey ? 'text' : 'password'}
                value={tencentSecretKey}
                onChange={e => setTencentKey(tencentSecretId, e.target.value)}
                placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                autoComplete="new-password"
                style={inputStyle}
              />
              <p style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: '1.6' }}>
                {provider.apiKeyHint}
              </p>
            </div>

            {/* Fixed endpoint */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={labelStyle}>请求地址</label>
              <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>
                {provider.defaultBaseUrl}
              </p>
              <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                Action: SearchPro　·　TC3-HMAC-SHA256 鉴权，无需手动填写
              </p>
            </div>
          </>
        ) : (
          <>
            {/* API Key */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>API Key</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={e => updateConfig({ apiKey: e.target.value })}
                  placeholder="tvly-..."
                  autoComplete="new-password"
                  style={inputStyle}
                />
                <button onClick={() => setShowKey(v => !v)} style={eyeButtonStyle}>
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {provider.apiKeyHint && (
                <p style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: '1.5' }}>
                  {provider.apiKeyHint}
                </p>
              )}
            </div>

            {/* Base URL */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>Base URL</label>
              <input
                type="text"
                value={config.baseUrl || ''}
                onChange={e => updateConfig({ baseUrl: e.target.value })}
                placeholder={provider.defaultBaseUrl || '留空使用默认端点'}
                style={inputStyle}
              />
            </div>

            {/* Request URL */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={labelStyle}>请求地址</label>
              <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>
                {effectiveBaseUrl}/search
              </p>
            </div>
          </>
        )}
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
          激活此搜索服务
        </button>

        <button
          onClick={handleTest}
          disabled={!hasKey || testState.status === 'testing'}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 16px', borderRadius: 8, fontSize: 13,
            cursor: hasKey && testState.status !== 'testing' ? 'pointer' : 'not-allowed',
            border: '1px solid var(--color-border-strong)',
            background: 'var(--color-bg-surface-high)',
            color: hasKey ? 'var(--color-text-secondary)' : 'var(--color-text-disabled)',
            opacity: hasKey ? 1 : 0.5, transition: 'all 0.15s',
          }}
        >
          {testState.status === 'testing'
            ? <><Loader2 size={13} className="animate-spin" />测试中…</>
            : '测试连通性'}
        </button>

        {activateMsg && (
          <span style={{ fontSize: 12, color: activateMsg.startsWith('✓') ? '#22c55e' : '#dc2626' }}>
            {activateMsg}
          </span>
        )}
      </div>

      {/* Test result */}
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
              连通成功，返回 {testState.sourceCount} 条结果
            </p>
            {testState.firstTitle && (
              <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                首条：{testState.firstTitle}
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

      {!hasKey && (
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          {isTencent ? '填写 SecretId 和 SecretKey 后可激活和测试' : '填写 API Key 后可激活和测试'}
        </p>
      )}
    </div>
  )
}
