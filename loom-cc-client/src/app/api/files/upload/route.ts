import { NextRequest, NextResponse } from 'next/server'
import { writeFile, readFile as fsReadFile } from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { getUploadsDir } from '@/shared/db/paths'
import { mkdirSync } from 'fs'
import { logger } from '@/shared/logging/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB

function ensureUploadsDir(): string {
  const dir = getUploadsDir()
  mkdirSync(dir, { recursive: true })
  return dir
}

/** File extensions recognized as text-based (content injected into prompt) */
const TEXT_EXTENSIONS = new Set([
  // Documents
  '.txt', '.md', '.rst', '.rtf', '.log',
  // Code
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go', '.java', '.cpp', '.c', '.h', '.hpp',
  '.rb', '.php', '.swift', '.kt', '.kts', '.sh', '.bash', '.zsh', '.fish',
  '.sql', '.r', '.scala', '.lua', '.pl', '.pm', '.zig', '.nim', '.ex', '.exs',
  '.cs', '.fs', '.vb', '.m', '.mm', '.dart', '.groovy', '.clj', '.cljs', '.erl', '.hs',
  '.dockerfile',
  // Config
  '.json', '.yaml', '.yml', '.toml', '.xml', '.env', '.ini', '.cfg', '.properties',
  '.editorconfig', '.gitignore', '.gitattributes', '.npmrc', '.eslintrc',
  // Data
  '.csv', '.tsv', '.jsonl', '.ndjson',
  // Markup
  '.html', '.htm', '.css', '.scss', '.less', '.sass', '.svg', '.graphql', '.gql',
  // Other text
  '.tex', '.bib', '.makefile', '.cmake', '.gradle', '.pom',
])

/** Office MIME types that can be extracted to text */
const OFFICE_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
  'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.oasis.opendocument.presentation',
])

/** Office file extensions for fallback detection */
const OFFICE_EXTENSIONS = new Set([
  '.docx', '.doc', '.odt',
  '.xlsx', '.xls', '.xlsm', '.xlsb', '.ods',
  '.pptx', '.ppt', '.odp',
])

type OfficeCategory = 'word' | 'spreadsheet' | 'presentation'

function classifyOfficeFile(ext: string, mime: string): OfficeCategory | null {
  const e = ext.toLowerCase()
  if (['.docx', '.doc', '.odt'].includes(e)) return 'word'
  if (['.xlsx', '.xls', '.xlsm', '.xlsb', '.ods'].includes(e)) return 'spreadsheet'
  if (['.pptx', '.ppt', '.odp'].includes(e)) return 'presentation'
  if (mime.includes('wordprocessing') || mime.includes('msword') || mime.includes('opendocument.text')) return 'word'
  if (mime.includes('spreadsheet') || mime.includes('ms-excel')) return 'spreadsheet'
  if (mime.includes('presentation') || mime.includes('ms-powerpoint')) return 'presentation'
  return null
}

async function extractWord(filePath: string, ext: string): Promise<string> {
  const e = ext.toLowerCase()
  if (e === '.docx') {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ path: filePath })
    return result.value
  }
  const officeparser = await import('officeparser')
  const ast = await officeparser.parseOffice(filePath)
  return ast.toText()
}

async function extractSpreadsheet(filePath: string): Promise<string> {
  const XLSX = await import('xlsx')
  const fs = await import('fs')
  if (typeof XLSX.set_fs === 'function') {
    XLSX.set_fs(fs)
  }
  let workbook: ReturnType<typeof XLSX.readFile>
  try {
    workbook = XLSX.readFile(filePath)
  } catch {
    const buf = await fsReadFile(filePath)
    workbook = XLSX.read(buf)
  }
  const sheets: string[] = []
  for (const name of workbook.SheetNames) {
    const ws = workbook.Sheets[name]
    const csv = XLSX.utils.sheet_to_csv(ws)
    sheets.push(`[Sheet: ${name}]\n${csv}`)
  }
  return sheets.join('\n\n')
}

async function extractPresentation(filePath: string): Promise<string> {
  const officeparser = await import('officeparser')
  const ast = await officeparser.parseOffice(filePath)
  return ast.toText()
}

async function extractPdf(filePath: string): Promise<string> {
  const officeparser = await import('officeparser')
  const ast = await officeparser.parseOffice(filePath, {
    extractAttachments: false,
    ocr: false,
    outputErrorToConsole: false,
  })
  const officeText = ast.toText()
  if (officeText.trim().length > 0) return officeText

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(await fsReadFile(filePath))
  const doc = await pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise
  const pages: string[] = []
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber)
      const textContent = await page.getTextContent()
      const text = textContent.items
        .map(item => ('str' in item ? item.str : ''))
        .filter(Boolean)
        .join(' ')
        .replace(/[ \t]+/g, ' ')
        .trim()
      if (text) pages.push(`[Page ${pageNumber}]\n${text}`)
      page.cleanup()
    }
  } finally {
    await doc.destroy()
  }
  return pages.join('\n\n')
}

