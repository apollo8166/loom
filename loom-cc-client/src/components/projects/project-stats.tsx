'use client'

import { useState, useEffect } from 'react'
import { Loader2, FolderOpen, MessageSquare } from 'lucide-react'

interface StatsData {
  sessionCount: number
  messageCount: number
  totalInput: number
  totalOutput: number
  byModel: { model: string; input: number; output: number }[]
}

function fmtN(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function tokenComparison(tok: number): string {
  if (tok === 0) return '还没有任何对话记录'
  if (tok < 10_000) return `约等于 ${Math.round(tok / 250)} 页 A4 纸`
  if (tok < 100_000) return `约等于 ${Math.round(tok / 50_000)} 本短篇小说`
  if (tok < 10_000_000) return `约等于 ${Math.round(tok / 300_000)} 本《哈利波特》`
  return `${Math.round(tok / 300_000).toLocaleString()} 本《哈利波特》`
}

function formatModelName(model: string): string {
  return model.replace('claude-', '').replace(/-(\d)/g, ' $1').replace(/-/g, ' ')
}

const MODEL_COLORS = ['var(--color-accent-primary)', '#A9793F', '#8A735C', '#B98D56', '#6F6256']

interface StatCardProps {
  label: string
  value: string
  sub?: string
}

function StatCard({ label, value, sub }: StatCardProps) {
  return (
    <div style={{
      background: 'var(--theme-bg-surface)',
      border: '1px solid var(--theme-border)',
      borderRadius: 10,
      padding: '14px 16px',
    }}>
      <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6, letterSpacing: '0.04em' }}>
        {label}
      </p>
      <p style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1 }}>
        {value}
      </p>
      {sub && (
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>{sub}</p>
      )}
    </div>
  )
}

interface ProjectStatsProps {
  projectId: string
  projectName: string
}

export function ProjectStats({ projectId, projectName }: ProjectStatsProps) {
  const [stats, setStats] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/projects/${projectId}/stats`)
      .then(r => r.json())
      .then(data => setStats(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId])

  const totalTokens = stats ? stats.totalInput + stats.totalOutput : 0
  const inputPct = totalTokens > 0 ? Math.round((stats?.totalInput ?? 0) / totalTokens * 100) : 0
  const outputPct = totalTokens > 0 ? 100 - inputPct : 0

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 24px',
      overflowY: 'auto',
    }}>
      <div style={{ width: '100%', maxWidth: 620 }}>
        {/* Project header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--theme-bg-active)',
            border: '1px solid var(--theme-border-strong)',
          }}>
            <FolderOpen size={20} style={{ color: 'var(--color-accent-primary)' }} />
          </div>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 2 }}>
              {projectName}
            </h2>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              当前项目 Token 使用量 · 点击左侧 "+ New Session" 开始对话
            </p>
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
            <Loader2 size={18} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
          </div>
        ) : stats ? (
          <>
            <div style={{
              background: 'var(--theme-bg-surface)',
              border: '1px solid var(--theme-border)',
              borderRadius: 14,
              padding: '22px 24px',
              marginBottom: 12,
            }}>
              <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Project Token Usage
              </p>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
                <div>
                  <p style={{ fontSize: 42, fontWeight: 800, lineHeight: 1, color: 'var(--color-text-primary)', letterSpacing: '-0.04em' }}>
                    {fmtN(totalTokens)}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8 }}>
                    {tokenComparison(totalTokens)}
                  </p>
                </div>
                <button
                  onClick={() => document.dispatchEvent(new CustomEvent('loom:new-session'))}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    height: 34,
                    padding: '0 12px',
                    borderRadius: 9,
                    border: '1px solid var(--theme-border-strong)',
                    background: 'var(--theme-bg-active)',
                    color: 'var(--color-accent-primary)',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  <MessageSquare size={13} />
                  New Session
                </button>
              </div>

              <div style={{ height: 8, borderRadius: 999, overflow: 'hidden', display: 'flex', background: 'var(--theme-bg-raised)', border: '1px solid var(--theme-border)' }}>
                <div style={{ width: `${inputPct}%`, background: 'var(--color-accent-primary)' }} />
                <div style={{ width: `${outputPct}%`, background: 'rgba(120, 83, 45, 0.42)' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 12, color: 'var(--color-text-muted)' }}>
                <span>Input {fmtN(stats.totalInput)} · {inputPct}%</span>
                <span>Output {fmtN(stats.totalOutput)} · {outputPct}%</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <StatCard label="SESSIONS" value={fmtN(stats.sessionCount)} />
              <StatCard label="MESSAGES" value={fmtN(stats.messageCount)} />
            </div>

            {/* Model breakdown */}
            {stats.byModel.length > 0 && (
              <div style={{
                background: 'var(--theme-bg-surface)',
                border: '1px solid var(--theme-border)',
                borderRadius: 10,
                padding: '14px 16px',
              }}>
                <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 12, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Model Token Breakdown
                </p>
                {stats.byModel.map((m, i) => {
                  const total = m.input + m.output
                  const maxTotal = Math.max(...stats.byModel.map(x => x.input + x.output))
                  const pct = maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0
                  const color = MODEL_COLORS[i % MODEL_COLORS.length]
                  return (
                    <div key={m.model} style={{ marginBottom: i < stats.byModel.length - 1 ? 10 : 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                          {formatModelName(m.model)}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                          {fmtN(total)}
                        </span>
                      </div>
                      <div style={{
                        height: 4, borderRadius: 2,
                        background: 'var(--color-bg-surface-high)',
                        overflow: 'hidden',
                      }}>
                        <div style={{
                          height: '100%', borderRadius: 2,
                          background: color,
                          width: `${pct}%`,
                        }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  )
}
