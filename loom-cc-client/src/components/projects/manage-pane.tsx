'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ElementType, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Bot, Check, Circle, ExternalLink, Loader2,
  Plug, Plus, Save, Search, Trash2, Wrench, Zap,
} from 'lucide-react'

type ManagePanelId = 'subagents' | 'skills' | 'mcp'

interface ManageNavItem {
  id: ManagePanelId
  label: string
  Icon: ElementType
}

interface ProjectManagePaneProps {
  projectId: string
  workspacePath: string
}

interface ProjectAgent {
  id: string
  filename: string
  name: string
  description: string
  model: string
  enabled: boolean
  tools: string[]
  disallowedTools: string[]
  skills: string[]
  instructions: string
  updatedAt: string | null
}

interface SkillSummary {
  name: string
  description: string
  source: 'builtin' | 'project' | 'global'
}

interface McpSummary {
  name: string
  scope: 'local' | 'project' | 'user'
  overriddenBy?: 'local' | 'project' | 'user'
  config: { type?: string; command?: string; args?: string[]; url?: string }
}

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

type AgentModelOption = {
  id: string
  label: string
  detail?: string
}

const NAV_ITEMS: ManageNavItem[] = [
  { id: 'subagents', label: 'Subagents', Icon: Bot },
  { id: 'skills', label: 'Skills', Icon: Zap },
  { id: 'mcp', label: 'MCP', Icon: Plug },
]

const LOGICAL_MODELS: WorkbenchModelEntry[] = [
  { id: 'claude-haiku-4-5', label: '快速', tier: 'fast' },
  { id: 'claude-sonnet-4-6', label: '主力', tier: 'main' },
  { id: 'claude-opus-4-6', label: '强力', tier: 'heavy' },
]

const TOOL_OPTIONS = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch']

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '7px 10px',
  borderRadius: 7,
  border: '1px solid var(--color-border-subtle)',
  background: 'var(--color-bg-surface)',
  color: 'var(--color-text-primary)',
  fontSize: 13,
  outline: 'none',
}

const labelStyle: CSSProperties = {
  display: 'block',
  marginBottom: 5,
  fontSize: 11,
  fontWeight: 650,
  color: 'var(--color-text-muted)',
}

function sourceLabel(source: SkillSummary['source']) {
  if (source === 'project') return '项目'
  if (source === 'global') return '全局'
  return '内置'
}

function slugifyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'agent'
}

