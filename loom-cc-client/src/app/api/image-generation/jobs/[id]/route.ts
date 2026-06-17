import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { getDb } from '@/shared/db/db'
import { getUploadsDir } from '@/shared/db/paths'
import { getImageGenerationConfig } from '@/shared/config/image-generation-config'
import { getImageJob, type StoredReferenceImage } from '@/shared/image-generation/job-store'
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

/** GET /api/image-generation/jobs/:id — poll job status */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()
  const job = getImageJob(db, id)
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }
  return NextResponse.json(job)
}

/** POST /api/image-generation/jobs/:id — create a new job from a completed job */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()
  const job = getImageJob(db, id)
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }
  if (['pending', 'merging', 'submitting', 'waiting'].includes(job.status)) {
    return NextResponse.json({ error: 'Job is still running' }, { status: 400 })
  }

  const body = await req.json() as {
    history?: ImageGenHistoryItem[]
    referenceImages?: RawReferenceImage[]
  }

  const imageConfig = getImageGenerationConfig(db)
  const provider = imageConfig.configs.find(c => c.id === job.providerId)
  if (!provider?.apiKey?.trim()) {
    return NextResponse.json({ error: '服务商配置已失效，请重新设置' }, { status: 400 })
  }

  const retryReferences = body.referenceImages
    ? body.referenceImages.map(normalizeReferenceForStorage).filter((ref): ref is StoredReferenceImage => Boolean(ref))
    : job.referenceImages
  const newJobId = createAndExecuteImageJob(
    {
      sessionId: job.sessionId,
      prompt: job.prompt,
      providerId: job.providerId,
      model: provider.model,
      aspectRatio: job.aspectRatio,
      styleId: job.styleId,
      size: job.size,
      count: job.count,
      referenceImages: retryReferences,
      origin: job.origin,
    },
    {
      history: body.history ?? [],
      referenceImages: retryReferences
        .map(resolveReferenceImage)
        .filter((ref): ref is ResolvedImageReference => Boolean(ref)),
    },
  )

  return NextResponse.json({ ok: true, jobId: newJobId })
}
