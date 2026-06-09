import { NextRequest, NextResponse } from 'next/server'
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type PreviewResult =
  | { type: 'word'; html: string }
  | { type: 'excel'; sheets: { name: string; html: string }[] }
  | { type: 'text'; content: string; language: string }
  | { type: 'error'; message: string }

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function detectLanguage(ext: string): string {
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
    py: 'python', rs: 'rust', go: 'go', java: 'java',
    cpp: 'cpp', c: 'c', h: 'c', cs: 'csharp',
    rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin',
    sh: 'bash', bash: 'bash', zsh: 'bash',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    html: 'html', htm: 'html', css: 'css', scss: 'scss',
    sql: 'sql', md: 'markdown', mdx: 'markdown', xml: 'xml', csv: 'csv',
  }
  return map[ext] || 'text'
}

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

function resolveLocalPreviewPath(req: NextRequest): { filePath?: string; response?: NextResponse } {
  const rawPath = req.nextUrl.searchParams.get('path') || ''
  if (!rawPath) return { response: NextResponse.json({ type: 'error', message: 'path required' }, { status: 400 }) }

  let filePath = rawPath
  try {
    if (rawPath.startsWith('file://')) filePath = new URL(rawPath).pathname
  } catch {
    return { response: NextResponse.json({ type: 'error', message: 'Invalid path' }, { status: 400 }) }
  }
  filePath = safeDecodeURIComponent(filePath)

  if (!path.isAbsolute(filePath)) {
    return { response: NextResponse.json({ type: 'error', message: 'Absolute path required' }, { status: 400 }) }
  }
  if (!existsSync(filePath)) {
    return { response: NextResponse.json({ type: 'error', message: 'File not found' }, { status: 404 }) }
  }

  const stat = statSync(filePath)
  if (!stat.isFile()) return { response: NextResponse.json({ type: 'error', message: 'Not a file' }, { status: 400 }) }
  if (stat.size > 100 * 1024 * 1024) {
    return { response: NextResponse.json({ type: 'error', message: 'File too large' }, { status: 413 }) }
  }

  return { filePath }
}

export async function GET(req: NextRequest) {
  const resolved = resolveLocalPreviewPath(req)
  if (resolved.response) return resolved.response
  if (!resolved.filePath) return NextResponse.json({ type: 'error', message: 'File not found' }, { status: 404 })

  const ext = path.extname(resolved.filePath).toLowerCase().slice(1)
  try {
    let result: PreviewResult
    if (['docx', 'doc', 'odt'].includes(ext)) {
      result = await previewWord(resolved.filePath, ext)
    } else if (['xlsx', 'xls', 'xlsm', 'xlsb', 'ods'].includes(ext)) {
      result = await previewExcel(resolved.filePath)
    } else {
      const rawContent = await readFile(resolved.filePath, 'utf-8')
      result = { type: 'text', content: rawContent, language: detectLanguage(ext) }
    }
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ type: 'error', message: msg }, { status: 500 })
  }
}
