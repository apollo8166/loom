import { NextRequest, NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { getDb } from '@/shared/db/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SkillRow {
  id: string
  name: string
  slug: string
  description: string
  source_type: string
  storage_path: string
  is_pinned: number
  created_at: string
  updated_at: string
}

/** PATCH /api/skills/:id — update is_pinned or other fields */
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
  const existing = db.prepare(
    'SELECT * FROM skills WHERE id = ?',
  ).get(id) as SkillRow | undefined

  if (existing) {
    // Update existing DB record
    const updates: string[] = []
    const values: unknown[] = []

    if ('isPinned' in body) {
      updates.push('is_pinned = ?')
      values.push(body.isPinned ? 1 : 0)
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    updates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')")
    values.push(id)

    db.prepare(`UPDATE skills SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as SkillRow
    return NextResponse.json({ skill: mapSkillRow(row) })
  }

  // Upsert: file-scanned skill being pinned for first time
  // The id format for file-scanned skills is "sourceType:slug"
  const parts = id.split(':')
  if (parts.length < 2) {
    return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
  }

  const sourceType = parts[0]
  const slug = parts.slice(1).join(':')

  const newId = nanoid()
  const isPinned = body.isPinned ? 1 : 0
  const name = (body.name as string) || slug
  const description = (body.description as string) || ''
  const storagePath = (body.storagePath as string) || ''

  db.prepare(`
    INSERT INTO skills (id, name, slug, description, source_type, storage_path, is_pinned)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(newId, name, slug, description, sourceType, storagePath, isPinned)

  const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(newId) as SkillRow
  return NextResponse.json({ skill: mapSkillRow(row) })
}

function mapSkillRow(row: SkillRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    sourceType: row.source_type,
    storagePath: row.storage_path || null,
    isPinned: row.is_pinned === 1,
    createdAt: row.created_at,
  }
}
