/**
 * GET /api/projects/[id]/files/preview/[...relpath]
 * Returns a JSON preview of a workspace file (Word HTML, Excel sheets, or text content).
 * Mirrors /api/files/preview/[filename] but reads from the project workspace instead of uploads dir.
 */

import { NextRequest, NextResponse } from 'next/server'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import path from 'path'
import { getDb } from '@/shared/db/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function detectLanguage(ext: string): string {
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', rs: 'rust', go: 'go', java: 'java',
    cpp: 'cpp', c: 'c', h: 'c', cs: 'csharp',
    rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin',
    sh: 'bash', bash: 'bash', zsh: 'bash',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    html: 'html', htm: 'html', css: 'css', scss: 'scss',
    sql: 'sql', md: 'markdown', mdx: 'markdown', xml: 'xml', csv: 'csv',
    env: 'bash', gitignore: 'bash', dockerfile: 'dockerfile',
  }
  return map[ext] || 'text'
}

type PreviewResult =
  | { type: 'word'; html: string }
  | { type: 'excel'; sheets: { name: string; html: string }[] }
  | { type: 'text'; content: string; language: string }
  | { type: 'error'; message: string }

async function previewWord(filePath: string, ext: string): Promise<PreviewResult> {
  if (ext === 'docx') {
    const mammoth = await import('mammoth')
    const result = await mammoth.convertToHtml({ path: filePath }, {
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
      ],
    })
    return { type: 'word', html: result.value }
  }
  const officeparser = await import('officeparser')
  const ast = await officeparser.parseOffice(filePath)
  const text = ast.toText()
  const html = text
    .split('\n')
    .map((line: string) => {
      const trimmed = line.trim()
      if (!trimmed) return ''
      const escaped = trimmed.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      return `<p>${escaped}</p>`
    })
    .join('\n') || '<p style="color:#999">(empty or unparseable document)</p>'
  return { type: 'word', html }
}

async function previewExcel(filePath: string): Promise<PreviewResult> {
  const XLSX = await import('xlsx')
  const fs = await import('fs')
  if (typeof XLSX.set_fs === 'function') XLSX.set_fs(fs)

  let workbook: ReturnType<typeof XLSX.readFile>
  try {
    workbook = XLSX.readFile(filePath)
  } catch {
    const buf = await readFile(filePath)
    workbook = XLSX.read(buf)
  }

  const sheets = workbook.SheetNames.map(name => {
    const ws = workbook.Sheets[name]
    const html = XLSX.utils.sheet_to_html(ws, { id: `sheet-${name}`, editable: false })
    return { name, html }
  })
  return { type: 'excel', sheets }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; relpath: string[] }> },
) {
  const { id: projectId, relpath } = await params

  if (relpath.some(seg => seg.includes('..'))) {
    return NextResponse.json({ type: 'error', message: 'Invalid path' }, { status: 400 })
  }

  const db = getDb()
  const project = db
    .prepare('SELECT workspace_path FROM projects WHERE id = ? AND status != ?')
    .get(projectId, 'deleted') as { workspace_path: string } | undefined

  if (!project) return NextResponse.json({ type: 'error', message: 'Project not found' }, { status: 404 })

  const relFilePath = relpath.join('/')
  const fullPath = path.join(project.workspace_path, relFilePath)

  const workspaceReal = path.resolve(project.workspace_path)
  const fileReal = path.resolve(fullPath)
  if (!fileReal.startsWith(workspaceReal + path.sep)) {
    return NextResponse.json({ type: 'error', message: 'Forbidden' }, { status: 403 })
  }

  if (!existsSync(fullPath)) {
    return NextResponse.json({ type: 'error', message: 'File not found' }, { status: 404 })
  }

  const ext = path.extname(fullPath).toLowerCase().slice(1)

  try {
    let result: PreviewResult

    if (['docx', 'doc', 'odt'].includes(ext)) {
      result = await previewWord(fullPath, ext)
    } else if (['xlsx', 'xls', 'xlsm', 'xlsb', 'ods'].includes(ext)) {
      result = await previewExcel(fullPath)
    } else {
      const rawContent = await readFile(fullPath, 'utf-8')
      result = { type: 'text', content: rawContent, language: detectLanguage(ext) }
    }

    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ type: 'error', message: msg }, { status: 500 })
  }
}
