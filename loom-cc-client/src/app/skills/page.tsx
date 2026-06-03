'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  ChevronDown,
  Code2,
  GitBranch,
  LayoutGrid,
  LayoutList,
  Package,
  PenLine,
  Plus,
  Presentation,
  Search,
  Shield,
  Sparkles,
  Star,
  Wrench,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useSkills } from '@/modules/skills/use-skills'
import type { SkillItem } from '@/modules/skills/use-skills'
import { useProjects } from '@/modules/projects/use-projects'
import { SkillDetailPanel } from '@/components/skills/skill-detail-panel'
import { SkillCreateDialog } from '@/components/skills/skill-create-dialog'
import { cn } from '@/shared/lib/utils'

// ── Icon + Color System ─────────────────────────────────────────

const COLOR_PALETTE = [
  { bg: 'rgba(13,148,136,0.14)',  icon: '#2DD4BF' },  // 0 teal
  { bg: 'rgba(217,119,6,0.14)',   icon: '#F59E0B' },  // 1 amber   → builtin
  { bg: 'rgba(168,85,247,0.14)',  icon: '#C084FC' },  // 2 purple  → global
  { bg: 'rgba(5,150,105,0.14)',   icon: '#34D399' },  // 3 emerald → project
  { bg: 'rgba(225,29,72,0.14)',   icon: '#FB7185' },  // 4 rose
  { bg: 'rgba(234,88,12,0.14)',   icon: '#FB923C' },  // 5 orange
  { bg: 'rgba(219,39,119,0.14)',  icon: '#F472B6' },  // 6 pink
  { bg: 'rgba(202,138,4,0.14)',   icon: '#EAB308' },  // 7 gold
]

function hashInt(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

function getSkillColor(skill: SkillItem) {
  if (skill.sourceType === 'builtin') return COLOR_PALETTE[1]
  if (skill.sourceType === 'global') return COLOR_PALETTE[2]
  if (skill.sourceType === 'project') return COLOR_PALETTE[3]
  return COLOR_PALETTE[hashInt(skill.id || skill.slug) % COLOR_PALETTE.length]
}

function getSkillIcon(skill: SkillItem): LucideIcon {
  const t = [skill.slug, skill.stage, skill.category, skill.name, ...(skill.tags ?? [])].join(' ').toLowerCase()
  if (t.includes('ppt') || t.includes('slides') || t.includes('演示')) return Presentation
  if (t.includes('创建') || t.includes('builder')) return Sparkles
  if (t.includes('ai') || t.includes('bot') || t.includes('agent')) return Bot
  if (t.includes('执行') || t.includes('运行') || t.includes('zap')) return Zap
  if (t.includes('代码') || t.includes('开发') || t.includes('code')) return Code2
  if (t.includes('审查') || t.includes('检查') || t.includes('review')) return Shield
  if (t.includes('工具') || t.includes('自动')) return Wrench
  if (t.includes('写') || t.includes('生成') || t.includes('内容')) return PenLine
  if (t.includes('git') || t.includes('分支')) return GitBranch
  return Package
}

// ── Helpers ─────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  builtin: 'Loom 官方',
  global: '全局',
  project: '项目',
  session: '会话',
  user: '自建',
}

const FEATURED_SKILL_ORDER: Record<string, number> = {
  'student-ppt-skill': 0,
  'skill-builder': 10,
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return '刚刚'
  if (diffMins < 60) return `${diffMins} 分钟前`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours} 小时前`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays} 天前`
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

// ── Filter & Sort Logic ─────────────────────────────────────────

type GroupFilter = 'all' | 'builtin' | 'global' | 'project' | 'pinned' | 'uncategorized'
type SortOrder = 'name' | 'newest' | 'updated'
type ViewMode = 'grid' | 'list'

