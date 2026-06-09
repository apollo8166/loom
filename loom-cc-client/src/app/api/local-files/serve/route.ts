import { NextRequest, NextResponse } from 'next/server'
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  csv: 'text/plain; charset=utf-8',
  json: 'application/json',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  cjs: 'text/javascript; charset=utf-8',
  ts: 'text/plain; charset=utf-8',
  tsx: 'text/plain; charset=utf-8',
  jsx: 'text/plain; charset=utf-8',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  return MIME_MAP[ext] || 'application/octet-stream'
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function resolveLocalFile(req: NextRequest): { filePath?: string; stat?: ReturnType<typeof statSync>; response?: NextResponse } {
  const rawPath = req.nextUrl.searchParams.get('path') || ''
  if (!rawPath) return { response: new NextResponse('path required', { status: 400 }) }

  let filePath = rawPath
  try {
    if (rawPath.startsWith('file://')) filePath = new URL(rawPath).pathname
  } catch {
    return { response: new NextResponse('Invalid path', { status: 400 }) }
  }
  filePath = safeDecodeURIComponent(filePath)

  if (!path.isAbsolute(filePath)) return { response: new NextResponse('Absolute path required', { status: 400 }) }
  if (!existsSync(filePath)) return { response: new NextResponse('File not found', { status: 404 }) }

  const stat = statSync(filePath)
  if (!stat.isFile()) return { response: new NextResponse('Not a file', { status: 400 }) }
  if (stat.size > 100 * 1024 * 1024) return { response: new NextResponse('File too large', { status: 413 }) }

  return { filePath, stat }
}

function localFileHeaders(filePath: string, size: number): HeadersInit {
  return {
    'Content-Type': getContentType(filePath),
    'Content-Length': String(size),
    'Cache-Control': 'private, max-age=3600',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(filePath))}`,
  }
}

export async function HEAD(req: NextRequest) {
  const resolved = resolveLocalFile(req)
  if (resolved.response) return resolved.response
  if (!resolved.filePath || !resolved.stat) return new NextResponse('File not found', { status: 404 })

  return new NextResponse(null, {
    status: 200,
    headers: localFileHeaders(resolved.filePath, Number(resolved.stat.size)),
  })
}

export async function GET(req: NextRequest) {
  const resolved = resolveLocalFile(req)
  if (resolved.response) return resolved.response
  if (!resolved.filePath || !resolved.stat) return new NextResponse('File not found', { status: 404 })

  const filePath = resolved.filePath
  const buf = await readFile(filePath)
  return new NextResponse(buf, {
    status: 200,
    headers: localFileHeaders(filePath, buf.length),
  })
}
