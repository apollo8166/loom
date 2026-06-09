import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const channelId = req.nextUrl.searchParams.get('channelId') || 'feishu'
  const projectId = req.nextUrl.searchParams.get('projectId')?.trim()
  const projectClause = projectId ? 'AND b.project_id = ?' : ''
  const args = projectId ? [channelId, projectId] : [channelId]
  const bindings = getDb().prepare(
    `SELECT b.*, p.name AS project_name, s.title AS session_title
     FROM im_channel_bindings b
     LEFT JOIN projects p ON p.id = b.project_id
     LEFT JOIN sessions s ON s.id = b.session_id
     WHERE b.channel_id = ?
       ${projectClause}
     ORDER BY b.updated_at DESC`,
  ).all(...args) as Array<Record<string, unknown>>

  return NextResponse.json({
    bindings: bindings.map(binding => ({
      id: binding.id,
      channelId: binding.channel_id,
      chatId: binding.chat_id,
      chatName: binding.chat_name,
      projectId: binding.project_id,
      projectName: binding.project_name,
      sessionId: binding.session_id,
      sessionTitle: binding.session_title,
      createdAt: binding.created_at,
      updatedAt: binding.updated_at,
    })),
  })
}
