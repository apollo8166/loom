'use client'

import { useState, useEffect } from 'react'
import { X, FileText, Loader2, Maximize2, Minimize2, Code2, Eye } from 'lucide-react'
import { MarkdownRenderer } from '@/components/chat/markdown-renderer'

export interface PreviewFile {
  /** Serve URL — used for image <img>, PDF <iframe>, and raw text fetch */
  url: string
  /** Server-side filename of the original office file (docx/xlsx/…), used to call the JSON preview API */
  originalFilename?: string
  /** Override the full preview API URL (e.g. for workspace files). If provided, used instead of /api/files/preview/:originalFilename */
  previewApiUrl?: string
  name: string
  mimeType: string
}

interface FilePreviewPanelProps {
  file: PreviewFile
  onClose: () => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getExt(name: string) {
  return name.split('.').pop()?.toLowerCase() || ''
}

function isImage(name: string, mimeType: string) {
  return mimeType.startsWith('image/') ||
    ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(getExt(name))
}

function isPdf(name: string, mimeType: string) {
  return mimeType === 'application/pdf' || getExt(name) === 'pdf'
}

function isWordLike(ext: string) {
  return ['docx', 'doc', 'odt'].includes(ext)
}

function isExcelLike(ext: string) {
  return ['xlsx', 'xls', 'xlsm', 'xlsb', 'ods'].includes(ext)
}

function isTextLike(name: string) {
  const ext = getExt(name)
  return ['md', 'mdx', 'txt', 'csv', 'json', 'yaml', 'yml', 'toml', 'xml', 'html', 'htm', 'css', 'scss',
    'ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'cpp', 'c', 'h', 'cs', 'rb', 'php',
    'swift', 'kt', 'sh', 'bash', 'sql'].includes(ext)
}

function isMarkdown(name: string) {
  return ['md', 'mdx'].includes(getExt(name))
}

/** Derive the directory portion of a file URL for resolving relative image paths */
function getBaseUrl(fileUrl: string): string {
  const idx = fileUrl.lastIndexOf('/')
  return idx >= 0 ? fileUrl.slice(0, idx + 1) : '/'
}

// ── Preview data types ────────────────────────────────────────────────────────

type PreviewData =
  | { type: 'text'; content: string; language: string }
  | { type: 'word'; html: string }
  | { type: 'excel'; sheets: { name: string; html: string }[] }
  | { type: 'error'; message: string }

// ── Sub-renderers ─────────────────────────────────────────────────────────────

type ViewMode = 'preview' | 'source'

function TextViewer({
  content,
  name,
  viewMode,
  baseUrl,
}: {
  content: string
  name: string
  viewMode: ViewMode
  baseUrl: string
}) {
  const md = isMarkdown(name)

  // Markdown preview mode
  if (md && viewMode === 'preview') {
    return (
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--color-bg-base)' }}>
        <div style={{ maxWidth: 920, margin: '0 auto', padding: '40px 56px 72px' }}>
          <MarkdownRenderer content={content} baseUrl={baseUrl} variant="document" />
        </div>
      </div>
    )
  }

  // Source mode (or non-markdown text)
  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'var(--color-bg-base)' }}>
      <pre style={{
        margin: 0, padding: '20px 24px', fontSize: 12, lineHeight: 1.8,
        fontFamily: "'SF Mono', 'Fira Code', Consolas, monospace",
        color: 'var(--color-text-primary)', whiteSpace: 'pre', overflowX: 'auto',
        tabSize: 2,
      }}>
        <code>{content}</code>
      </pre>
    </div>
  )
}