const GROUP_TABS: { key: GroupFilter; label: string }[] = [
  { key: 'all',           label: '全部' },
  { key: 'builtin',       label: 'Loom 官方' },
  { key: 'global',        label: '全局' },
  { key: 'project',       label: '项目' },
  { key: 'pinned',        label: '已收藏' },
  { key: 'uncategorized', label: '未分类' },
]

const SORT_OPTIONS: { key: SortOrder; label: string }[] = [
  { key: 'name',    label: '名称 A→Z' },
  { key: 'newest',  label: '最新创建' },
  { key: 'updated', label: '最近更新' },
]

function filterSkills(skills: SkillItem[], group: GroupFilter): SkillItem[] {
  switch (group) {
    case 'pinned':        return skills.filter(s => s.isPinned)
    case 'global':        return skills.filter(s => s.sourceType === 'global')
    case 'project':       return skills.filter(s => s.sourceType === 'project')
    case 'builtin':       return skills.filter(s => s.sourceType === 'builtin')
    case 'uncategorized': return skills.filter(s => !s.stage && !s.category && (!s.tags || s.tags.length === 0))
    default:              return skills
  }
}

function sortSkills(skills: SkillItem[], order: SortOrder): SkillItem[] {
  return [...skills].sort((a, b) => {
    const rankDiff = (FEATURED_SKILL_ORDER[a.slug] ?? 1000) - (FEATURED_SKILL_ORDER[b.slug] ?? 1000)
    if (order === 'name') return rankDiff || a.name.localeCompare(b.name)
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return tb - ta || rankDiff
  })
}

function matchesSearch(skill: SkillItem, query: string): boolean {
  if (!query.trim()) return true
  const q = query.toLowerCase()
  return [
    skill.name, skill.slug, skill.description, skill.summary,
    skill.stage, skill.category,
    ...(skill.tags ?? []),
    ...(skill.inputs ?? []),
    ...(skill.outputs ?? []),
  ].filter(Boolean).some(v => String(v).toLowerCase().includes(q))
}

// ── Sort Dropdown ───────────────────────────────────────────────

function SortDropdown({ value, onChange }: { value: SortOrder; onChange: (v: SortOrder) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const current = SORT_OPTIONS.find(o => o.key === value)!

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center rounded-xl border"
        style={{
          gap: 6, padding: '5px 12px', fontSize: 13, lineHeight: '20px',
          borderColor: 'var(--color-border-subtle)',
          color: 'var(--color-text-secondary)',
          background: 'var(--color-bg-surface)',
        }}
      >
        {current.label}
        <ChevronDown
          size={12}
          style={{ transform: open ? 'rotate(180deg)' : '', transition: 'transform 0.15s' }}
        />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-1.5 min-w-[130px] overflow-hidden rounded-xl border shadow-lg"
          style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border-subtle)' }}
        >
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => { onChange(opt.key); setOpen(false) }}
              className="block w-full px-4 py-2.5 text-left text-sm hover:bg-[var(--color-bg-surface-high)]"
              style={{
                color: opt.key === value ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                fontWeight: opt.key === value ? 600 : 400,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Grid Card ───────────────────────────────────────────────────

function SkillGridCard({ skill, selected, onSelect, onTogglePin }: {
  skill: SkillItem
  selected: boolean
  onSelect: () => void
  onTogglePin: () => void
}) {
  const color = getSkillColor(skill)
  const Icon = getSkillIcon(skill)
  const relTime = formatRelativeTime(skill.createdAt)

  return (
    <div
      onClick={onSelect}
      className="flex flex-col cursor-pointer transition-all duration-150"
      style={{
        padding: '16px',
        borderRadius: 12,
        background: selected ? 'var(--color-bg-surface-high)' : 'var(--color-bg-surface)',
        border: `1px solid ${selected ? 'var(--color-border-strong)' : 'var(--color-border-subtle)'}`,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--color-border-strong)'
        e.currentTarget.style.background = 'var(--color-bg-surface-high)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = selected ? 'var(--color-border-strong)' : 'var(--color-border-subtle)'
        e.currentTarget.style.background = selected ? 'var(--color-bg-surface-high)' : 'var(--color-bg-surface)'
      }}
    >
      {/* Top: icon + title */}
      <div className="flex items-center gap-3 mb-3">
        <div
          className="flex shrink-0 items-center justify-center rounded-xl"
          style={{ width: 36, height: 36, background: color.bg, color: color.icon }}
        >
          <Icon size={16} />
        </div>
        <h3
          className="flex-1 min-w-0 text-[15px] font-bold leading-snug"
          style={{ color: 'var(--color-text-primary)', wordBreak: 'break-word' }}
        >
          {skill.name}
        </h3>
      </div>

      {/* Description */}
      <p
        className="flex-1 text-[12px] leading-[1.6]"
        style={{
          color: 'var(--color-text-muted)',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          minHeight: 58,
        }}
      >
        {skill.summary || skill.description || '暂无说明'}
      </p>

      {/* Divider */}
      <div style={{ borderTop: '1px solid var(--color-border-subtle)', margin: '14px 0 12px' }} />

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
          {relTime ? `更新于 ${relTime}` : SOURCE_LABELS[skill.sourceType] ?? skill.sourceType}
        </span>
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onTogglePin() }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 26, height: 26, borderRadius: 6, flexShrink: 0,
            border: '1px solid var(--color-border-strong)',
            background: 'var(--color-bg-surface-high)',
            color: skill.isPinned ? '#F59E0B' : 'var(--color-text-muted)',
            cursor: 'pointer',
          }}
        >
          <Star size={12} fill={skill.isPinned ? 'currentColor' : 'none'} />
        </button>
      </div>
    </div>
  )
}

