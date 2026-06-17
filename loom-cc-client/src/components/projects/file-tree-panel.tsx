'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Loader2, RefreshCw, FilePlus, FolderPlus, ChevronsUpDown,
  ChevronRight, Folder, FolderOpen, FileText, GitBranch,
  MapPin, Settings, Pencil, Trash2, FileVideo,
} from 'lucide-react'
import { FilePreviewPanel, type PreviewFile } from '@/components/chat/file-preview-panel'

interface FileNode {
  name: string
  type: 'file' | 'dir'
  path: string
  children?: FileNode[]
}

const ROOT_PATH = '__root__'

/* ── File extension color map ── */
function getExtColor(name: string): { letter: string; color: string } | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, { letter: string; color: string }> = {
    ts:    { letter: 'TS',   color: '#3B82F6' },
    tsx:   { letter: 'TSX',  color: '#60A5FA' },
    js:    { letter: 'JS',   color: '#F59E0B' },
    jsx:   { letter: 'JSX',  color: '#FBBF24' },
    mjs:   { letter: 'JS',   color: '#F59E0B' },
    cjs:   { letter: 'JS',   color: '#F59E0B' },
    json:  { letter: 'JSON', color: '#9CA3AF' },
    md:    { letter: 'MD',   color: '#34D399' },
    mdx:   { letter: 'MDX',  color: '#34D399' },
    py:    { letter: 'PY',   color: '#06B6D4' },
    css:   { letter: 'CSS',  color: '#F472B6' },
    scss:  { letter: 'SCSS', color: '#EC4899' },
    html:  { letter: 'HTML', color: '#F97316' },
    svg:   { letter: 'SVG',  color: '#A78BFA' },
    env:   { letter: 'ENV',  color: '#EF4444' },
    yaml:  { letter: 'YML',  color: '#84CC16' },
    yml:   { letter: 'YML',  color: '#84CC16' },
    toml:  { letter: 'TOML', color: '#84CC16' },
    sh:    { letter: 'SH',   color: '#10B981' },
    bash:  { letter: 'SH',   color: '#10B981' },
    rs:    { letter: 'RS',   color: '#F97316' },
    go:    { letter: 'GO',   color: '#06B6D4' },
    java:  { letter: 'JV',   color: '#F59E0B' },
    swift: { letter: 'SW',   color: '#F97316' },
    kt:    { letter: 'KT',   color: '#A78BFA' },
    rb:    { letter: 'RB',   color: '#EF4444' },
  }
  return map[ext] ?? null
}

function isVideoFile(name: string): boolean {
  return name.split('.').pop()?.toLowerCase() === 'mp4'
}

/* ── Preview helpers ── */
const PREVIEWABLE_EXTS = new Set([
  // Images
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg',
  // Video
  'mp4',
  // PDF
  'pdf',
  // Text / code
  'md', 'mdx', 'txt', 'csv', 'json', 'yaml', 'yml', 'toml', 'xml',
  'html', 'htm', 'css', 'scss',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'rs', 'go', 'java', 'cpp', 'c', 'h', 'cs', 'rb', 'php',
  'swift', 'kt', 'sh', 'bash', 'zsh', 'sql', 'env',
  // Office (Word / Excel only — PPT not supported)
  'doc', 'docx', 'odt',
  'xls', 'xlsx', 'xlsm', 'xlsb', 'ods',
])

const OFFICE_WORD_EXTS = new Set(['doc', 'docx', 'odt'])
const OFFICE_EXCEL_EXTS = new Set(['xls', 'xlsx', 'xlsm', 'xlsb', 'ods'])

function getFileMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    mp4: 'video/mp4',
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    odt: 'application/vnd.oasis.opendocument.text',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    xlsm: 'application/vnd.ms-excel.sheet.macroenabled.12',
    xlsb: 'application/vnd.ms-excel.sheet.binary.macroenabled.12',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
  }
  return map[ext] || 'text/plain; charset=utf-8'
}