// POST /api/files/upload — upload a file attachment
export async function POST(req: NextRequest) {
  const UPLOAD_DIR = ensureUploadsDir()
  const contentType = req.headers.get('content-type') || ''
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'multipart/form-data required' }, { status: 400 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }
  const file = formData.get('file') as File | null
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  if (file.size > MAX_FILE_SIZE) {
    logger.warn('files.upload.rejected_size', {
      name: file.name,
      size: file.size,
      maxSize: MAX_FILE_SIZE,
    })
    return NextResponse.json({ error: `文件超过 20MB，无法作为附件上传。请压缩文件，或拆分后再上传。` }, { status: 400 })
  }

  const ext = path.extname(file.name) || ''
  const id = crypto.randomUUID().slice(0, 8)
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
  const filename = `${id}_${safeName}`
  const filePath = path.join(UPLOAD_DIR, filename)

  const buffer = Buffer.from(await file.arrayBuffer())
  await writeFile(filePath, buffer)

  const extLower = ext.toLowerCase()
  const mimeType = extLower === '.mp4' ? 'video/mp4' : file.type || 'application/octet-stream'
  const isImage = mimeType.startsWith('image/') && !extLower.endsWith('.svg')
  const isPdf = mimeType === 'application/pdf' || extLower === '.pdf'
  const isText = mimeType.startsWith('text/') || TEXT_EXTENSIONS.has(extLower)

  // ── PDF text extraction ─────────────────────────────────────────────
  // Prefer text injection for model reliability. The original PDF is kept
  // for preview/download through originalFilename.
  if (isPdf) {
    try {
      const extractedText = await extractPdf(filePath)
      if (extractedText.trim().length > 0) {
        const extractedFilename = `${id}_extracted.txt`
        const extractedPath = path.join(UPLOAD_DIR, extractedFilename)
        await writeFile(extractedPath, extractedText, 'utf-8')
        const extractedSize = Buffer.byteLength(extractedText, 'utf-8')

        logger.info('files.upload.done', {
          name: file.name,
          filename: extractedFilename,
          originalFilename: filename,
          size: extractedSize,
          extractedChars: extractedText.length,
          originalSize: file.size,
          mimeType,
          tier: 'text',
          extracted: true,
          extractedFrom: 'pdf',
        })

        return NextResponse.json({
          id,
          filename: extractedFilename,
          originalFilename: filename,
          displayFilename: filename,
          originalName: file.name,
          size: extractedSize,
          originalSize: file.size,
          mimeType: 'text/plain',
          originalMimeType: 'application/pdf',
          displayMimeType: 'application/pdf',
          isImage: false,
          isPdf: true,
          isText: true,
          tier: 'text' as const,
          path: `/api/files/serve/${extractedFilename}`,
          originalPath: `/api/files/serve/${filename}`,
        })
      }

      logger.warn('files.upload.pdf_extract_empty', {
        name: file.name,
        filename,
        size: file.size,
        mimeType,
      })
      return NextResponse.json({
        id,
        filename,
        originalName: file.name,
        size: file.size,
        mimeType: 'application/pdf',
        isImage: false,
        isPdf: true,
        isText: false,
        tier: 'pdf' as const,
        readable: false,
        extractError: 'pdf_text_empty',
        message: '未能从该 PDF 中提取可读文字。它可能是扫描版/图片型 PDF；当前聊天附件暂不支持 OCR。',
        path: `/api/files/serve/${filename}`,
      })
    } catch (err) {
      logger.warn('files.upload.pdf_extract_failed', {
        name: file.name,
        filename,
        size: file.size,
        mimeType,
        error: err instanceof Error ? err.message : String(err),
      })
      return NextResponse.json({
        id,
        filename,
        originalName: file.name,
        size: file.size,
        mimeType: 'application/pdf',
        isImage: false,
        isPdf: true,
        isText: false,
        tier: 'pdf' as const,
        readable: false,
        extractError: 'pdf_extract_failed',
        message: 'PDF 文本解析失败。当前聊天附件无法读取该 PDF 内容，请改用可复制文字的 PDF 或先转成文本。',
        path: `/api/files/serve/${filename}`,
      })
    }
  }

  // ── Office file extraction ──────────────────────────────────────────
  const isOffice = OFFICE_MIME_TYPES.has(mimeType) || OFFICE_EXTENSIONS.has(extLower)
  if (isOffice) {
    const category = classifyOfficeFile(extLower, mimeType)
    if (category) {
      try {
        let extractedText = ''
        switch (category) {
          case 'word':
            extractedText = await extractWord(filePath, extLower)
            break
          case 'spreadsheet':
            extractedText = await extractSpreadsheet(filePath)
            break
          case 'presentation':
            extractedText = await extractPresentation(filePath)
            break
        }

        const extractedFilename = `${id}_extracted.txt`
        const extractedPath = path.join(UPLOAD_DIR, extractedFilename)
        await writeFile(extractedPath, extractedText, 'utf-8')

        logger.info('files.upload.done', {
          name: file.name,
          filename: extractedFilename,
          originalFilename: filename,
          size: file.size,
          extractedChars: extractedText.length,
          mimeType,
          tier: 'text',
          extracted: true,
        })

        return NextResponse.json({
          id,
          filename: extractedFilename,
          originalFilename: filename,
          originalName: file.name,
          size: file.size,
          mimeType: 'text/plain',
          isImage: false,
          isPdf: false,
          isText: true,
          tier: 'text' as const,
          path: `/api/files/serve/${extractedFilename}`,
          originalPath: `/api/files/serve/${filename}`,
        })
      } catch {
        logger.warn('files.upload.office_extract_failed', {
          name: file.name,
          size: file.size,
          mimeType,
          category,
        })
        // Extraction failed — fall through to binary response below
      }
    }
  }

  let tier: 'image' | 'pdf' | 'text' | 'binary' = 'binary'
  if (isImage) tier = 'image'
  else if (isPdf) tier = 'pdf'
  else if (isText) tier = 'text'

  logger.info('files.upload.done', {
    name: file.name,
    filename,
    size: file.size,
    mimeType,
    tier,
  })

  return NextResponse.json({
    id,
    filename,
    originalName: file.name,
    size: file.size,
    mimeType,
    isImage,
    isPdf,
    isText,
    tier,
    path: `/api/files/serve/${filename}`,
  })
}
