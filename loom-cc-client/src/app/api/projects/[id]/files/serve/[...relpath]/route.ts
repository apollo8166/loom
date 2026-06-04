/**
 * GET /api/projects/[id]/files/serve/[...relpath]
 * Serves a workspace file as raw bytes with the correct Content-Type.
 */

import { NextRequest, NextResponse } from 'next/server'
import { existsSync, statSync } from 'fs'
import { readFile } from 'fs/promises'
import path from 'path'
import { getDb } from '@/shared/db/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  mdx: 'text/plain; charset=utf-8',
  csv: 'text/plain; charset=utf-8',
  json: 'application/json',
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  xml: 'text/xml; charset=utf-8',
  css: 'text/css; charset=utf-8',
  scss: 'text/plain; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  ts: 'text/plain; charset=utf-8',
  tsx: 'text/plain; charset=utf-8',
  jsx: 'text/plain; charset=utf-8',
  py: 'text/plain; charset=utf-8',
  rs: 'text/plain; charset=utf-8',
  go: 'text/plain; charset=utf-8',
  java: 'text/plain; charset=utf-8',
  cpp: 'text/plain; charset=utf-8',
  c: 'text/plain; charset=utf-8',
  h: 'text/plain; charset=utf-8',
  sh: 'text/plain; charset=utf-8',
  bash: 'text/plain; charset=utf-8',
  yaml: 'text/plain; charset=utf-8',
  yml: 'text/plain; charset=utf-8',
  toml: 'text/plain; charset=utf-8',
  sql: 'text/plain; charset=utf-8',
  env: 'text/plain; charset=utf-8',
  gitignore: 'text/plain; charset=utf-8',
  dockerignore: 'text/plain; charset=utf-8',
  dockerfile: 'text/plain; charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  odt: 'application/vnd.oasis.opendocument.text',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  xlsm: 'application/vnd.ms-excel.sheet.macroenabled.12',
  xlsb: 'application/vnd.ms-excel.sheet.binary.macroenabled.12',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
}

function getContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return MIME_MAP[ext] || 'application/octet-stream'
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; relpath: string[] }> },
) {
  const { id: projectId, relpath } = await params

  // Security: reject path traversal in any segment
  if (relpath.some(seg => seg.includes('..'))) {
    return new NextResponse('Invalid path', { status: 400 })
  }

  const db = getDb()
  const project = db
    .prepare('SELECT workspace_path FROM projects WHERE id = ? AND status != ?')
    .get(projectId, 'deleted') as { workspace_path: string } | undefined

  if (!project) return new NextResponse('Project not found', { status: 404 })

  const relFilePath = relpath.join('/')
  const fullPath = path.join(project.workspace_path, relFilePath)

  // Security: ensure resolved path stays within workspace
  const workspaceReal = path.resolve(project.workspace_path)
  const fileReal = path.resolve(fullPath)
  if (!fileReal.startsWith(workspaceReal + path.sep)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  if (!existsSync(fullPath)) {
    return new NextResponse('File not found', { status: 404 })
  }

  const stat = statSync(fullPath)
  if (stat.isDirectory()) {
    return new NextResponse('Is a directory', { status: 400 })
  }

  const buf = await readFile(fullPath)
  const contentType = getContentType(fullPath)

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buf.length),
      'Cache-Control': 'no-cache',
    },
  })
}
