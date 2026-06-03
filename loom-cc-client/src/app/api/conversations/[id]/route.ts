import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/conversations/:id — get a project as a conversation (compat shell) */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as {
    id: string; name: string; default_model: string; is_pinned: number;
    created_at: string; updated_at: string; last_opened_at: string | null
  } | undefined

  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({
    conversation: {
      id: project.id,
      title: project.name,
      model: project.default_model,
      isPinned: !!project.is_pinned,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
      lastOpenedAt: project.last_opened_at,
    },
  })
}

/** PATCH /api/conversations/:id — update a project (compat shell) */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const db = getDb()
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const fieldMap: Record<string, string> = {
    title: 'name',
    model: 'default_model',
    isPinned: 'is_pinned',
  }

  const updates: string[] = []
  const values: unknown[] = []

  for (const [clientField, dbField] of Object.entries(fieldMap)) {
    if (clientField in body) {
      updates.push(`${dbField} = ?`)
      values.push(clientField === 'isPinned' ? (body[clientField] ? 1 : 0) : body[clientField])
    }
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  updates.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`)
  values.push(id)

  db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...values)

  return NextResponse.json({ ok: true })
}

/** DELETE /api/conversations/:id — soft delete a project (compat shell) */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  db.prepare(
    `UPDATE projects SET status = 'deleted', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
  ).run(id)

  return NextResponse.json({ ok: true })
}
