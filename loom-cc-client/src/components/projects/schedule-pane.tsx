'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ChevronLeft, Plus, MoreHorizontal, Pencil,
  Trash2, Loader2, CheckCircle2, XCircle, Clock, Zap,
} from 'lucide-react'
import type { ScheduledTask, TaskExecution } from '@/shared/types'
import { cronToLabel, getNextRun } from '@/shared/runtime/cron/cron-parser'
// ── helpers ───────────────────────────────────────────────────────────────────

/** Parse a single field from SKILL.md frontmatter */
function parseFmField(raw: string, field: string): string {
  const m = new RegExp(`^${field}:\\s*(.+)$`, 'm').exec(raw)
  return m ? m[1].trim() : ''
}

function formatNextRun(date: Date | null): string {
  if (!date) return ''
  const now = new Date()
  const diffMin = Math.round((date.getTime() - now.getTime()) / 60000)
  if (diffMin <= 0) return '即将执行'
  if (diffMin < 60) return `${diffMin} 分钟后`
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  const d = new Date(date); d.setHours(0, 0, 0, 0)
  const dayDiff = Math.round((d.getTime() - today.getTime()) / 86400000)
  const hhmm = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (dayDiff === 0) return `今天 ${hhmm}`
  if (dayDiff === 1) return `明天 ${hhmm}`
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) + ' ' + hhmm
}

function nextRunLabel(task: ScheduledTask): string {
  if (!task.enabled) return ''
  const d = getNextRun(task.schedule)
  return d ? formatNextRun(d) : ''
}

// ── Frequency builder ─────────────────────────────────────────────────────────

type Freq = 'minutes' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'once'
const MINUTE_INTERVALS = [5, 10, 15, 20, 30, 45]
const DAYS = ['日', '一', '二', '三', '四', '五', '六']

interface FreqOpts {
  minuteInterval: number; minute: number; hour: number
  dow: number; dom: number; onceDate: string; onceTime: string
}
function defaultOpts(): FreqOpts {
  return { minuteInterval: 30, minute: 0, hour: 9, dow: 1, dom: 1, onceDate: '', onceTime: '09:00' }
}
function buildCron(freq: Freq, opts: FreqOpts): string {
  switch (freq) {
    case 'minutes': return `*/${opts.minuteInterval} * * * *`
    case 'hourly':  return `${opts.minute} * * * *`
    case 'daily':   return `${opts.minute} ${opts.hour} * * *`
    case 'weekly':  return `${opts.minute} ${opts.hour} * * ${opts.dow}`
    case 'monthly': return `${opts.minute} ${opts.hour} ${opts.dom} * *`
    case 'once': {
      if (!opts.onceDate || !opts.onceTime) return '0 9 * * *'
      const d = new Date(`${opts.onceDate}T${opts.onceTime}`)
      return `${d.getMinutes()} ${d.getHours()} ${d.getDate()} ${d.getMonth() + 1} *`
    }
  }
}

/** Parse a saved cron string back into { freq, opts } so the edit form shows correct values */
function parseCron(schedule: string): { freq: Freq; opts: FreqOpts } {
  const opts = defaultOpts()
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) return { freq: 'daily', opts }
  const [min, hour, dom, month, dow] = parts

  // */n * * * *  →  every-n-minutes
  if (min.startsWith('*/') && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    const interval = parseInt(min.slice(2))
    opts.minuteInterval = MINUTE_INTERVALS.includes(interval) ? interval : 30
    return { freq: 'minutes', opts }
  }

  // n * * * *  →  hourly
  if (/^\d+$/.test(min) && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    opts.minute = parseInt(min)
    return { freq: 'hourly', opts }
  }

  // For remaining patterns both min and hour must be digits
  if (!/^\d+$/.test(min) || !/^\d+$/.test(hour)) return { freq: 'daily', opts }
  opts.minute = parseInt(min)
  opts.hour   = parseInt(hour)

  // n h * * d  →  weekly
  if (dom === '*' && month === '*' && /^\d+$/.test(dow)) {
    opts.dow = parseInt(dow)
    return { freq: 'weekly', opts }
  }

  // n h D * *  →  monthly
  if (/^\d+$/.test(dom) && month === '*' && dow === '*') {
    opts.dom = parseInt(dom)
    return { freq: 'monthly', opts }
  }

  // n h D M *  →  once
  if (/^\d+$/.test(dom) && /^\d+$/.test(month) && dow === '*') {
    const year = new Date().getFullYear()
    let d = new Date(year, parseInt(month) - 1, parseInt(dom))
    if (d < new Date()) d = new Date(year + 1, parseInt(month) - 1, parseInt(dom))
    opts.onceDate = d.toISOString().slice(0, 10)
    opts.onceTime = `${String(opts.hour).padStart(2, '0')}:${String(opts.minute).padStart(2, '0')}`
    return { freq: 'once', opts }
  }

  // n h * * *  →  daily (default)
  return { freq: 'daily', opts }
}