function normalizeFilename(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`
}

function describeMcp(server: McpSummary): string {
  if (!server.config.type || server.config.type === 'stdio') {
    return [server.config.command, ...(server.config.args || [])].filter(Boolean).join(' ')
  }
  return server.config.url || ''
}

function mcpScopeLabel(scope: McpSummary['scope']): string {
  if (scope === 'local') return 'Local'
  if (scope === 'project') return 'Project'
  return 'User'
}

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

function normalizeAgentModel(modelId: string | null | undefined, config?: ProviderConfigBrief): string {
  const model = modelId?.trim()
  if (!model || model === 'inherit') return 'inherit'
  if (LOGICAL_MODELS.some(option => option.id === model)) return model
  if (config?.fastModel && model === config.fastModel) return 'claude-haiku-4-5'
  if (config?.mainModel && model === config.mainModel) return 'claude-sonnet-4-6'
  if (config?.heavyModel && model === config.heavyModel) return 'claude-opus-4-6'
  if (model.toLowerCase().includes('opus')) return 'claude-opus-4-6'
  if (model.toLowerCase().includes('haiku')) return 'claude-haiku-4-5'
  if (model.toLowerCase().includes('sonnet')) return 'claude-sonnet-4-6'
  return model
}

function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const left = [...a].sort()
  const right = [...b].sort()
  return left.every((value, index) => value === right[index])
}

export function ProjectManagePane({ projectId, workspacePath }: ProjectManagePaneProps) {
  const [activePanel, setActivePanel] = useState<ManagePanelId>('subagents')

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>
      <aside style={{
        width: 212,
        flexShrink: 0,
        borderRight: '1px solid var(--shell-panel-border)',
        padding: '14px 10px',
        overflowY: 'auto',
        background: 'var(--shell-panel-bg-muted)',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px 12px',
          color: 'var(--color-text-secondary)',
        }}>
          <Wrench size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 700 }}>项目资源</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {NAV_ITEMS.map(item => {
            const isActive = activePanel === item.id
            return (
              <div key={item.id}>
                <button
                  onClick={() => setActivePanel(item.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '8px 9px',
                    borderRadius: 8,
                    border: isActive ? '1px solid var(--theme-border-strong)' : '1px solid transparent',
                    background: isActive ? 'var(--theme-bg-active)' : 'transparent',
                    color: isActive ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: isActive ? 650 : 500,
                    textAlign: 'left',
                  }}
                >
                  <item.Icon size={14} style={{ flexShrink: 0 }} />
                  <span>{item.label}</span>
                </button>
              </div>
            )
          })}
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        {activePanel === 'subagents' && <SubagentsPanel projectId={projectId} workspacePath={workspacePath} />}
        {activePanel === 'skills' && <SkillsPanel workspacePath={workspacePath} />}
        {activePanel === 'mcp' && <McpPanel workspacePath={workspacePath} />}
      </main>
    </div>
  )
}

function SubagentsPanel({ projectId, workspacePath }: ProjectManagePaneProps) {
  const [agents, setAgents] = useState<ProjectAgent[]>([])
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const loadAgents = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/agents`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '加载失败')
      const nextAgents = data.agents ?? []
      setAgents(nextAgents)
      setSelectedFilename(prev => {
        if (prev && nextAgents.some((agent: ProjectAgent) => agent.filename === prev)) return prev
        return nextAgents[0]?.filename ?? null
      })
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
      setAgents([])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { loadAgents() }, [loadAgents])

  const selectedAgent = useMemo(
    () => agents.find(agent => agent.filename === selectedFilename) ?? null,
    [agents, selectedFilename],
  )

  const filteredAgents = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return agents
    return agents.filter(agent =>
      agent.name.toLowerCase().includes(q) ||
      agent.description.toLowerCase().includes(q) ||
      agent.filename.toLowerCase().includes(q)
    )
  }, [agents, search])

  const createAgent = async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Agent',
          filename: 'new-agent.md',
          description: '',
          model: 'inherit',
          enabled: true,
          instructions: 'You are New Agent. Complete delegated work clearly and concisely.',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '创建失败')
      await loadAgents()
      setSelectedFilename(data.agent.filename)
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    }
  }

  const deleteAgent = async (agent: ProjectAgent) => {
    if (!window.confirm(`删除 ${agent.name}？`)) return
    try {
      const res = await fetch(`/api/projects/${projectId}/agents/${encodeURIComponent(agent.filename)}`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '删除失败')
      await loadAgents()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <section style={{
        width: 292,
        flexShrink: 0,
        borderRight: '1px solid var(--shell-panel-border)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--shell-panel-bg)',
      }}>
        <div style={{
          height: 77,
          boxSizing: 'border-box',
          padding: '16px',
          borderBottom: '1px solid var(--shell-panel-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 750, color: 'var(--color-text-primary)' }}>Subagents</div>
            <div
              title={`${workspacePath}/.claude/agents`}
              style={{ marginTop: 3, fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {workspacePath}/.claude/agents
            </div>
          </div>
          <button
            type="button"
            onClick={createAgent}
            title="新建 Agent"
            style={{
              width: 30,
              height: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 7,
              border: '1px solid var(--color-border-subtle)',
              background: 'var(--color-bg-surface)',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <Plus size={14} />
          </button>
        </div>

        <div style={{ padding: 10, borderBottom: '1px solid var(--shell-panel-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, ...inputStyle, padding: '6px 9px' }}>
            <Search size={13} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索 Agent"
              style={{
                flex: 1,
                minWidth: 0,
                border: 'none',
                background: 'transparent',
                color: 'var(--color-text-primary)',
                outline: 'none',
                fontSize: 12,
              }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 28 }}>
              <Loader2 size={18} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
            </div>
          ) : filteredAgents.length === 0 ? (
            <div style={{ padding: 18, textAlign: 'center', fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
              暂无项目 Subagent
            </div>
          ) : (
            filteredAgents.map(agent => {
              const isActive = selectedFilename === agent.filename
              return (
                <button
                  key={agent.filename}
                  onClick={() => setSelectedFilename(agent.filename)}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 9,
                    width: '100%',
                    padding: '10px 9px',
                    borderRadius: 8,
                    border: isActive ? '1px solid var(--theme-border-strong)' : '1px solid transparent',
                    background: isActive ? 'var(--theme-bg-active)' : 'transparent',
                    color: 'var(--color-text-primary)',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <Bot size={14} style={{
                    marginTop: 1,
                    color: isActive ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
                    flexShrink: 0,
                  }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.name}</span>
                      {!agent.enabled && <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>停用</span>}
                    </span>
                    <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {agent.description || agent.filename}
                    </span>
                  </span>
                </button>
              )
            })
          )}
        </div>
      </section>

      <section style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
        {error && (
          <div style={{
            margin: '16px 20px 0',
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid rgba(232,90,79,0.22)',
            background: 'rgba(232,90,79,0.08)',
            color: 'var(--color-accent-danger)',
            fontSize: 12,
          }}>
            {error}
          </div>
        )}

        {selectedAgent ? (
          <AgentEditor
            key={selectedAgent.filename}
            projectId={projectId}
            workspacePath={workspacePath}
            agent={selectedAgent}
            onSaved={agent => {
              setAgents(prev => prev.map(item => item.filename === selectedAgent.filename ? agent : item).sort((a, b) => a.name.localeCompare(b.name)))
              setSelectedFilename(agent.filename)
            }}
            onDeleted={() => deleteAgent(selectedAgent)}
          />
        ) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
            选择或新建一个 Subagent
          </div>
        )}
      </section>
    </div>
  )
}

function AgentEditor({
  projectId,
  workspacePath,
  agent,
  onSaved,
  onDeleted,
}: {
  projectId: string
  workspacePath: string
  agent: ProjectAgent
  onSaved: (agent: ProjectAgent) => void
  onDeleted: () => void
}) {
  const [name, setName] = useState(agent.name)
  const [filename, setFilename] = useState(agent.filename)
  const [description, setDescription] = useState(agent.description)
  const [model, setModel] = useState(() => normalizeAgentModel(agent.model))
  const [enabled, setEnabled] = useState(agent.enabled)
  const [instructions, setInstructions] = useState(agent.instructions)
  const [skillNames, setSkillNames] = useState<string[]>(agent.skills)
  const [providerConfig, setProviderConfig] = useState<ProviderConfigBrief | undefined>(undefined)
  const [disallowedTools, setDisallowedTools] = useState(() => new Set(agent.disallowedTools))
  const [modelOptions, setModelOptions] = useState<AgentModelOption[]>([
    { id: 'inherit', label: '继承项目默认' },
    ...LOGICAL_MODELS.map(model => ({ id: model.id, label: model.label })),
  ])
  const [showSkillDrawer, setShowSkillDrawer] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const dirty =
    name !== agent.name ||
    filename !== agent.filename ||
    description !== agent.description ||
    model !== normalizeAgentModel(agent.model, providerConfig) ||
    enabled !== agent.enabled ||
    instructions !== agent.instructions ||
    !sameStringSet(skillNames, agent.skills) ||
    !sameStringSet(Array.from(disallowedTools), agent.disallowedTools)

  useEffect(() => {
    setName(agent.name)
    setFilename(agent.filename)
    setDescription(agent.description)
    setModel(normalizeAgentModel(agent.model, providerConfig))
    setEnabled(agent.enabled)
    setInstructions(agent.instructions)
    setSkillNames(agent.skills)
    setDisallowedTools(new Set(agent.disallowedTools))
    setError(null)
    setSaved(false)
  }, [agent])

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
      setModel(prev => normalizeAgentModel(prev === 'inherit' ? agent.model : prev, nextProviderConfig))
      const logicalOptions = buildLogicalModelOptions(nextProviderConfig)
      setModelOptions([
        { id: 'inherit', label: '继承项目默认', detail: '使用项目 Chat 当前默认模型' },
        ...logicalOptions.map(option => ({
          id: option.id,
          label: option.label,
          detail: option.actualModel || '由全局 Settings 实时解析',
        })),
      ])
    })
  }, [projectId])

  const toggleTool = (tool: string) => {
    setDisallowedTools(prev => {
      const next = new Set(prev)
      if (next.has(tool)) next.delete(tool)
      else next.add(tool)
      return next
    })
  }

  const save = async () => {
    const nextFilename = normalizeFilename(filename || slugifyName(name))
    if (!name.trim()) { setError('名称不能为空'); return }
    if (!nextFilename) { setError('文件名不能为空'); return }

    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch(`/api/projects/${projectId}/agents/${encodeURIComponent(agent.filename)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: nextFilename,
          name: name.trim(),
          description: description.trim(),
          model: model.trim() || 'inherit',
          enabled,
          skills: skillNames,
          disallowedTools: Array.from(disallowedTools),
          instructions,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '保存失败')
      onSaved(data.agent)
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const selectedModelInOptions = modelOptions.some(option => option.id === model)
  const fullModelOptions = selectedModelInOptions
    ? modelOptions
    : [...modelOptions, { id: model, label: model, detail: '当前文件中的自定义模型' }]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{
        height: 77,
        boxSizing: 'border-box',
        flexShrink: 0,
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        borderBottom: '1px solid var(--color-border-subtle)',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Bot size={17} style={{ color: 'var(--color-accent-primary)' }} />
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 750, color: 'var(--color-text-primary)' }}>{agent.name}</h2>
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>
            .claude/agents/{agent.filename}
          </div>
        </div>
        {dirty && <span style={{ fontSize: 11, color: 'var(--color-accent-primary)' }}>未保存</span>}
        {saved && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-accent-success)' }}><Check size={12} /> 已保存</span>}
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 14px',
            borderRadius: 7,
            border: 'none',
            background: dirty ? 'var(--color-accent-primary)' : 'var(--color-bg-surface-highest)',
            color: dirty ? '#fff' : 'var(--color-text-muted)',
            cursor: saving || !dirty ? 'default' : 'pointer',
            fontSize: 12,
            fontWeight: 650,
          }}
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          保存
        </button>
        <button
          type="button"
          onClick={onDeleted}
          title="删除 Agent"
          style={{
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 7,
            border: '1px solid rgba(232,90,79,0.25)',
            background: 'rgba(232,90,79,0.06)',
            color: 'var(--color-accent-danger)',
            cursor: 'pointer',
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: 24, maxWidth: 920 }}>
          {error && (
            <div style={{
              marginBottom: 14,
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid rgba(232,90,79,0.22)',
              background: 'rgba(232,90,79,0.08)',
              color: 'var(--color-accent-danger)',
              fontSize: 12,
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <Field label="名称">
              <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} placeholder="code-reviewer" />
            </Field>
            <Field label="文件名 / 运行 ID">
              <input value={filename} onChange={e => setFilename(e.target.value)} style={inputStyle} placeholder={`${slugifyName(name)}.md`} />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <Field label="模型">
              <select value={model} onChange={e => setModel(e.target.value)} style={inputStyle}>
                {fullModelOptions.map(option => (
                  <option key={option.id} value={option.id}>
                    {option.detail ? `${option.label} - ${option.detail}` : option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="说明">
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                style={{ ...inputStyle, minHeight: 76, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }}
                placeholder="这个 Agent 擅长什么，支持 Markdown 源码"
              />
            </Field>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: 'var(--color-text-secondary)' }}>
              <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} style={{ accentColor: 'var(--color-accent-primary)' }} />
              启用这个 Subagent
            </label>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>绑定 Skills</label>
              <button
                type="button"
                onClick={() => setShowSkillDrawer(true)}
                style={{
                  fontSize: 11,
                  padding: '3px 9px',
                  borderRadius: 5,
                  border: '1px solid var(--color-border-subtle)',
                  background: 'transparent',
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                }}
              >
                选择 Skills
              </button>
            </div>
            {skillNames.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {skillNames.map(skill => (
                  <span
                    key={skill}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      fontSize: 11,
                      padding: '3px 7px',
                      borderRadius: 5,
                      background: 'rgba(245,158,11,0.12)',
                      color: 'var(--color-accent-primary)',
                      border: '1px solid rgba(245,158,11,0.28)',
                    }}
                  >
                    {skill}
                    <button
                      type="button"
                      onClick={() => setSkillNames(prev => prev.filter(item => item !== skill))}
                      aria-label={`移除 ${skill}`}
                      style={{
                        padding: 0,
                        border: 'none',
                        background: 'transparent',
                        color: 'inherit',
                        cursor: 'pointer',
                        fontSize: 12,
                        lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <div style={{
                padding: '10px 12px',
                borderRadius: 7,
                border: '1px dashed var(--color-border-subtle)',
                color: 'var(--color-text-muted)',
                fontSize: 12,
              }}>
                未绑定 Skill
              </div>
            )}
          </div>

          <div style={{ marginTop: 16 }}>
            <label style={labelStyle}>工具权限</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {TOOL_OPTIONS.map(tool => {
                const allowed = !disallowedTools.has(tool)
                return (
                  <button
                    key={tool}
                    type="button"
                    onClick={() => toggleTool(tool)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '5px 9px',
                      borderRadius: 6,
                      border: allowed ? '1px solid rgba(74,163,95,0.35)' : '1px solid var(--color-border-subtle)',
                      background: allowed ? 'rgba(74,163,95,0.08)' : 'var(--color-bg-surface)',
                      color: allowed ? 'var(--color-accent-success)' : 'var(--color-text-muted)',
                      cursor: 'pointer',
                      fontSize: 11,
                      fontWeight: 650,
                    }}
                  >
                    {allowed ? <Check size={11} /> : <Circle size={10} />}
                    {tool}
                  </button>
                )
              })}
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <Field label="Instructions">
              <textarea
                value={instructions}
                onChange={e => setInstructions(e.target.value)}
                style={{
                  ...inputStyle,
                  minHeight: 340,
                  resize: 'vertical',
                  lineHeight: 1.55,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                }}
                placeholder="写入这个 Subagent 的系统提示，使用 Markdown 源码编辑..."
              />
            </Field>
          </div>
        </div>
      </div>

      {showSkillDrawer && (
        <SkillPickerDrawer
          workspacePath={workspacePath}
          selectedNames={skillNames}
          onApply={setSkillNames}
          onClose={() => setShowSkillDrawer(false)}
        />
      )}
    </div>
  )
}

function SkillPickerDrawer({
  workspacePath,
  selectedNames,
  onApply,
  onClose,
}: {
  workspacePath: string
  selectedNames: string[]
  onApply: (names: string[]) => void
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [draftNames, setDraftNames] = useState<string[]>(selectedNames)
  const [loading, setLoading] = useState(true)

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => { setDraftNames(selectedNames) }, [selectedNames])

  useEffect(() => {
    fetch(`/api/config/skills?workspacePath=${encodeURIComponent(workspacePath)}`)
      .then(r => r.json())
      .then(data => setSkills(data.skills ?? []))
      .catch(() => setSkills([]))
      .finally(() => setLoading(false))
  }, [workspacePath])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const selected = new Set(draftNames)
  const toggleSkill = (name: string) => {
    setDraftNames(prev => prev.includes(name) ? prev.filter(item => item !== name) : [...prev, name])
  }

  if (!mounted) return null

  return createPortal(
    <div
      onPointerDown={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.12)' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onPointerDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: 440,
          background: 'var(--color-bg-surface)',
          borderLeft: '1px solid var(--color-border-subtle)',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.3)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{
          height: 52,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          padding: '0 20px',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)' }}>绑定 Skills</span>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '3px 10px',
              borderRadius: 5,
              border: '1px solid var(--color-border-subtle)',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 12,
              color: 'var(--color-text-muted)',
            }}
          >
            关闭
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}>
              <Loader2 size={18} className="animate-spin" style={{ color: 'var(--color-text-disabled)' }} />
            </div>
          ) : skills.length === 0 ? (
            <div style={{ padding: 24, fontSize: 12, color: 'var(--color-text-disabled)', textAlign: 'center' }}>
              暂无可用 Skill
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: 150 }} />
                <col style={{ width: 58 }} />
                <col />
              </colgroup>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                  {(['名称', '来源', '说明'] as const).map(header => (
                    <th key={header} style={{
                      padding: '8px 16px',
                      textAlign: 'left',
                      fontSize: 10,
                      fontWeight: 700,
                      color: 'var(--color-text-disabled)',
                      background: 'var(--color-bg-nav)',
                    }}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {skills.map(skill => (
                  <tr
                    key={skill.name}
                    onClick={() => toggleSkill(skill.name)}
                    style={{ cursor: 'pointer', borderBottom: '1px solid var(--color-border-subtle)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-surface-high)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '10px 12px 10px 16px', fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, maxWidth: '100%' }}>
                        <input
                          type="checkbox"
                          checked={selected.has(skill.name)}
                          readOnly
                          style={{ flexShrink: 0, pointerEvents: 'none', accentColor: 'var(--color-accent-primary)' }}
                        />
                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{skill.name}</span>
                      </span>
                    </td>
                    <td style={{ padding: '10px 8px', whiteSpace: 'nowrap', fontSize: 11, color: 'var(--color-text-muted)' }}>
                      {sourceLabel(skill.source)}
                    </td>
                    <td style={{ padding: '10px 16px 10px 8px', fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                      {skill.description || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{
          height: 54,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          borderTop: '1px solid var(--color-border-subtle)',
        }}>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            已选择 {draftNames.length} 个 Skill
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid var(--color-border-subtle)',
                background: 'transparent',
                color: 'var(--color-text-secondary)',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => { onApply(draftNames); onClose() }}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: 'none',
                background: 'var(--color-accent-primary)',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              完成
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function SkillsPanel({ workspacePath }: { workspacePath: string }) {
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/config/skills?summary=1&workspacePath=${encodeURIComponent(workspacePath)}`)
      .then(async res => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || '加载失败')
        setSkills(data.skills ?? [])
        setError(null)
      })
      .catch(err => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false))
  }, [workspacePath])

  const counts = useMemo(() => ({
    project: skills.filter(skill => skill.source === 'project').length,
    global: skills.filter(skill => skill.source === 'global').length,
    builtin: skills.filter(skill => skill.source === 'builtin').length,
  }), [skills])

  return (
    <PlaceholderPanel
      title="项目 Skills"
      icon={<Zap size={17} />}
      description="这里显示当前项目 Chat、Schedule 可以继承和调用的 Skills。完整安装和创建流程仍在顶级 Skills 页面。"
      actionHref="/skills"
      actionLabel="打开 Skills"
    >
      {loading ? (
        <Loader2 size={18} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
      ) : error ? (
        <div style={{ fontSize: 12, color: 'var(--color-accent-danger)' }}>{error}</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <Stat label="项目" value={counts.project} />
            <Stat label="全局" value={counts.global} />
            <Stat label="内置" value={counts.builtin} />
          </div>
          <ResourceTable
            headers={['名称', '来源', '说明']}
            rows={skills.map(skill => [
              skill.name,
              sourceLabel(skill.source),
              skill.description || '—',
            ])}
            empty="暂无可用 Skill"
          />
        </>
      )}
    </PlaceholderPanel>
  )
}

