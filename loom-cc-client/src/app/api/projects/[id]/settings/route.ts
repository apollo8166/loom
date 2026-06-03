import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* ── GET /api/projects/[id]/settings ── */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()

  const project = db.prepare('SELECT id FROM projects WHERE id = ? AND status = ?').get(id, 'active')
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const row = db.prepare(
    `SELECT value FROM project_settings WHERE project_id = ? AND key = 'provider_id'`
  ).get(id) as { value: string } | undefined

  return NextResponse.json({ settings: { providerId: row?.value ?? null } })
}

/* ── PATCH /api/projects/[id]/settings ── */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()

  const project = db.prepare('SELECT id FROM projects WHERE id = ? AND status = ?').get(id, 'active')
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const body = await req.json() as { providerId: string | null }
  const { providerId } = body

  if (providerId === null || providerId === undefined) {
    // Clear project-level provider override → fall back to global default
    db.prepare(
      `DELETE FROM project_settings WHERE project_id = ? AND key = 'provider_id'`
    ).run(id)
  } else {
    // UPSERT
    db.prepare(`
      INSERT INTO project_settings (project_id, key, value, updated_at)
      VALUES (?, 'provider_id', ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      ON CONFLICT(project_id, key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run(id, providerId)
  }

  return NextResponse.json({ settings: { providerId: providerId ?? null } })
}
