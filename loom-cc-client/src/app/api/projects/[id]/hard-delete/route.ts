import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** DELETE /api/projects/:id/hard-delete — permanently delete a project */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()

  const existing = db.prepare('SELECT id, status FROM projects WHERE id = ?').get(id) as
    | { id: string; status: string }
    | undefined

  if (!existing) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // Cascade delete (sessions, messages, etc.) handled by FK ON DELETE CASCADE
  db.prepare('DELETE FROM projects WHERE id = ?').run(id)

  return NextResponse.json({ success: true })
}