/* ── Dir icon ── */
function DirIcon({ name, isExpanded }: { name: string; isExpanded: boolean }) {
  if (name === '.claude') return <Settings size={13} style={{ color: '#F59E0B', flexShrink: 0 }} />
  return isExpanded
    ? <FolderOpen size={13} style={{ color: '#F59E0B', flexShrink: 0 }} />
    : <Folder size={13} style={{ color: '#F59E0B', flexShrink: 0 }} />
}

/* ── Inline create input row ── */
function InlineCreateRow({
  depth, type, value, onChange, onCommit, onCancel,
}: {
  depth: number
  type: 'file' | 'dir'
  value: string
  onChange: (v: string) => void
  onCommit: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      padding: `3px 12px 3px ${12 + depth * 12}px`,
    }}>
      <span style={{ width: 11, flexShrink: 0 }} />
      {type === 'dir'
        ? <Folder size={13} style={{ color: '#F59E0B', flexShrink: 0 }} />
        : <FileText size={13} style={{ color: 'var(--color-text-disabled)', flexShrink: 0 }} />
      }
      <input
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); if (value.trim()) onCommit() }
          if (e.key === 'Escape') { e.preventDefault(); onCancel() }
        }}
        onBlur={onCancel}
        placeholder={type === 'dir' ? '文件夹名称…' : '文件名称…'}
        style={{
          flex: 1, minWidth: 0, fontSize: 12, borderRadius: 4,
          padding: '2px 6px', outline: 'none',
          background: 'var(--color-bg-input, var(--color-bg-surface))',
          border: '1px solid rgba(99,102,241,0.5)',
          color: 'var(--color-text-primary)',
        }}
      />
    </div>
  )
}

/* ── Tree callbacks (passed down to avoid prop drilling repetition) ── */
interface TreeCbs {
  onToggle: (p: string) => void
  onSelect: (p: string, isDir: boolean) => void
  onPreview: (relPath: string, name: string) => void
  onContextMenu: (e: React.MouseEvent, p: string, name: string, isDir: boolean) => void
  onRenameChange: (v: string) => void
  onRenameCommit: () => void
  onRenameCancel: () => void
  onCreateChange: (v: string) => void
  onCreateCommit: () => void
  onCreateCancel: () => void
  highlightingPath: string | null
}

