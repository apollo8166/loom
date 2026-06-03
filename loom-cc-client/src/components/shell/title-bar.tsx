'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight, BookOpen, Command, Layers, MessageSquare, Moon, Monitor,
  Palette, Settings, Store, Sun, Trash2, X, Zap,
} from 'lucide-react'
import { useTheme } from '@/shared/lib/theme-provider'
import { BRAND } from '@/brand/config'

const APP_VERSION = 'v1.1.0'

const THEME_OPTIONS = [
  { value: 'light' as const, label: '浅色', Icon: Sun },
  { value: 'dark' as const, label: '深色', Icon: Moon },
  { value: 'system' as const, label: '跟随系统', Icon: Monitor },
]

/**
 * Two-row application bar — WPS Office style.
 *
 * Row 1 (h-8 = 32px): macOS traffic light zone. Entirely draggable.
 * Row 2 (h-12 = 48px): Logo left · Search centered (absolute) · Actions right.
 */
export function TitleBar() {
  const router = useRouter()
  const [isMac, setIsMac] = useState(false)
  const { theme, resolvedTheme, setTheme } = useTheme()
  const isLight = resolvedTheme === 'light'
  const [themeOpen, setThemeOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [guideTab, setGuideTab] = useState<'start' | 'shortcuts' | 'changelog'>('start')
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const themeRef = useRef<HTMLDivElement>(null)
  const paletteInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!themeOpen) return
    const handler = (e: MouseEvent) => {
      if (themeRef.current && !themeRef.current.contains(e.target as Node)) {
        setThemeOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [themeOpen])

  useEffect(() => {
    setIsMac(window.electronAPI?.platform === 'darwin')
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(true)
        setGuideOpen(false)
        setThemeOpen(false)
      }
      if (e.key === 'Escape') {
        setPaletteOpen(false)
        setGuideOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (!paletteOpen) return
    setSelectedIdx(0)
    requestAnimationFrame(() => paletteInputRef.current?.focus())
  }, [paletteOpen])

  const runCommand = (run: () => void) => {
    run()
    setPaletteOpen(false)
    setQuery('')
  }

  const commands = [
    { id: 'chat', label: 'Open Chat', desc: 'Go to standalone chat workspace', Icon: MessageSquare, run: () => router.push('/chat') },
    { id: 'projects', label: 'Open Projects', desc: 'Browse and manage projects', Icon: Layers, run: () => router.push('/projects') },
    { id: 'skills', label: 'Open Skills', desc: 'Manage local skills', Icon: Zap, run: () => router.push('/skills') },
    { id: 'marketplace', label: 'Open Marketplace', desc: 'Explore plugins and skills', Icon: Store, run: () => router.push('/marketplace') },
    { id: 'trash', label: 'Open Trash', desc: 'Review archived projects', Icon: Trash2, run: () => router.push('/trash') },
    { id: 'settings', label: 'Open Settings', desc: 'Configure providers and appearance', Icon: Settings, run: () => router.push('/settings') },
    { id: 'theme-light', label: 'Set Light Theme', desc: 'Switch appearance to light mode', Icon: Sun, run: () => setTheme('light') },
    { id: 'theme-dark', label: 'Set Dark Theme', desc: 'Switch appearance to dark mode', Icon: Moon, run: () => setTheme('dark') },
    { id: 'theme-system', label: 'Use System Theme', desc: 'Follow system appearance', Icon: Monitor, run: () => setTheme('system') },
  ]

  const filteredCommands = commands.filter(cmd => {
    const needle = query.trim().toLowerCase()
    if (!needle) return true
    return `${cmd.label} ${cmd.desc}`.toLowerCase().includes(needle)
  })

  const dragStyle = { WebkitAppRegion: 'drag' } as React.CSSProperties
  const sharedBg = { background: 'var(--theme-header-bg)' }

  return (
    <header
      className="shrink-0 z-50"
      style={{
        ...sharedBg,
        ...dragStyle,
        position: 'relative',
        backdropFilter: 'blur(12px)',
        borderBottom: `1px solid var(--shell-panel-border)`,
        boxShadow: 'var(--shell-panel-shadow-soft)',
      }}
    >
      {/* ── Row 1: traffic light zone (32px) ── */}
      <div className="h-8 flex items-center" style={{ ...dragStyle }}>
        {isMac && <div className="w-20 shrink-0" />}
      </div>

      {/* ── Row 2: main toolbar (48px) ── */}
      <div className="h-12 flex items-center relative" style={{ ...dragStyle }}>

        {/* LEFT — hero identity */}
        <div className="flex items-center shrink-0 z-10 select-none" style={{ paddingLeft: '18px', gap: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logo.png"
            alt="Loom logo"
            style={{
              height: 36,
              width: 36,
              flexShrink: 0,
              display: 'block',
              borderRadius: 10,
              boxShadow: 'var(--theme-shadow-soft)',
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                className="whitespace-nowrap brand-gradient-text"
                style={{ fontSize: '19px', fontWeight: 900, letterSpacing: '-0.02em', lineHeight: 1 }}
              >
                {BRAND.name}
              </span>
              <span
                style={{
                  height: 18,
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '0 7px',
                  borderRadius: 6,
                  background: 'var(--theme-bg-active)',
                  color: 'var(--color-accent-primary)',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.02em',
                }}
              >
                DESKTOP
              </span>
            </div>
            <span
              className="whitespace-nowrap"
              style={{
                fontSize: '10px',
                fontWeight: 600,
                letterSpacing: '0.04em',
                lineHeight: 1,
                color: isLight ? 'rgba(61,44,26,0.58)' : 'rgba(216,195,173,0.54)',
              }}
            >
              Claude Code 本地智能工作台
            </span>
          </div>
        </div>

        {/* CENTER — command palette entry */}
        <div
          className="absolute left-1/2 -translate-x-1/2 inset-y-0 flex items-center"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div className="relative">
            <Command
              className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              size={15}
              style={{ color: isLight ? 'rgba(61,44,26,0.45)' : 'rgba(216,195,173,0.48)' }}
            />
            <input
              type="text"
              placeholder="Search or run command..."
              readOnly
              className="rounded-full outline-none transition-all selectable"
              style={{
                height: '36px',
                width: 'min(44vw, 460px)',
                paddingLeft: '40px',
                paddingRight: '70px',
                backgroundColor: 'var(--theme-bg-input)',
                border: '1px solid var(--shell-panel-border)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
                color: isLight ? '#1A1008' : '#f0e0d1',
                fontSize: '13px',
                cursor: 'pointer',
              }}
              onMouseDown={e => {
                e.preventDefault()
                setPaletteOpen(true)
                setThemeOpen(false)
              }}
              onFocus={e => {
                e.currentTarget.style.borderColor = isLight ? '#D97706' : '#F59E0B'
                e.currentTarget.style.boxShadow = 'var(--theme-focus-ring)'
                e.currentTarget.style.backgroundColor = 'var(--theme-bg-raised)'
              }}
              onBlur={e => {
                e.currentTarget.style.borderColor = 'var(--shell-panel-border)'
                e.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.05)'
                e.currentTarget.style.backgroundColor = 'var(--theme-bg-input)'
              }}
            />
            <span
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2"
              style={{
                height: 22,
                display: 'inline-flex',
                alignItems: 'center',
                padding: '0 7px',
                borderRadius: 6,
                border: '1px solid var(--shell-panel-border)',
                background: 'var(--theme-bg-surface)',
                color: 'var(--color-text-muted)',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              ⌘ K
            </span>
          </div>
        </div>

        {/* Spacer — draggable */}
        <div className="flex-1" />

        {/* RIGHT — guide + theme */}
        <div
          className="flex items-center gap-2 z-10"
          style={{ paddingRight: '22px', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={() => { setGuideOpen(true); setPaletteOpen(false); setThemeOpen(false) }}
            aria-label="使用说明"
            title="使用说明"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 36,
              height: 36,
              borderRadius: 9,
              border: '1px solid var(--shell-panel-border)',
              background: 'var(--theme-bg-surface)',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
            }}
          >
            <BookOpen size={16} strokeWidth={2} />
          </button>

          {/* Theme toggle — dropdown */}
          <div ref={themeRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={() => setThemeOpen(v => !v)}
              aria-label="切换主题"
              title="切换主题"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 36,
                height: 36,
                borderRadius: 9,
                border: '1px solid var(--shell-panel-border)',
                background: 'var(--theme-bg-surface)',
                color: 'var(--color-accent-primary)',
                cursor: 'pointer',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
              }}
            >
              {isLight ? <Sun size={16} strokeWidth={2} /> : <Moon size={16} strokeWidth={2} />}
            </button>

            {themeOpen && (
              <div style={{
                position: 'absolute',
                right: 0,
                top: 'calc(100% + 8px)',
                width: 148,
                borderRadius: 10,
                overflow: 'hidden',
                boxShadow: 'var(--theme-shadow-popover)',
                border: '1px solid var(--theme-border)',
                background: 'var(--theme-bg-raised)',
                zIndex: 999,
                padding: '4px 0',
              }}>
                {THEME_OPTIONS.map(({ value, label, Icon }) => {
                  const active = theme === value
                  return (
                    <button
                      key={value}
                      onClick={() => { setTheme(value); setThemeOpen(false) }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 14px',
                        background: active
                          ? isLight ? 'rgba(217,119,6,0.10)' : 'rgba(245,158,11,0.15)'
                          : 'transparent',
                        color: active
                          ? isLight ? '#D97706' : '#F59E0B'
                          : isLight ? '#374151' : '#d8c3ad',
                        fontSize: 14,
                        cursor: 'pointer',
                        border: 'none',
                        transition: 'background 0.15s',
                      }}
                    >
                      <Icon size={15} strokeWidth={2} />
                      <span>{label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {guideOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'var(--theme-bg-overlay)',
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
          onMouseDown={() => setGuideOpen(false)}
        >
          <div
            onMouseDown={e => e.stopPropagation()}
            style={{
              width: 'min(720px, calc(100vw - 48px))',
              margin: '92px auto 0',
              borderRadius: 14,
              border: '1px solid var(--shell-panel-border)',
              background: 'var(--theme-bg-panel)',
              boxShadow: 'var(--theme-shadow-popover)',
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 20px', borderBottom: '1px solid var(--shell-panel-border)' }}>
              <div style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--theme-bg-active)',
                color: 'var(--color-accent-primary)',
                flexShrink: 0,
              }}>
                <BookOpen size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <h2 style={{ fontSize: 17, fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1 }}>Loom Guide</h2>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', padding: '2px 7px', borderRadius: 999, border: '1px solid var(--theme-border)' }}>
                    {APP_VERSION}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>Agent 桌面工作台使用说明、快捷键和版本更新记录。</p>
              </div>
              <button
                onClick={() => setGuideOpen(false)}
                aria-label="关闭"
                style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, padding: '12px 20px 0' }}>
              {[
                { id: 'start' as const, label: '快速开始' },
                { id: 'shortcuts' as const, label: '快捷键' },
                { id: 'changelog' as const, label: '更新记录' },
              ].map(tab => {
                const active = guideTab === tab.id
                return (
                  <button
                    key={tab.id}
                    onClick={() => setGuideTab(tab.id)}
                    style={{
                      height: 30,
                      padding: '0 12px',
                      borderRadius: 999,
                      border: active ? '1px solid var(--theme-border-strong)' : '1px solid var(--theme-border)',
                      background: active ? 'var(--theme-bg-active)' : 'transparent',
                      color: active ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {tab.label}
                  </button>
                )
              })}
            </div>

            <div style={{ padding: '18px 20px 22px', minHeight: 310 }}>
              {guideTab === 'start' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                  {[
                    ['Project Workspace', '从项目进入后，左侧管理 session，中间是对话，右侧是项目上下文和文件视图。'],
                    ['直接输入', '项目没有 session 时会显示统计页，底部输入第一条消息后自动创建 session。'],
                    ['Capture Area', '点击输入框左侧剪刀，或使用快捷键区域截图并上传到当前 session。'],
                    ['Command Palette', '使用 ⌘K / Ctrl+K 快速跳转页面、切换主题或打开设置。'],
                  ].map(([title, desc]) => (
                    <div key={title} style={{ padding: 14, borderRadius: 12, border: '1px solid var(--theme-border)', background: 'var(--theme-bg-surface)' }}>
                      <h3 style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-text-primary)', marginBottom: 7 }}>{title}</h3>
                      <p style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--color-text-muted)' }}>{desc}</p>
                    </div>
                  ))}
                </div>
              )}

              {guideTab === 'shortcuts' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    ['Command Palette', '⌘K / Ctrl+K', '搜索页面、设置和主题命令。'],
                    ['Capture Area', '⌘⇧X / Ctrl+Shift+X', '区域截图并附加到当前输入框，可在 Settings 内修改。'],
                    ['Send Message', 'Enter', '发送当前消息。'],
                    ['New Line', 'Shift+Enter', '在输入框内换行。'],
                    ['Stop Agent', 'Esc', 'Agent 输出中断。'],
                  ].map(([name, keys, desc]) => (
                    <div key={name} style={{ display: 'grid', gridTemplateColumns: '170px 180px 1fr', gap: 12, alignItems: 'center', padding: '11px 12px', borderRadius: 10, border: '1px solid var(--theme-border)', background: 'var(--theme-bg-surface)' }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--color-text-primary)' }}>{name}</span>
                      <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-accent-primary)', fontFamily: 'monospace' }}>{keys}</span>
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{desc}</span>
                    </div>
                  ))}
                </div>
              )}

              {guideTab === 'changelog' && (
                <div style={{ padding: 16, borderRadius: 12, border: '1px solid var(--theme-border)', background: 'var(--theme-bg-surface)' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, marginBottom: 12 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 900, color: 'var(--color-text-primary)' }}>{APP_VERSION}</h3>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Current</span>
                  </div>
                  <ul style={{ display: 'flex', flexDirection: 'column', gap: 9, margin: 0, paddingLeft: 18, color: 'var(--color-text-secondary)', fontSize: 12, lineHeight: 1.6 }}>
                    <li>新增 Capture Area 区域截图和快捷键设置。</li>
                    <li>优化项目无 session 状态：保留统计页，底部可直接输入并创建首个 session。</li>
                    <li>重构桌面端主布局：Header、左侧菜单、二级菜单和 Chat 区域改为 panel 分区。</li>
                    <li>调整浅色主题为白色主导、冷灰背景的简洁科技风格。</li>
                    <li>收敛右上角入口，仅保留使用说明和主题切换。</li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {paletteOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'var(--theme-bg-overlay)',
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
          onMouseDown={() => setPaletteOpen(false)}
        >
          <div
            onMouseDown={e => e.stopPropagation()}
            style={{
              width: 'min(620px, calc(100vw - 48px))',
              margin: '96px auto 0',
              borderRadius: 12,
              border: '1px solid var(--shell-panel-border)',
              background: 'var(--theme-bg-panel)',
              boxShadow: 'var(--theme-shadow-popover)',
              overflow: 'hidden',
            }}
          >
            <div style={{ position: 'relative', borderBottom: '1px solid var(--shell-panel-border)' }}>
              <Command
                size={16}
                style={{
                  position: 'absolute',
                  left: 18,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--color-text-muted)',
                }}
              />
              <input
                ref={paletteInputRef}
                value={query}
                onChange={e => { setQuery(e.target.value); setSelectedIdx(0) }}
                onKeyDown={e => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setSelectedIdx(i => Math.min(i + 1, Math.max(filteredCommands.length - 1, 0)))
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setSelectedIdx(i => Math.max(i - 1, 0))
                  }
                  if (e.key === 'Enter' && filteredCommands[selectedIdx]) {
                    e.preventDefault()
                    runCommand(filteredCommands[selectedIdx].run)
                  }
                }}
                placeholder="Search pages, settings, themes..."
                className="selectable"
                style={{
                  width: '100%',
                  height: 54,
                  padding: '0 18px 0 48px',
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  color: 'var(--color-text-primary)',
                  fontSize: 15,
                }}
              />
            </div>

            <div style={{ maxHeight: 360, overflowY: 'auto', padding: 8 }}>
              {filteredCommands.length === 0 ? (
                <div style={{ padding: 18, color: 'var(--color-text-muted)', fontSize: 13 }}>No commands found</div>
              ) : filteredCommands.map((cmd, idx) => {
                const active = idx === selectedIdx
                return (
                  <button
                    key={cmd.id}
                    onMouseEnter={() => setSelectedIdx(idx)}
                    onClick={() => runCommand(cmd.run)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 12px',
                      borderRadius: 9,
                      border: 'none',
                      background: active ? 'rgba(245,158,11,0.12)' : 'transparent',
                      color: 'var(--color-text-primary)',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{
                      width: 30,
                      height: 30,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 8,
                      background: active ? 'var(--theme-bg-active)' : 'var(--theme-bg-raised)',
                      color: active ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
                      flexShrink: 0,
                    }}>
                      <cmd.Icon size={15} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{cmd.label}</span>
                      <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: 'var(--color-text-muted)' }}>{cmd.desc}</span>
                    </span>
                    <ArrowRight size={14} style={{ color: active ? 'var(--color-accent-primary)' : 'var(--color-text-disabled)' }} />
                  </button>
                )
              })}
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 14px',
              borderTop: '1px solid var(--shell-panel-border)',
              color: 'var(--color-text-disabled)',
              fontSize: 11,
            }}
          >
              <span>↑↓ navigate · Enter run · Esc close</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Palette size={12} />
                Command Center
              </span>
            </div>
          </div>
        </div>
      )}

      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 1,
          pointerEvents: 'none',
          background: 'var(--theme-header-glow)',
        }}
      />
    </header>
  )
}
