'use client'

import type { SkillItem } from '@/modules/skills/use-skills'
import { cn } from '@/shared/lib/utils'
import { FileText, Star } from 'lucide-react'

const SOURCE_LABELS: Record<SkillItem['sourceType'], string> = {
  builtin: '官方',
  global: '全局',
  project: '项目',
  session: '会话',
  user: '自建',
}

interface SkillCardProps {
  skill: SkillItem
  onTogglePin: (id: string, currentlyPinned: boolean) => void
  onSelect: (skill: SkillItem) => void
  selected?: boolean
}

export function SkillCard({ skill, onTogglePin, onSelect, selected }: SkillCardProps) {
  return (
    <div
      onClick={() => onSelect(skill)}
      className={cn(
        'group cursor-pointer rounded-xl border px-4 py-3 transition-colors',
        'hover:border-[var(--color-border-strong)]',
      )}
      style={{
        background: selected ? 'var(--color-bg-surface-high)' : 'var(--color-bg-surface)',
        borderColor: selected ? 'var(--color-border-strong)' : 'transparent',
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{ background: 'var(--color-bg-canvas)', color: 'var(--color-text-muted)' }}
        >
          <FileText size={16} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {skill.name}
                </h3>
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px]" style={{ background: 'var(--color-bg-canvas)', color: 'var(--color-text-muted)' }}>
                  {SOURCE_LABELS[skill.sourceType]}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs leading-5" style={{ color: 'var(--color-text-muted)' }}>
                {skill.summary || skill.description || '暂无说明'}
              </p>
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onTogglePin(skill.id, skill.isPinned)
              }}
              className="shrink-0 rounded-lg p-1.5 opacity-75 transition-opacity hover:opacity-100"
              title={skill.isPinned ? '取消收藏' : '收藏'}
              aria-label={skill.isPinned ? '取消收藏' : '收藏'}
              style={{ color: skill.isPinned ? 'var(--color-accent-warning)' : 'var(--color-text-muted)' }}
            >
              <Star size={15} fill={skill.isPinned ? 'currentColor' : 'none'} />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {skill.stage && <Chip>{skill.stage}</Chip>}
            {skill.category && <Chip>{skill.category}</Chip>}
            {skill.tags?.slice(0, 3).map(tag => <Chip key={tag}>{tag}</Chip>)}
            {!skill.stage && !skill.category && (!skill.tags || skill.tags.length === 0) && <Chip>未分类</Chip>}
          </div>
        </div>
      </div>
    </div>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: 'var(--color-bg-canvas)', color: 'var(--color-text-muted)' }}>
      {children}
    </span>
  )
}