/* ── FileTreeNode ── */
function FileTreeNode({
  node, depth, expandedPaths, selectedPath,
  renamingPath, renameValue,
  creating, createValue,
  cbs,
}: {
  node: FileNode
  depth: number
  expandedPaths: Set<string>
  selectedPath: string
  renamingPath: string | null
  renameValue: string
  creating: { targetDirPath: string; type: 'file' | 'dir' } | null
  createValue: string
  cbs: TreeCbs
}) {
  const isSelected = selectedPath === node.path
  const isHighlighting = cbs.highlightingPath === node.path
  const isRenaming = renamingPath === node.path
  const isExpanded = expandedPaths.has(node.path)
  const isDir = node.type === 'dir'
  const isVideo = !isDir && isVideoFile(node.name)
  const extInfo = !isDir && !isVideo ? getExtColor(node.name) : null
  const indent = depth * 12
  const showCreateHere = isDir && isExpanded && creating?.targetDirPath === node.path

  return (
    <div>
      {/* Row */}
      <div
        onClick={() => {
          if (isDir) cbs.onToggle(node.path)
          cbs.onSelect(node.path, isDir)
          if (!isDir) {
            const ext = node.name.split('.').pop()?.toLowerCase() || ''
            if (PREVIEWABLE_EXTS.has(ext)) cbs.onPreview(node.path, node.name)
          }
        }}
        onContextMenu={e => cbs.onContextMenu(e, node.path, node.name, isDir)}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: `3px 12px 3px ${12 + indent}px`,
          cursor: 'pointer', borderRadius: 4, userSelect: 'none',
          background: isHighlighting
            ? 'rgba(99,102,241,0.18)'
            : isSelected ? 'var(--color-bg-surface-high)' : 'transparent',
          transition: 'background 0.4s ease',
          outline: isHighlighting ? '1px solid rgba(99,102,241,0.35)' : 'none',
        }}
        onMouseEnter={e => { if (!isSelected && !isHighlighting) (e.currentTarget as HTMLElement).style.background = 'var(--color-bg-surface)' }}
        onMouseLeave={e => { if (!isSelected && !isHighlighting) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
      >
        {isDir ? (
          <>
            <ChevronRight size={11} style={{ color: 'var(--color-text-muted)', flexShrink: 0, transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.12s' }} />
            <DirIcon name={node.name} isExpanded={isExpanded} />
          </>
        ) : (
          <>
            <span style={{ width: 11, flexShrink: 0 }} />
            {isVideo ? (
              <FileVideo size={14} style={{ color: '#38bdf8', flexShrink: 0 }} />
            ) : extInfo ? (
              <span style={{ fontSize: 8, fontWeight: 700, flexShrink: 0, padding: '1px 2px', borderRadius: 2, background: extInfo.color + '22', color: extInfo.color, minWidth: 20, textAlign: 'center' }}>
                {extInfo.letter.length > 3 ? extInfo.letter.slice(0, 3) : extInfo.letter}
              </span>
            ) : (
              <FileText size={13} style={{ color: 'var(--color-text-disabled)', flexShrink: 0 }} />
            )}
          </>
        )}
        {isRenaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={e => cbs.onRenameChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); if (renameValue.trim()) cbs.onRenameCommit() }
              if (e.key === 'Escape') { e.preventDefault(); cbs.onRenameCancel() }
            }}
            onBlur={cbs.onRenameCancel}
            style={{ flex: 1, minWidth: 0, fontSize: 12, borderRadius: 4, padding: '2px 6px', outline: 'none', background: 'var(--color-bg-input, var(--color-bg-surface))', border: '1px solid rgba(99,102,241,0.5)', color: 'var(--color-text-primary)' }}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span style={{ fontSize: 12, color: isDir ? 'var(--color-text-secondary)' : 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.name}
          </span>
        )}
      </div>

      {/* Children */}
      {isDir && isExpanded && (
        <>
          {showCreateHere && (
            <InlineCreateRow
              depth={depth + 1}
              type={creating!.type}
              value={createValue}
              onChange={cbs.onCreateChange}
              onCommit={cbs.onCreateCommit}
              onCancel={cbs.onCreateCancel}
            />
          )}
          {node.children?.map(child => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              selectedPath={selectedPath}
              renamingPath={renamingPath}
              renameValue={renameValue}
              creating={creating}
              createValue={createValue}
              cbs={cbs}
            />
          ))}
        </>
      )}
    </div>
  )
}

/* ── Collect all dir paths ── */
function collectDirPaths(nodes: FileNode[]): string[] {
  const paths: string[] = []
  for (const n of nodes) {
    if (n.type === 'dir') {
      paths.push(n.path)
      if (n.children) paths.push(...collectDirPaths(n.children))
    }
  }
  return paths
}

/* ── Find node by path ── */
function findNode(nodes: FileNode[], relPath: string): FileNode | null {
  for (const n of nodes) {
    if (n.path === relPath) return n
    if (n.type === 'dir' && n.children) {
      const found = findNode(n.children, relPath)
      if (found) return found
    }
  }
  return null
}

/* ── Main component ── */
interface FileTreePanelProps {
  projectId: string
  workspacePath: string
  projectName: string
  onPreviewChange?: (open: boolean) => void
  highlightPath?: string | null
}

