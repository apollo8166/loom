import {
  appendRuntimeEvent,
  getRuntimeEventHighWatermark,
  readActiveSessionRuntimeEvents,
  readRecentRuntimeEvents,
  readRuntimeEventsAfter,
  type RuntimeEventScope,
} from '@/shared/runtime/runtime-event-store'

type SessionEvent = Record<string, unknown>

type Listener = (event: SessionEvent) => void

const listeners = new Map<string, Set<Listener>>()
const activeEvents = new Map<string, SessionEvent[]>()

function listenerKey(scope: 'session' | 'project', id: string): string {
  return `${scope}:${id}`
}

export function publishSessionEvent(sessionId: string, event: SessionEvent) {
  const eventId = appendRuntimeEvent('session', sessionId, event)
  const publishedEvent = eventId ? { ...event, eventId } : event

  if (event.type === 'im_user_message' || event.type === 'runtime_user_message') {
    activeEvents.set(sessionId, [publishedEvent])
  } else if (activeEvents.has(sessionId)) {
    activeEvents.get(sessionId)!.push(publishedEvent)
  }

  const scoped = listeners.get(listenerKey('session', sessionId))
  if (scoped) {
    for (const listener of scoped) listener(publishedEvent)
  }
  const all = listeners.get(listenerKey('session', '*'))
  if (all) {
    for (const listener of all) listener({ ...publishedEvent, sessionId })
  }

  if (event.type === 'done' || event.type === 'error') {
    activeEvents.delete(sessionId)
  }
}

export function subscribeSessionEvents(sessionId: string, listener: Listener): () => void {
  const key = listenerKey('session', sessionId || '*')
  const scoped = listeners.get(key) ?? new Set<Listener>()
  scoped.add(listener)
  listeners.set(key, scoped)
  if (sessionId) {
    for (const event of activeEvents.get(sessionId) ?? []) listener(event)
  }
  return () => {
    scoped.delete(listener)
    if (scoped.size === 0) listeners.delete(key)
  }
}

export function publishProjectEvent(projectId: string, event: SessionEvent) {
  const eventId = appendRuntimeEvent('project', projectId, event)
  const publishedEvent = eventId ? { ...event, eventId } : event
  const scoped = listeners.get(listenerKey('project', projectId))
  if (scoped) {
    for (const listener of scoped) listener(publishedEvent)
  }
}

export function subscribeProjectEvents(projectId: string, listener: Listener): () => void {
  const key = listenerKey('project', projectId)
  const scoped = listeners.get(key) ?? new Set<Listener>()
  scoped.add(listener)
  listeners.set(key, scoped)
  return () => {
    scoped.delete(listener)
    if (scoped.size === 0) listeners.delete(key)
  }
}

export function getRuntimeEventsCursor(scope: RuntimeEventScope, scopeId: string): number {
  return getRuntimeEventHighWatermark(scope, scopeId)
}

export function readRuntimeEvents(scope: RuntimeEventScope, scopeId: string, afterId: number) {
  return readRuntimeEventsAfter(scope, scopeId, afterId).map(row => ({ ...row.event, eventId: row.id }))
}

export function readActiveSessionEvents(sessionId: string) {
  return readActiveSessionRuntimeEvents(sessionId).map(row => ({ ...row.event, eventId: row.id }))
}

export function readRecentProjectEvents(projectId: string) {
  return readRecentRuntimeEvents('project', projectId).map(row => ({ ...row.event, eventId: row.id }))
}
