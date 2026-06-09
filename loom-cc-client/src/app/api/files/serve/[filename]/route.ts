/**
 * GET /api/files/serve/[filename]
 * Serves raw uploaded file bytes with the correct Content-Type.
 * Used by FilePreviewPanel for images, videos, PDFs, and text files.
 */

import { NextRequest, NextResponse } from 'next/server'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import path from 'path'
import { getUploadsDir } from '@/shared/db/paths'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  csv: 'text/plain; charset=utf-8',
  json: 'application/json',
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  xml: 'text/xml; charset=utf-8',
  css: 'text/css; charset=utf-8',
  scss: 'text/plain; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  cjs: 'text/javascript; charset=utf-8',
  ts: 'text/plain; charset=utf-8',
  tsx: 'text/plain; charset=utf-8',
  jsx: 'text/plain; charset=utf-8',
  py: 'text/plain; charset=utf-8',
  rs: 'text/plain; charset=utf-8',
  go: 'text/plain; charset=utf-8',
  sh: 'text/plain; charset=utf-8',
  bash: 'text/plain; charset=utf-8',
  zsh: 'text/plain; charset=utf-8',
  yaml: 'text/plain; charset=utf-8',
  yml: 'text/plain; charset=utf-8',
  toml: 'text/plain; charset=utf-8',
  sql: 'text/plain; charset=utf-8',
  env: 'text/plain; charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

function getContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return MIME_MAP[ext] || 'application/octet-stream'
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params

  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return new NextResponse('Invalid filename', { status: 400 })
  }

  const filePath = path.join(getUploadsDir(), filename)

  if (!existsSync(filePath)) {
    return new NextResponse('File not found', { status: 404 })
  }

  const buf = await readFile(filePath)
  const contentType = getContentType(filename)

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buf.length),
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
