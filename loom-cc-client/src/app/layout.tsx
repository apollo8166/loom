import type { Metadata } from 'next'
import './globals.css'
import 'katex/dist/katex.min.css'
import { ThemeProvider } from '@/shared/lib/theme-provider'
import { AppShell } from '@/components/shell/app-shell'
import { Toaster } from 'sonner'
import { BRAND } from '@/brand/config'

export const metadata: Metadata = {
  title: BRAND.windowTitle,
  description: BRAND.description,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>
        <ThemeProvider defaultTheme="dark">
          <AppShell>
            {children}
          </AppShell>
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border-strong)',
                color: 'var(--color-text-primary)',
                borderRadius: '10px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  )
}