function McpPanel({ workspacePath }: { workspacePath: string }) {
  const [servers, setServers] = useState<McpSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/config/mcp?workspacePath=${encodeURIComponent(workspacePath)}`)
      .then(async res => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || '加载失败')
        setServers(data.servers ?? [])
        setError(null)
      })
      .catch(err => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false))
  }, [workspacePath])

  return (
    <PlaceholderPanel
      title="项目 MCP"
      icon={<Plug size={17} />}
      description="这里按 Claude Code 的 MCP scope 显示当前项目可见配置：local、project、user。"
      actionHref="/settings"
      actionLabel="打开 User MCP 设置"
    >
      {loading ? (
        <Loader2 size={18} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
      ) : error ? (
        <div style={{ fontSize: 12, color: 'var(--color-accent-danger)' }}>{error}</div>
      ) : (
        <ResourceTable
          headers={['名称', 'Scope', '传输', '地址 / 命令']}
          columnWidths={['180px', '78px', '72px', 'auto']}
          rows={servers.map(server => [
            server.name,
            server.overriddenBy ? `${mcpScopeLabel(server.scope)} → ${mcpScopeLabel(server.overriddenBy)}` : mcpScopeLabel(server.scope),
            (server.config.type || 'stdio').toUpperCase(),
            describeMcp(server) || '-',
          ])}
          empty="暂无 MCP Server"
        />
      )}
    </PlaceholderPanel>
  )
}

function PlaceholderPanel({
  title,
  icon,
  description,
  actionHref,
  actionLabel,
  children,
}: {
  title: string
  icon: ReactNode
  description: string
  actionHref: string
  actionLabel: string
  children: ReactNode
}) {
  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 24 }}>
      <div style={{ maxWidth: 880 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18, marginBottom: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, color: 'var(--color-accent-primary)' }}>
              {icon}
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 750, color: 'var(--color-text-primary)' }}>{title}</h2>
            </div>
            <p style={{ margin: 0, maxWidth: 620, fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.65 }}>
              {description}
            </p>
          </div>
          <a
            href={actionHref}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 11px',
              borderRadius: 7,
              border: '1px solid var(--color-border-subtle)',
              background: 'var(--color-bg-surface)',
              color: 'var(--color-text-secondary)',
              textDecoration: 'none',
              fontSize: 12,
              fontWeight: 650,
              flexShrink: 0,
            }}
          >
            <ExternalLink size={13} />
            {actionLabel}
          </a>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={labelStyle}>{label}</span>
      {children}
    </label>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      minWidth: 96,
      padding: '10px 12px',
      borderRadius: 8,
      border: '1px solid var(--color-border-subtle)',
      background: 'var(--color-bg-surface)',
    }}>
      <div style={{ fontSize: 18, fontWeight: 750, color: 'var(--color-text-primary)' }}>{value}</div>
      <div style={{ marginTop: 2, fontSize: 11, color: 'var(--color-text-muted)' }}>{label}</div>
    </div>
  )
}

function ResourceTable({
  headers,
  rows,
  empty,
  columnWidths,
}: {
  headers: string[]
  rows: string[][]
  empty: string
  columnWidths?: string[]
}) {
  if (rows.length === 0) {
    return (
      <div style={{
        padding: '34px 18px',
        borderRadius: 10,
        border: '1px solid var(--color-border-subtle)',
        background: 'var(--color-bg-surface)',
        textAlign: 'center',
        color: 'var(--color-text-muted)',
        fontSize: 12,
      }}>
        {empty}
      </div>
    )
  }

  return (
    <div style={{
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 10,
      background: 'var(--color-bg-surface)',
      overflow: 'hidden',
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        {columnWidths && (
          <colgroup>
            {headers.map((header, index) => (
              <col key={header} style={{ width: columnWidths[index] }} />
            ))}
          </colgroup>
        )}
        <thead>
          <tr style={{ background: 'var(--color-bg-nav)', borderBottom: '1px solid var(--color-border-subtle)' }}>
            {headers.map(header => (
              <th key={header} style={{
                padding: '9px 12px',
                textAlign: 'left',
                fontSize: 10,
                fontWeight: 750,
                color: 'var(--color-text-muted)',
              }}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} style={{ borderBottom: rowIndex === rows.length - 1 ? 'none' : '1px solid var(--color-border-subtle)' }}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} style={{
                  padding: '10px 12px',
                  fontSize: cellIndex === 0 ? 12 : 11,
                  fontWeight: cellIndex === 0 ? 700 : 500,
                  color: cellIndex === 0 ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
