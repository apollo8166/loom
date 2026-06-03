'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check, ExternalLink, Cpu, ChevronDown, ChevronRight } from 'lucide-react'
import type { ProviderConfig } from '@/shared/config/provider-config'

// ── Types ──────────────────────────────────────────────────────────────────

interface NavItem {
  id: string
  label: string
}

interface NavCategory {
  id: string
  label: string
  icon: React.ReactNode
  items: NavItem[]
}

// ── Nav data ───────────────────────────────────────────────────────────────

const NAV_CATEGORIES: NavCategory[] = [
  {
    id: 'ai',
    label: 'AI 服务商',
    icon: <Cpu size={13} />,
    items: [
      { id: 'provider', label: 'Provider 设置' },
    ],
  },
]

// ── Provider option card ───────────────────────────────────────────────────

function ProviderOption({
  isSelected, isAvailable, label, subLabel, badge, onClick,
}: {
  isSelected: boolean
  isAvailable: boolean
  label: string
  subLabel: string
  badge?: string
  onClick: () => void
}) {
  return (
    <div
      onClick={isAvailable ? onClick : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 14px', borderRadius: 10,
        cursor: isAvailable ? 'pointer' : 'not-allowed',
        opacity: isAvailable ? 1 : 0.4,
        border: isSelected
          ? '1px solid rgba(245,158,11,0.5)'
          : '1px solid var(--color-border-subtle)',
        background: isSelected
          ? 'rgba(245,158,11,0.06)'
          : 'var(--color-bg-surface)',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      <div style={{
        width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
        border: isSelected ? 'none' : '2px solid var(--color-border-strong)',
        background: isSelected ? 'var(--color-accent-primary)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {isSelected && <Check size={9} style={{ color: 'white', strokeWidth: 3 }} />}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize: 13, fontWeight: isSelected ? 500 : 400,
            color: isSelected ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
          }}>
            {label}
          </span>
          {badge && (
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 4,
              background: 'rgba(245,158,11,0.12)', color: 'var(--color-accent-primary)',
              fontWeight: 500,
            }}>
              {badge}
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{subLabel}</span>
      </div>
    </div>
  )
}

// ── Provider Settings Content ──────────────────────────────────────────────

function ProviderSettingsContent({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [allConfigs, setAllConfigs] = useState<ProviderConfig[]>([])
  const [globalActiveId, setGlobalActiveId] = useState<string>('anthropic')
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/config/provider').then(r => r.json()),
      fetch(`/api/projects/${projectId}/settings`).then(r => r.json()),
    ])
      .then(([providerData, settingsData]) => {
        setAllConfigs(providerData.configs ?? [])
        setGlobalActiveId(providerData.active ?? 'anthropic')
        setSelectedProviderId(settingsData.settings?.providerId ?? null)
      })
      .catch(() => setError('加载配置失败'))
      .finally(() => setLoading(false))
  }, [projectId])

  const handleSave = async () => {
    setSaving(true)
    setSaveMsg(null)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: selectedProviderId }),
      })
      if (!res.ok) throw new Error('保存失败')
      setSaveMsg('已保存')
      setTimeout(() => setSaveMsg(null), 2500)
    } catch {
      setError('保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  const isAvailable = (config: ProviderConfig) =>
    config.id === 'anthropic' || !!config.apiKey

  const globalActiveConfig = allConfigs.find(c => c.id === globalActiveId)
  const globalActiveName = globalActiveConfig?.name ?? globalActiveId

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 0' }}>
        <Loader2 size={16} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
      </div>
    )
  }

  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>
        Provider 设置
      </h3>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
        为此项目选择使用的 AI 服务商。若选择「全局默认」，将跟随全局设置切换。
        <br />
        服务商的具体配置（API Key 等）请前往全局设置完成。
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <ProviderOption
          isSelected={selectedProviderId === null}
          isAvailable={true}
          label="使用全局默认"
          subLabel={`当前全局：${globalActiveName}`}
          onClick={() => setSelectedProviderId(null)}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0' }}>
          <div style={{ flex: 1, height: 1, background: 'var(--color-border-subtle)' }} />
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>或指定服务商</span>
          <div style={{ flex: 1, height: 1, background: 'var(--color-border-subtle)' }} />
        </div>

        {allConfigs.map(config => {
          const available = isAvailable(config)
          const isGlobal = config.id === globalActiveId
          return (
            <ProviderOption
              key={config.id}
              isSelected={selectedProviderId === config.id}
              isAvailable={available}
              label={config.name}
              subLabel={available ? '已配置' : '未配置 API Key'}
              badge={isGlobal ? '全局默认' : undefined}
              onClick={() => setSelectedProviderId(config.id)}
            />
          )
        })}
      </div>

      <div style={{
        marginTop: 16, padding: '10px 14px', borderRadius: 8,
        background: 'rgba(245,158,11,0.04)',
        border: '1px solid rgba(245,158,11,0.12)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', flex: 1 }}>
          未配置的服务商无法选择。需要添加或修改服务商配置？
        </span>
        <button
          onClick={() => router.push('/settings')}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 11, color: 'var(--color-accent-primary)', flexShrink: 0,
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          }}
        >
          前往全局设置
          <ExternalLink size={10} />
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 24 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '8px 24px', borderRadius: 8, fontSize: 13, fontWeight: 500,
            cursor: saving ? 'not-allowed' : 'pointer',
            background: saving ? 'rgba(245,158,11,0.3)' : 'var(--color-accent-primary)',
            color: saving ? 'var(--color-text-muted)' : '#000',
            border: 'none',
          }}
        >
          {saving ? '保存中…' : '保存'}
        </button>
        {saveMsg && (
          <span style={{ fontSize: 12, color: 'var(--color-accent-success)' }}>{saveMsg}</span>
        )}
        {error && (
          <span style={{ fontSize: 12, color: 'var(--color-accent-danger)' }}>{error}</span>
        )}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