export function FileTreePanel({ projectId, workspacePath, projectName, onPreviewChange, highlightPath }: FileTreePanelProps) {
  const [files, setFiles] = useState<FileNode[]>([])
  const [branch, setBranch] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set([ROOT_PATH]))
  const [allExpanded, setAllExpanded] = useState(false)

  // Selection
  const [selectedPath, setSelectedPath] = useState<string>(ROOT_PATH)
  const [selectedIsDir, setSelectedIsDir] = useState(true)

  // Context menu
  const [contextMenu, setContextMenu] = useState<{ path: string; name: string; isDir: boolean; x: number; y: number } | null>(null)
  const ctxMenuRef = useRef<HTMLDivElement>(null)
  const loadSeqRef = useRef(0)

  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState<{ path: string; name: string; isDir: boolean } | null>(null)

  // Rename
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Create
  const [creating, setCreating] = useState<{ targetDirPath: string; type: 'file' | 'dir' } | null>(null)
  const [createValue, setCreateValue] = useState('')

  // Preview
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null)

  // Highlight (from Tasks → Files linkage)
  const [highlightingPath, setHighlightingPath] = useState<string | null>(null)

  /* ── Notify parent of preview open/close ── */
  useEffect(() => {
    onPreviewChange?.(previewFile !== null)
  }, [previewFile, onPreviewChange])

  /* ── Navigate to highlighted path (from Tasks linkage) ── */
  useEffect(() => {
    if (!highlightPath || files.length === 0) return
    // Expand all ancestor directories
    const segments = highlightPath.split('/')
    const ancestors: string[] = []
    for (let i = 1; i < segments.length; i++) {
      ancestors.push(segments.slice(0, i).join('/'))
    }
    setExpandedPaths(prev => {
      const next = new Set(prev)
      next.add(ROOT_PATH)
      ancestors.forEach(p => next.add(p))
      return next
    })
    setSelectedPath(highlightPath)
    setSelectedIsDir(false)
    setHighlightingPath(highlightPath)
    const t = setTimeout(() => setHighlightingPath(null), 1200)
    return () => clearTimeout(t)
  }, [highlightPath, files])

  /* ── Handle file preview click ── */
  const handlePreview = useCallback((relPath: string, name: string) => {
    const ext = name.split('.').pop()?.toLowerCase() || ''
    const isOffice = OFFICE_WORD_EXTS.has(ext) || OFFICE_EXCEL_EXTS.has(ext)
    const encodedPath = relPath.split('/').map(encodeURIComponent).join('/')
    setPreviewFile({
      url: `/api/projects/${projectId}/files/serve/${encodedPath}`,
      previewApiUrl: isOffice ? `/api/projects/${projectId}/files/preview/${encodedPath}` : undefined,
      name,
      mimeType: getFileMime(name),
    })
  }, [projectId])

  /* ── Fetch ── */
  const loadFiles = useCallback(async (options?: { force?: boolean; showSpinner?: boolean; resetExpanded?: boolean }) => {
    const force = options?.force ?? false
    const showSpinner = options?.showSpinner ?? false
    const seq = ++loadSeqRef.current
    if (showSpinner) setRefreshing(true)
    try {
      const searchParams = new URLSearchParams()
      if (force) {
        searchParams.set('refresh', '1')
        searchParams.set('_', String(Date.now()))
      }
      const query = searchParams.toString()
      const res = await fetch(`/api/projects/${projectId}/files${query ? `?${query}` : ''}`, {
        cache: force ? 'no-store' : 'default',
      })
      if (!res.ok) return
      const data = await res.json() as { files?: FileNode[]; branch?: string | null }
      if (seq !== loadSeqRef.current) return
      const fetched = data.files || []
      setFiles(fetched)
      setBranch(data.branch || null)
      if (options?.resetExpanded) {
        const auto = new Set<string>([ROOT_PATH])
        for (const n of fetched) {
          if (n.type === 'dir' && n.name === '.claude') auto.add(n.path)
        }
        setExpandedPaths(auto)
        setAllExpanded(false)
      }
    } catch {
      // Keep the last known tree if a transient refresh fails.
    } finally {
      if (showSpinner) setRefreshing(false)
    }
  }, [projectId])

  useEffect(() => {
    setLoading(true)
    setSelectedPath(ROOT_PATH)
    setSelectedIsDir(true)
    loadFiles({ force: true, resetExpanded: true })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId, loadFiles])

  useEffect(() => {
    if (!workspacePath || !window.electronAPI?.watchDirectory || !window.electronAPI?.onFsChanged) return
    let disposed = false
    const normalizedWorkspacePath = workspacePath.replace(/\/+$/, '')

    window.electronAPI.watchDirectory(workspacePath).catch(() => {})
    const offFsChanged = window.electronAPI.onFsChanged(payload => {
      if (disposed) return
      const changedDirPath = payload?.dirPath?.replace(/\/+$/, '')
      if (changedDirPath && changedDirPath !== normalizedWorkspacePath) return
      void loadFiles({ force: true })
    })

    return () => {
      disposed = true
      offFsChanged()
      window.electronAPI?.unwatchDirectory?.().catch(() => {})
    }
  }, [workspacePath, loadFiles])

  /* ── Close context menu on outside click ── */
  useEffect(() => {
    if (!contextMenu) return
    const handler = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) setContextMenu(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [contextMenu])

  /* ── Toggle expansion ── */
  const togglePath = useCallback((p: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })
  }, [])

  const handleCollapseExpand = useCallback(() => {
    if (allExpanded) {
      setExpandedPaths(new Set([ROOT_PATH]))
      setAllExpanded(false)
    } else {
      setExpandedPaths(new Set([ROOT_PATH, ...collectDirPaths(files)]))
      setAllExpanded(true)
    }
  }, [allExpanded, files])

  /* ── Select ── */
  const handleSelect = useCallback((p: string, isDir: boolean) => {
    setSelectedPath(p)
    setSelectedIsDir(isDir)
    setContextMenu(null)
  }, [])

  /* ── Context menu ── */
  const handleContextMenu = useCallback((e: React.MouseEvent, p: string, name: string, isDir: boolean) => {
    e.preventDefault()
    setSelectedPath(p)
    setSelectedIsDir(isDir)
    setContextMenu({ path: p, name, isDir, x: e.clientX, y: e.clientY })
  }, [])

  const handleOpenDirectory = useCallback(async (relPath: string) => {
    const normalizedRelPath = relPath === ROOT_PATH ? '' : relPath
    setContextMenu(null)
    await fetch(`/api/projects/${projectId}/files/open-directory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relPath: normalizedRelPath }),
    }).catch(() => {})
  }, [projectId])

  /* ── Create ── */
  const startCreate = useCallback((type: 'file' | 'dir') => {
    const targetDirPath = selectedIsDir ? selectedPath : ROOT_PATH
    // Expand target if collapsed
    setExpandedPaths(prev => {
      const next = new Set(prev)
      next.add(targetDirPath)
      return next
    })
    setCreating({ targetDirPath, type })
    setCreateValue('')
  }, [selectedPath, selectedIsDir])

  const handleCreateCommit = useCallback(async () => {
    if (!creating || !createValue.trim()) return
    const targetRelPath = creating.targetDirPath === ROOT_PATH ? '' : creating.targetDirPath
    await fetch(`/api/projects/${projectId}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: createValue.trim(), parentRelPath: targetRelPath, type: creating.type }),
    })
    setCreating(null)
    setCreateValue('')
    void loadFiles({ force: true })
  }, [creating, createValue, projectId, loadFiles])

  const handleCreateCancel = useCallback(() => {
    setCreating(null)
    setCreateValue('')
  }, [])

  /* ── Rename ── */
  const startRename = useCallback((p: string, currentName: string) => {
    setContextMenu(null)
    setRenamingPath(p)
    setRenameValue(currentName)
  }, [])

  const handleRenameCommit = useCallback(async () => {
    if (!renamingPath || !renameValue.trim()) return
    await fetch(`/api/projects/${projectId}/files`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relPath: renamingPath, newName: renameValue.trim() }),
    })
    setRenamingPath(null)
    setRenameValue('')
    setSelectedPath(ROOT_PATH)
    setSelectedIsDir(true)
    void loadFiles({ force: true })
  }, [renamingPath, renameValue, projectId, loadFiles])

  const handleRenameCancel = useCallback(() => {
    setRenamingPath(null)
    setRenameValue('')
  }, [])

  /* ── Delete ── */
  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirm) return
    await fetch(`/api/projects/${projectId}/files`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relPath: deleteConfirm.path }),
    })
    setDeleteConfirm(null)
    setSelectedPath(ROOT_PATH)
    setSelectedIsDir(true)
    void loadFiles({ force: true })
  }, [deleteConfirm, projectId, loadFiles])

  const cbs: TreeCbs = {
    onToggle: togglePath,
    onSelect: handleSelect,
    onPreview: handlePreview,
    onContextMenu: handleContextMenu,
    onRenameChange: setRenameValue,
    onRenameCommit: handleRenameCommit,
    onRenameCancel: handleRenameCancel,
    onCreateChange: setCreateValue,
    onCreateCommit: handleCreateCommit,
    onCreateCancel: handleCreateCancel,
    highlightingPath,
  }

  const isRootExpanded = expandedPaths.has(ROOT_PATH)
  const isRootSelected = selectedPath === ROOT_PATH
  const shortPath = workspacePath.replace(/^\/Users\/[^/]+/, '~')

  return (
    <div style={{
      width: 240, flexShrink: 0, height: '100%',
      display: 'flex', flexDirection: 'column',
      borderLeft: '1px solid var(--color-border-subtle)',
      background: 'var(--color-bg-nav)',
    }}>
      {/* ── Header ── */}
      <div style={{
        height: 48, flexShrink: 0,
        display: 'flex', alignItems: 'center',
        padding: '0 8px 0 14px',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>Files</span>
        <div style={{ display: 'flex', gap: 2 }}>
          <button
            onClick={() => void loadFiles({ force: true, showSpinner: true })}
            disabled={refreshing}
            title="刷新文件列表"
            style={{
              width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', borderRadius: 6,
              color: 'var(--color-text-muted)',
              cursor: refreshing ? 'default' : 'pointer',
              opacity: refreshing ? 0.65 : 1,
            }}
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : undefined} />
          </button>
          <button
            onClick={() => selectedIsDir && startCreate('file')}
            disabled={!selectedIsDir}
            title={selectedIsDir ? '新建文件' : '请先选择一个文件夹'}
            style={{
              width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', borderRadius: 6,
              color: selectedIsDir ? 'var(--color-text-muted)' : 'var(--color-text-disabled)',
              cursor: selectedIsDir ? 'pointer' : 'not-allowed',
              opacity: selectedIsDir ? 1 : 0.4,
            }}
          >
            <FilePlus size={13} />
          </button>
          <button
            onClick={() => selectedIsDir && startCreate('dir')}
            disabled={!selectedIsDir}
            title={selectedIsDir ? '新建文件夹' : '请先选择一个文件夹'}
            style={{
              width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', borderRadius: 6,
              color: selectedIsDir ? 'var(--color-text-muted)' : 'var(--color-text-disabled)',
              cursor: selectedIsDir ? 'pointer' : 'not-allowed',
              opacity: selectedIsDir ? 1 : 0.4,
            }}
          >
            <FolderPlus size={13} />
          </button>
          <button
            onClick={handleCollapseExpand}
            title={allExpanded ? '全部折叠' : '全部展开'}
            style={{
              width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', borderRadius: 6, cursor: 'pointer',
              color: 'var(--color-text-muted)',
            }}
          >
            <ChevronsUpDown size={13} />
          </button>
        </div>
      </div>

      {/* ── Project info ── */}
      <div style={{
        flexShrink: 0, padding: '12px 14px 14px',
        borderBottom: '1px solid var(--color-border-subtle)',
        display: 'flex', flexDirection: 'column', gap: 7,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <FolderOpen size={14} style={{ color: '#60A5FA', flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {projectName}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <MapPin size={11} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
            {shortPath}
          </span>
        </div>
        {branch && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <GitBranch size={11} style={{ color: '#34D399', flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: '#34D399', fontWeight: 500 }}>{branch}</span>
          </div>
        )}
      </div>

      {/* ── Tree ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
            <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
          </div>
        ) : files.length === 0 ? (
          <div style={{ padding: '16px 14px' }}>
            <p style={{ fontSize: 11, color: 'var(--color-text-disabled)', textAlign: 'center' }}>
              {workspacePath ? '目录为空' : '未设置工作目录'}
            </p>
          </div>
        ) : (
          <div>
            {/* Root node */}
            <div
              onClick={() => { togglePath(ROOT_PATH); handleSelect(ROOT_PATH, true) }}
              onContextMenu={e => handleContextMenu(e, ROOT_PATH, projectName, true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '3px 12px', cursor: 'pointer', borderRadius: 4, userSelect: 'none',
                background: isRootSelected ? 'var(--color-bg-surface-high)' : 'transparent',
              }}
              onMouseEnter={e => { if (!isRootSelected) (e.currentTarget as HTMLElement).style.background = 'var(--color-bg-surface)' }}
              onMouseLeave={e => { if (!isRootSelected) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >
              <ChevronRight size={11} style={{ color: 'var(--color-text-muted)', flexShrink: 0, transform: isRootExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.12s' }} />
              {isRootExpanded
                ? <FolderOpen size={13} style={{ color: '#60A5FA', flexShrink: 0 }} />
                : <Folder size={13} style={{ color: '#60A5FA', flexShrink: 0 }} />
              }
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {projectName}
              </span>
            </div>

            {/* Root children */}
            {isRootExpanded && (
              <>
                {creating?.targetDirPath === ROOT_PATH && (
                  <InlineCreateRow
                    depth={1}
                    type={creating.type}
                    value={createValue}
                    onChange={cbs.onCreateChange}
                    onCommit={cbs.onCreateCommit}
                    onCancel={cbs.onCreateCancel}
                  />
                )}
                {files.map(node => (
                  <FileTreeNode
                    key={node.path}
                    node={node}
                    depth={1}
                    expandedPaths={expandedPaths}
                    selectedPath={selectedPath}
                    renamingPath={renamingPath}
                    renameValue={renameValue}
                    creating={creating}
                    createValue={createValue}
                    cbs={cbs}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Context menu ── */}
      {contextMenu && createPortal(
        <div
          ref={ctxMenuRef}
          style={{
            position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 9000,
            minWidth: 140, background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', padding: '4px 0',
          }}
        >
          {contextMenu.isDir && (
            <button
              onMouseDown={e => { e.preventDefault(); void handleOpenDirectory(contextMenu.path) }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 16px', fontSize: 12, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-bg-surface-high)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none' }}
            >
              <FolderOpen size={12} style={{ color: 'var(--color-text-muted)' }} />
              打开目录
            </button>
          )}
          {contextMenu.path !== ROOT_PATH && (
            <>
          <button
            onMouseDown={e => { e.preventDefault(); const node = findNode(files, contextMenu.path); if (node) startRename(contextMenu.path, node.name) }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 16px', fontSize: 12, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-bg-surface-high)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none' }}
          >
            <Pencil size={12} style={{ color: 'var(--color-text-muted)' }} />
            重命名
          </button>
          <button
            onMouseDown={e => { e.preventDefault(); setContextMenu(null); setDeleteConfirm({ path: contextMenu.path, name: contextMenu.name, isDir: contextMenu.isDir }) }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 16px', fontSize: 12, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-accent-danger)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-bg-surface-high)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none' }}
          >
            <Trash2 size={12} />
            删除
          </button>
            </>
          )}
        </div>,
        document.body,
      )}

      {/* ── Delete confirm dialog ── */}
      {deleteConfirm && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={() => setDeleteConfirm(null)} />
          <div style={{
            position: 'relative', borderRadius: 12, minWidth: 300, padding: 24,
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border-strong)',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)',
          }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 6 }}>
              删除{deleteConfirm.isDir ? '文件夹' : '文件'}？
            </p>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>
              <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>{deleteConfirm.name}</span>
            </p>
            {deleteConfirm.isDir && (
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 20 }}>
                文件夹及其所有内容将被永久删除，此操作不可撤销。
              </p>
            )}
            {!deleteConfirm.isDir && (
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 20 }}>
                此操作不可撤销。
              </p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setDeleteConfirm(null)}
                style={{ padding: '8px 20px', borderRadius: 8, fontSize: 12, cursor: 'pointer', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border-strong)', background: 'var(--color-bg-surface-high)' }}
              >
                取消
              </button>
              <button
                onClick={handleDeleteConfirm}
                style={{ padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer', color: '#fff', background: '#ef4444', border: 'none' }}
              >
                删除
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* ── File preview panel ── */}
      {previewFile && (
        <FilePreviewPanel
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  )
}
