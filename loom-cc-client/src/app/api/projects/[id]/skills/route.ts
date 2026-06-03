import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ProjectSkillJoinRow {
  skill_id: string
  name: string
  slug: string
  description: string
  source_type: string
  storage_path: string
  is_pinned: number
  enabled: number
  sort_order: number
  created_at: string
}

function mapRow(row: ProjectSkillJoinRow) {
  return {
    skillId: row.skill_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    sourceType: row.source_type,
    storagePath: row.storage_path || null,
    isPinned: row.is_pinned === 1,
    enabled: row.enabled === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  }
}

/** GET /api/projects/:id/skills — list skills attached to a project */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()

  const rows = db.prepare(`
    SELECT
      s.id AS skill_id, s.name, s.slug, s.description,
      s.source_type, s.storage_path, s.is_pinned,
      ps.enabled, ps.sort_order, s.created_at
    FROM project_skills ps
    JOIN skills s ON s.id = ps.skill_id
    WHERE ps.project_id = ?
    ORDER BY ps.sort_order ASC, s.name ASC
  `).all(id) as ProjectSkillJoinRow[]

  return NextResponse.json({ skills: rows.map(mapRow) })
}

/** POST /api/projects/:id/skills — attach a skill to a project */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  let body: { skillId: string; enabled?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.skillId) {
    return NextResponse.json({ error: 'skillId is required' }, { status: 400 })
  }

  const db = getDb()

  // Verify project exists
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(id)
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // Verify skill exists
  const skill = db.prepare('SELECT id FROM skills WHERE id = ?').get(body.skillId)
  if (!skill) {
    return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
  }

  const enabled = body.enabled !== false ? 1 : 0

  // Get max sort_order for this project
  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM project_skills WHERE project_id = ?',
  ).get(id) as { max_order: number }

  db.prepare(`
    INSERT OR REPLACE INTO project_skills (project_id, skill_id, enabled, sort_order)
    VALUES (?, ?, ?, ?)
  `).run(id, body.skillId, enabled, maxOrder.max_order + 1)

  return NextResponse.json({ ok: true })
}

/** DELETE /api/projects/:id/skills?skillId=xxx — detach a skill from a project */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const skillId = req.nextUrl.searchParams.get('skillId')

  if (!skillId) {
    return NextResponse.json({ error: 'skillId query param is required' }, { status: 400 })
  }

  const db = getDb()
  db.prepare(
    'DELETE FROM project_skills WHERE project_id = ? AND skill_id = ?',
  ).run(id, skillId)

  return NextResponse.json({ ok: true })
}