interface ProjectSettingsPaneProps {
  projectId: string
}

export function ProjectSettingsPane({ projectId }: ProjectSettingsPaneProps) {
  const [expandedCats, setExpandedCats] = useState<Set<string>>(
    () => new Set(NAV_CATEGORIES.map(c => c.id))
  )
  const [activeCatId, setActiveCatId] = useState<string>(NAV_CATEGORIES[0].id)
  const [activeItemId, setActiveItemId] = useState<string>(NAV_CATEGORIES[0].items[0].id)

  const toggleCategory = (catId: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev)
      if (next.has(catId)) next.delete(catId)
      else next.add(catId)
      return next
    })
  }

  const selectItem = (catId: string, itemId: string) => {
    setActiveCatId(catId)
    setActiveItemId(itemId)
    // Ensure category is expanded when selecting a child
    setExpandedCats(prev => new Set([...prev, catId]))
  }

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%' }}>

      {/* ── Left nav sidebar ── */}
      <div style={{
        width: 180, flexShrink: 0,
        borderRight: '1px solid var(--color-border-subtle)',
        background: 'var(--color-bg-base)',
        overflowY: 'auto',
        padding: '16px 0',
      }}>
        {NAV_CATEGORIES.map(cat => {
          const isExpanded = expandedCats.has(cat.id)
          return (
            <div key={cat.id}>
              {/* Category row */}
              <button
                onClick={() => toggleCategory(cat.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  width: '100%', padding: '6px 12px',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--color-text-secondary)',
                  fontSize: 12, fontWeight: 500,
                  textAlign: 'left',
                }}
              >
                <span style={{ color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center' }}>
                  {cat.icon}
                </span>
                <span style={{ flex: 1 }}>{cat.label}</span>
                <span style={{ color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center' }}>
                  {isExpanded
                    ? <ChevronDown size={12} />
                    : <ChevronRight size={12} />}
                </span>
              </button>

              {/* Sub-items */}
              {isExpanded && cat.items.map(item => {
                const isActive = activeCatId === cat.id && activeItemId === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => selectItem(cat.id, item.id)}
                    style={{
                      display: 'flex', alignItems: 'center',
                      width: '100%', padding: '6px 12px 6px 32px',
                      background: isActive ? 'rgba(245,158,11,0.08)' : 'none',
                      border: 'none',
                      borderLeft: isActive
                        ? '2px solid var(--color-accent-primary)'
                        : '2px solid transparent',
                      cursor: 'pointer',
                      color: isActive ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
                      fontSize: 12,
                      fontWeight: isActive ? 500 : 400,
                      textAlign: 'left',
                    }}
                  >
                    {item.label}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>

      {/* ── Content area ── */}
      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '28px 32px',
        background: 'var(--color-bg-base)',
      }}>
        {activeCatId === 'ai' && activeItemId === 'provider' && (
          <ProviderSettingsContent projectId={projectId} />
        )}
      </div>

    </div>
  )
}
