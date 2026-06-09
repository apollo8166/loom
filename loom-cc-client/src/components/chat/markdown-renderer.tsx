'use client'

import { useState, useEffect, useCallback, memo, useMemo, useRef, isValidElement } from 'react'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import { Check, Copy, Download, FileVideo } from 'lucide-react'

// All supported code themes
const CODE_THEMES = ['github-dark', 'github-light', 'monokai', 'one-dark-pro', 'dracula', 'nord'] as const
const REMARK_PLUGINS = [remarkGfm]

type MarkdownPreviewFile = {
  url: string
  name: string
  mimeType: string
  previewApiUrl?: string
}

function renderMissingImage(alt?: string) {
  if (!alt) return null
  return (
    <span className="inline-block my-2 text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
      {alt}
    </span>
  )
}

function normalizeFileUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim()
  if (!trimmed.startsWith('file://')) return trimmed
  return `/api/local-files/serve?path=${encodeURIComponent(fileUrlToPath(trimmed))}`
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function fileUrlToPath(rawUrl: string): string {
  try {
    return safeDecodeURIComponent(new URL(rawUrl).pathname)
  } catch {
    return safeDecodeURIComponent(rawUrl.replace(/^file:\/\//, ''))
  }
}

function basenameFromPath(filePath: string): string {
  const cleaned = filePath.replace(/[\\/]+$/, '')
  return cleaned.split(/[\\/]/).filter(Boolean).pop() || cleaned || 'file'
}

function localFilePathFromHref(rawHref: string): string | null {
  if (rawHref.startsWith('file://')) return fileUrlToPath(rawHref)
  try {
    const base = typeof window === 'undefined' ? 'http://localhost' : window.location.origin
    const url = new URL(rawHref, base)
    if (url.pathname !== '/api/local-files/serve') return null
    return url.searchParams.get('path')
  } catch {
    return null
  }
}

function localFileNameFromHref(rawHref: string): string | null {
  const filePath = localFilePathFromHref(rawHref)
  return filePath ? basenameFromPath(filePath) : null
}

function rewriteLocalFileUrls(markdown: string): string {
  const lines = markdown.split(/\r?\n/)
  let inFence = false
  return lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      return line
    }
    if (inFence) return line

    let next = line.replace(/(\]\()file:\/\/([^)]+)(\))/g, (_match, open: string, rest: string, close: string) => {
      const rawUrl = `file://${rest}`
      return `${open}${normalizeFileUrl(rawUrl)}${close}`
    })
    next = next.replace(/<file:\/\/([^>]+)>/g, (_match, rest: string) => {
      const rawUrl = `file://${rest}`
      return `[${basenameFromPath(fileUrlToPath(rawUrl))}](${normalizeFileUrl(rawUrl)})`
    })
    next = next.replace(/\bfile:\/\/[^\s<>)\]]+/g, (rawUrl: string) => {
      return `[${basenameFromPath(fileUrlToPath(rawUrl))}](${normalizeFileUrl(rawUrl)})`
    })
    return next
  }).join('\n')
}

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'])

function extensionFromName(name: string): string {
  return name.split('.').pop()?.toLowerCase() || ''
}

function formatFileSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return '未知大小'
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function mimeTypeFromName(name: string): string {
  const ext = extensionFromName(name)
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    mp4: 'video/mp4',
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  }
  return map[ext] || 'application/octet-stream'
}

function canUseLocalPreviewApi(name: string): boolean {
  return ['doc', 'docx', 'odt', 'xls', 'xlsx', 'xlsm', 'xlsb', 'ods'].includes(extensionFromName(name))
}

