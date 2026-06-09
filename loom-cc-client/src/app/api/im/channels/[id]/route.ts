import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'
import { parseJsonObject, parseJsonStringArray } from '@/shared/im/json'
import { getImBridgeManager } from '@/shared/im/bridge-manager'
import type { ImChannelRow } from '@/shared/im/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const row = getDb().prepare('SELECT * FROM im_channels WHERE id = ?').get(id) as ImChannelRow | undefined
  if (!row) return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
  return NextResponse.json({ channel: mapChannel(row, getImBridgeManager().getState(id)) })
}

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
  const existing = db.prepare('SELECT * FROM im_channels WHERE id = ?').get(id) as ImChannelRow | undefined
  if (!existing) return NextResponse.json({ error: 'Channel not found' }, { status: 404 })

  const credentials = typeof body.credentials === 'object' && body.credentials !== null
    ? { ...parseJsonObject(existing.credentials), ...body.credentials as Record<string, unknown> }
    : parseJsonObject(existing.credentials)

  const enabled = typeof body.enabled === 'boolean' ? (body.enabled ? 1 : 0) : existing.enabled
  const dmPolicy = coerce(body.dmPolicy, existing.dm_policy, ['open', 'allowlist', 'disabled'])
  const groupPolicy = coerce(body.groupPolicy, existing.group_policy, ['mention', 'open', 'allowlist', 'disabled'])
  const triggerMode = coerce(body.triggerMode, existing.trigger_mode, ['mention', 'all'])
  const permissionMode = coerce(body.permissionMode, existing.permission_mode, ['confirm', 'read-only', 'full'])
  const senderWhitelist = JSON.stringify(coerceStringArray(body.senderWhitelist, parseJsonStringArray(existing.sender_whitelist)))
  const groupWhitelist = JSON.stringify(coerceStringArray(body.groupWhitelist, parseJsonStringArray(existing.group_whitelist)))
  const defaultModel = typeof body.defaultModel === 'string' ? body.defaultModel.trim() : existing.default_model

  db.prepare(
    `UPDATE im_channels
     SET enabled = ?, credentials = ?, dm_policy = ?, group_policy = ?, trigger_mode = ?,
         sender_whitelist = ?, group_whitelist = ?, default_model = ?,
         permission_mode = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
     WHERE id = ?`,
  ).run(
    enabled,
    JSON.stringify(credentials),
    dmPolicy,
    groupPolicy,
    triggerMode,
    senderWhitelist,
    groupWhitelist,
    defaultModel,
    permissionMode,
    id,
  )

  if (!enabled && getImBridgeManager().isConnected(id)) {
    await getImBridgeManager().stopAdapter(id)
  }

  const row = db.prepare('SELECT * FROM im_channels WHERE id = ?').get(id) as ImChannelRow
  return NextResponse.json({ channel: mapChannel(row, getImBridgeManager().getState(id)) })
}

function coerce<T extends string>(value: unknown, fallback: T, allowed: readonly T[]): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback
}

function coerceStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  return [...new Set(value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean))]
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
