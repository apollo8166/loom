import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()

  const project = db.prepare('SELECT id FROM projects WHERE id = ? AND status = ?').get(id, 'active')
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // Total counts
  const totals = db.prepare(`
    SELECT
      COUNT(DISTINCT s.id) AS session_count,
      COUNT(m.id) AS message_count,
      COALESCE(SUM(m.input_tokens), 0) AS total_input,
      COALESCE(SUM(m.output_tokens), 0) AS total_output
    FROM sessions s
    LEFT JOIN messages m ON m.session_id = s.id
    WHERE s.project_id = ? AND s.status != 'deleted'
  `).get(id) as {
    session_count: number
    message_count: number
    total_input: number
    total_output: number
  }

  // Per-model breakdown
  const byModel = db.prepare(`
    SELECT
      s.model,
      COALESCE(SUM(m.input_tokens), 0) AS input_tokens,
      COALESCE(SUM(m.output_tokens), 0) AS output_tokens
    FROM sessions s
    LEFT JOIN messages m ON m.session_id = s.id
    WHERE s.project_id = ? AND s.status != 'deleted'
    GROUP BY s.model
    ORDER BY (COALESCE(SUM(m.input_tokens), 0) + COALESCE(SUM(m.output_tokens), 0)) DESC
  `).all(id) as { model: string; input_tokens: number; output_tokens: number }[]

  return NextResponse.json({
    sessionCount: totals.session_count,
    messageCount: totals.message_count,
    totalInput: totals.total_input,
    totalOutput: totals.total_output,
    byModel: byModel.map(r => ({
      model: r.model,
      input: r.input_tokens,
      output: r.output_tokens,
    })),
  })
}
