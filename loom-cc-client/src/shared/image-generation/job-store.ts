import crypto from 'crypto'
import type Database from 'better-sqlite3'

export type ImageJobStatus = 'pending' | 'merging' | 'submitting' | 'waiting' | 'success' | 'error'

export interface StoredReferenceImage {
  name: string
  url: string
  serverFilename: string
  mimeType: string
}

export interface ImageGenerationJob {
  id: string
  sessionId: string
  status: ImageJobStatus
  providerId: string
  model: string
  prompt: string
  finalPrompt: string
  aspectRatio: string
  styleId: string
  size: string
  count: number
  referenceImages: StoredReferenceImage[]
  resultUrls: string[]
  resultMetadata: Record<string, unknown>
  errorMessage: string
  startedAt: string
  completedAt: string | null
}

export interface CreateImageJobParams {
  sessionId: string
  prompt: string
  providerId: string
  model: string
  aspectRatio: string
  styleId: string
  size: string
  count?: number
  referenceImages?: StoredReferenceImage[]
}

interface RawJobRow {
  id: string
  session_id: string
  status: string
  provider_id: string
  model: string
  prompt: string
  final_prompt: string
  aspect_ratio: string
  style_id: string
  size: string
  count: number
  reference_images: string
  result_urls: string
  result_metadata: string
  error_message: string
  started_at: string
  completed_at: string | null
}

function rowToJob(row: RawJobRow): ImageGenerationJob {
  let referenceImages: StoredReferenceImage[] = []
  let resultUrls: string[] = []
  let resultMetadata: Record<string, unknown> = {}
  try { referenceImages = JSON.parse(row.reference_images) } catch { /* ignore */ }
  try { resultUrls = JSON.parse(row.result_urls) } catch { /* ignore */ }
  try { resultMetadata = JSON.parse(row.result_metadata) } catch { /* ignore */ }
  return {
    id: row.id,
    sessionId: row.session_id,
    status: row.status as ImageJobStatus,
    providerId: row.provider_id,
    model: row.model,
    prompt: row.prompt,
    finalPrompt: row.final_prompt,
    aspectRatio: row.aspect_ratio,
    styleId: row.style_id,
    size: row.size,
    count: row.count,
    referenceImages,
    resultUrls,
    resultMetadata,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? null,
  }
}

export function createImageJob(db: Database.Database, params: CreateImageJobParams): string {
  const id = crypto.randomUUID()
  db.prepare(`
    INSERT INTO image_generation_jobs
      (id, session_id, status, provider_id, model, prompt, aspect_ratio, style_id, size, count, reference_images)
    VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.sessionId,
    params.providerId,
    params.model,
    params.prompt,
    params.aspectRatio,
    params.styleId,
    params.size,
    params.count ?? 1,
    JSON.stringify(params.referenceImages ?? []),
  )
  return id
}

export function getImageJob(db: Database.Database, id: string): ImageGenerationJob | null {
  const row = db.prepare('SELECT * FROM image_generation_jobs WHERE id = ?').get(id) as RawJobRow | undefined
  return row ? rowToJob(row) : null
}

export function getSessionImageJobs(db: Database.Database, sessionId: string, limit = 5): ImageGenerationJob[] {
  const rows = db.prepare(`
    SELECT * FROM image_generation_jobs
    WHERE session_id = ?
    ORDER BY started_at ASC
    LIMIT ?
  `).all(sessionId, limit) as RawJobRow[]
  return rows.map(rowToJob)
}

export function updateImageJobStatus(
  db: Database.Database,
  id: string,
  status: ImageJobStatus,
  extra?: {
    finalPrompt?: string
    resultUrls?: string[]
    resultMetadata?: Record<string, unknown>
    errorMessage?: string
  },
): void {
  const completed = status === 'success' || status === 'error'
  db.prepare(`
    UPDATE image_generation_jobs
    SET status = ?,
        final_prompt = COALESCE(?, final_prompt),
        result_urls = COALESCE(?, result_urls),
        result_metadata = COALESCE(?, result_metadata),
        error_message = COALESCE(?, error_message),
        completed_at = CASE WHEN ? THEN strftime('%Y-%m-%dT%H:%M:%SZ', 'now') ELSE completed_at END
    WHERE id = ?
  `).run(
    status,
    extra?.finalPrompt ?? null,
    extra?.resultUrls ? JSON.stringify(extra.resultUrls) : null,
    extra?.resultMetadata ? JSON.stringify(extra.resultMetadata) : null,
    extra?.errorMessage ?? null,
    completed ? 1 : 0,
    id,
  )
}

export function markStaleJobsAsError(db: Database.Database, staleMinutes = 10): void {
  db.prepare(`
    UPDATE image_generation_jobs
    SET status = 'error',
        error_message = '任务超时，请重试',
        completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE status IN ('pending', 'merging', 'submitting', 'waiting')
      AND started_at < datetime('now', ?)
  `).run(`-${staleMinutes} minutes`)
}
