import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'
import { parseJsonObject } from '@/shared/im/json'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const channelId = req.nextUrl.searchParams.get('channelId') || 'feishu'
  const projectId = req.nextUrl.searchParams.get('projectId')?.trim()
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') || 100), 500)
  const projectClause = projectId ? 'AND project_id = ?' : ''
  const args = projectId ? [channelId, projectId, limit] : [channelId, limit]
  const logs = getDb().prepare(
    `SELECT * FROM im_audit_logs
     WHERE channel_id = ?
       ${projectClause}
     ORDER BY created_at DESC
     LIMIT ?`,
  ).all(...args) as Array<Record<string, string>>

  return NextResponse.json({
    logs: logs.map(log => ({
      id: log.id,
      channelId: log.channel_id,
      chatId: log.chat_id,
      projectId: log.project_id,
      sessionId: log.session_id,
      action: log.action,
      status: log.status,
      details: parseJsonObject(log.details),
      createdAt: log.created_at,
    })),
  })
}
