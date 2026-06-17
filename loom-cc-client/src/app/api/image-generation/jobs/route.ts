import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { getDb } from '@/shared/db/db'
import { getUploadsDir } from '@/shared/db/paths'
import { getAspectRatioSize, getImageGenerationConfig, normalizeArkImageSize } from '@/shared/config/image-generation-config'
import { getSessionImageJobs, markStaleJobsAsError, type StoredReferenceImage } from '@/shared/image-generation/job-store'
import { createAndExecuteImageJob, type ImageGenHistoryItem } from '@/shared/image-generation/job-executor'
import type { ResolvedImageReference } from '@/shared/image-generation/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RawReferenceImage = {
  name?: string
  url?: string
  filename?: string
  serverFilename?: string
  mimeType?: string
}

function safeDecode(value: string): string {
  try { return decodeURIComponent(value) } catch { return value }
}

function filenameFromReference(ref: RawReferenceImage): string {
  if (ref.serverFilename) return ref.serverFilename
  if (ref.filename) return ref.filename
  const match = ref.url?.match(/\/api\/files\/(?:serve|upload)\/([^/?#]+)/)
  if (match?.[1]) return safeDecode(match[1])
  return ''
}

function mimeTypeForFilename(filename: string, fallback?: string): string {
  if (fallback?.startsWith('image/')) return fallback
  const lower = filename.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'image/png'
}

function resolveReferenceImage(ref: RawReferenceImage): ResolvedImageReference | null {
  const filename = path.basename(filenameFromReference(ref))
  if (!filename) return null
  return {
    name: ref.name || filename,
    path: path.join(getUploadsDir(), filename),
    mimeType: mimeTypeForFilename(filename, ref.mimeType),
  }
}

function normalizeReferenceForStorage(ref: RawReferenceImage): StoredReferenceImage | null {
  const filename = path.basename(filenameFromReference(ref))
  if (!filename) return null
  return {
    name: ref.name || filename,
    url: ref.url || `/api/files/serve/${encodeURIComponent(filename)}`,
    serverFilename: filename,
    mimeType: mimeTypeForFilename(filename, ref.mimeType),
  }
}

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId') ?? ''
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
  }

  const db = getDb()
  const sessionExists = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId) as { id: string } | undefined
  if (!sessionExists) {
    return NextResponse.json({ error: 'session not found' }, { status: 404 })
  }

  markStaleJobsAsError(db)
  return NextResponse.json({ jobs: getSessionImageJobs(db, sessionId, 100) })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      sessionId?: string
      prompt?: string
      history?: ImageGenHistoryItem[]
      providerId?: string
      aspectRatio?: string
      styleId?: string
      count?: number
      referenceImages?: RawReferenceImage[]
    }

    const { sessionId, prompt, history = [], providerId, aspectRatio = '1:1', styleId = 'none', count = 1, referenceImages = [] } = body

    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
    }

    const db = getDb()
    const sessionExists = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId) as { id: string } | undefined
    if (!sessionExists) {
      return NextResponse.json({ error: 'session not found' }, { status: 404 })
    }

    const imageConfig = getImageGenerationConfig(db)

    if (!imageConfig.enabled) {
      return NextResponse.json({ error: '请先到设置中完成图像生成配置' }, { status: 400 })
    }

    const effectiveProviderId = providerId && imageConfig.configs.some(c => c.id === providerId)
      ? providerId
      : imageConfig.activeProviderId

    const providerConfig = imageConfig.configs.find(c => c.id === effectiveProviderId)
    if (!providerConfig) {
      return NextResponse.json({ error: `未找到服务商配置：${effectiveProviderId}` }, { status: 400 })
    }
    if (!providerConfig.apiKey?.trim()) {
      return NextResponse.json({ error: `服务商 ${providerConfig.name} 未配置 API Key` }, { status: 400 })
    }

    // Clean up any stale pending jobs for this session
    markStaleJobsAsError(db)

    const baseSize = getAspectRatioSize(aspectRatio)
    const size = providerConfig.apiFormat === 'ark-images' ? normalizeArkImageSize(baseSize) : baseSize
    const storedReferences = referenceImages
      .map(normalizeReferenceForStorage)
      .filter((ref): ref is StoredReferenceImage => Boolean(ref))
    const resolvedReferences = storedReferences
      .map(resolveReferenceImage)
      .filter((ref): ref is ResolvedImageReference => Boolean(ref))

    const jobId = createAndExecuteImageJob(
      {
        sessionId,
        prompt: prompt.trim(),
        providerId: effectiveProviderId,
        model: providerConfig.model,
        aspectRatio,
        styleId,
        size,
        count: Math.max(1, Math.min(4, count)),
        referenceImages: storedReferences,
      },
      {
        history,
        referenceImages: resolvedReferences,
      },
    )

    return NextResponse.json({ jobId })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