// ── List Row ────────────────────────────────────────────────────

function SkillListRow({ skill, selected, onSelect, onTogglePin }: {
  skill: SkillItem
  selected: boolean
  onSelect: () => void
  onTogglePin: () => void
}) {
  const color = getSkillColor(skill)
  const Icon = getSkillIcon(skill)

  return (
    <div
      onClick={onSelect}
      className="flex cursor-pointer items-center gap-4 transition-all duration-150"
      style={{
        padding: '14px 18px',
        borderRadius: 10,
        background: selected ? 'var(--color-bg-surface-high)' : 'var(--color-bg-surface)',
        border: `1px solid ${selected ? 'var(--color-border-strong)' : 'var(--color-border-subtle)'}`,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--color-border-strong)'
        e.currentTarget.style.background = 'var(--color-bg-surface-high)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = selected ? 'var(--color-border-strong)' : 'var(--color-border-subtle)'
        e.currentTarget.style.background = selected ? 'var(--color-bg-surface-high)' : 'var(--color-bg-surface)'
      }}
    >
      {/* Icon */}
      <div
        className="flex shrink-0 items-center justify-center rounded-xl"
        style={{ width: 32, height: 32, background: color.bg, color: color.icon }}
      >
        <Icon size={14} />
      </div>

      {/* Name + description */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
            {skill.name}
          </span>
          <span
            style={{
              padding: '1px 7px', borderRadius: 999, fontSize: 10, flexShrink: 0,
              background: 'var(--color-bg-canvas)', color: 'var(--color-text-muted)',
            }}
          >
            {SOURCE_LABELS[skill.sourceType] ?? skill.sourceType}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[12px] leading-[1.5]" style={{ color: 'var(--color-text-muted)' }}>
          {skill.summary || skill.description || '暂无说明'}
        </p>
      </div>

      {/* Time + star */}
      <div className="flex shrink-0 items-center gap-3">
        <span className="hidden text-[11px] sm:block" style={{ color: 'var(--color-text-muted)' }}>
          {formatRelativeTime(skill.createdAt)}
        </span>
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onTogglePin() }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: 7,
            border: '1px solid var(--color-border-strong)',
            background: 'var(--color-bg-surface-high)',
            color: skill.isPinned ? '#F59E0B' : 'var(--color-text-muted)',
            cursor: 'pointer',
          }}
        >
          <Star size={13} fill={skill.isPinned ? 'currentColor' : 'none'} />
        </button>
      </div>
    </div>
  )
}

