'use client'

import { useEffect, useState, useCallback } from 'react'
import { CheckCircle, Eye, EyeOff, Loader2, Wifi, XCircle } from 'lucide-react'
import {
  DEFAULT_IMAGE_GENERATION_CONFIG,
  IMAGE_PROVIDER_ORDER,
  type ImageGenerationConfig,
  type ImageGenerationMode,
  type ImageOutputFormat,
  type ImageProviderConfig,
  type ImageProviderId,
} from '@/shared/config/image-generation-config'

const PROVIDER_LABELS: Record<ImageProviderId, string> = {
  openai: 'GPT-Image2 / OpenAI',
  seedream: 'SeeDream / 火山方舟',
}

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; modelFound?: boolean }
  | { status: 'error'; message: string }

export function ImageGenerationSettings() {
  const [config, setConfig] = useState<ImageGenerationConfig>(DEFAULT_IMAGE_GENERATION_CONFIG)
  const [activeTabId, setActiveTabId] = useState<ImageProviderId>('openai')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [testState, setTestState] = useState<TestState>({ status: 'idle' })

  useEffect(() => {
    fetch('/api/config/image-generation')
      .then(r => r.json())
      .then((data: ImageGenerationConfig) => {
        setConfig(data)
        setActiveTabId(data.activeProviderId || 'openai')
      })
      .catch(err => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false))
  }, [])

  const activeConfig = config.configs.find(c => c.id === activeTabId)
    ?? DEFAULT_IMAGE_GENERATION_CONFIG.configs.find(c => c.id === activeTabId)!

  const updateActiveConfig = useCallback((patch: Partial<ImageProviderConfig>) => {
    setConfig(prev => ({
      ...prev,
      configs: prev.configs.map(item => item.id === activeTabId ? { ...item, ...patch } : item),
    }))
    setSaveMsg(null)
    setTestState({ status: 'idle' })
  }, [activeTabId])

  const handleTabChange = (id: ImageProviderId) => {
    setActiveTabId(id)
    setShowKey(false)
    setSaveMsg(null)
    setTestState({ status: 'idle' })
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveMsg(null)
    setError(null)
    const next = { ...config, activeProviderId: activeTabId }
    try {
      const res = await fetch('/api/config/image-generation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      if (!res.ok) throw new Error('保存失败')
      setConfig(next)
      setSaveMsg('已保存')
      setTimeout(() => setSaveMsg(null), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTestState({ status: 'testing' })
    try {
      const res = await fetch('/api/config/image-generation/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: activeTabId,
          apiKey: activeConfig.apiKey || '',
          baseUrl: activeConfig.baseUrl || '',
          model: activeConfig.model || '',
        }),
      })
      const data = await res.json() as { ok: boolean; error?: string; modelFound?: boolean }
      if (data.ok) {
        setTestState({ status: 'ok', modelFound: data.modelFound })
        setTimeout(() => setTestState({ status: 'idle' }), 3000)
      } else {
        setTestState({ status: 'error', message: data.error ?? '连接失败' })
      }
    } catch (err) {
      setTestState({ status: 'error', message: err instanceof Error ? err.message : '网络错误' })
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    fontSize: 13,
    borderRadius: 7,
    padding: '7px 12px',
    outline: 'none',
    boxSizing: 'border-box',
    color: 'var(--color-text-primary)',
    background: 'var(--color-bg-input)',
    border: '1px solid var(--color-border-strong)',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    letterSpacing: '0.04em',
    color: 'var(--color-text-muted)',
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

      <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 2 }}>
        {IMAGE_PROVIDER_ORDER.map(id => {
          const isActive = id === activeTabId
          const isSavedActive = id === config.activeProviderId
          return (
            <button
              key={id}
              onClick={() => handleTabChange(id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 12px', borderRadius: 8, fontSize: 12, whiteSpace: 'nowrap', cursor: 'pointer',
                border: isActive ? '1px solid rgba(99,102,241,0.45)' : '1px solid var(--color-border-subtle)',
                background: isActive ? 'rgba(99,102,241,0.1)' : 'transparent',
                color: isActive ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
              }}
            >
              {PROVIDER_LABELS[id]}
              {isSavedActive && (
                <span style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0, background: 'var(--color-accent-primary)' }} />
              )}
            </button>
          )
        })}
      </div>

      <div style={{
        display: 'flex', flexDirection: 'column', gap: 16,
        padding: 16, borderRadius: 12,
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-subtle)',
      }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-text-secondary)' }}>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={e => setConfig(prev => ({ ...prev, enabled: e.target.checked }))}
          />
          启用图像生成 tool
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={labelStyle}>API KEY</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <input
                type={showKey ? 'text' : 'password'}
                value={activeConfig.apiKey}
                onChange={e => updateActiveConfig({ apiKey: e.target.value })}
                placeholder={activeTabId === 'openai' ? 'sk-...' : '火山方舟 API Key'}
                autoComplete="new-password"
                style={{ ...inputStyle, paddingRight: 36 }}
              />
              <button
                onClick={() => setShowKey(v => !v)}
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  cursor: 'pointer', padding: 2, color: 'var(--color-text-muted)', background: 'none', border: 'none',
                }}
                title={showKey ? '隐藏' : '显示'}
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            {activeConfig.apiKey && (
              <button
                onClick={() => updateActiveConfig({ apiKey: '' })}
                style={{
                  padding: '7px 12px', borderRadius: 7, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
                  border: '1px solid rgba(232,90,79,0.3)',
                  background: 'rgba(232,90,79,0.06)',
                  color: 'var(--color-accent-danger)',
                }}
              >
                清除
              </button>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={labelStyle}>BASE URL</label>
          <input
            type="text"
            value={activeConfig.baseUrl}
            onChange={e => updateActiveConfig({ baseUrl: e.target.value })}
            placeholder={activeTabId === 'openai' ? 'https://api.openai.com/v1' : 'https://ark.cn-beijing.volces.com/api/v3'}
            style={inputStyle}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={labelStyle}>模型 ID</label>
          <input
            type="text"
            value={activeConfig.model}
            onChange={e => updateActiveConfig({ model: e.target.value })}
            placeholder={activeTabId === 'openai' ? 'gpt-image-2' : 'doubao-seedream-4-0-250828'}
            style={inputStyle}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={labelStyle}>默认模式</label>
            <select
              value={config.defaultMode}
              onChange={e => setConfig(prev => ({ ...prev, defaultMode: e.target.value as ImageGenerationMode }))}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="auto">自动判断</option>
              <option value="text_to_image">文生图</option>
              <option value="image_to_image">参考图生图</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={labelStyle}>输出格式</label>
            <select
              value={config.outputFormat}
              onChange={e => setConfig(prev => ({ ...prev, outputFormat: e.target.value as ImageOutputFormat }))}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
            </select>
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-text-secondary)' }}>
          <input
            type="checkbox"
            checked={config.alwaysConfirm}
            onChange={e => setConfig(prev => ({ ...prev, alwaysConfirm: e.target.checked }))}
          />
          图像生成前始终请求确认
        </label>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer',
            background: 'var(--color-accent-primary)',
            border: 'none',
            color: '#fff',
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving && <Loader2 size={13} className="animate-spin" />}
          {saving ? '保存中...' : '保存并激活'}
        </button>
        <button
          onClick={handleTest}
          disabled={testState.status === 'testing'}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 16px', borderRadius: 8, fontSize: 13,
            cursor: testState.status === 'testing' ? 'not-allowed' : 'pointer',
            border: '1px solid var(--color-border-strong)',
            background: 'var(--color-bg-surface-high)',
            color: testState.status === 'ok'
              ? 'var(--color-accent-success)'
              : testState.status === 'error'
                ? 'var(--color-accent-danger)'
                : 'var(--color-text-secondary)',
            opacity: testState.status === 'testing' ? 0.7 : 1,
          }}
        >
          {testState.status === 'testing'
            ? <><Loader2 size={13} className="animate-spin" />测试中…</>
            : testState.status === 'ok'
              ? <><CheckCircle size={13} />连通正常</>
              : <><Wifi size={13} />测试连通性</>}
        </button>
        {saveMsg && (
          <span style={{ fontSize: 12, color: 'var(--color-accent-success)' }}>{saveMsg}</span>
        )}
        {testState.status === 'ok' && testState.modelFound === false && (
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            端点可用，但模型列表中未确认该模型
          </span>
        )}
        {testState.status === 'error' && (
          <span style={{ fontSize: 12, color: 'var(--color-accent-danger)' }}>
            <XCircle size={12} style={{ display: 'inline', marginRight: 4 }} />
            {testState.message}
          </span>
        )}
      </div>
    </div>
  )
}
