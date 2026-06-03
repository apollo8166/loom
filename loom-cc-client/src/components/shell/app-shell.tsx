'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { TitleBar } from './title-bar'
import { LeftNav } from './left-nav'
import { UIProvider } from '@/shared/lib/ui-context'

interface AppShellProps {
  children: React.ReactNode
}

function AppShellInner({ children }: AppShellProps) {
  const pathname = usePathname()
  // Hide the global left nav when inside a project workspace
  const isProjectWorkspace = /^\/projects\/[^/]+/.test(pathname)

  useEffect(() => {
    const fallback = navigator.platform.toLowerCase().includes('mac') ? 'Command+Shift+X' : 'Control+Shift+X'
    const shortcut = localStorage.getItem('loom_capture_area_shortcut') || fallback
    window.electronAPI?.registerCaptureShortcut?.(shortcut).catch(() => {})
  }, [])

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={{
        backgroundColor: 'var(--theme-bg-page)',
        backgroundImage: 'var(--theme-app-glow)',
      }}
    >
      <TitleBar />
      <div
        className="flex flex-1 min-h-0"
        style={{
          gap: 'var(--shell-gap)',
          padding: 'var(--shell-outer-gap)',
          paddingTop: 'var(--shell-gap)',
        }}
      >
        {!isProjectWorkspace && <LeftNav />}
        <main
          className="flex-1 min-w-0 overflow-hidden"
          style={{ minHeight: 0 }}
        >
          {children}
        </main>
      </div>
    </div>
  )
}

export function AppShell({ children }: AppShellProps) {
  return (
    <UIProvider>
      <AppShellInner>{children}</AppShellInner>
    </UIProvider>
  )
}