// ── Empty State ─────────────────────────────────────────────────

function EmptyState({ group }: { group: GroupFilter }) {
  const messages: Record<GroupFilter, string> = {
    all:           '暂无能力。点击右上角创建你的第一个 Skill。',
    builtin:       '暂无 Loom 官方能力。',
    global:        '还没有全局能力。创建一个 Skill，让所有项目都能使用。',
    project:       '当前没有项目能力。打开带模板的项目后，对应 Skills 会出现在这里。',
    pinned:        '还没有收藏能力。收藏常用 Skill 后会显示在这里。',
    uncategorized: '没有未分类的能力。',
  }
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <Sparkles size={32} className="mb-3 opacity-25" style={{ color: 'var(--color-text-muted)' }} />
      <p className="max-w-xs text-sm leading-6" style={{ color: 'var(--color-text-muted)' }}>
        {messages[group]}
      </p>
    </div>
  )
}

// ── Main Page ───────────────────────────────────────────────────

export default function SkillsPage() {
  const [group, setGroup] = useState<GroupFilter>('all')
  const [sortOrder, setSortOrder] = useState<SortOrder>('name')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<SkillItem | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const { skills, loading, pinSkill, unpinSkill, refetch } = useSkills()
  const { projects } = useProjects()

  const counts = useMemo(() => ({
    all:           skills.length,
    builtin:       skills.filter(s => s.sourceType === 'builtin').length,
    global:        skills.filter(s => s.sourceType === 'global').length,
    project:       skills.filter(s => s.sourceType === 'project').length,
    pinned:        skills.filter(s => s.isPinned).length,
    uncategorized: skills.filter(s => !s.stage && !s.category && (!s.tags || s.tags.length === 0)).length,
  }), [skills])

  const filtered = useMemo(
    () => sortSkills(
      filterSkills(skills, group).filter(s => matchesSearch(s, search)),
      sortOrder,
    ),
    [skills, group, search, sortOrder],
  )

  const handleTogglePin = (id: string, pinned: boolean) => {
    if (pinned) {
      unpinSkill(id)
      if (selected?.id === id) setSelected(prev => prev ? { ...prev, isPinned: false } : null)
    } else {
      pinSkill(id)
      if (selected?.id === id) setSelected(prev => prev ? { ...prev, isPinned: true } : null)
    }
  }

  const handleInstalled = async (installedSkill: SkillItem) => {
    setSelected(prev => prev && prev.slug === installedSkill.slug ? { ...prev, ...installedSkill } : prev)
    await refetch()
  }

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: 'var(--color-bg-canvas)' }}>
      {/* Toolbar */}
      <div
        className="flex shrink-0 items-center"
        style={{ padding: '20px 24px 0', gap: 12 }}
      >
        <div className="relative flex-1">
          <Search
            size={14}
            style={{
              position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--color-text-muted)', pointerEvents: 'none',
            }}
          />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索 skill 名称、用途、输入或产出"
            className="w-full outline-none text-sm"
            style={{
              borderRadius: 12,
              border: '1px solid var(--color-border-subtle)',
              background: 'var(--color-bg-surface)',
              color: 'var(--color-text-primary)',
              padding: '9px 16px 9px 40px',
            }}
          />
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex shrink-0 items-center font-semibold"
          style={{
            gap: 7, borderRadius: 12, padding: '9px 18px', fontSize: 13,
            background: 'var(--color-accent-primary)', color: '#000',
          }}
        >
          <Plus size={14} />
          创建 SKILL
        </button>
      </div>

      {/* Controls row */}
      <div
        className="flex shrink-0 items-center"
        style={{ paddingLeft: 24, paddingRight: 24, paddingTop: 10, paddingBottom: 10, marginTop: 8 }}
      >
        {/* Group pills — left aligned */}
        <div className="flex flex-1 items-center overflow-x-auto" style={{ gap: 6 }}>
          {GROUP_TABS.map(tab => {
            const active = group === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setGroup(tab.key)}
                className="whitespace-nowrap rounded-full transition-all"
                style={{
                  minHeight: 22,
                  padding: '2px 14px',
                  fontSize: 12,
                  lineHeight: '16px',
                  background: active ? 'rgba(245,158,11,0.12)' : 'transparent',
                  color: active ? '#F59E0B' : 'var(--color-text-muted)',
                  border: active
                    ? '1px solid rgba(245,158,11,0.35)'
                    : '1px solid var(--color-border-subtle)',
                }}
              >
                {tab.label}
                {counts[tab.key] > 0 && (
                  <span style={{ marginLeft: 5, opacity: 0.7 }}>{counts[tab.key]}</span>
                )}
              </button>
            )
          })}
        </div>

        {/* Right controls — right aligned */}
        <div className="flex shrink-0 items-center" style={{ gap: 10, marginLeft: 16 }}>
          <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {filtered.length} 个
          </span>
          <SortDropdown value={sortOrder} onChange={setSortOrder} />

          {/* List/Grid toggle */}
          <div
            className="flex items-center overflow-hidden"
            style={{ borderRadius: 8, border: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-canvas)' }}
          >
            <button
              onClick={() => setViewMode('list')}
              className="flex items-center transition-colors"
              style={{
                gap: 5, padding: '5px 12px', fontSize: 13, lineHeight: '20px',
                background: viewMode === 'list' ? 'rgba(245,158,11,0.12)' : 'transparent',
                color: viewMode === 'list' ? '#F59E0B' : 'var(--color-text-muted)',
                borderRight: '1px solid var(--color-border-subtle)',
              }}
            >
              <LayoutList size={14} />
              <span style={{ marginLeft: 4 }}>List</span>
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className="flex items-center transition-colors"
              style={{
                gap: 5, padding: '5px 12px', fontSize: 13, lineHeight: '20px',
                background: viewMode === 'grid' ? 'rgba(245,158,11,0.12)' : 'transparent',
                color: viewMode === 'grid' ? '#F59E0B' : 'var(--color-text-muted)',
              }}
            >
              <LayoutGrid size={14} />
              <span style={{ marginLeft: 4 }}>Grid</span>
            </button>
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="min-h-0 flex-1 overflow-y-auto" style={{ paddingLeft: 24, paddingRight: 24, paddingBottom: 24 }}>
        {loading ? (
          <div
            className={viewMode === 'grid' ? 'grid gap-4' : 'space-y-3'}
            style={viewMode === 'grid' ? { gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' } : {}}
          >
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className={cn('animate-pulse rounded-xl', viewMode === 'grid' ? 'h-[180px]' : 'h-[68px]')}
                style={{ background: 'var(--color-bg-surface-high)' }}
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState group={group} />
        ) : viewMode === 'grid' ? (
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
          >
            {filtered.map(skill => (
              <SkillGridCard
                key={skill.id}
                skill={skill}
                selected={selected?.id === skill.id}
                onSelect={() => setSelected(skill)}
                onTogglePin={() => handleTogglePin(skill.id, skill.isPinned)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(skill => (
              <SkillListRow
                key={skill.id}
                skill={skill}
                selected={selected?.id === skill.id}
                onSelect={() => setSelected(skill)}
                onTogglePin={() => handleTogglePin(skill.id, skill.isPinned)}
              />
            ))}
          </div>
        )}
      </div>

      <SkillDetailPanel
        skill={selected}
        onClose={() => setSelected(null)}
        onTogglePin={handleTogglePin}
        onInstalled={handleInstalled}
        projects={projects}
      />
      <SkillCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={refetch}
      />
    </div>
  )
}
