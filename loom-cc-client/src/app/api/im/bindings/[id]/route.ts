import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let body: { projectId?: string; sessionId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const db = getDb()
  const binding = db.prepare('SELECT * FROM im_channel_bindings WHERE id = ?').get(id)
  if (!binding) return NextResponse.json({ error: 'Binding not found' }, { status: 404 })

  const updates: string[] = []
  const values: unknown[] = []
  if (body.projectId) {
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(body.projectId)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    updates.push('project_id = ?')
    values.push(body.projectId)
  }
  if (body.sessionId) {
    const session = db.prepare('SELECT id, project_id FROM sessions WHERE id = ?').get(body.sessionId) as { id: string; project_id: string } | undefined
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    updates.push('session_id = ?')
    values.push(body.sessionId)
    if (!body.projectId) {
      updates.push('project_id = ?')
      values.push(session.project_id)
    }
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }
  updates.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`)
  values.push(id)
  db.prepare(`UPDATE im_channel_bindings SET ${updates.join(', ')} WHERE id = ?`).run(...values)

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  getDb().prepare('DELETE FROM im_channel_bindings WHERE id = ?').run(id)
  return NextResponse.json({ ok: true })
}
