'use client'

import { useState, useEffect, useCallback } from 'react'
import { Eye, EyeOff, Loader2, CheckCircle, XCircle, Wifi, Plus, Trash2 } from 'lucide-react'
import { PROVIDER_PRESETS, PROVIDER_ORDER } from '@/shared/config/provider-config'
import type { ProviderConfig } from '@/shared/config/provider-config'
import type { ModelCatalogEntry } from '@/shared/config/models'
import { mergeModelCatalog } from '@/shared/config/model-catalog'
import type { CustomModelCatalogs } from '@/shared/config/model-catalog'

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  qwen: '千问',
  glm: 'GLM',
  doubao: '豆包',
  chatgpt: 'ChatGPT',
  custom: '自定义',
}

export function ProviderSettings() {
  const [configs, setConfigs] = useState<ProviderConfig[]>([])
  const [savedActiveId, setSavedActiveId] = useState('anthropic')
  const [activeTabId, setActiveTabId] = useState('anthropic')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showKey, setShowKey] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [customCatalogs, setCustomCatalogs] = useState<CustomModelCatalogs>({})
  const [newModel, setNewModel] = useState({ id: '', label: '', tier: 'main' as ModelCatalogEntry['tier'] })
  const [testState, setTestState] = useState<
    { status: 'idle' } | { status: 'testing' } | { status: 'ok' } | { status: 'error'; message: string }
  >({ status: 'idle' })

  useEffect(() => {
    Promise.all([
      fetch('/api/config/provider').then(r => r.json()),
      fetch('/api/config/models').then(r => r.json()).catch(() => ({ catalogs: {} })),
    ])
      .then(([providerData, modelData]) => {
        setConfigs(providerData.configs || [])
        setSavedActiveId(providerData.active || 'anthropic')
        setActiveTabId(providerData.active || 'anthropic')
        setCustomCatalogs(modelData.catalogs || {})
      })
      .catch(err => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false))
  }, [])

  const activeConfig = configs.find(c => c.id === activeTabId)
    ?? { ...PROVIDER_PRESETS[activeTabId] ?? PROVIDER_PRESETS.custom, apiKey: '' }

  const updateActiveConfig = useCallback((patch: Partial<ProviderConfig>) => {
    setConfigs(prev => prev.map(c => c.id === activeTabId ? { ...c, ...patch } : c))
    setSaveMsg(null)
  }, [activeTabId])

  const handleTabChange = (id: string) => {
    setActiveTabId(id)
    setShowKey(false)
    setSaveMsg(null)
    setNewModel({ id: '', label: '', tier: 'main' })
    setTestState({ status: 'idle' })
  }

  const handleTest = async () => {
    setTestState({ status: 'testing' })
    try {
      const res = await fetch('/api/config/provider/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: activeTabId,
          apiKey: activeConfig.apiKey || '',
          baseUrl: activeConfig.baseUrl || '',
        }),
      })
      const data = await res.json() as { ok: boolean; error?: string }
      if (data.ok) {
        setTestState({ status: 'ok' })
        setTimeout(() => setTestState({ status: 'idle' }), 3000)
      } else {
        setTestState({ status: 'error', message: data.error ?? '连接失败' })
      }
    } catch (e) {
      setTestState({ status: 'error', message: e instanceof Error ? e.message : '网络错误' })
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveMsg(null)
    setError(null)
    try {
      const res = await fetch('/api/config/provider', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeId: activeTabId, configs }),
      })
      if (!res.ok) throw new Error('保存失败')
      const modelRes = await fetch('/api/config/models', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ catalogs: customCatalogs }),
      })
      if (!modelRes.ok) throw new Error('模型配置保存失败')
      setSavedActiveId(activeTabId)
      setSaveMsg('已保存')
      setTimeout(() => setSaveMsg(null), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const isAnthropic = activeTabId === 'anthropic'
  const catalog = mergeModelCatalog(activeTabId, customCatalogs)
  const customModels = customCatalogs[activeTabId] ?? []

  const addCustomModel = () => {
    const id = newModel.id.trim()
    if (!id) return
    const entry: ModelCatalogEntry = {
      id,
      label: newModel.label.trim() || id,
      tier: newModel.tier,
    }
    setCustomCatalogs(prev => {
      const next = { ...prev }
      const existing = next[activeTabId] ?? []
      next[activeTabId] = [...existing.filter(m => m.id !== entry.id), entry]
      return next
    })
    setNewModel({ id: '', label: '', tier: 'main' })
    setSaveMsg(null)
  }

  const removeCustomModel = (id: string) => {
    setCustomCatalogs(prev => ({
      ...prev,
      [activeTabId]: (prev[activeTabId] ?? []).filter(m => m.id !== id),
    }))
    setSaveMsg(null)
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

      {/* Provider Tabs */}
      <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 2 }}>
        {PROVIDER_ORDER.map(id => {
          const isActive = id === activeTabId
          const isSavedActive = id === savedActiveId
          return (
            <button
              key={id}
              onClick={() => handleTabChange(id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 12px', borderRadius: 8, fontSize: 12, whiteSpace: 'nowrap' as const, cursor: 'pointer',
                border: isActive
                  ? '1px solid rgba(99,102,241,0.45)'
                  : '1px solid var(--color-border-subtle)',
                background: isActive ? 'rgba(99,102,241,0.1)' : 'transparent',
                color: isActive ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
              }}
            >
              {PROVIDER_LABELS[id] || id}
              {isSavedActive && (
                <span style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0, background: 'var(--color-accent-primary)' }} />
              )}
            </button>
          )
        })}
      </div>

      {/* Config Panel */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 16,
        padding: 16, borderRadius: 12,
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-subtle)',
      }}>
        {/* API Key */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, letterSpacing: '0.04em', color: 'var(--color-text-muted)' }}>API KEY</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <input
                type={showKey ? 'text' : 'password'}
                value={activeConfig.apiKey}
                onChange={e => updateActiveConfig({ apiKey: e.target.value })}
                placeholder={isAnthropic ? '留空则使用环境变量或 claude login 认证' : 'sk-...'}
                style={{
                  width: '100%', fontSize: 13, borderRadius: 7,
                  padding: '7px 36px 7px 12px', outline: 'none', boxSizing: 'border-box' as const,
                  color: 'var(--color-text-primary)',
                  background: 'var(--color-bg-input)',
                  border: '1px solid var(--color-border-strong)',
                }}
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
                  padding: '7px 12px', borderRadius: 7, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' as const,
                  border: '1px solid rgba(232,90,79,0.3)',
                  background: 'rgba(232,90,79,0.06)',
                  color: 'var(--color-accent-danger)',
                }}
              >
                清除
              </button>
            )}
          </div>
          {isAnthropic && (
            <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              清除后将依次使用{' '}
              <code style={{ padding: '1px 4px', borderRadius: 4, background: 'var(--color-bg-surface-high)' }}>ANTHROPIC_API_KEY</code>
              {' '}环境变量 →{' '}
              <code style={{ padding: '1px 4px', borderRadius: 4, background: 'var(--color-bg-surface-high)' }}>claude login</code>
              {' '}OAuth 认证
            </p>
          )}
        </div>

        {/* Base URL */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, letterSpacing: '0.04em', color: 'var(--color-text-muted)' }}>BASE URL</label>
          <input
            type="text"
            value={activeConfig.baseUrl}
            onChange={e => updateActiveConfig({ baseUrl: e.target.value })}
            placeholder={isAnthropic ? '留空使用默认 https://api.anthropic.com' : 'https://api.example.com/v1'}
            style={{
              fontSize: 13, borderRadius: 7, padding: '7px 12px', outline: 'none', width: '100%', boxSizing: 'border-box' as const,
              color: 'var(--color-text-primary)',
              background: 'var(--color-bg-input)',
              border: '1px solid var(--color-border-strong)',
            }}
          />
          {isAnthropic && (
            <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              可填写自定义代理地址，留空直连 Anthropic 官方 API
            </p>
          )}
        </div>

        {/* Model Mappings */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, letterSpacing: '0.04em', color: 'var(--color-text-muted)', marginBottom: 4 }}>模型层级映射</label>
          <ModelRow
            label="快速 (Haiku 层)"
            value={activeConfig.fastModel || ''}
            catalog={catalog}
            isAnthropic={isAnthropic}
            onChange={v => updateActiveConfig({ fastModel: v })}
          />
          <ModelRow
            label="主力 (Sonnet 层)"
            value={activeConfig.mainModel || ''}
            catalog={catalog}
            isAnthropic={isAnthropic}
            onChange={v => updateActiveConfig({ mainModel: v })}
          />
          <ModelRow
            label="强力 (Opus 层)"
            value={activeConfig.heavyModel || ''}
            catalog={catalog}
            isAnthropic={isAnthropic}
            onChange={v => updateActiveConfig({ heavyModel: v })}
          />
        </div>

        {/* Custom Models */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 11, letterSpacing: '0.04em', color: 'var(--color-text-muted)' }}>自定义模型</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 90px 34px', gap: 8, alignItems: 'center' }}>
            <input
              value={newModel.id}
              onChange={e => setNewModel(prev => ({ ...prev, id: e.target.value }))}
              placeholder="模型 ID，例如 gpt-5.6"
              className="text-xs rounded-md px-2.5 py-1 outline-none"
              style={{ color: 'var(--color-text-secondary)', background: 'var(--color-bg-input)', border: '1px solid var(--color-border-strong)' }}
            />
            <input
              value={newModel.label}
              onChange={e => setNewModel(prev => ({ ...prev, label: e.target.value }))}
              placeholder="显示名称"
              className="text-xs rounded-md px-2.5 py-1 outline-none"
              style={{ color: 'var(--color-text-secondary)', background: 'var(--color-bg-input)', border: '1px solid var(--color-border-strong)' }}
            />
            <select
              value={newModel.tier}
              onChange={e => setNewModel(prev => ({ ...prev, tier: e.target.value as ModelCatalogEntry['tier'] }))}
              className="text-xs rounded-md px-2 py-1 outline-none cursor-pointer"
              style={{ color: 'var(--color-text-secondary)', background: 'var(--color-bg-input)', border: '1px solid var(--color-border-strong)' }}
            >
              <option value="fast">fast</option>
              <option value="main">main</option>
              <option value="heavy">heavy</option>
            </select>
            <button
              onClick={addCustomModel}
              disabled={!newModel.id.trim()}
              title="添加模型"
              style={{
                width: 34, height: 28, borderRadius: 7, border: 'none',
                background: newModel.id.trim() ? 'var(--color-accent-primary)' : 'var(--color-bg-surface-high)',
                color: newModel.id.trim() ? '#fff' : 'var(--color-text-disabled)',
                cursor: newModel.id.trim() ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Plus size={14} />
            </button>
          </div>
          {customModels.length === 0 ? (
            <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              后端新增模型时，在这里填入模型 ID 即可，无需改代码。
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {customModels.map(model => (
                <div key={model.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 8px', borderRadius: 7,
                  border: '1px solid var(--color-border-subtle)',
                  background: 'var(--color-bg-surface-high)',
                }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontFamily: 'monospace', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{model.id}</span>
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{model.label}</span>
                  <span style={{ fontSize: 10, color: 'var(--color-accent-primary)', border: '1px solid rgba(245,158,11,0.28)', borderRadius: 999, padding: '1px 7px' }}>{model.tier}</span>
                  <button
                    onClick={() => removeCustomModel(model.id)}
                    title="删除模型"
                    style={{ border: 'none', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 2 }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Capabilities */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, letterSpacing: '0.04em', color: 'var(--color-text-muted)' }}>功能支持</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {([
              { label: '文本 / 流式', supported: true },
              { label: '工具调用', supported: true },
              { label: '视觉（图片）', supported: activeConfig.supportsVision },
              { label: 'PDF', supported: activeConfig.supportsPDF },
              { label: 'Thinking', supported: activeConfig.supportsThinking },
            ] as { label: string; supported: boolean }[]).map(({ label, supported }) => (
              <span
                key={label}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: 11, padding: '2px 10px', borderRadius: 999,
                  border: supported
                    ? '1px solid rgba(50,213,131,0.3)'
                    : '1px solid var(--color-border-subtle)',
                  background: supported
                    ? 'rgba(50,213,131,0.07)'
                    : 'var(--color-bg-surface-high)',
                  color: supported
                    ? 'var(--color-accent-success)'
                    : 'var(--color-text-disabled)',
                }}
              >
                {supported ? <CheckCircle size={10} /> : <XCircle size={10} />}
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Save Action */}
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
          <span style={{ fontSize: 12, color: saveMsg === '已保存' ? 'var(--color-accent-success)' : 'var(--color-accent-danger)' }}>
            {saveMsg}
          </span>
        )}
        {testState.status === 'error' && (
          <span style={{ fontSize: 12, color: 'var(--color-accent-danger)' }}>
            {testState.message}
          </span>
        )}
      </div>
    </div>
  )
}

/* ── Model Row Sub-component ──────────────────────────────────────── */

function ModelRow({
  label, value, catalog, isAnthropic, onChange,
}: {
  label: string
  value: string
  catalog: { id: string; label: string }[]
  isAnthropic: boolean
  onChange: (v: string) => void
}) {
  if (isAnthropic) {
    return (
      <div className="flex items-center gap-2 py-1.5">
        <span className="text-[11px] w-[140px] shrink-0" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
        <span className="text-xs px-2.5 py-1 rounded-md" style={{
          color: 'var(--color-text-disabled)',
          background: 'var(--color-bg-surface-high)',
          border: '1px solid var(--color-border-subtle)',
        }}>
          {value}
        </span>
      </div>
    )
  }

  if (catalog.length > 0) {
    return (
      <div className="flex items-center gap-2 py-1.5">
        <span className="text-[11px] w-[140px] shrink-0" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="flex-1 text-xs rounded-md px-2 py-1 outline-none cursor-pointer"
          style={{
            color: 'var(--color-text-secondary)',
            background: 'var(--color-bg-input)',
            border: '1px solid var(--color-border-strong)',
          }}
        >
          <option value="">-- 选择模型 --</option>
          {catalog.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          {value && !catalog.find(m => m.id === value) && <option value={value}>{value}</option>}
        </select>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="text-[11px] w-[140px] shrink-0" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="模型 ID"
        className="flex-1 text-xs rounded-md px-2.5 py-1 outline-none"
        style={{
          color: 'var(--color-text-secondary)',
          background: 'var(--color-bg-input)',
          border: '1px solid var(--color-border-strong)',
        }}
      />
    </div>
  )
}
