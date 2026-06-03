import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const execFileAsync = promisify(execFile)
const workspaceInfoCache = new Map<string, {
  expiresAt: number
  value: { isGitRepo: boolean; branch: string | null; root?: string }
}>()

export async function GET(req: NextRequest) {
  const workspacePath = req.nextUrl.searchParams.get('path')?.trim()
  if (!workspacePath) {
    return NextResponse.json({ isGitRepo: false, branch: null })
  }

  try {
    const stat = fs.statSync(workspacePath)
    if (!stat.isDirectory()) {
      return NextResponse.json({ isGitRepo: false, branch: null })
    }
  } catch {
    return NextResponse.json({ isGitRepo: false, branch: null })
  }

  const cacheKey = path.resolve(workspacePath)
  const cached = workspaceInfoCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.value, { headers: { 'Cache-Control': 'private, max-age=15' } })
  }

  try {
    const [{ stdout: rootStdout }, branchResult] = await Promise.all([
      execFileAsync('git', ['-C', workspacePath, 'rev-parse', '--show-toplevel'], { timeout: 2500 }),
      execFileAsync('git', ['-C', workspacePath, 'branch', '--show-current'], { timeout: 2500 }).catch(() => ({ stdout: '' })),
    ])
    const root = rootStdout.trim()
    const value = {
      isGitRepo: Boolean(root),
      branch: branchResult.stdout.trim() || null,
      root: root || path.resolve(workspacePath),
    }
    workspaceInfoCache.set(cacheKey, { expiresAt: Date.now() + 15_000, value })
    return NextResponse.json(value, { headers: { 'Cache-Control': 'private, max-age=15' } })
  } catch {
    return NextResponse.json({ isGitRepo: false, branch: null })
  }
}