function canPreviewFileName(name: string): boolean {
  const ext = extensionFromName(name)
  return IMAGE_EXTS.has(ext) ||
    ext === 'pdf' ||
    ext === 'mp4' ||
    ['doc', 'docx', 'odt', 'xls', 'xlsx', 'xlsm', 'xlsb', 'ods'].includes(ext) ||
    ['md', 'mdx', 'txt', 'csv', 'json', 'yaml', 'yml', 'toml', 'xml', 'html', 'htm', 'css', 'scss',
      'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'cpp', 'c', 'h', 'cs', 'rb', 'php',
      'swift', 'kt', 'sh', 'bash', 'zsh', 'sql', 'env'].includes(ext)
}

function getFileChipConfig(name: string, contentType?: string | null): { letter: string; color: string; typeLabel: string; icon?: 'video' } {
  const ext = extensionFromName(name)
  if (contentType?.startsWith('video/') || ext === 'mp4') return { letter: 'MP4', color: '#0ea5e9', typeLabel: 'Video', icon: 'video' }
  if (contentType === 'application/pdf' || ext === 'pdf') return { letter: 'PDF', color: '#ef4444', typeLabel: 'PDF' }
  if (['doc', 'docx', 'odt'].includes(ext)) return { letter: 'W', color: '#2b579a', typeLabel: 'Word' }
  if (['xls', 'xlsx', 'xlsm', 'xlsb', 'ods'].includes(ext)) return { letter: 'X', color: '#217346', typeLabel: 'Excel' }
  if (['ppt', 'pptx', 'odp'].includes(ext)) return { letter: 'P', color: '#d24726', typeLabel: 'PowerPoint' }
  if (['md', 'mdx'].includes(ext)) return { letter: 'MD', color: '#22c55e', typeLabel: 'Markdown' }
  if (ext === 'csv') return { letter: 'CSV', color: '#16a34a', typeLabel: 'CSV' }
  if (ext === 'txt') return { letter: 'TXT', color: '#6b7280', typeLabel: 'Text' }
  if (ext === 'json') return { letter: '{ }', color: '#8b5cf6', typeLabel: 'JSON' }
  return { letter: 'FILE', color: '#6b7280', typeLabel: 'File' }
}

function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children)
  return ''
}

