import { NextRequest, NextResponse } from 'next/server'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import path from 'path'
import { getUploadsDir } from '@/shared/db/paths'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Rich PPT types
type PptTextRun = { text: string; fontSize?: number; bold?: boolean; italic?: boolean; color?: string }
type PptParagraph = { runs: PptTextRun[]; indent: number; align: string }
type PptShape = { isTitle: boolean; paragraphs: PptParagraph[] }
type PptSlide = { index: number; background?: string; shapes: PptShape[] }

type PreviewResult =
  | { type: 'word'; html: string }
  | { type: 'excel'; sheets: { name: string; html: string }[] }
  | { type: 'ppt'; slides: PptSlide[] }
  | { type: 'text'; content: string; language: string }
  | { type: 'error'; message: string }

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
    .map(line => {
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

function parseShapeParas(spXml: string): PptParagraph[] {
  const paragraphs: PptParagraph[] = []
  for (const paraMatch of spXml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)) {
    const paraXml = paraMatch[1]
    let indent = 0
    let align = 'left'
    const pPrM = paraXml.match(/<a:pPr([^>]*)>/)
    if (pPrM) {
      const lvlM = pPrM[1].match(/lvl="(\d+)"/)
      if (lvlM) indent = parseInt(lvlM[1])
      const algM = pPrM[1].match(/algn="(\w+)"/)
      if (algM) align = algM[1]
    }
    const runs: PptTextRun[] = []
    for (const runMatch of paraXml.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)) {
      const runXml = runMatch[1]
      const textM = runXml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/)
      if (!textM || !textM[1]) continue
      const text = textM[1]
      const run: PptTextRun = { text }
      const rPrM = runXml.match(/<a:rPr([^>\/]*)(?:\/>|>([\s\S]*?)<\/a:rPr>)/)
      if (rPrM) {
        const attrs = rPrM[1]
        const inner = rPrM[2] ?? ''
        const szM = attrs.match(/\bsz="(\d+)"/)
        if (szM) run.fontSize = Math.round(parseInt(szM[1]) / 100)
        if (/\bb="1"/.test(attrs)) run.bold = true
        if (/\bi="1"/.test(attrs)) run.italic = true
        const colorM = inner.match(/<a:srgbClr val="([0-9A-Fa-f]{6})"/)
        if (colorM) run.color = colorM[1]
      }
      runs.push(run)
    }
    if (runs.length > 0) paragraphs.push({ runs, indent, align })
  }
  return paragraphs
}

async function previewPptx(filePath: string, ext: string): Promise<PreviewResult> {
  if (ext !== 'pptx') {
    const officeparser = await import('officeparser')
    const ast = await officeparser.parseOffice(filePath)
    const text = ast.toText()
    const lines = text.split('\n').map((l: string) => l.trim()).filter(Boolean)
    const slides: PptSlide[] = []
    for (let i = 0; i < lines.length; i += 8) {
      const chunk = lines.slice(i, i + 8)
      const shapes: PptShape[] = []
      if (chunk[0]) shapes.push({ isTitle: true, paragraphs: [{ runs: [{ text: chunk[0] }], indent: 0, align: 'left' }] })
      if (chunk.length > 1) shapes.push({ isTitle: false, paragraphs: chunk.slice(1).map((l: string) => ({ runs: [{ text: l }], indent: 0, align: 'left' })) })
      slides.push({ index: Math.floor(i / 8) + 1, shapes })
    }
    if (slides.length === 0) slides.push({ index: 1, shapes: [] })
    return { type: 'ppt', slides }
  }

  const JSZip = (await import('jszip')).default
  const buf = await readFile(filePath)
  const zip = await JSZip.loadAsync(buf)

  const slideEntries: [number, string][] = []
  zip.forEach((p) => {
    const m = p.match(/^ppt\/slides\/slide(\d+)\.xml$/)
    if (m) slideEntries.push([parseInt(m[1]), p])
  })
  slideEntries.sort((a, b) => a[0] - b[0])

  const slides: PptSlide[] = []

  for (const [idx, slidePath] of slideEntries) {
    const xmlStr = await zip.file(slidePath)!.async('string')
    let background: string | undefined
    const bgM = xmlStr.match(/<p:bg>[\s\S]*?<a:srgbClr val="([0-9A-Fa-f]{6})"/)
    if (bgM) background = bgM[1]
    const shapes: PptShape[] = []
    for (const spMatch of xmlStr.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)) {
      const spXml = spMatch[1]
      const isTitle = /<p:ph[^>]*type="(title|ctrTitle)"/.test(spXml)
      const paragraphs = parseShapeParas(spXml)
      if (paragraphs.length > 0) shapes.push({ isTitle, paragraphs })
    }
    slides.push({ index: idx, background, shapes })
  }

  return { type: 'ppt', slides }
}

// GET /api/files/preview/:filename
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params

  if (filename.includes('..') || filename.includes('/')) {
    return NextResponse.json({ type: 'error', message: 'Invalid filename' }, { status: 400 })
  }

  const UPLOAD_DIR = getUploadsDir()
  const filePath = path.join(UPLOAD_DIR, filename)

  if (!existsSync(filePath)) {
    return NextResponse.json({ type: 'error', message: 'File not found' }, { status: 404 })
  }

  const ext = path.extname(filename).toLowerCase().slice(1)

  try {
    let result: PreviewResult

    if (['docx', 'doc', 'odt'].includes(ext)) {
      result = await previewWord(filePath, ext)
    } else if (['xlsx', 'xls', 'xlsm', 'xlsb', 'ods'].includes(ext)) {
      result = await previewExcel(filePath)
    } else if (['pptx', 'ppt', 'odp'].includes(ext)) {
      result = await previewPptx(filePath, ext)
    } else {
      const rawContent = await readFile(filePath, 'utf-8')
      result = { type: 'text', content: rawContent, language: detectLanguage(ext) }
    }

    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ type: 'error', message: msg }, { status: 500 })
  }
}
