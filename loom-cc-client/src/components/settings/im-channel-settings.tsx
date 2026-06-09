'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle, ChevronDown, ChevronRight, Loader2, Plug, PlugZap, RefreshCcw, Save, Send, Trash2, XCircle } from 'lucide-react'

type ChannelStatus = 'connected' | 'connecting' | 'disconnected' | 'not_configured' | 'error'
type PermissionMode = 'confirm' | 'read-only' | 'full'
type DmPolicy = 'open' | 'allowlist' | 'disabled'
type GroupPolicy = 'mention' | 'open' | 'allowlist' | 'disabled'
type TriggerMode = 'mention' | 'all'

type ProviderConfigBrief = {
  id: string
  fastModel?: string
  mainModel?: string
  heavyModel?: string
}

type WorkbenchModelEntry = {
  id: string
  label: string
  tier: 'fast' | 'main' | 'heavy'
  actualModel?: string
}

type ImModelOption = {
  id: string
  label: string
  detail?: string
}

interface ImChannel {
  id: string
  type: 'feishu'
  enabled: boolean
  status: ChannelStatus
  connected: boolean
  credentials: {
    app_id?: string
    app_secret?: string
    platform?: 'feishu' | 'lark'
  }
  dmPolicy: DmPolicy
  groupPolicy: GroupPolicy
  triggerMode: TriggerMode
  senderWhitelist: string[]
  groupWhitelist: string[]
  defaultModel: string
  permissionMode: PermissionMode
  lastConnectedAt: string | null
  lastError: string
}

interface BindingRow {
  id: string
  chatId: string
  chatName: string
  projectId: string
  projectName: string
  sessionId: string
  sessionTitle: string
  updatedAt: string
}

interface AuditRow {
  id: string
  chatId: string
  action: string
  status: string
  details: Record<string, unknown>
  createdAt: string
}

const DEFAULT_CHANNEL: ImChannel = {
  id: 'feishu',
  type: 'feishu',
  enabled: false,
  status: 'not_configured',
  connected: false,
  credentials: { platform: 'feishu' },
  dmPolicy: 'open',
  groupPolicy: 'mention',
  triggerMode: 'mention',
  senderWhitelist: [],
  groupWhitelist: [],
  defaultModel: '',
  permissionMode: 'confirm',
  lastConnectedAt: null,
  lastError: '',
}

const statusLabel: Record<ChannelStatus, string> = {
  connected: '已连接',
  connecting: '连接中',
  disconnected: '未连接',
  not_configured: '未配置',
  error: '异常',
}

const auditStatusLabel: Record<string, string> = {
  ok: '成功',
  error: '失败',
  skipped: '已跳过',
}

const auditActionLabel: Record<string, string> = {
  connect: '连接',
  disconnect: '断开连接',
  message_received: '收到消息',
  message_ignored: '忽略消息',
  session_bound: '绑定会话',
  session_created: '创建会话',
  permission_requested: '请求权限',
  permission_allowed: '权限已允许',
  permission_denied: '权限已拒绝',
  reply_sent: '已发送回复',
  error: '异常',
}

const LOGICAL_MODELS: WorkbenchModelEntry[] = [
  { id: 'claude-haiku-4-5', label: '快速', tier: 'fast' },
  { id: 'claude-sonnet-4-6', label: '主力', tier: 'main' },
  { id: 'claude-opus-4-6', label: '强力', tier: 'heavy' },
]

function buildLogicalModelOptions(config?: ProviderConfigBrief): WorkbenchModelEntry[] {
  return LOGICAL_MODELS.map(model => {
    const actualModel = model.tier === 'fast'
      ? config?.fastModel
      : model.tier === 'heavy'
        ? config?.heavyModel
        : config?.mainModel
    return {
      ...model,
      actualModel: actualModel?.trim() || undefined,
    }
  })
}

