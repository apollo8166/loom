'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Loader2, Server, Globe, Terminal } from 'lucide-react'
import type { McpServerConfig, McpTransport } from '@/modules/config/mcp-config'

interface McpServer {
  name: string
  config: McpServerConfig
}

const inputStyle: React.CSSProperties = {
  fontSize: 13, borderRadius: 7, padding: '7px 12px', outline: 'none',
  width: '100%', boxSizing: 'border-box',
  color: 'var(--color-text-primary)',
  background: 'var(--color-bg-input)',
  border: '1px solid var(--color-border-strong)',
}

const labelStyle: React.CSSProperties = {
  fontSize: 11, letterSpacing: '0.04em', color: 'var(--color-text-muted)',
}

export function McpSettings() {
  const [servers, setServers] = useState<McpServer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const loadServers = useCallback(async () => {
    try {
      const res = await fetch('/api/config/mcp')
      const data = await res.json()
      setServers(data.servers || [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadServers() }, [loadServers])

  const handleDelete = async (name: string) => {
    setDeleting(name)
    setError(null)
    try {
      const res = await fetch('/api/config/mcp', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '删除失败')
      }
      await loadServers()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setDeleting(null)
    }
  }

  const handleAdd = async (name: string, config: McpServerConfig) => {
    setError(null)
    try {
      const res = await fetch('/api/config/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, config }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '添加失败')
      }
      await loadServers()
      setShowForm(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败')
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0' }}>
        <Loader2 size={20} className="animate-spin" style={{ color: 'var(--color-accent-primary)' }} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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

      {/* Server List */}
      {servers.length === 0 ? (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
          padding: '32px 0', color: 'var(--color-text-muted)',
        }}>
          <Server size={24} />
          <p style={{ fontSize: 14 }}>暂无 MCP 服务器</p>
          <p style={{ fontSize: 12 }}>点击下方按钮添加第一个服务器</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {servers.map(server => (
            <McpServerRow
              key={server.name}
              server={server}
              onDelete={() => handleDelete(server.name)}
              isDeleting={deleting === server.name}
            />
          ))}
        </div>
      )}

      {/* Add Server */}
      {showForm ? (
        <AddServerForm
          onAdd={handleAdd}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <button
          onClick={() => setShowForm(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
            padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
            border: '1px solid var(--color-border-subtle)',
            background: 'transparent',
            color: 'var(--color-text-secondary)',
          }}
        >
          <Plus size={14} />
          添加服务器
        </button>
      )}
    </div>
  )
}

/* ── Server Row ───────────────────────────────────────────────────── */

function McpServerRow({
  server, onDelete, isDeleting,
}: {
  server: McpServer
  onDelete: () => void
  isDeleting: boolean
}) {
  const config = server.config
  const Icon = config.type === 'stdio' ? Terminal : Globe
  const address = config.type === 'stdio'
    ? config.command + (config.args?.length ? ' ' + config.args.join(' ') : '')
    : config.url

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 16px', borderRadius: 12,
      background: 'var(--color-bg-surface)',
      border: '1px solid var(--color-border-subtle)',
    }}>
      <Icon size={16} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>
          {server.name}
        </span>
        <span style={{
          fontSize: 11, color: 'var(--color-text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {config.type.toUpperCase()} - {address}
        </span>
      </div>
      <button
        onClick={onDelete}
        disabled={isDeleting}
        style={{
          padding: 6, borderRadius: 6, cursor: isDeleting ? 'not-allowed' : 'pointer', flexShrink: 0,
          background: 'transparent', border: 'none',
          color: 'var(--color-text-muted)',
          opacity: isDeleting ? 0.5 : 1,
        }}
        title="删除"
      >
        {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
      </button>
    </div>
  )
}

/* ── Add Server Form ──────────────────────────────────────────────── */

function AddServerForm({
  onAdd, onCancel,
}: {
  onAdd: (name: string, config: McpServerConfig) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<McpTransport>('stdio')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [url, setUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const handleSubmit = async () => {
    setFormError(null)
    if (!name.trim()) { setFormError('名称不能为空'); return }

    let config: McpServerConfig
    if (transport === 'stdio') {
      if (!command.trim()) { setFormError('命令不能为空'); return }
      const parsedArgs = args.trim() ? args.trim().split(/\s+/) : undefined
      config = { type: 'stdio', command: command.trim(), ...(parsedArgs ? { args: parsedArgs } : {}) }
    } else {
      if (!url.trim()) { setFormError('URL 不能为空'); return }
      config = { type: transport, url: url.trim() }
    }

    setSubmitting(true)
    try {
      await onAdd(name.trim(), config)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 14,
      padding: 16, borderRadius: 12,
      background: 'var(--color-bg-surface)',
      border: '1px solid var(--color-border-subtle)',
    }}>
      {formError && (
        <div style={{
          fontSize: 11, padding: '6px 10px', borderRadius: 6,
          color: 'var(--color-accent-danger)',
          background: 'rgba(232,90,79,0.08)',
        }}>
          {formError}
        </div>
      )}

      {/* Name */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={labelStyle}>名称</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="my-server"
          style={inputStyle}
        />
      </div>

      {/* Transport */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={labelStyle}>传输类型</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['stdio', 'sse', 'http'] as McpTransport[]).map(t => {
            const isActive = transport === t
            return (
              <button
                key={t}
                onClick={() => setTransport(t)}
                style={{
                  padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                  border: isActive
                    ? '1px solid rgba(99,102,241,0.45)'
                    : '1px solid var(--color-border-subtle)',
                  background: isActive ? 'rgba(99,102,241,0.1)' : 'transparent',
                  color: isActive ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
                }}
              >
                {t.toUpperCase()}
              </button>
            )
          })}
        </div>
      </div>

      {/* Stdio fields */}
      {transport === 'stdio' ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={labelStyle}>命令</label>
            <input
              type="text"
              value={command}
              onChange={e => setCommand(e.target.value)}
              placeholder="npx -y @modelcontextprotocol/server-example"
              style={inputStyle}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={labelStyle}>
              参数 <span style={{ opacity: 0.6 }}>(空格分隔，可选)</span>
            </label>
            <input
              type="text"
              value={args}
              onChange={e => setArgs(e.target.value)}
              placeholder="--port 3000"
              style={inputStyle}
            />
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={labelStyle}>URL</label>
          <input
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder={transport === 'sse' ? 'http://localhost:3001/sse' : 'http://localhost:3001/mcp'}
            style={inputStyle}
          />
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
            cursor: submitting ? 'not-allowed' : 'pointer',
            background: 'var(--color-accent-primary)',
            border: 'none', color: '#fff',
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting && <Loader2 size={12} className="animate-spin" />}
          {submitting ? '添加中...' : '添加'}
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
            background: 'transparent',
            border: '1px solid var(--color-border-subtle)',
            color: 'var(--color-text-muted)',
          }}
        >
          取消
        </button>
      </div>
    </div>
  )
}
