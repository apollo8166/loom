'use client'

import { useTheme } from '@/shared/lib/theme-provider'
import { Monitor, Sun, Moon } from 'lucide-react'

const THEME_OPTIONS = [
  { value: 'light' as const, label: '浅色', icon: Sun },
  { value: 'dark' as const, label: '深色', icon: Moon },
  { value: 'system' as const, label: '跟随系统', icon: Monitor },
]

export function AppearanceSettings() {
  const { theme, resolvedTheme, setTheme } = useTheme()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Theme Selector */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label style={{ fontSize: 11, letterSpacing: '0.04em', color: 'var(--color-text-muted)' }}>
          主题模式
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          {THEME_OPTIONS.map(opt => {
            const isActive = theme === opt.value
            const Icon = opt.icon
            return (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 16px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                  border: isActive
                    ? '1px solid rgba(99,102,241,0.5)'
                    : '1px solid var(--color-border-subtle)',
                  background: isActive
                    ? 'rgba(99,102,241,0.1)'
                    : 'transparent',
                  color: isActive
                    ? 'var(--color-accent-primary)'
                    : 'var(--color-text-muted)',
                }}
              >
                <Icon size={15} />
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Visual Preview */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label style={{ fontSize: 11, letterSpacing: '0.04em', color: 'var(--color-text-muted)' }}>
          预览
        </label>
        <div style={{
          borderRadius: 12, overflow: 'hidden',
          border: '1px solid var(--color-border-subtle)',
          background: 'var(--color-bg-surface)',
        }}>
          {/* Fake title bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 12px',
            background: 'var(--color-bg-nav)',
            borderBottom: '1px solid var(--color-border-subtle)',
          }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#E85A4F' }} />
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#F59E0B' }} />
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#32D583' }} />
            <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--color-text-muted)' }}>
              Loom CC - {resolvedTheme === 'dark' ? '深色模式' : '浅色模式'}
            </span>
          </div>

          {/* Fake content area */}
          <div style={{ display: 'flex', padding: 12, gap: 12 }}>
            {/* Sidebar mock */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 64, flexShrink: 0 }}>
              <div style={{ height: 8, borderRadius: 4, background: 'var(--color-bg-surface-high)', width: '100%' }} />
              <div style={{ height: 8, borderRadius: 4, background: 'var(--color-accent-primary)', width: '80%', opacity: 0.5 }} />
              <div style={{ height: 8, borderRadius: 4, background: 'var(--color-bg-surface-high)', width: '70%' }} />
            </div>
            {/* Main content mock */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
              <div style={{ height: 10, borderRadius: 4, background: 'var(--color-text-primary)', width: '40%', opacity: 0.3 }} />
              <div style={{ height: 8, borderRadius: 4, background: 'var(--color-bg-surface-highest)', width: '100%' }} />
              <div style={{ height: 8, borderRadius: 4, background: 'var(--color-bg-surface-highest)', width: '85%' }} />
              <div style={{ height: 8, borderRadius: 4, background: 'var(--color-bg-surface-highest)', width: '60%' }} />
              <div style={{
                marginTop: 4, height: 24, borderRadius: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--color-bg-surface-highest)',
                border: '1px solid var(--color-border-subtle)',
              }}>
                <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>
                  输入框
                </span>
              </div>
            </div>
          </div>
        </div>
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          当前：{theme === 'system' ? `跟随系统（${resolvedTheme === 'dark' ? '深色' : '浅色'}）` : resolvedTheme === 'dark' ? '深色模式' : '浅色模式'}
        </p>
      </div>
    </div>
  )
}
