'use client'

import { useTransition, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Loader2, MessageSquare, Layers, Zap, Store, Trash2, Settings, FolderOpen } from 'lucide-react'
import type { Project } from '@/shared/types'
import { APP_VERSION } from '@/brand/version'

const NAV_ITEMS = [
  { id: 'chat',        label: '对话',        href: '/chat',        Icon: MessageSquare },
  { id: 'projects',    label: '项目',        href: '/projects',    Icon: Layers },
  { id: 'skills',      label: 'Skills',      href: '/skills',      Icon: Zap },
  { id: 'marketplace', label: 'Marketplace', href: '/marketplace', Icon: Store },
  { id: 'trash',       label: 'Trash',       href: '/trash',       Icon: Trash2 },
  { id: 'settings',    label: 'Settings',    href: '/settings',    Icon: Settings },
]

function NavLink({
  href,
  label,
  icon,
  isActive,
}: {
  href: string
  label: string
  icon: React.ReactNode
  isActive: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const handleClick = () => {
    if (isActive) return
    startTransition(() => { router.push(href) })
  }

  return (
    <button
      onClick={handleClick}
      title={label}
      className="flex items-center w-full transition-all duration-150"
      style={{
        paddingTop: '11px',
        paddingBottom: '11px',
        paddingLeft: '12px',
        paddingRight: '12px',
        gap: 12,
        width: 'calc(100% - 20px)',
        margin: '0 10px 6px',
        borderRadius: 9,
        backgroundColor: isActive ? 'var(--theme-bg-active)' : 'transparent',
        color: isActive
          ? 'var(--color-accent-primary)'
          : isPending
            ? 'var(--color-text-secondary)'
            : 'var(--color-text-muted)',
        borderTop: 'none',
        borderLeft: 'none',
        borderBottom: 'none',
        borderRight: 'none',
        boxShadow: isActive ? 'inset 0 0 0 1px var(--theme-border-strong)' : 'none',
        cursor: isActive ? 'default' : 'pointer',
      }}
      onMouseEnter={e => {
        if (!isActive && !isPending) {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--theme-bg-hover)'
          ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'
        }
      }}
      onMouseLeave={e => {
        if (!isActive && !isPending) {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
          ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'
        }
      }}
    >
      <span className="shrink-0">
        {isPending
          ? <Loader2 size={18} className="animate-spin" />
          : icon
        }
      </span>
      <span style={{ fontSize: '13px', fontWeight: 500, letterSpacing: 0 }}>{label}</span>
    </button>
  )
}

function PinnedProjectLink({ project, isActive }: { project: Project; isActive: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const handleClick = () => {
    if (isActive) return
    startTransition(() => { router.push(`/projects/${project.id}`) })
  }

  return (
    <button
      onClick={handleClick}
      title={project.name}
      className="flex items-center w-full transition-all duration-150"
      style={{
        paddingTop: '9px',
        paddingBottom: '9px',
        paddingLeft: '12px',
        paddingRight: '12px',
        gap: 10,
        width: 'calc(100% - 20px)',
        margin: '0 10px 4px',
        borderRadius: 8,
        backgroundColor: isActive ? 'var(--theme-bg-active)' : 'transparent',
        color: isActive ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
        borderTop: 'none',
        borderLeft: 'none',
        borderBottom: 'none',
        borderRight: 'none',
        boxShadow: isActive ? 'inset 0 0 0 1px var(--theme-border-strong)' : 'none',
        cursor: isActive ? 'default' : 'pointer',
      }}
      onMouseEnter={e => {
        if (!isActive && !isPending) {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--theme-bg-hover)'
          ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'
        }
      }}
      onMouseLeave={e => {
        if (!isActive && !isPending) {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
          ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'
        }
      }}
    >
      <span className="shrink-0">
        {isPending
          ? <Loader2 size={14} className="animate-spin" />
          : <FolderOpen size={14} />
        }
      </span>
      <span style={{
        fontSize: '12px', fontWeight: 500,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        flex: 1, textAlign: 'left',
      }}>
        {project.name}
      </span>
    </button>
  )
}

export function LeftNav() {
  const pathname = usePathname() // still needed for isActive checks
  const [pinnedProjects, setPinnedProjects] = useState<Project[]>([])

  useEffect(() => {
    const fetchPinned = () => {
      fetch('/api/projects')
        .then(r => r.json())
        .then(data => {
          setPinnedProjects((data.projects ?? []).filter((p: Project) => p.isPinned))
        })
        .catch(() => {})
    }

    fetchPinned() // initial load

    // Listen for pin/unpin actions from anywhere in the app
    window.addEventListener('loom:pin-changed', fetchPinned)
    return () => window.removeEventListener('loom:pin-changed', fetchPinned)
  }, []) // mount-only — no pathname dependency, no full-page-refresh feel

  return (
    <nav
      className="shrink-0 flex flex-col h-full select-none"
      style={{
        width: '204px',
        background: 'var(--shell-panel-bg-muted)',
        border: '1px solid var(--shell-panel-border)',
        borderRadius: 'var(--shell-radius-lg)',
        boxShadow: 'var(--shell-panel-shadow-soft)',
        overflow: 'hidden',
      }}
      aria-label="主导航"
    >
      {/* ── Top padding ── */}
      <div style={{ height: '16px' }} />

      {/* ── Main nav ── */}
      <div className="flex-1 overflow-y-auto">
        {NAV_ITEMS.map(item => {
          const isActive = item.href === '/projects'
            ? pathname === '/projects' || pathname.startsWith('/projects/')
            : pathname.startsWith(item.href)
          return (
            <NavLink
              key={item.id}
              href={item.href}
              label={item.label}
              icon={<item.Icon size={18} />}
              isActive={isActive}
            />
          )
        })}

        {/* ── Pinned section ── */}
        <div style={{ margin: '28px 10px 8px', padding: '10px 10px 0', borderTop: '1px solid var(--shell-panel-border)' }}>
          <span style={{
            fontSize: '12px',
            fontWeight: 600,
            letterSpacing: 0,
            color: 'var(--color-text-disabled)',
          }}>
            Pinned
          </span>
        </div>

        {pinnedProjects.map(p => (
          <PinnedProjectLink
            key={p.id}
            project={p}
            isActive={pathname === `/projects/${p.id}` || pathname.startsWith(`/projects/${p.id}/`)}
          />
        ))}
      </div>

      <div
        style={{
          flexShrink: 0,
          padding: '10px 14px 12px',
          borderTop: '1px solid var(--shell-panel-border)',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: 22,
            padding: '0 8px',
            borderRadius: 999,
            border: '1px solid var(--theme-border)',
            background: 'var(--theme-bg-surface)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.04em',
            color: 'var(--color-text-muted)',
            opacity: 0.82,
          }}
        >
          {APP_VERSION}
        </span>
      </div>
    </nav>
  )
}
