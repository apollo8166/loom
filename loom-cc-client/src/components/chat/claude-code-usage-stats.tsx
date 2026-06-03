'use client'

import { useEffect, useState, useCallback } from 'react'

/* ── Types ─────────────────────────────────────────────────────────── */
type Range = 'all' | '30d' | '7d'

interface Totals {
  sessions: number
  messages: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  activeDays: number
  currentStreak: number
  longestStreak: number
  peakHour: string
  favoriteModel: string
}

interface HeatDay { day: string; count: number }
interface ModelStat {
  modelId: string
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  sessions: number
  percentage: number
}
interface DailyModelToken { day: string; byModel: Record<string, number> }

interface UsageData {
  totals: Totals
  heatmap: HeatDay[]
  byModel: ModelStat[]
  dailyModelTokens: DailyModelToken[]
}

/* ── Helpers ────────────────────────────────────────────────────────── */
function fmtN(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function tokenComparison(tok: number): string {
  if (tok === 0) return '开始你的第一次对话吧'
  if (tok < 10_000) return `约 ${Math.round(tok / 250)} 页 A4 纸`
  if (tok < 100_000) return `约 ${Math.round(tok / 50_000)} 本短篇小说`
  if (tok < 1_000_000) return `约 ${(tok / 300_000).toFixed(1)} 本《哈利波特》`
  return `${Math.round(tok / 300_000).toLocaleString()} 本《哈利波特》`
}

function buildGrid(heatmap: HeatDay[]): { date: string; count: number }[][] {
  const countMap = new Map(heatmap.map(d => [d.day, d.count]))
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(start.getDate() - 364 - today.getDay())

  const weeks: { date: string; count: number }[][] = []
  let week: { date: string; count: number }[] = []
  const cur = new Date(start)
  while (cur <= today) {
    const key = cur.toISOString().slice(0, 10)
    week.push({ date: key, count: countMap.get(key) ?? 0 })
    if (week.length === 7) { weeks.push(week); week = [] }
    cur.setDate(cur.getDate() + 1)
  }
  if (week.length > 0) {
    while (week.length < 7) week.push({ date: '', count: 0 })
    weeks.push(week)
  }
  return weeks
}

function heatColor(count: number): string {
  if (count === 0) return 'var(--color-bg-surface-high)'
  if (count <= 2) return 'rgba(245,158,11,0.3)'
  if (count <= 5) return 'rgba(245,158,11,0.55)'
  if (count <= 10) return 'rgba(245,158,11,0.8)'
  return '#F59E0B'
}

const MODEL_COLORS = [
  '#F59E0B', '#6366F1', '#32D583', '#E85A4F',
  '#60A5FA', '#F472B6', '#A78BFA', '#34D399',
]

/* ── Sub-components ─────────────────────────────────────────────────── */
function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div style={{
      background: 'var(--color-bg-surface)',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 10,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <div style={{
        fontSize: 11,
        color: 'var(--color-text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 22,
        fontWeight: 700,
        color: 'var(--color-text-primary)',
        lineHeight: 1.2,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{sub}</div>
      )}
    </div>
  )
}

function Heatmap({ data }: { data: HeatDay[] }) {
  const grid = buildGrid(data)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  const monthLabels: { label: string; col: number }[] = []
  let lastMonth = -1
  grid.forEach((week, wi) => {
    const firstReal = week.find(d => d.date)
    if (!firstReal) return
    const m = new Date(firstReal.date).getMonth()
    if (m !== lastMonth) { monthLabels.push({ label: months[m], col: wi }); lastMonth = m }
  })

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
      <div style={{ position: 'relative', paddingTop: 18, display: 'inline-block' }}>
        {/* Month labels */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 16, display: 'flex', gap: 2 }}>
          {grid.map((_, wi) => {
            const ml = monthLabels.find(m => m.col === wi)
            return (
              <div key={wi} style={{ width: 11, flexShrink: 0, fontSize: 9, color: 'var(--color-text-muted)', userSelect: 'none' }}>
                {ml ? ml.label : ''}
              </div>
            )
          })}
        </div>
        {/* Grid */}
        <div style={{ display: 'flex', gap: 2 }}>
          {grid.map((week, wi) => (
            <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {week.map((day, di) => (
                <div
                  key={di}
                  title={day.date ? `${day.date}: ${day.count} sessions` : ''}
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: 2,
                    background: day.date ? heatColor(day.count) : 'transparent',
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Bar sizing by range
function barConfig(range: Range) {
  if (range === '7d')  return { minWidth: 28, maxWidth: 56, gap: 5 }
  if (range === '30d') return { minWidth: 8,  maxWidth: 16, gap: 3 }
  return                      { minWidth: 3,  maxWidth: 7,  gap: 2 }
}

function StackedDailyBarChart({
  data, modelOrder, maxH = 80, range,
}: {
  data: DailyModelToken[]
  modelOrder: { modelId: string; color: string; label: string }[]
  maxH?: number
  range: Range
}) {
  if (data.length === 0) return (
    <div style={{ height: maxH, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>
      暂无数据
    </div>
  )

  const { minWidth, maxWidth, gap } = barConfig(range)
  const max = Math.max(...data.map(d => Object.values(d.byModel).reduce((s, v) => s + v, 0)), 1)

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap, height: maxH, overflow: 'hidden' }}>
      {data.map((day, i) => {
        const total = Object.values(day.byModel).reduce((s, v) => s + v, 0)
        const colH = Math.max(3, Math.round((total / max) * maxH))
        const tip = modelOrder
          .filter(m => (day.byModel[m.modelId] ?? 0) > 0)
          .map(m => `${m.label}: ${fmtN(day.byModel[m.modelId])}`)
          .join('\n')
        return (
          <div
            key={i}
            title={`${day.day}\n${tip}\nTotal: ${fmtN(total)}`}
            style={{
              flex: '1 0 auto',
              minWidth,
              maxWidth,
              height: colH,
              borderRadius: '2px 2px 0 0',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column-reverse',
              cursor: 'default',
            }}
          >
            {modelOrder.map(m => {
              const tok = day.byModel[m.modelId] ?? 0
              if (tok === 0 || total === 0) return null
              const segH = Math.round((tok / total) * colH)
              return (
                <div
                  key={m.modelId}
                  style={{ width: '100%', height: segH, flexShrink: 0, background: m.color }}
                />
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

/* ── Main Component ─────────────────────────────────────────────────── */
const MODEL_COLLAPSED_COUNT = 3

export function ClaudeCodeUsageStats({ projectId }: { projectId?: string }) {
  const [range, setRange] = useState<Range>('all')
  const [tab, setTab] = useState<'overview' | 'models'>('overview')
  const [data, setData] = useState<UsageData | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modelsExpanded, setModelsExpanded] = useState(false)

  const load = useCallback(async (r: Range, isInitial: boolean) => {
    if (isInitial) setInitialLoading(true)
    else setRefreshing(true)
    setError(null)
    try {
      const params = new URLSearchParams({ range: r })
      if (projectId) params.set('projectId', projectId)
      const res = await fetch(`/api/claude-code/usage?${params.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData({
        totals: json.totals,
        heatmap: json.heatmap ?? [],
        byModel: json.byModel ?? [],
        dailyModelTokens: json.dailyModelTokens ?? [],
      })
    } catch (e) {
      setError(String(e))
    } finally {
      if (isInitial) setInitialLoading(false)
      else setRefreshing(false)
    }
  }, [projectId])

  useEffect(() => { load(range, true) }, [load]) // reload when the data scope changes

  const handleRangeChange = useCallback((r: Range) => {
    setRange(r)
    load(r, false)
  }, [load])

  /* ── Skeleton ── */
  if (initialLoading) return (
    <div style={{ maxWidth: 700, width: '100%', margin: '0 auto' }}>
      <style>{`@keyframes pulse{0%,100%{opacity:.7}50%{opacity:.3}}`}</style>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 14 }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} style={{
            height: 72,
            borderRadius: 10,
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border-subtle)',
            animation: 'pulse 1.5s ease-in-out infinite',
          }} />
        ))}
      </div>
      <div style={{
        height: 120,
        borderRadius: 10,
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-subtle)',
        animation: 'pulse 1.5s ease-in-out infinite',
      }} />
    </div>
  )

  if (error) return (
    <div style={{ maxWidth: 700, margin: '0 auto', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
      加载统计数据失败
    </div>
  )

  if (!data) return null

  const { totals, heatmap, byModel, dailyModelTokens } = data

  // Build consistent model→color mapping (sorted by total tokens, same as byModel list)
  const modelOrder = byModel.map((m, i) => ({
    modelId: m.modelId,
    label: m.model,
    color: MODEL_COLORS[i % MODEL_COLORS.length],
  }))

  return (
    <div style={{ maxWidth: 700, width: '100%', margin: '0 auto' }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header: tabs + period filter */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['overview', 'models'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '5px 14px',
                borderRadius: 20,
                border: '1px solid',
                borderColor: tab === t ? 'rgba(245,158,11,0.5)' : 'var(--color-border-subtle)',
                background: tab === t ? 'rgba(245,158,11,0.12)' : 'transparent',
                color: tab === t ? '#F59E0B' : 'var(--color-text-muted)',
                fontSize: 12,
                fontWeight: tab === t ? 600 : 400,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {t === 'overview' ? 'Overview' : 'Models'}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            border: '2px solid transparent',
            borderTopColor: '#F59E0B',
            animation: 'spin 0.7s linear infinite',
            opacity: refreshing ? 1 : 0,
            transition: 'opacity 0.2s',
            flexShrink: 0,
          }} />
          {(['all', '30d', '7d'] as const).map(r => (
            <button
              key={r}
              onClick={() => handleRangeChange(r)}
              disabled={refreshing}
              style={{
                padding: '4px 10px',
                borderRadius: 16,
                border: '1px solid',
                borderColor: range === r ? 'rgba(245,158,11,0.4)' : 'var(--color-border-subtle)',
                background: range === r ? 'rgba(245,158,11,0.1)' : 'transparent',
                color: range === r ? '#F59E0B' : 'var(--color-text-muted)',
                fontSize: 11,
                fontWeight: range === r ? 600 : 400,
                cursor: refreshing ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {r === 'all' ? 'All' : r}
            </button>
          ))}
        </div>
      </div>

      {/* Content — fades while refreshing */}
      <div style={{ opacity: refreshing ? 0.6 : 1, transition: 'opacity 0.2s' }}>

        {/* ── Overview Tab ── */}
        {tab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* 4×2 stat cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
              <StatCard label="Sessions" value={fmtN(totals.sessions)} />
              <StatCard label="Messages" value={fmtN(totals.messages)} />
              <StatCard
                label="Tokens"
                value={fmtN(totals.totalTokens)}
                sub={tokenComparison(totals.totalTokens)}
              />
              <StatCard label="Active Days" value={totals.activeDays} />
              <StatCard label="Streak" value={`${totals.currentStreak}d`} sub="current" />
              <StatCard label="Best Streak" value={`${totals.longestStreak}d`} sub="longest" />
              <StatCard label="Peak Hour" value={totals.peakHour} sub="most active" />
              <StatCard label="Top Model" value={totals.favoriteModel} />
            </div>

            {/* Activity heatmap */}
            <div style={{
              background: 'var(--color-bg-surface)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 10,
              padding: '14px 16px',
            }}>
              <div style={{
                fontSize: 11,
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: 10,
              }}>
                Activity — Last 365 days
              </div>
              <Heatmap data={heatmap} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, justifyContent: 'flex-end' }}>
                <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>Less</span>
                {[0, 2, 5, 8, 12].map(v => (
                  <div key={v} style={{ width: 10, height: 10, borderRadius: 2, background: heatColor(v) }} />
                ))}
                <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>More</span>
              </div>
            </div>
          </div>
        )}

        {/* ── Models Tab ── */}
        {tab === 'models' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Daily token bar chart */}
            <div style={{
              background: 'var(--color-bg-surface)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 10,
              padding: '14px 16px',
            }}>
              <div style={{
                fontSize: 11,
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: 10,
              }}>
                Daily Token Usage
              </div>
              <StackedDailyBarChart data={dailyModelTokens} modelOrder={modelOrder} maxH={80} range={range} />
            </div>

            {/* Model breakdown */}
            <div style={{
              background: 'var(--color-bg-surface)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 10,
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}>
              <div style={{
                fontSize: 11,
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}>
                Model Breakdown
              </div>
              {byModel.length === 0 && (
                <div style={{ color: 'var(--color-text-muted)', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>
                  暂无模型使用记录
                </div>
              )}
              {(modelsExpanded ? byModel : byModel.slice(0, MODEL_COLLAPSED_COUNT)).map((m, i) => (
                <div key={m.modelId}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <div style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: MODEL_COLORS[i % MODEL_COLORS.length],
                        flexShrink: 0,
                      }} />
                      <span style={{
                        fontSize: 13,
                        color: 'var(--color-text-primary)',
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {m.model}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0, marginLeft: 12 }}>
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                        ↑ {fmtN(m.inputTokens)} · ↓ {fmtN(m.outputTokens)}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', fontWeight: 600, minWidth: 44, textAlign: 'right' }}>
                        {fmtN(m.totalTokens)}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', minWidth: 38, textAlign: 'right' }}>
                        {m.percentage.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <div style={{ height: 4, borderRadius: 2, background: 'var(--color-bg-surface-high)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${m.percentage}%`,
                      borderRadius: 2,
                      background: MODEL_COLORS[i % MODEL_COLORS.length],
                      transition: 'width 0.6s ease',
                    }} />
                  </div>
                </div>
              ))}
              {byModel.length > MODEL_COLLAPSED_COUNT && (
                <button
                  onClick={() => setModelsExpanded(e => !e)}
                  style={{
                    marginTop: 2,
                    padding: '5px 0',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 11,
                    color: 'var(--color-text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    alignSelf: 'center',
                    transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#F59E0B')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
                >
                  <span style={{
                    display: 'inline-block',
                    transform: modelsExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s',
                    fontSize: 10,
                    lineHeight: 1,
                  }}>▼</span>
                  {modelsExpanded
                    ? '收起'
                    : `展开全部 ${byModel.length} 个模型`}
                </button>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