function WordViewer({ html }: { html: string }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', background: '#e8e4de' }}>
      <style>{`
        .word-doc h1,.word-doc h2,.word-doc h3{font-weight:700;margin:1em 0 .4em}
        .word-doc h1{font-size:1.6em}.word-doc h2{font-size:1.3em}.word-doc h3{font-size:1.1em}
        .word-doc p{margin:.4em 0;line-height:1.8}
        .word-doc table{border-collapse:collapse;width:100%;margin:1em 0}
        .word-doc td,.word-doc th{border:1px solid #ccc;padding:6px 10px;text-align:left}
        .word-doc th{background:#f0ede8;font-weight:600}
        .word-doc ul,.word-doc ol{padding-left:1.5em;margin:.4em 0}
        .word-doc li{margin:.2em 0;line-height:1.7}
      `}</style>
      <div style={{ maxWidth: 760, margin: '28px auto', padding: '0 24px 40px' }}>
        <div
          className="word-doc"
          style={{
            background: '#fff',
            boxShadow: '0 2px 16px rgba(0,0,0,0.12)',
            borderRadius: 2,
            padding: '56px 64px',
            fontFamily: 'Georgia, "Times New Roman", serif',
            fontSize: 14,
            lineHeight: 1.8,
            color: '#1a1a1a',
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  )
}

function ExcelViewer({ sheets }: { sheets: { name: string; html: string }[] }) {
  const [activeSheet, setActiveSheet] = useState(0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* Sheet tabs */}
      {sheets.length > 1 && (
        <div style={{
          display: 'flex', gap: 0, flexShrink: 0, overflowX: 'auto',
          borderBottom: '1px solid var(--color-border-subtle)',
          background: 'var(--color-bg-surface-high)',
        }}>
          {sheets.map((s, i) => (
            <button
              key={i}
              onClick={() => setActiveSheet(i)}
              style={{
                padding: '7px 16px', fontSize: 12, fontWeight: activeSheet === i ? 600 : 400,
                color: activeSheet === i ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
                background: 'transparent', border: 'none', borderBottom: activeSheet === i ? '2px solid var(--color-accent-primary)' : '2px solid transparent',
                cursor: 'pointer', whiteSpace: 'nowrap', transition: 'color 0.1s',
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Table content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16, background: '#f5f5f5' }}>
        <style>{`
          .excel-sheet table{border-collapse:collapse;font-size:12px;white-space:nowrap}
          .excel-sheet td,.excel-sheet th{border:1px solid #d0d0d0;padding:4px 10px;background:#fff;text-align:left;vertical-align:middle}
          .excel-sheet th{background:#e8e8e8;font-weight:600}
          .excel-sheet tr:hover td{background:#f0f8ff}
        `}</style>
        <div
          className="excel-sheet"
          dangerouslySetInnerHTML={{ __html: sheets[activeSheet]?.html || '' }}
        />
      </div>
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

// TitleBar = row1(h-8=32px) + row2(h-12=48px) + border-bottom(1px) = 81px
const TITLEBAR_HEIGHT = 81

export function FilePreviewPanel({ file, onClose }: FilePreviewPanelProps) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<PreviewData | null>(null)
  const [isMaximized, setIsMaximized] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('preview')

  const ext = getExt(file.name)
  const isMd = isMarkdown(file.name)
  const baseUrl = getBaseUrl(file.url)

  // Reset to preview mode when switching files
  useEffect(() => { setViewMode('preview') }, [file.url])

  useEffect(() => {
    setData(null)
    if (isImage(file.name, file.mimeType)) return
    if (isPdf(file.name, file.mimeType)) return

    // Word / Excel: call the JSON preview API
    if (isWordLike(ext) || isExcelLike(ext)) {
      const apiUrl = file.previewApiUrl
        ?? (file.originalFilename ? `/api/files/preview/${encodeURIComponent(file.originalFilename)}` : null)
      if (!apiUrl) {
        setData({ type: 'error', message: '无法找到原始文件' })
        return
      }
      setLoading(true)
      fetch(apiUrl)
        .then(r => r.json())
        .then((json: PreviewData) => setData(json))
        .catch(e => setData({ type: 'error', message: String(e) }))
        .finally(() => setLoading(false))
      return
    }

    // Text / code / markdown: fetch raw content from serve URL
    if (isTextLike(file.name)) {
      setLoading(true)
      fetch(file.url)
        .then(r => r.text())
        .then(text => setData({ type: 'text', content: text, language: ext }))
        .catch(e => setData({ type: 'error', message: String(e) }))
        .finally(() => setLoading(false))
    }
  }, [file.url, file.originalFilename, file.previewApiUrl, file.name, file.mimeType, ext])

  const renderContent = () => {
    if (isImage(file.name, file.mimeType)) {
      return (
        <div style={{
          flex: 1, overflow: 'auto', display: 'flex',
          alignItems: 'center', justifyContent: 'center', padding: 32,
          background: 'var(--color-bg-base)',
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={file.url}
            alt={file.name}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8 }}
          />
        </div>
      )
    }

    if (isPdf(file.name, file.mimeType)) {
      return (
        <iframe
          src={file.url}
          style={{ flex: 1, width: '100%', border: 'none', background: '#fff' }}
          title={file.name}
        />
      )
    }

    if (loading) {
      return (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          color: 'var(--color-text-muted)',
        }}>
          <Loader2 size={16} className="animate-spin" />
          <span style={{ fontSize: 13 }}>加载中…</span>
        </div>
      )
    }

    if (!data) return null

    if (data.type === 'error') {
      return (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
          <FileText size={32} style={{ color: 'var(--color-text-muted)' }} />
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center', maxWidth: 280 }}>
            预览失败：{data.message}
          </p>
        </div>
      )
    }

    if (data.type === 'word') return <WordViewer html={data.html} />
    if (data.type === 'excel') return <ExcelViewer sheets={data.sheets} />
    if (data.type === 'text') return <TextViewer content={data.content} name={file.name} viewMode={viewMode} baseUrl={baseUrl} />

    return null
  }

  return (
    <div style={{
      position: 'fixed',
      top: TITLEBAR_HEIGHT,
      right: 0,
      bottom: 0,
      width: isMaximized ? '100%' : '50%',
      minWidth: isMaximized ? undefined : 400,
      zIndex: 100,
      background: 'var(--color-bg-surface)',
      display: 'flex',
      flexDirection: 'column',
      borderLeft: '1px solid var(--color-border-subtle)',
      transition: 'width 0.2s ease',
    }}>
      {/* Header — same 48px height as the chat session header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px 0 16px', height: 48,
          borderBottom: '1px solid var(--color-border-subtle)', flexShrink: 0,
        }}
      >
        <FileText size={15} style={{ color: 'var(--color-accent-primary)', flexShrink: 0 }} />
        <span style={{
          fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)',
          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {file.name}
        </span>

        {/* Source / Preview toggle — markdown only */}
        {isMd && (
          <div style={{
            display: 'flex', flexShrink: 0,
            background: 'var(--color-bg-base)',
            borderRadius: 6, padding: 2, gap: 1,
            border: '1px solid var(--color-border-subtle)',
          }}>
            {(['preview', 'source'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                title={mode === 'preview' ? '渲染预览' : '源码'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '3px 8px', fontSize: 11, fontWeight: 500,
                  color: viewMode === mode ? 'var(--color-text-primary)' : 'var(--color-text-disabled)',
                  background: viewMode === mode ? 'var(--color-bg-surface)' : 'transparent',
                  border: 'none', borderRadius: 4, cursor: 'pointer',
                  transition: 'color 0.15s, background 0.15s',
                  boxShadow: viewMode === mode ? '0 1px 3px rgba(0,0,0,0.15)' : 'none',
                }}
              >
                {mode === 'preview'
                  ? <><Eye size={11} /><span>Preview</span></>
                  : <><Code2 size={11} /><span>Source</span></>
                }
              </button>
            ))}
          </div>
        )}

        <button
          onClick={() => setIsMaximized(m => !m)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: 6, border: 'none',
            background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)',
          }}
          title={isMaximized ? '还原' : '最大化'}
        >
          {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button
          onClick={onClose}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: 6, border: 'none',
            background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)',
          }}
          title="关闭预览"
        >
          <X size={15} />
        </button>
      </div>

      {/* Content */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        {renderContent()}
      </div>
    </div>
  )
}