function normalizeChannelModel(modelId: string | null | undefined, config?: ProviderConfigBrief): string {
  const model = modelId?.trim()
  if (!model || model === 'inherit') return ''
  if (LOGICAL_MODELS.some(option => option.id === model)) return model
  if (config?.fastModel && model === config.fastModel) return 'claude-haiku-4-5'
  if (config?.mainModel && model === config.mainModel) return 'claude-sonnet-4-6'
  if (config?.heavyModel && model === config.heavyModel) return 'claude-opus-4-6'
  if (model.toLowerCase().includes('opus')) return 'claude-opus-4-6'
  if (model.toLowerCase().includes('haiku')) return 'claude-haiku-4-5'
  if (model.toLowerCase().includes('sonnet')) return 'claude-sonnet-4-6'
  return model
}

export function ImChannelSettings({
  projectId,
  projectName,
  defaultModel,
}: {
  projectId: string
  projectName: string
  defaultModel: string
}) {
  const [channel, setChannel] = useState<ImChannel>(DEFAULT_CHANNEL)
  const [bindings, setBindings] = useState<BindingRow[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [showSecret, setShowSecret] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [providerConfig, setProviderConfig] = useState<ProviderConfigBrief | undefined>(undefined)
  const [modelOptions, setModelOptions] = useState<ImModelOption[]>([
    { id: '', label: '继承项目默认' },
    ...LOGICAL_MODELS.map(model => ({ id: model.id, label: model.label })),
  ])
  const channelId = useMemo(() => `feishu:${projectId}`, [projectId])

  const load = useCallback(async () => {
    setError(null)
    try {
      const [channelRes, bindingsRes, auditRes] = await Promise.all([
        fetch(`/api/im/channels?projectId=${encodeURIComponent(projectId)}`).then(r => r.json()),
        fetch(`/api/im/bindings?channelId=${encodeURIComponent(channelId)}&projectId=${encodeURIComponent(projectId)}`).then(r => r.json()),
        fetch(`/api/im/audit?channelId=${encodeURIComponent(channelId)}&projectId=${encodeURIComponent(projectId)}&limit=8`).then(r => r.json()).catch(() => ({ logs: [] })),
      ])
      const nextChannel = channelRes.channels?.[0] ?? { ...DEFAULT_CHANNEL, id: channelId }
      setChannel(nextChannel)
      setBindings(bindingsRes.bindings ?? [])
      setAuditLogs(auditRes.logs ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [projectId, channelId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    Promise.all([
      fetch('/api/config/provider').then(r => r.json()).catch(() => ({ active: 'anthropic', configs: [] })),
      fetch(`/api/projects/${projectId}/settings`).then(r => r.json()).catch(() => ({ settings: null })),
    ]).then(([providerData, settingsData]) => {
      const globalActive = providerData.active ?? 'anthropic'
      const projectOverride = settingsData.settings?.providerId ?? null
      const effectiveId: string = projectOverride ?? globalActive
      const nextProviderConfig = (providerData.configs as ProviderConfigBrief[] | undefined)?.find(c => c.id === effectiveId)
      setProviderConfig(nextProviderConfig)
      const logicalOptions = buildLogicalModelOptions(nextProviderConfig)
      setModelOptions([
        { id: '', label: '继承项目默认', detail: defaultModel || '使用项目 Chat 默认模型' },
        ...logicalOptions.map(option => ({
          id: option.id,
          label: option.label,
          detail: option.actualModel || '由全局 Settings 实时解析',
        })),
      ])
    })
  }, [projectId, defaultModel])

  useEffect(() => {
    setChannel(prev => ({
      ...prev,
      defaultModel: normalizeChannelModel(prev.defaultModel, providerConfig),
    }))
  }, [providerConfig])

  const patchChannel = (patch: Partial<ImChannel>) => {
    setChannel(prev => ({ ...prev, ...patch }))
    setMessage(null)
  }

  const patchCredentials = (patch: Partial<ImChannel['credentials']>) => {
    setChannel(prev => ({ ...prev, credentials: { ...prev.credentials, ...patch } }))
    setMessage(null)
  }

  const save = async (): Promise<boolean> => {
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`/api/im/channels/${encodeURIComponent(channel.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(channel),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '保存失败')
      setChannel(data.channel)
      setMessage('已保存')
      setTimeout(() => setMessage(null), 2000)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
      return false
    } finally {
      setSaving(false)
    }
  }

  const connect = async (action: 'connect' | 'disconnect') => {
    setConnecting(true)
    setError(null)
    setMessage(null)
    try {
      if (action === 'connect') {
        const saved = await save()
        if (!saved) return
      }
      const res = await fetch(`/api/im/channels/${encodeURIComponent(channel.id)}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '连接操作失败')
      await load()
      setMessage(action === 'connect' ? '连接已启动' : '已断开')
      setTimeout(() => setMessage(null), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : '连接操作失败')
      await load()
    } finally {
      setConnecting(false)
    }
  }

  const deleteBinding = async (id: string) => {
    await fetch(`/api/im/bindings/${id}`, { method: 'DELETE' })
    await load()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 size={20} className="animate-spin" style={{ color: 'var(--color-accent-primary)' }} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {error && (
        <Notice tone="danger" text={error} />
      )}
      {message && (
        <Notice tone="ok" text={message} />
      )}

      <section style={panelStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={iconBadgeStyle}><Send size={16} /></span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--color-text-primary)' }}>Feishu</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                为项目「{projectName}」配置专属飞书 Bot。
              </div>
            </div>
          </div>
          <StatusPill status={channel.status} connected={channel.connected} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="App ID">
            <input
              value={channel.credentials.app_id || ''}
              onChange={e => patchCredentials({ app_id: e.target.value })}
              placeholder="cli_xxx"
              style={inputStyle}
            />
          </Field>
          <Field label="App Secret">
            <div style={{ position: 'relative' }}>
              <input
                type={showSecret ? 'text' : 'password'}
                value={channel.credentials.app_secret || ''}
                onChange={e => patchCredentials({ app_secret: e.target.value })}
                placeholder="请输入 App Secret"
                style={{ ...inputStyle, paddingRight: 66 }}
              />
              <button
                onClick={() => setShowSecret(v => !v)}
                style={inlineButtonStyle}
              >
                {showSecret ? '隐藏' : '显示'}
              </button>
            </div>
          </Field>
          <Field label="平台">
            <select
              value={channel.credentials.platform || 'feishu'}
              onChange={e => patchCredentials({ platform: e.target.value as 'feishu' | 'lark' })}
              style={inputStyle}
            >
              <option value="feishu">Feishu</option>
              <option value="lark">Lark</option>
            </select>
          </Field>
          <Field label="项目">
            <input value={projectName} readOnly style={{ ...inputStyle, color: 'var(--color-text-muted)' }} />
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="默认模型">
            <select
              value={channel.defaultModel}
              onChange={e => patchChannel({ defaultModel: e.target.value })}
              style={inputStyle}
            >
              {(modelOptions.some(option => option.id === channel.defaultModel)
                ? modelOptions
                : [...modelOptions, { id: channel.defaultModel, label: channel.defaultModel, detail: '当前配置中的自定义模型' }]
              ).map(option => (
                <option key={option.id || 'inherit'} value={option.id}>
                  {option.detail ? `${option.label} - ${option.detail}` : option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="权限模式">
            <select
              value={channel.permissionMode}
              onChange={e => patchChannel({ permissionMode: e.target.value as PermissionMode })}
              style={inputStyle}
            >
              <option value="confirm">飞书内确认</option>
              <option value="read-only">只读</option>
              <option value="full">完全访问</option>
            </select>
          </Field>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={save} disabled={saving || connecting} style={primaryButtonStyle}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            保存
          </button>
          {channel.connected ? (
            <button onClick={() => connect('disconnect')} disabled={connecting} style={secondaryButtonStyle}>
              {connecting ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
              断开连接
            </button>
          ) : (
            <button onClick={() => connect('connect')} disabled={connecting} style={secondaryButtonStyle}>
              {connecting ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />}
              连接
            </button>
          )}
          <button onClick={load} style={ghostButtonStyle}>
            <RefreshCcw size={14} />
            刷新
          </button>
        </div>

        {channel.lastError && (
          <div style={{ fontSize: 12, color: 'var(--color-accent-danger)', lineHeight: 1.5 }}>
            {channel.lastError}
          </div>
        )}
      </section>

      <section style={panelStyle}>
        <div style={sectionTitleStyle}>消息策略</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Field label="私聊策略">
            <select value={channel.dmPolicy} onChange={e => patchChannel({ dmPolicy: e.target.value as DmPolicy })} style={inputStyle}>
              <option value="open">允许所有私聊</option>
              <option value="allowlist">仅白名单</option>
              <option value="disabled">禁用私聊</option>
            </select>
          </Field>
          <Field label="群聊策略">
            <select value={channel.groupPolicy} onChange={e => patchChannel({ groupPolicy: e.target.value as GroupPolicy })} style={inputStyle}>
              <option value="mention">需要 @Bot</option>
              <option value="open">允许所有群消息</option>
              <option value="allowlist">仅白名单群</option>
              <option value="disabled">禁用群聊</option>
            </select>
          </Field>
          <Field label="触发方式">
            <select value={channel.triggerMode} onChange={e => patchChannel({ triggerMode: e.target.value as TriggerMode })} style={inputStyle}>
              <option value="mention">仅 @Bot 时触发</option>
              <option value="all">所有消息触发</option>
            </select>
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="发送者白名单">
            <textarea
              value={channel.senderWhitelist.join('\n')}
              onChange={e => patchChannel({ senderWhitelist: lines(e.target.value) })}
              placeholder="open_id，每行一个"
              style={textareaStyle}
            />
          </Field>
          <Field label="群聊白名单">
            <textarea
              value={channel.groupWhitelist.join('\n')}
              onChange={e => patchChannel({ groupWhitelist: lines(e.target.value) })}
              placeholder="chat_id，每行一个"
              style={textareaStyle}
            />
          </Field>
        </div>
      </section>

      <section style={panelStyle}>
        <button onClick={() => setGuideOpen(v => !v)} style={disclosureStyle}>
          {guideOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          飞书配置指南
        </button>
        {guideOpen && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.7 }}>
            <div>1. 在飞书开放平台创建自建应用，并复制 App ID / App Secret。</div>
            <div>2. 开启机器人能力和事件订阅。</div>
            <div>3. 添加事件：im.message.receive_v1。</div>
            <div>4. 将应用安装到目标组织或测试群，然后回到这里连接。</div>
          </div>
        )}
      </section>

      <section style={panelStyle}>
        <div style={sectionTitleStyle}>会话绑定</div>
        {bindings.length === 0 ? (
          <EmptyText text="还没有绑定飞书会话。第一条被接收的消息会自动创建绑定。" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {bindings.map(binding => (
              <div key={binding.id} style={rowStyle}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--color-text-primary)', fontWeight: 600 }}>
                    {binding.chatName || binding.chatId}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {binding.projectName} / {binding.sessionTitle || binding.sessionId}
                  </div>
                </div>
                <button onClick={() => deleteBinding(binding.id)} title="解除绑定" style={iconButtonStyle}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={panelStyle}>
        <div style={sectionTitleStyle}>最近活动</div>
        {auditLogs.length === 0 ? (
          <EmptyText text="暂无活动记录。" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {auditLogs.map(log => (
              <div key={log.id} style={rowStyle}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--color-text-primary)', fontWeight: 600 }}>{formatAuditAction(log.action)}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{log.chatId || '-'} · {formatDate(log.createdAt)}</div>
                </div>
                <span style={{ fontSize: 11, color: log.status === 'error' ? 'var(--color-accent-danger)' : 'var(--color-text-muted)' }}>
                  {formatAuditStatus(log.status)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <span style={{ fontSize: 11, letterSpacing: '0.04em', color: 'var(--color-text-muted)' }}>{label}</span>
      {children}
    </label>
  )
}

function StatusPill({ status, connected }: { status: ChannelStatus; connected: boolean }) {
  const ok = connected || status === 'connected'
  const bad = status === 'error'
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 26,
      padding: '0 10px',
      borderRadius: 999,
      fontSize: 12,
      color: ok ? 'var(--color-accent-success)' : bad ? 'var(--color-accent-danger)' : 'var(--color-text-muted)',
      background: ok ? 'rgba(34,197,94,0.08)' : bad ? 'rgba(232,90,79,0.08)' : 'var(--color-bg-surface-high)',
      border: ok ? '1px solid rgba(34,197,94,0.25)' : bad ? '1px solid rgba(232,90,79,0.25)' : '1px solid var(--color-border-subtle)',
    }}>
      {ok ? <CheckCircle size={13} /> : bad ? <XCircle size={13} /> : <Plug size={13} />}
      {statusLabel[status]}
    </span>
  )
}

function Notice({ tone, text }: { tone: 'ok' | 'danger'; text: string }) {
  return (
    <div style={{
      fontSize: 12,
      padding: '8px 12px',
      borderRadius: 8,
      color: tone === 'ok' ? 'var(--color-accent-success)' : 'var(--color-accent-danger)',
      background: tone === 'ok' ? 'rgba(34,197,94,0.08)' : 'rgba(232,90,79,0.08)',
      border: tone === 'ok' ? '1px solid rgba(34,197,94,0.2)' : '1px solid rgba(232,90,79,0.2)',
    }}>
      {text}
    </div>
  )
}

function EmptyText({ text }: { text: string }) {
  return <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '8px 0' }}>{text}</div>
}

function lines(value: string): string[] {
  return [...new Set(value.split(/\r?\n|,/).map(item => item.trim()).filter(Boolean))]
}

function formatDate(value: string) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function formatAuditAction(value: string) {
  return auditActionLabel[value] ?? value
}

function formatAuditStatus(value: string) {
  return auditStatusLabel[value] ?? value
}

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  padding: 16,
  borderRadius: 8,
  background: 'var(--color-bg-surface)',
  border: '1px solid var(--color-border-subtle)',
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 650,
  color: 'var(--color-text-primary)',
}

const iconBadgeStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--color-accent-primary)',
  background: 'rgba(99,102,241,0.1)',
  border: '1px solid rgba(99,102,241,0.18)',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 34,
  fontSize: 13,
  borderRadius: 7,
  padding: '0 10px',
  outline: 'none',
  boxSizing: 'border-box',
  color: 'var(--color-text-primary)',
  background: 'var(--color-bg-input)',
  border: '1px solid var(--color-border-strong)',
}

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  height: 72,
  padding: '8px 10px',
  resize: 'vertical',
  lineHeight: 1.5,
}

const primaryButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  height: 32,
  padding: '0 12px',
  borderRadius: 7,
  border: '1px solid var(--color-accent-primary)',
  color: 'white',
  background: 'var(--color-accent-primary)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
}

const secondaryButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  color: 'var(--color-accent-primary)',
  background: 'rgba(99,102,241,0.08)',
}

const ghostButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  color: 'var(--color-text-secondary)',
  background: 'transparent',
  border: '1px solid var(--color-border-subtle)',
}

const inlineButtonStyle: React.CSSProperties = {
  position: 'absolute',
  right: 6,
  top: 5,
  height: 24,
  padding: '0 8px',
  borderRadius: 6,
  border: '1px solid var(--color-border-subtle)',
  background: 'var(--color-bg-surface-high)',
  color: 'var(--color-text-muted)',
  fontSize: 11,
  cursor: 'pointer',
}

const disclosureStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: 'var(--color-text-primary)',
  fontSize: 13,
  fontWeight: 650,
  cursor: 'pointer',
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '9px 10px',
  borderRadius: 7,
  background: 'var(--color-bg-surface-high)',
  border: '1px solid var(--color-border-subtle)',
}

const iconButtonStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 7,
  border: '1px solid rgba(232,90,79,0.25)',
  background: 'rgba(232,90,79,0.06)',
  color: 'var(--color-accent-danger)',
  cursor: 'pointer',
  flexShrink: 0,
}