function useLocalFileMeta(href: string) {
  const [meta, setMeta] = useState<{ size: number | null; contentType: string | null } | null>(null)

  useEffect(() => {
    if (!href.startsWith('/api/local-files/serve')) {
      setMeta(null)
      return
    }

    let cancelled = false
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 8000)
    fetch(href, { method: 'HEAD', signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HEAD ${res.status}`)
        const length = Number(res.headers.get('content-length') || '')
        setMeta({
          size: Number.isFinite(length) ? length : null,
          contentType: res.headers.get('content-type'),
        })
      })
      .catch(() => {
        if (!cancelled) setMeta({ size: null, contentType: null })
      })
      .finally(() => window.clearTimeout(timeout))

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [href])

  return meta
}

function LocalFileCard({
  href,
  children,
  onPreviewFile,
}: {
  href: string
  children: ReactNode
  onPreviewFile?: (file: MarkdownPreviewFile) => void
}) {
  const name = localFileNameFromHref(href) || nodeText(children).trim() || 'file'
  const meta = useLocalFileMeta(href)
  const cfg = getFileChipConfig(name, meta?.contentType)
  const filePath = localFilePathFromHref(href)
  const mimeType = meta?.contentType || mimeTypeFromName(name)
  const previewApiUrl = filePath && canUseLocalPreviewApi(name)
    ? `/api/local-files/preview?path=${encodeURIComponent(filePath)}`
    : undefined
  const canPreview = Boolean(onPreviewFile && canPreviewFileName(name))

  const handleClick = useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!onPreviewFile || !canPreview) return
    event.preventDefault()
    onPreviewFile({ url: href, name, mimeType, previewApiUrl })
  }, [canPreview, href, name, mimeType, onPreviewFile, previewApiUrl])

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      download={name}
      onClick={handleClick}
      className="group/local-file-card my-2 no-underline"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        maxWidth: 'min(100%, 360px)',
        minWidth: 220,
        padding: '8px 12px',
        borderRadius: 10,
        border: '1px solid var(--color-border-strong)',
        background: 'var(--color-bg-surface)',
        verticalAlign: 'middle',
      }}
      title={canPreview ? '点击预览' : name}
    >
      <span
        style={{
          width: 36,
          height: 36,
          borderRadius: 6,
          flexShrink: 0,
          background: cfg.color,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {cfg.icon === 'video' ? (
          <FileVideo size={20} style={{ color: 'white' }} />
        ) : (
          <span style={{ fontSize: cfg.letter.length > 2 ? 9 : cfg.letter.length > 1 ? 11 : 14, fontWeight: 700, color: 'white', fontFamily: SYSTEM_MONO, lineHeight: 1 }}>
            {cfg.letter}
          </span>
        )}
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </span>
        <span style={{ display: 'block', fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
          {cfg.typeLabel} · {meta ? formatFileSize(meta.size) : '读取大小...'}
        </span>
      </span>
      <Download size={15} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
    </a>
  )
}

function LocalImageLink({
  href,
  children,
  onPreviewFile,
}: {
  href: string
  children: ReactNode
  onPreviewFile?: (file: MarkdownPreviewFile) => void
}) {
  const name = localFileNameFromHref(href) || nodeText(children).trim() || ''
  const handleClick = useCallback(() => {
    onPreviewFile?.({ url: href, name: name || 'image', mimeType: mimeTypeFromName(name) })
  }, [href, name, onPreviewFile])

  return (
    <span
      className="inline-block my-2"
      onClick={handleClick}
      style={{ cursor: onPreviewFile ? 'pointer' : 'default' }}
      title={onPreviewFile ? '点击预览' : name}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={href}
        alt={name}
        className="max-w-[400px] max-h-[300px] rounded-lg object-contain"
        style={{ border: '1px solid var(--color-border-subtle)' }}
        loading="lazy"
      />
      {name && (
        <span style={{ display: 'block', marginTop: 6, fontSize: 11, color: 'var(--color-text-disabled)', textAlign: 'center' }}>
          {name}
        </span>
      )}
    </span>
  )
}

function renderLocalAwareLink(
  href: string | undefined,
  children: ReactNode,
  onPreviewFile?: (file: MarkdownPreviewFile) => void,
) {
  const safeHref = typeof href === 'string' ? normalizeFileUrl(href) : href
  if (typeof safeHref === 'string' && localFilePathFromHref(safeHref)) {
    const name = localFileNameFromHref(safeHref) || nodeText(children)
    if (IMAGE_EXTS.has(extensionFromName(name))) {
      return <LocalImageLink href={safeHref} onPreviewFile={onPreviewFile}>{children}</LocalImageLink>
    }
    return <LocalFileCard href={safeHref} onPreviewFile={onPreviewFile}>{children}</LocalFileCard>
  }
  return (
    <a href={safeHref} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent-primary)' }} className="hover:underline">
      {children}
    </a>
  )
}

function ChatImage({
  src,
  alt,
  onPreviewFile,
}: {
  src: string
  alt?: string
  onPreviewFile?: (file: MarkdownPreviewFile) => void
}) {
  const name = localFileNameFromHref(src) || alt || 'image'
  const handleClick = useCallback(() => {
    if (!onPreviewFile) return
    onPreviewFile({ url: src, name, mimeType: mimeTypeFromName(name) })
  }, [name, onPreviewFile, src])

  return (
    <span
      className="inline-block my-2"
      onClick={handleClick}
      style={{ cursor: onPreviewFile && localFilePathFromHref(src) ? 'pointer' : 'default' }}
      title={onPreviewFile && localFilePathFromHref(src) ? '点击预览' : name}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt || ''}
        className="max-w-[400px] max-h-[300px] rounded-lg object-contain"
        style={{ border: '1px solid var(--color-border-subtle)' }}
        loading="lazy"
      />
    </span>
  )
}

// Shiki highlighter singleton (lazy-loaded)
let highlighterPromise: Promise<unknown> | null = null
const highlightHtmlCache = new Map<string, string | null>()

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then(({ createHighlighter }) =>
      createHighlighter({
        themes: [...CODE_THEMES],
        langs: [
          'javascript', 'typescript', 'python', 'bash', 'json', 'html', 'css',
          'jsx', 'tsx', 'sql', 'yaml', 'markdown', 'rust', 'go', 'java', 'c',
          'cpp', 'shell', 'diff', 'xml', 'toml',
        ],
      })
    )
  }
  return highlighterPromise
}

function getShikiTheme(): string {
  if (typeof document === 'undefined') return 'github-dark'
  const codeTheme = document.documentElement.getAttribute('data-code-theme')
  if (codeTheme && CODE_THEMES.includes(codeTheme as typeof CODE_THEMES[number])) {
    return codeTheme
  }
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'github-light' : 'github-dark'
}

function useCodeTheme(): string {
  const [theme, setTheme] = useState(() => getShikiTheme())
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(getShikiTheme())
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-code-theme', 'data-theme'] })
    return () => observer.disconnect()
  }, [])
  return theme
}

if (typeof window !== 'undefined') {
  const warmHighlighter = () => { void getHighlighter() }
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(warmHighlighter, { timeout: 2500 })
  } else {
    window.setTimeout(warmHighlighter, 1200)
  }
}

/* -- Copy Button -- */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 px-2 py-1 rounded text-[11px] hover:opacity-80 transition-opacity"
      style={{ color: copied ? 'var(--color-accent-success)' : 'var(--color-text-muted)' }}
      title="Copy code"
    >
      {copied ? (
        <>
          <Check size={12} />
          <span>Copied</span>
        </>
      ) : (
        <>
          <Copy size={12} />
          <span>Copy</span>
        </>
      )}
    </button>
  )
}

const SYSTEM_MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'

/* -- Code Block with Shiki -- */

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const codeTheme = useCodeTheme()
  const isDiff = lang === 'diff'
  const cacheKey = `${codeTheme}\u0000${lang}\u0000${code}`
  const [, bumpHighlightVersion] = useState(0)
  const html = !isDiff ? highlightHtmlCache.get(cacheKey) ?? null : null

  useEffect(() => {
    if (isDiff || highlightHtmlCache.has(cacheKey)) return

    let cancelled = false
    getHighlighter().then((hl) => {
      const highlighter = hl as {
        codeToHtml: (code: string, opts: { lang: string; theme: string }) => string
        getLoadedLanguages: () => string[]
      }
      const loadedLangs = highlighter.getLoadedLanguages()
      const effectiveLang = loadedLangs.includes(lang) ? lang : 'text'
      try {
        const result = highlighter.codeToHtml(code, { lang: effectiveLang, theme: codeTheme })
        highlightHtmlCache.set(cacheKey, result)
      } catch {
        highlightHtmlCache.set(cacheKey, null)
      }
      if (!cancelled) bumpHighlightVersion(version => version + 1)
    }).catch(() => {
      highlightHtmlCache.set(cacheKey, null)
      if (!cancelled) bumpHighlightVersion(version => version + 1)
    })
    return () => { cancelled = true }
  }, [cacheKey, code, codeTheme, isDiff, lang])

  return (
    <div className="my-4 rounded-[5px] overflow-hidden" style={{ border: '1px solid var(--color-border-subtle)' }}>
      <div className="flex items-center justify-between px-4 py-2.5" style={{ background: 'var(--color-bg-surface-high)', borderBottom: '1px solid var(--color-border-subtle)' }}>
        <span className="text-[12px]" style={{ color: 'var(--color-text-muted)', fontFamily: SYSTEM_MONO }}>{lang || 'code'}</span>
        <CopyButton text={code} />
      </div>
      {isDiff ? (
        <DiffView code={code} />
      ) : html ? (
        <div
          className="px-4 py-4 text-[12px] overflow-x-auto [&_pre]:!bg-transparent [&_pre]:!m-0 [&_pre]:!p-0 [&_code]:!bg-transparent"
          style={{ fontFamily: SYSTEM_MONO, background: 'var(--color-bg-surface)' }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="px-4 py-4 text-[12px] overflow-x-auto" style={{ fontFamily: SYSTEM_MONO, background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)' }}>
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
}

/* -- Diff Viewer -- */

function DiffView({ code }: { code: string }) {
  const lines = code.split('\n')
  return (
    <pre className="text-[12px] overflow-x-auto" style={{ fontFamily: SYSTEM_MONO }}>
      {lines.map((line, i) => {
        let bg = 'transparent'
        let color = 'var(--color-text-primary)'
        if (line.startsWith('+')) {
          bg = 'rgba(50, 213, 131, 0.1)'
          color = '#4ade80'
        } else if (line.startsWith('-')) {
          bg = 'rgba(232, 90, 79, 0.1)'
          color = '#f87171'
        } else if (line.startsWith('@@')) {
          bg = 'rgba(245, 158, 11, 0.1)'
          color = '#fbbf24'
        }
        return (
          <div key={i} className="px-3 py-0" style={{ background: bg, color }}>
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}

/* -- Markdown Components -- */

const components: Components = {
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '')
    const isBlock = match || (typeof children === 'string' && children.includes('\n'))

    if (isBlock) {
      const lang = match?.[1] || ''
      const code = String(children).replace(/\n$/, '')
      return <CodeBlock lang={lang} code={code} />
    }

    return (
      <code
        className="px-1 py-0.5 rounded text-[12px]"
        style={{ fontFamily: SYSTEM_MONO, background: 'var(--color-bg-surface-high)', color: 'var(--color-accent-warning)' }}
        {...props}
      >
        {children}
      </code>
    )
  },
  pre({ children }) {
    return <>{children}</>
  },
  p({ children }) {
    return <p className="mb-5 last:mb-0">{children}</p>
  },
  ul({ children }) {
    return (
      <ul style={{ marginBottom: '1.25rem', paddingLeft: '1.5rem', listStyleType: 'disc', listStylePosition: 'outside' }}
        className="space-y-2">{children}</ul>
    )
  },
  ol({ children }) {
    return (
      <ol style={{ marginBottom: '1.25rem', paddingLeft: '1.5rem', listStyleType: 'decimal', listStylePosition: 'outside' }}
        className="space-y-2">{children}</ol>
    )
  },
  li({ children }) {
    return <li style={{ paddingLeft: '0.25rem', color: 'var(--color-text-primary)' }}>{children}</li>
  },
  h1({ children }) {
    return <h1 className="text-[15px] font-bold mt-7 mb-3" style={{ color: 'var(--color-text-primary)' }}>{children}</h1>
  },
  h2({ children }) {
    return <h2 className="text-[14px] font-bold mt-6 mb-3" style={{ color: 'var(--color-text-primary)' }}>{children}</h2>
  },
  h3({ children }) {
    return <h3 className="text-[13px] font-semibold mt-5 mb-2" style={{ color: 'var(--color-text-primary)' }}>{children}</h3>
  },
  blockquote({ children }) {
    return (
      <blockquote
        className="pl-3 my-5 rounded-r-md italic"
        style={{
          borderLeft: '2px solid rgba(99, 102, 241, 0.5)',
          color: 'var(--color-text-secondary)',
          background: 'rgba(99, 102, 241, 0.05)',
          paddingTop: 10, paddingBottom: 10, paddingRight: 8,
        }}
      >
        {children}
      </blockquote>
    )
  },
  a({ href, children }) {
    return renderLocalAwareLink(href, children)
  },
  table({ children }) {
    return (
      <div className="my-5 overflow-x-auto rounded-lg" style={{ border: '1px solid var(--color-border-subtle)' }}>
        <table className="w-full text-[12px]">{children}</table>
      </div>
    )
  },
  thead({ children }) {
    return <thead style={{ background: 'var(--color-bg-surface-high)' }}>{children}</thead>
  },
  th({ children }) {
    return <th className="px-3 py-1.5 text-left font-medium" style={{ color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border-subtle)' }}>{children}</th>
  },
  td({ children }) {
    return <td className="px-3 py-1.5" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>{children}</td>
  },
  hr() {
    return <hr className="my-6" style={{ borderColor: 'var(--color-border-subtle)' }} />
  },
  img({ src, alt }) {
    const imageSrc = typeof src === 'string' ? normalizeFileUrl(src) : ''
    if (!imageSrc) return renderMissingImage(alt)
    return <ChatImage src={imageSrc} alt={alt} />
  },
}

function createDocumentComponents(baseUrl?: string): Components {
  const imageSrc = (src: string | Blob | undefined) => baseUrl ? resolveImgSrc(src, baseUrl) : String(src || '')

  return {
    ...components,
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '')
      const isBlock = match || (typeof children === 'string' && children.includes('\n'))

      if (isBlock) {
        const lang = match?.[1] || ''
        const code = String(children).replace(/\n$/, '')
        return <CodeBlock lang={lang} code={code} />
      }

      return (
        <code
          className="rounded px-1 py-0.5 text-[0.92em]"
          style={{
            fontFamily: SYSTEM_MONO,
            background: 'var(--color-bg-surface-high)',
            color: 'var(--color-text-primary)',
          }}
          {...props}
        >
          {children}
        </code>
      )
    },
    p({ children }) {
      return <p className="mb-5 last:mb-0 leading-[1.78]">{children}</p>
    },
    h1({ children }) {
      return (
        <h1
          className="mt-0 mb-7 border-b pb-3 text-[26px] font-semibold leading-tight"
          style={{ color: 'var(--color-text-primary)', borderColor: 'var(--color-border-subtle)' }}
        >
          {children}
        </h1>
      )
    },
    h2({ children }) {
      return (
        <h2
          className="mt-10 mb-5 border-b pb-2 text-[21px] font-semibold leading-snug"
          style={{ color: 'var(--color-text-primary)', borderColor: 'var(--color-border-subtle)' }}
        >
          {children}
        </h2>
      )
    },
    h3({ children }) {
      return <h3 className="mt-8 mb-4 text-[17px] font-semibold leading-snug" style={{ color: 'var(--color-text-primary)' }}>{children}</h3>
    },
    h4({ children }) {
      return <h4 className="mt-7 mb-3 text-[15px] font-semibold leading-snug" style={{ color: 'var(--color-text-primary)' }}>{children}</h4>
    },
    ul({ children }) {
      return (
        <ul
          className="mb-5 space-y-2"
          style={{ paddingLeft: '1.7rem', listStyleType: 'disc', listStylePosition: 'outside' }}
        >
          {children}
        </ul>
      )
    },
    ol({ children }) {
      return (
        <ol
          className="mb-5 space-y-2"
          style={{ paddingLeft: '1.7rem', listStyleType: 'decimal', listStylePosition: 'outside' }}
        >
          {children}
        </ol>
      )
    },
    li({ children }) {
      return <li className="pl-1 leading-[1.78]" style={{ color: 'var(--color-text-primary)' }}>{children}</li>
    },
    input({ checked, type, ...props }) {
      if (type !== 'checkbox') return <input type={type} {...props} />
      return (
        <input
          type="checkbox"
          checked={checked}
          readOnly
          className="mr-2 translate-y-[1px]"
          style={{ accentColor: 'var(--color-accent-primary)' }}
        />
      )
    },
    blockquote({ children }) {
      return (
        <blockquote
          className="my-6 pl-4"
          style={{
            borderLeft: '4px solid var(--color-border-strong)',
            color: 'var(--color-text-secondary)',
          }}
        >
          {children}
        </blockquote>
      )
    },
    table({ children }) {
      return (
        <div className="my-6 overflow-x-auto">
          <table
            className="w-full border-collapse text-[13px]"
            style={{ border: '1px solid var(--color-border-subtle)' }}
          >
            {children}
          </table>
        </div>
      )
    },
    thead({ children }) {
      return <thead style={{ background: 'var(--color-bg-surface-high)' }}>{children}</thead>
    },
    th({ children }) {
      return (
        <th
          className="px-3 py-2 text-left font-semibold"
          style={{ color: 'var(--color-text-primary)', border: '1px solid var(--color-border-subtle)' }}
        >
          {children}
        </th>
      )
    },
    td({ children }) {
      return <td className="px-3 py-2 align-top" style={{ border: '1px solid var(--color-border-subtle)' }}>{children}</td>
    },
    hr() {
      return <hr className="my-8 border-0 border-t" style={{ borderColor: 'var(--color-border-subtle)' }} />
    },
    img({ src, alt }) {
      const resolvedSrc = imageSrc(src).trim()
      if (!resolvedSrc) return renderMissingImage(alt)
      return (
        <span className="block my-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={resolvedSrc}
            alt={alt || ''}
            className="mx-auto block max-h-[70vh] max-w-full object-contain"
            style={{ borderRadius: 4 }}
            loading="lazy"
          />
          {alt && (
            <span
              className="mt-2 block text-center text-[12px] italic"
              style={{ color: 'var(--color-text-disabled)' }}
            >
              {alt}
            </span>
          )}
        </span>
      )
    },
  }
}

/* -- Relative URL resolver -- */

function resolveImgSrc(src: string | Blob | undefined, baseUrl: string): string {
  if (!src || typeof src !== 'string') return ''
  if (src.startsWith('file://')) return normalizeFileUrl(src)
  // Absolute URLs and data URIs stay as-is
  if (src.startsWith('http') || src.startsWith('/') || src.startsWith('data:')) return src
  try {
    return new URL(src, window.location.origin + baseUrl).pathname
  } catch {
    return baseUrl + src
  }
}

function stripDocumentMetadata(markdown: string): string {
  const trimmedStart = markdown.replace(/^\uFEFF/, '')

  if (trimmedStart.startsWith('---\n')) {
    const end = trimmedStart.indexOf('\n---', 4)
    if (end > -1) {
      const afterFence = trimmedStart.slice(end + 4).replace(/^\r?\n/, '')
      return afterFence
    }
  }

  const firstHeadingIndex = trimmedStart.search(/^#{1,6}\s+/m)
  if (firstHeadingIndex > 0) {
    const beforeHeading = trimmedStart.slice(0, firstHeadingIndex).trim()
    const metadataLines = beforeHeading.split(/\r?\n/).filter(Boolean)
    const looksLikeMetadata = metadataLines.length > 0 && metadataLines.every((line) =>
      /^[A-Za-z][\w.-]*:\s+\S/.test(line.trim())
    )
    if (looksLikeMetadata) return trimmedStart.slice(firstHeadingIndex)
  }

  return trimmedStart
}

function looksLikeTreeLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  if (/^[|├└│]/.test(trimmed)) return true
  if (/^(?:[|│]\s*)*[├└]──/.test(trimmed)) return true
  if (/^(?:[|│]\s*)*\S.*\/\s*$/.test(trimmed)) return true
  if (/^(?:[|│]\s*)*\S.*\.(?:md|mdx|ts|tsx|js|jsx|json|yaml|yml|toml|css|scss|html|txt)\b/.test(trimmed)) return true
  return false
}

function protectDocumentStructureBlocks(markdown: string): string {
  const lines = markdown.split(/\r?\n/)
  const output: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (/^```/.test(line.trim())) {
      output.push(line)
      i += 1
      while (i < lines.length) {
        output.push(lines[i])
        if (/^```/.test(lines[i].trim())) {
          i += 1
          break
        }
        i += 1
      }
      continue
    }

    const isStructureLabel = /^\s*(?:#{1,6}\s*)?\[?(?:文件结构|目录结构|项目结构|File structure|Directory structure)\]?\s*[:：]?\s*$/i.test(line.trim())
    const nextLineLooksTree = i + 1 < lines.length && looksLikeTreeLine(lines[i + 1])

    if (isStructureLabel && nextLineLooksTree) {
      output.push(line)
      output.push('')
      output.push('```text')
      i += 1
      while (i < lines.length && (lines[i].trim() === '' || looksLikeTreeLine(lines[i]))) {
        output.push(lines[i])
        i += 1
      }
      output.push('```')
      continue
    }

    output.push(line)
    i += 1
  }

  return output.join('\n')
}

function prepareDocumentMarkdown(markdown: string): string {
  return protectDocumentStructureBlocks(stripDocumentMetadata(markdown))
}

/* -- Main Component -- */

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  baseUrl,
  variant = 'chat',
  onPreviewFile,
}: {
  content: string
  /** Base URL for resolving relative image paths in markdown (e.g. file preview context) */
  baseUrl?: string
  variant?: 'chat' | 'document'
  onPreviewFile?: (file: MarkdownPreviewFile) => void
}) {
  const renderedContent = useMemo(() => {
    const normalized = rewriteLocalFileUrls(content)
    if (variant !== 'document') return normalized
    return prepareDocumentMarkdown(normalized)
  }, [content, variant])

  const resolvedComponents = useMemo<Components>(() => {
    if (variant === 'document') return createDocumentComponents(baseUrl)
    if (!baseUrl) {
      return {
        ...components,
        a({ href, children }) {
          return renderLocalAwareLink(href, children, onPreviewFile)
        },
        img({ src, alt }) {
          const imageSrc = typeof src === 'string' ? normalizeFileUrl(src) : ''
          if (!imageSrc) return renderMissingImage(alt)
          return <ChatImage src={imageSrc} alt={alt} onPreviewFile={onPreviewFile} />
        },
      }
    }
    return {
      ...components,
      a({ href, children }) {
        return renderLocalAwareLink(href, children, onPreviewFile)
      },
      img({ src, alt }) {
        const resolvedSrc = resolveImgSrc(src, baseUrl).trim()
        if (!resolvedSrc) return renderMissingImage(alt)
        const canPreview = Boolean(onPreviewFile && localFilePathFromHref(resolvedSrc))
        const name = localFileNameFromHref(resolvedSrc) || alt || 'image'
        return (
          <span
            className="block my-4"
            onClick={() => {
              if (canPreview) onPreviewFile?.({ url: resolvedSrc, name, mimeType: mimeTypeFromName(name) })
            }}
            style={{ cursor: canPreview ? 'pointer' : 'default' }}
            title={canPreview ? '点击预览' : name}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={resolvedSrc}
              alt={alt || ''}
              style={{
                maxWidth: '100%', height: 'auto', borderRadius: 8,
                border: '1px solid var(--color-border-subtle)',
              }}
              loading="lazy"
            />
            {alt && (
              <span style={{
                display: 'block', marginTop: 6, fontSize: 11,
                color: 'var(--color-text-disabled)', textAlign: 'center', fontStyle: 'italic',
              }}>
                {alt}
              </span>
            )}
          </span>
        )
      },
    }
  }, [baseUrl, onPreviewFile, variant])

  return (
    <div
      className={variant === 'document' ? 'selectable leading-[1.75] text-[14px]' : 'leading-relaxed text-[13px]'}
      style={{ color: 'var(--color-text-primary)' }}
    >
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={resolvedComponents}>
        {renderedContent}
      </ReactMarkdown>
    </div>
  )
})
