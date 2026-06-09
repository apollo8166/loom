import { getDb } from '@/shared/db/db'

export type RuntimeEventScope = 'session' | 'project'
export type RuntimeEventPayload = Record<string, unknown>

export interface StoredRuntimeEvent {
  id: number
  event: RuntimeEventPayload
}

export function appendRuntimeEvent(scope: RuntimeEventScope, scopeId: string, event: RuntimeEventPayload): number | null {
  if (!scopeId) return null
  try {
    const info = getDb().prepare(
      `INSERT INTO runtime_events (scope, scope_id, event_type, payload)
       VALUES (?, ?, ?, ?)`,
    ).run(scope, scopeId, String(event.type || ''), JSON.stringify(event))
    const eventId = Number(info.lastInsertRowid)
    if (eventId > 0 && eventId % 500 === 0) pruneRuntimeEvents()
    return eventId
  } catch {
    return null
  }
}

export function readRuntimeEventsAfter(
  scope: RuntimeEventScope,
  scopeId: string,
  afterId: number,
  limit = 200,
): StoredRuntimeEvent[] {
  if (!scopeId) return []
  try {
    const rows = getDb().prepare(
      `SELECT id, payload
       FROM runtime_events
       WHERE scope = ? AND scope_id = ? AND id > ?
       ORDER BY id ASC
       LIMIT ?`,
    ).all(scope, scopeId, afterId, limit) as Array<{ id: number; payload: string }>

    return parseStoredRows(rows)
  } catch {
    return []
  }
}

export function readActiveSessionRuntimeEvents(sessionId: string): StoredRuntimeEvent[] {
  if (!sessionId) return []
  try {
    const rows = getDb().prepare(
      `SELECT id, event_type, payload
       FROM runtime_events
       WHERE scope = 'session' AND scope_id = ?
       ORDER BY id DESC
       LIMIT 10000`,
    ).all(sessionId) as Array<{ id: number; event_type: string; payload: string }>

    rows.reverse()
    let start = -1
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (rows[i].event_type === 'done' || rows[i].event_type === 'error') return []
      if (rows[i].event_type === 'im_user_message' || rows[i].event_type === 'runtime_user_message') {
        start = i
        break
      }
    }
    if (start < 0) return []
    return parseStoredRows(rows.slice(start))
  } catch {
    return []
  }
}

export function readRecentRuntimeEvents(
  scope: RuntimeEventScope,
  scopeId: string,
  seconds = 30,
  limit = 50,
): StoredRuntimeEvent[] {
  if (!scopeId) return []
  try {
    const rows = getDb().prepare(
      `SELECT id, payload
       FROM runtime_events
       WHERE scope = ? AND scope_id = ?
         AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
       ORDER BY id ASC
       LIMIT ?`,
    ).all(scope, scopeId, `-${Math.max(1, seconds)} seconds`, limit) as Array<{ id: number; payload: string }>
    return parseStoredRows(rows)
  } catch {
    return []
  }
}

export function getRuntimeEventHighWatermark(scope: RuntimeEventScope, scopeId: string): number {
  if (!scopeId) return 0
  try {
    const row = getDb().prepare(
      `SELECT COALESCE(MAX(id), 0) AS id
       FROM runtime_events
       WHERE scope = ? AND scope_id = ?`,
    ).get(scope, scopeId) as { id: number } | undefined
    return Number(row?.id || 0)
  } catch {
    return 0
  }
}

function parseStoredRows(rows: Array<{ id: number; payload: string }>): StoredRuntimeEvent[] {
  return rows.flatMap(row => {
    try {
      const parsed = JSON.parse(row.payload)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
      return [{ id: row.id, event: parsed as RuntimeEventPayload }]
    } catch {
      return []
    }
  })
}

function pruneRuntimeEvents() {
  try {
    getDb().prepare(
      `DELETE FROM runtime_events
       WHERE id NOT IN (
         SELECT id FROM runtime_events
         ORDER BY id DESC
         LIMIT 50000
       )`,
    ).run()
  } catch {
    // Event persistence is a UI refresh aid; failures should not break chat.
  }
}
