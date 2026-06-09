import { NextRequest } from 'next/server'
import {
  getRuntimeEventsCursor,
  readRecentProjectEvents,
  readRuntimeEvents,
  subscribeProjectEvents,
} from '@/shared/runtime/session-events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const encoder = new TextEncoder()
  const lastEventId = Number(req.headers.get('last-event-id') || 0)
  const hasLastEventId = Number.isFinite(lastEventId) && lastEventId > 0

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let cursor = hasLastEventId ? lastEventId : getRuntimeEventsCursor('project', id)
      const seen = new Set<number>()
      const send = (event: Record<string, unknown>, options?: { replay?: boolean }) => {
        if (closed) return
        const eventId = Number(event.eventId || 0)
        if (eventId > 0) {
          if (seen.has(eventId)) return
          if (!options?.replay && eventId <= cursor) return
          seen.add(eventId)
          cursor = Math.max(cursor, eventId)
        }
        try {
          const idLine = eventId > 0 ? `id: ${eventId}\n` : ''
          controller.enqueue(encoder.encode(`${idLine}data: ${JSON.stringify(event)}\n\n`))
        } catch {
          closed = true
        }
      }
      send({ type: 'connected', projectId: id })
      for (const event of readRecentProjectEvents(id)) send(event, { replay: !hasLastEventId })
      const unsubscribe = subscribeProjectEvents(id, send)
      const heartbeat = setInterval(() => send({ type: 'ping' }), 25_000)
      const poll = setInterval(() => {
        for (const event of readRuntimeEvents('project', id, cursor)) send(event)
      }, 750)

      req.signal.addEventListener('abort', () => {
        closed = true
        clearInterval(heartbeat)
        clearInterval(poll)
        unsubscribe()
        try { controller.close() } catch { /* already closed */ }
      }, { once: true })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