// ── Skill selector types ──────────────────────────────────────────────────────

interface SkillOption {
  name: string
  description: string
  source: 'builtin' | 'project' | 'global'
  content: string   // stripped body (for AI)
  raw: string       // full source including frontmatter (for display)
}

// ── Skill drawer (slides in from right) ──────────────────────────────────────

interface SkillDrawerProps {
  workspacePath?: string
  onSelect: (skill: SkillOption) => void
  onClose: () => void
}

function SkillDrawer({ workspacePath, onSelect, onClose }: SkillDrawerProps) {
  const [skills, setSkills] = useState<SkillOption[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const url = workspacePath
      ? `/api/config/skills?workspacePath=${encodeURIComponent(workspacePath)}`
      : '/api/config/skills'
    fetch(url)
      .then(r => r.json())
      .then(d => setSkills(d.skills ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [workspacePath])

  return (
    <>
      {/* Click-outside backdrop (only covers behind drawer, not full screen) */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 1010 }}
      />
      {/* Drawer panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 1011,
        width: 440, background: 'var(--color-bg-surface)',
        borderLeft: '1px solid var(--color-border-subtle)',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          height: 52, flexShrink: 0, display: 'flex', alignItems: 'center',
          padding: '0 20px', borderBottom: '1px solid var(--color-border-subtle)',
        }}>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)' }}>选择 Skill</span>
          <button onClick={onClose} style={{
            padding: '3px 10px', borderRadius: 5, border: '1px solid var(--color-border-subtle)',
            background: 'transparent', cursor: 'pointer', fontSize: 12, color: 'var(--color-text-muted)',
          }}>关闭</button>
        </div>

        {/* Table */}
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
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                  {(['名称', '来源', '说明'] as const).map(h => (
                    <th key={h} style={{
                      padding: '8px 16px', textAlign: 'left', fontSize: 10, fontWeight: 700,
                      textTransform: 'uppercase', letterSpacing: '0.07em',
                      color: 'var(--color-text-disabled)', background: 'var(--color-bg-nav)',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {skills.map(s => (
                  <tr
                    key={s.name}
                    onClick={() => { onSelect(s); onClose() }}
                    style={{ cursor: 'pointer', borderBottom: '1px solid var(--color-border-subtle)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-surface-high)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap' }}>
                      {s.name}
                    </td>
                    <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>
                      <span style={{
                        fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600,
                        background: 'var(--color-bg-surface-highest)',
                        color: 'var(--color-text-disabled)',
                      }}>
                        {s.source === 'builtin' ? '官方' : s.source === 'project' ? '项目' : '全局'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                      {s.description || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  )
}

// ── Task form modal ───────────────────────────────────────────────────────────

interface TaskFormProps {
  projectId: string
  defaultModel: string
  workspacePath?: string
  initial?: ScheduledTask
  onSave: (task: ScheduledTask) => void
  onClose: () => void
}

function TaskForm({ projectId, defaultModel, workspacePath, initial, onSave, onClose }: TaskFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  // description = 任务说明 = what gets sent to SDK.
  const [description, setDescription] = useState(
    initial ? (initial.description || initial.prompt) : ''
  )
  const [skillName, setSkillName] = useState(initial?.skillName ?? '')
  const [skillContent, setSkillContent] = useState(initial?.skillName ? (initial.prompt ?? '') : '')
  const parsed = initial?.schedule ? parseCron(initial.schedule) : { freq: 'daily' as Freq, opts: defaultOpts() }
  const [freq, setFreq] = useState<Freq>(parsed.freq)
  const [opts, setOpts] = useState<FreqOpts>(parsed.opts)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showSkillDrawer, setShowSkillDrawer] = useState(false)

  const schedule = buildCron(freq, opts)

  const handleSelectSkill = (skill: SkillOption) => {
    setSkillName(skill.name)
    setSkillContent(skill.raw)   // store full raw content; executor will strip frontmatter
  }

  const clearSkill = () => { setSkillName(''); setSkillContent('') }

  const save = async () => {
    if (!name.trim()) { setErr('请输入任务名称'); return }
    if (!description.trim()) { setErr('请填写任务说明'); return }
    setSaving(true); setErr(null)
    try {
      const url = initial
        ? `/api/projects/${projectId}/schedules/${initial.id}`
        : `/api/projects/${projectId}/schedules`
      const res = await fetch(url, {
        method: initial ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          schedule,
          // Keep legacy prompt storage for existing task previews; execution
          // invokes skills through Claude Agent SDK instead of inlining this body.
          prompt: skillContent.trim() || description.trim(),
          skillName: skillName,
          model: defaultModel,
        }),
      })
      if (!res.ok) {
        let msg = `保存失败 (${res.status})`
        try { msg = (await res.json()).error ?? msg } catch { /* non-JSON error body */ }
        throw new Error(msg)
      }
      const data = await res.json()
      onSave(data.task)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(false) }
  }

  const inp: React.CSSProperties = {
    width: '100%', padding: '6px 10px', borderRadius: 6,
    border: '1px solid var(--color-border-subtle)',
    background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)',
    fontSize: 13, outline: 'none', boxSizing: 'border-box',
  }
  const lbl: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 4, display: 'block',
  }

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}>
        <div style={{ background: 'var(--color-bg-surface)', borderRadius: 10, border: '1px solid var(--color-border-subtle)', padding: 24, width: 480, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
          <h3 style={{ margin: '0 0 20px', fontSize: 15, fontWeight: 700, color: 'var(--color-text-primary)' }}>
            {initial ? '编辑定时任务' : '新建定时任务'}
          </h3>

          {/* Name */}
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>任务名称</label>
            <input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="例如：每日代码审查" />
          </div>

          {/* 任务说明 = prompt sent to AI */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <label style={{ ...lbl, marginBottom: 0 }}>任务说明</label>
              {skillName ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 5, fontWeight: 600,
                    background: 'rgba(245,158,11,0.12)', color: 'var(--color-accent-primary)',
                    border: '1px solid rgba(245,158,11,0.3)',
                  }}>
                    Skill: {skillName}
                  </span>
                  <button onClick={clearSkill} style={{
                    fontSize: 11, padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
                    border: '1px solid var(--color-border-subtle)', background: 'transparent',
                    color: 'var(--color-text-muted)',
                  }}>×</button>
                </div>
              ) : (
                <button onClick={() => setShowSkillDrawer(true)} style={{
                  fontSize: 11, padding: '3px 10px', borderRadius: 5, cursor: 'pointer',
                  border: '1px solid var(--color-border-subtle)', background: 'transparent',
                  color: 'var(--color-text-secondary)',
                }}>
                  选择 Skill →
                </button>
              )}
            </div>
            <textarea
              style={{ ...inp, height: 90, resize: 'vertical', fontFamily: 'inherit' }}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="描述这个任务要做什么，会发送给 AI…"
            />
          </div>

          {/* Schedule */}
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>执行频率</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {(['minutes', 'hourly', 'daily', 'weekly', 'monthly', 'once'] as Freq[]).map(f => (
                <button key={f} onClick={() => setFreq(f)} style={{
                  padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                  border: freq === f ? '1px solid var(--color-accent-primary)' : '1px solid var(--color-border-subtle)',
                  background: freq === f ? 'rgba(245,158,11,0.12)' : 'transparent',
                  color: freq === f ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
                  fontWeight: freq === f ? 600 : 400,
                }}>
                  {f === 'minutes' ? '分钟' : f === 'hourly' ? '每小时' : f === 'daily' ? '每天' : f === 'weekly' ? '每周' : f === 'monthly' ? '每月' : '一次'}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {freq === 'minutes' && (<>
                <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>每</span>
                <select style={{ ...inp, width: 80 }} value={opts.minuteInterval} onChange={e => setOpts(o => ({ ...o, minuteInterval: Number(e.target.value) }))}>
                  {MINUTE_INTERVALS.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>分钟</span>
              </>)}
              {freq === 'hourly' && (<>
                <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>每小时第</span>
                <input style={{ ...inp, width: 60 }} type="number" min={0} max={59} value={opts.minute} onChange={e => setOpts(o => ({ ...o, minute: Number(e.target.value) }))} />
                <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>分</span>
              </>)}
              {(freq === 'daily' || freq === 'weekly' || freq === 'monthly') && (<>
                {freq === 'weekly' && (
                  <select style={{ ...inp, width: 96 }} value={opts.dow} onChange={e => setOpts(o => ({ ...o, dow: Number(e.target.value) }))}>
                    {DAYS.map((d, i) => <option key={i} value={i}>周{d}</option>)}
                  </select>
                )}
                {freq === 'monthly' && (<>
                  <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>每月</span>
                  <input style={{ ...inp, width: 68 }} type="number" min={1} max={28} value={opts.dom} onChange={e => setOpts(o => ({ ...o, dom: Number(e.target.value) }))} />
                  <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>日</span>
                </>)}
                <input style={{ ...inp, width: 68 }} type="number" min={0} max={23} value={opts.hour} onChange={e => setOpts(o => ({ ...o, hour: Number(e.target.value) }))} />
                <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>:</span>
                <input style={{ ...inp, width: 68 }} type="number" min={0} max={59} value={opts.minute} onChange={e => setOpts(o => ({ ...o, minute: Number(e.target.value) }))} />
              </>)}
              {freq === 'once' && (<>
                <input style={{ ...inp, width: 140 }} type="date" value={opts.onceDate} onChange={e => setOpts(o => ({ ...o, onceDate: e.target.value }))} />
                <input style={{ ...inp, width: 110 }} type="time" value={opts.onceTime} onChange={e => setOpts(o => ({ ...o, onceTime: e.target.value }))} />
              </>)}
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>
              cron: <span style={{ color: 'var(--color-accent-primary)' }}>{schedule}</span>
              {' · '}{cronToLabel(schedule)}
            </div>
          </div>

          {err && <p style={{ fontSize: 12, color: 'var(--color-accent-danger)', marginBottom: 12 }}>{err}</p>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={onClose} style={{ padding: '7px 16px', borderRadius: 6, fontSize: 13, cursor: 'pointer', border: '1px solid var(--color-border-subtle)', background: 'transparent', color: 'var(--color-text-secondary)' }}>取消</button>
            <button onClick={save} disabled={saving} style={{ padding: '7px 16px', borderRadius: 6, fontSize: 13, cursor: saving ? 'default' : 'pointer', border: 'none', background: 'var(--color-accent-primary)', color: '#fff', fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>

      {showSkillDrawer && (
        <SkillDrawer
          workspacePath={workspacePath}
          onSelect={handleSelectSkill}
          onClose={() => setShowSkillDrawer(false)}
        />
      )}
    </>
  )
}

// ── Task card (list view) ─────────────────────────────────────────────────────

interface TaskCardProps {
  task: ScheduledTask
  projectId: string
  onToggle: (id: string, enabled: boolean) => void
  onEdit: (task: ScheduledTask) => void
  onDelete: (id: string) => void
  onClick: (task: ScheduledTask) => void
}

function TaskCard({ task, projectId, onToggle, onEdit, onDelete, onClick }: TaskCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const nr = nextRunLabel(task)

  return (
    <div
      onClick={() => onClick(task)}
      style={{
        background: 'var(--color-bg-surface)', borderRadius: 10,
        border: '1px solid var(--color-border-subtle)',
        padding: '18px 20px', cursor: 'pointer',
        display: 'flex', flexDirection: 'column',
        minHeight: 152,
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-border-strong)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border-subtle)')}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.3 }}>
            {task.name}
          </div>
        </div>
        {/* Three-dot menu */}
        <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={e => { e.stopPropagation(); setMenuOpen(o => !o) }}
            style={{
              width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 5, border: 'none', background: 'transparent', cursor: 'pointer',
              color: 'var(--color-text-muted)',
            }}
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, zIndex: 100, minWidth: 100,
              background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)',
              borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.3)', overflow: 'hidden',
            }}>
              <button
                onClick={e => { e.stopPropagation(); setMenuOpen(false); onEdit(task) }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 14px', fontSize: 12, cursor: 'pointer', border: 'none', background: 'transparent', color: 'var(--color-text-secondary)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <Pencil size={12} /> 编辑
              </button>
              <button
                onClick={e => { e.stopPropagation(); setMenuOpen(false); onDelete(task.id) }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 14px', fontSize: 12, cursor: 'pointer', border: 'none', background: 'transparent', color: '#f87171' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <Trash2 size={12} /> 删除
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Description preview — fixed 3-line area, always occupies same height */}
      <div style={{
        fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.5,
        height: '4.5em',            /* 3 lines × 1.5 line-height */
        overflow: 'hidden', display: '-webkit-box',
        WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
        marginBottom: 10,
      }}>
        {task.description || task.prompt}
      </div>

      {/* Footer row: toggle + schedule — pinned to bottom */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 'auto' }}>
        {/* Toggle switch */}
        <button
          onClick={e => { e.stopPropagation(); onToggle(task.id, !task.enabled) }}
          title={task.enabled ? '暂停任务' : '启用任务'}
          style={{
            position: 'relative', width: 28, height: 16, borderRadius: 8,
            border: '1px solid', flexShrink: 0, padding: 0, cursor: 'pointer',
            background: task.enabled ? 'var(--color-accent-primary)' : 'var(--color-bg-surface-highest)',
            borderColor: task.enabled ? 'var(--color-accent-primary)' : 'var(--color-border-strong)',
            transition: 'background 0.2s, border-color 0.2s',
          }}
        >
          <span style={{
            position: 'absolute', top: 1,
            left: task.enabled ? 13 : 1,
            width: 12, height: 12, borderRadius: '50%',
            background: task.enabled ? '#fff' : 'var(--color-text-muted)',
            transition: 'left 0.2s, background 0.2s',
            display: 'block',
          }} />
        </button>
        <span style={{ fontSize: 11, color: task.enabled ? 'var(--color-text-secondary)' : 'var(--color-text-disabled)' }}>
          {cronToLabel(task.schedule)}
        </span>
        {task.enabled && nr && (
          <span style={{ fontSize: 11, color: 'var(--color-text-disabled)' }}>
            · 下次 {nr}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Live steps panel ──────────────────────────────────────────────────────────

interface LiveStep {
  type: string
  text?: string
  name?: string
  error?: string
}

interface LivePanelProps {
  steps: LiveStep[]
  running: boolean
  sessionId: string | null
  onViewSession: (id: string) => void
}

function LivePanel({ steps, running, sessionId, onViewSession }: LivePanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [steps])

  const textLines = steps.filter(s => s.type === 'text_delta' && s.text)
  const fullText = textLines.map(s => s.text).join('')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        {running ? (
          <><Loader2 size={13} className="animate-spin" style={{ color: 'var(--color-accent-primary)' }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-accent-primary)' }}>执行中…</span></>
        ) : (
          <><CheckCircle2 size={13} style={{ color: '#4ade80' }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: '#4ade80' }}>执行完成</span></>
        )}
      </div>

      <div style={{
        flex: 1, overflowY: 'auto', background: 'var(--color-bg-base)', borderRadius: 8,
        padding: 12, fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6,
        color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {fullText || (running ? <span style={{ color: 'var(--color-text-disabled)' }}>等待输出…</span> : null)}
        <div ref={bottomRef} />
      </div>

      {!running && sessionId && (
        <button
          onClick={() => onViewSession(sessionId)}
          style={{
            marginTop: 10, padding: '7px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
            border: '1px solid var(--color-border-subtle)', background: 'transparent',
            color: 'var(--color-text-secondary)', cursor: 'pointer', alignSelf: 'flex-start',
          }}
        >
          查看完整会话 →
        </button>
      )}
    </div>
  )
}

// ── Info panel ────────────────────────────────────────────────────────────────

interface InfoPanelProps {
  task: ScheduledTask
  projectName?: string
  workspacePath?: string
}

function InfoPanel({ task, projectName, workspacePath }: InfoPanelProps) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const [skillDesc, setSkillDesc] = useState<string>('')
  const [skillRaw, setSkillRaw] = useState<string>('')

  // Fetch skill metadata from API
  useEffect(() => {
    if (!task.skillName) return
    const url = workspacePath
      ? `/api/config/skills?workspacePath=${encodeURIComponent(workspacePath)}`
      : '/api/config/skills'
    fetch(url)
      .then(r => r.json())
      .then((d: { skills: Array<{ name: string; description: string; raw: string }> }) => {
        const skill = d.skills?.find(s => s.name === task.skillName)
        if (skill) {
          setSkillDesc(skill.description)
          setSkillRaw(skill.raw)
        }
      })
      .catch(() => {})
  }, [task.skillName, workspacePath])

  const metaRows: [string, string][] = [
    ['执行频率', cronToLabel(task.schedule)],
  ]
  if (projectName) metaRows.push(['项目', projectName])
  if (workspacePath) metaRows.push(['工作目录', workspacePath])
  metaRows.push(['模型', task.model || '（项目默认）'])
  if (task.lastRunAt) metaRows.push(['上次执行', new Date(task.lastRunAt).toLocaleString('zh-CN')])

  const fieldLbl: React.CSSProperties = {
    fontSize: 10, fontWeight: 600, color: 'var(--color-text-disabled)',
    marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Description — prominent */}
      {task.description && (
        <div style={{ marginBottom: 18 }}>
          <div style={fieldLbl}>任务说明</div>
          <div style={{
            fontSize: 13, color: 'var(--color-text-primary)', lineHeight: 1.6,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {task.description}
          </div>
        </div>
      )}

      {/* Skill card OR custom prompt */}
      {task.skillName ? (
        <div style={{ marginBottom: 18 }}>
          <div style={fieldLbl}>Skill</div>
          <div style={{
            padding: '10px 14px', borderRadius: 8,
            border: '1px solid var(--color-border-subtle)',
            background: 'var(--color-bg-surface)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 2 }}>
                  {task.skillName}
                </div>
                {skillDesc && (
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                    {skillDesc}
                  </div>
                )}
              </div>
              <button
                onClick={() => setPreviewOpen(true)}
                style={{
                  flexShrink: 0, fontSize: 11, padding: '2px 8px', borderRadius: 5, cursor: 'pointer',
                  border: '1px solid var(--color-border-subtle)', background: 'transparent',
                  color: 'var(--color-text-muted)',
                }}
              >
                预览 →
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 18 }}>
          <div style={fieldLbl}>指令</div>
          <div style={{
            fontSize: 12, color: 'var(--color-text-secondary)', background: 'var(--color-bg-base)',
            borderRadius: 6, padding: '8px 10px', lineHeight: 1.6,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflowY: 'auto',
          }}>
            {task.prompt}
          </div>
        </div>
      )}

      {/* Meta rows */}
      {metaRows.map(([label, value]) => (
        <div key={label} style={{ marginBottom: 12 }}>
          <div style={fieldLbl}>{label}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', wordBreak: 'break-all', lineHeight: 1.4 }}>{value}</div>
        </div>
      ))}

      {/* Skill frontmatter preview modal */}
      {previewOpen && task.skillName && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}>
          <div style={{ background: 'var(--color-bg-surface)', borderRadius: 10, border: '1px solid var(--color-border-subtle)', padding: 24, width: '72vw', maxWidth: 900, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                {task.skillName}
              </span>
              <button onClick={() => setPreviewOpen(false)} style={{ padding: '3px 10px', borderRadius: 5, border: '1px solid var(--color-border-subtle)', background: 'transparent', cursor: 'pointer', fontSize: 12, color: 'var(--color-text-muted)' }}>
                关闭
              </button>
            </div>
            <pre style={{
              flex: 1, overflowY: 'auto', overflowX: 'auto',
              background: 'var(--color-bg-base)', borderRadius: 8,
              padding: 14, margin: 0,
              fontSize: 12, lineHeight: 1.7,
              color: 'var(--color-text-secondary)',
              fontFamily: "'SF Mono', 'Fira Code', Consolas, monospace",
              whiteSpace: 'pre', wordBreak: 'normal',
            }}>
              {skillRaw || '（暂无数据）'}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Execution history list ────────────────────────────────────────────────────

interface HistoryListProps {
  executions: TaskExecution[]
  loading: boolean
  onClickSession: (sessionId: string) => void
}

function HistoryList({ executions, loading, onClickSession }: HistoryListProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-disabled)', marginBottom: 12 }}>
        执行历史
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 20 }}>
            <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-text-disabled)' }} />
          </div>
        ) : executions.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-disabled)', textAlign: 'center', paddingTop: 20 }}>暂无执行记录</div>
        ) : (
          executions.map(exec => {
            const ok = exec.status === 'ok'
            return (
              <div
                key={exec.id}
                onClick={() => exec.sessionId && onClickSession(exec.sessionId)}
                style={{
                  padding: '8px 10px', borderRadius: 6, marginBottom: 2,
                  cursor: exec.sessionId ? 'pointer' : 'default',
                }}
                onMouseEnter={e => { if (exec.sessionId) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-bg-surface)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
              >
                {/* Time + status badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)', flex: 1 }}>
                    {new Date(exec.executedAt).toLocaleString('zh-CN')}
                  </span>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                    fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                    background: ok ? 'rgba(50,213,131,0.12)' : 'rgba(239,68,68,0.12)',
                    color: ok ? 'var(--color-accent-success)' : 'var(--color-accent-danger)',
                    border: `1px solid ${ok ? 'rgba(50,213,131,0.25)' : 'rgba(239,68,68,0.25)'}`,
                  }}>
                    {ok ? <CheckCircle2 size={9} /> : <XCircle size={9} />}
                    {ok ? '成功' : '失败'}
                  </span>
                </div>
                {/* Result preview */}
                {exec.result && (
                  <div style={{
                    fontSize: 11, color: 'var(--color-text-disabled)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {exec.result}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ── Detail view ───────────────────────────────────────────────────────────────

interface DetailViewProps {
  task: ScheduledTask
  projectId: string
  projectName?: string
  workspacePath?: string
  onBack: () => void
  onTaskChange: (task: ScheduledTask) => void
  onNavigateToSession: (sessionId: string, prompts?: { displayPrompt: string; effectivePrompt: string; execUpdateUrl?: string; enabledSkills?: string[] }) => void
  onEdit: (task: ScheduledTask) => void
}

function DetailView({
  task, projectId, projectName, workspacePath,
  onBack, onTaskChange, onNavigateToSession, onEdit,
}: DetailViewProps) {
  const [executions, setExecutions] = useState<TaskExecution[]>([])
  const [loadingExec, setLoadingExec] = useState(false)
  const [running, setRunning] = useState(false)

  const loadExecutions = useCallback(async () => {
    setLoadingExec(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/schedules/${task.id}/executions?limit=20`)
      const data = await res.json()
      setExecutions(data.executions ?? [])
    } finally { setLoadingExec(false) }
  }, [projectId, task.id])

  useEffect(() => { loadExecutions() }, [loadExecutions])

  const handleToggle = async () => {
    const res = await fetch(`/api/projects/${projectId}/schedules/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !task.enabled }),
    })
    if (res.ok) onTaskChange((await res.json()).task)
  }

  const handleRunNow = async () => {
    setRunning(true)

    try {
      const res = await fetch(`/api/projects/${projectId}/schedules/${task.id}/execute`, { method: 'POST' })
      if (!res.body) { setRunning(false); return }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      // Read only until session_created — then navigate
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const chunks = buf.split('\n\n')
        buf = chunks.pop() ?? ''
        for (const chunk of chunks) {
          if (!chunk.startsWith('data: ')) continue
          try {
            const data = JSON.parse(chunk.slice(6)) as {
              type: string; sessionId?: string; execId?: string
              displayPrompt?: string; effectivePrompt?: string
              enabledSkills?: string[]
            }
            if (data.type === 'session_created' && data.sessionId) {
              const execUpdateUrl = data.execId
                ? `/api/projects/${projectId}/schedules/${task.id}/executions/${data.execId}`
                : undefined
              onNavigateToSession(
                data.sessionId,
                data.displayPrompt && data.effectivePrompt
                  ? { displayPrompt: data.displayPrompt, effectivePrompt: data.effectivePrompt, execUpdateUrl, enabledSkills: data.enabledSkills }
                  : undefined
              )
              return
            }
          } catch { /* ignore malformed */ }
        }
      }
    } catch (err) {
      console.error('[schedule] Execute task error:', err)
    } finally {
      setRunning(false)
    }
  }

  const handleDeleteExec = async () => {
    if (!confirm('确定删除该定时任务？')) return
    await fetch(`/api/projects/${projectId}/schedules/${task.id}`, { method: 'DELETE' })
    onBack()
  }

  const nr = nextRunLabel(task)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--color-bg-base)' }}>
      {/* Header */}
      <div style={{
        flexShrink: 0, padding: '12px 20px',
        borderBottom: '1px solid var(--color-border-subtle)',
        background: 'var(--color-bg-nav)',
      }}>
        {/* Back + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <button onClick={onBack} style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 5,
            border: 'none', background: 'transparent', cursor: 'pointer',
            color: 'var(--color-text-muted)', fontSize: 12,
          }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <ChevronLeft size={13} /> 返回
          </button>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--color-text-primary)', flex: 1 }}>{task.name}</h2>
        </div>

        {/* Status + actions row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Toggle switch + label */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <button
              onClick={handleToggle}
              title={task.enabled ? '暂停任务' : '启用任务'}
              style={{
                position: 'relative', width: 32, height: 18, borderRadius: 9,
                border: '1px solid', flexShrink: 0, padding: 0, cursor: 'pointer',
                background: task.enabled ? 'var(--color-accent-primary)' : 'var(--color-bg-surface-highest)',
                borderColor: task.enabled ? 'var(--color-accent-primary)' : 'var(--color-border-strong)',
                transition: 'background 0.2s, border-color 0.2s',
              }}
            >
              <span style={{
                position: 'absolute', top: 2,
                left: task.enabled ? 16 : 2,
                width: 12, height: 12, borderRadius: '50%',
                background: task.enabled ? '#fff' : 'var(--color-text-muted)',
                transition: 'left 0.2s, background 0.2s', display: 'block',
              }} />
            </button>
            <span style={{ fontSize: 12, fontWeight: 600, color: task.enabled ? 'var(--color-accent-primary)' : 'var(--color-text-muted)' }}>
              {task.enabled ? '已启用' : '已暂停'}
            </span>
          </div>

          {task.enabled && nr && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--color-text-muted)' }}>
              <Clock size={11} />下次 {nr}
            </span>
          )}

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Edit / Delete / Run now */}
          <button onClick={() => onEdit(task)} style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px',
            borderRadius: 6, fontSize: 12, cursor: 'pointer',
            border: '1px solid var(--color-border-subtle)', background: 'transparent',
            color: 'var(--color-text-secondary)',
          }}>
            <Pencil size={11} /> 编辑
          </button>
          <button onClick={handleDeleteExec} style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px',
            borderRadius: 6, fontSize: 12, cursor: 'pointer',
            border: '1px solid var(--color-border-subtle)', background: 'transparent',
            color: '#f87171',
          }}>
            <Trash2 size={11} /> 删除
          </button>
          <button onClick={handleRunNow} disabled={running} style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '5px 14px',
            borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: running ? 'default' : 'pointer',
            border: 'none', background: 'var(--color-accent-primary)', color: '#fff',
            opacity: running ? 0.7 : 1,
          }}>
            {running ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
            {running ? '执行中…' : '立即执行'}
          </button>
        </div>
      </div>

      {/* Body: history (left) + info/live (right) */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: history */}
        <div style={{
          width: 260, flexShrink: 0, borderRight: '1px solid var(--color-border-subtle)',
          padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column',
        }}>
          <HistoryList
            executions={executions}
            loading={loadingExec}
            onClickSession={sid => { onNavigateToSession(sid) }}
          />
        </div>

        {/* Right: task info */}
        <div style={{ flex: 1, padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <InfoPanel task={task} projectName={projectName} workspacePath={workspacePath} />
        </div>
      </div>
    </div>
  )
}

// ── Main pane ─────────────────────────────────────────────────────────────────

interface SchedulePaneProps {
  projectId: string
  defaultModel: string
  workspacePath?: string
  projectName?: string
  onNavigateToSession: (sessionId: string, prompts?: { displayPrompt: string; effectivePrompt: string; execUpdateUrl?: string; enabledSkills?: string[] }) => void
}

export function SchedulePane({ projectId, defaultModel, workspacePath, projectName, onNavigateToSession }: SchedulePaneProps) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'list' | 'detail'>('list')
  const [selectedTask, setSelectedTask] = useState<ScheduledTask | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<ScheduledTask | undefined>()

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/schedules`)
      const data = await res.json()
      setTasks(data.tasks ?? [])
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [projectId])

  useEffect(() => { load() }, [load])

  const handleSave = (task: ScheduledTask) => {
    setTasks(prev => {
      const idx = prev.findIndex(t => t.id === task.id)
      return idx >= 0 ? prev.map((t, i) => i === idx ? task : t) : [...prev, task]
    })
    if (selectedTask?.id === task.id) setSelectedTask(task)
    setShowForm(false); setEditTarget(undefined)
  }

  const handleToggle = async (id: string, enabled: boolean) => {
    const res = await fetch(`/api/projects/${projectId}/schedules/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    if (res.ok) {
      const updated: ScheduledTask = (await res.json()).task
      setTasks(prev => prev.map(t => t.id === id ? updated : t))
      if (selectedTask?.id === id) setSelectedTask(updated)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该定时任务？')) return
    const res = await fetch(`/api/projects/${projectId}/schedules/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setTasks(prev => prev.filter(t => t.id !== id))
      if (selectedTask?.id === id) { setView('list'); setSelectedTask(null) }
    }
  }

  const openEdit = (task: ScheduledTask) => { setEditTarget(task); setShowForm(true) }
  const openCreate = () => { setEditTarget(undefined); setShowForm(true) }

  const handleNavigateToSession = useCallback((
    sessionId: string,
    prompts?: { displayPrompt: string; effectivePrompt: string; execUpdateUrl?: string; enabledSkills?: string[] }
  ) => {
    onNavigateToSession(sessionId, prompts)
  }, [onNavigateToSession])

  // Detail view
  if (view === 'detail' && selectedTask) {
    const currentTask = tasks.find(t => t.id === selectedTask.id) ?? selectedTask
    return (
      <>
        <DetailView
          task={currentTask}
          projectId={projectId}
          projectName={projectName}
          workspacePath={workspacePath}
          onBack={() => { setView('list'); setSelectedTask(null) }}
          onTaskChange={t => { handleSave(t); setSelectedTask(t) }}
          onNavigateToSession={handleNavigateToSession}
          onEdit={openEdit}
        />
        {showForm && (
          <TaskForm
            projectId={projectId}
            defaultModel={defaultModel}
            workspacePath={workspacePath}
            initial={editTarget}
            onSave={handleSave}
            onClose={() => { setShowForm(false); setEditTarget(undefined) }}
          />
        )}
      </>
    )
  }

  // List view
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--color-bg-base)' }}>
      {/* Header */}
      <div style={{
        height: 48, flexShrink: 0, display: 'flex', alignItems: 'center',
        padding: '0 20px', borderBottom: '1px solid var(--color-border-subtle)',
        background: 'var(--color-bg-nav)',
      }}>
        <Clock size={15} style={{ color: 'var(--color-text-muted)', marginRight: 8 }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', flex: 1 }}>定时任务</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-disabled)', marginRight: 12 }}>
          {tasks.filter(t => t.enabled).length} 个启用
        </span>
        <button onClick={openCreate} style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
          border: 'none', background: 'var(--color-accent-primary)', color: '#fff', cursor: 'pointer',
        }}>
          <Plus size={13} /> 新建
        </button>
      </div>

      {/* Card grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column' }}>
        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--color-text-disabled)' }} />
          </div>
        ) : tasks.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 360 }}>
            <div style={{
              width: 'min(420px, 100%)',
              padding: '30px 28px',
              borderRadius: 16,
              border: '1px solid var(--theme-border)',
              background: 'var(--theme-bg-surface)',
              boxShadow: 'var(--shell-panel-shadow-soft)',
              textAlign: 'center',
            }}>
              <div style={{
                width: 58,
                height: 58,
                borderRadius: 15,
                margin: '0 auto 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--theme-bg-active)',
                color: 'var(--color-accent-primary)',
                border: '1px solid var(--theme-border-strong)',
              }}>
                <Clock size={26} />
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--color-text-primary)', margin: '0 0 8px' }}>暂无定时任务</h3>
              <p style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--color-text-muted)', margin: '0 0 18px' }}>
                创建周期任务，让 Agent 按计划执行巡检、总结、代码审查或内容生成。
              </p>
              <button onClick={openCreate} style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '8px 16px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                border: 'none',
                background: 'var(--color-accent-primary)',
                color: '#fff',
                cursor: 'pointer',
              }}>
                <Plus size={13} /> 创建第一个任务
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: 14 }}>
            {tasks.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                projectId={projectId}
                onToggle={handleToggle}
                onEdit={openEdit}
                onDelete={handleDelete}
                onClick={t => { setSelectedTask(t); setView('detail') }}
              />
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <TaskForm
          projectId={projectId}
          defaultModel={defaultModel}
          workspacePath={workspacePath}
          initial={editTarget}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditTarget(undefined) }}
        />
      )}
    </div>
  )
}
