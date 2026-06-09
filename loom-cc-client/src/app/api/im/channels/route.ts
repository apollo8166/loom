import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'
import { parseJsonObject, parseJsonStringArray } from '@/shared/im/json'
import { getImBridgeManager } from '@/shared/im/bridge-manager'
import type { ImChannelRow } from '@/shared/im/types'
import { ensureProjectFeishuChannel } from '@/shared/im/channel-id'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const db = getDb()
  const projectId = req.nextUrl.searchParams.get('projectId')?.trim()
  if (projectId) ensureProjectFeishuChannel(projectId)
  const rows = projectId
    ? db.prepare('SELECT * FROM im_channels WHERE project_id = ? ORDER BY created_at ASC').all(projectId) as ImChannelRow[]
    : db.prepare("SELECT * FROM im_channels WHERE project_id != '' ORDER BY created_at ASC").all() as ImChannelRow[]
  const manager = getImBridgeManager()
  return NextResponse.json({
    channels: rows.map(row => mapChannel(row, manager.getState(row.id))),
  })
}

function mapChannel(row: ImChannelRow, state?: { status?: string; connected?: boolean; error?: string }) {
  return {
    id: row.id,
    type: row.type,
    projectId: row.project_id,
    enabled: row.enabled === 1,
    status: state?.status || row.status,
    connected: state?.connected || false,
    credentials: parseJsonObject(row.credentials),
    dmPolicy: row.dm_policy,
    groupPolicy: row.group_policy,
    triggerMode: row.trigger_mode,
    senderWhitelist: parseJsonStringArray(row.sender_whitelist),
    groupWhitelist: parseJsonStringArray(row.group_whitelist),
    defaultModel: row.default_model,
    permissionMode: row.permission_mode,
    lastConnectedAt: row.last_connected_at,
    lastError: state?.error || row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
