import { abortActiveRun } from '@/shared/runtime/active-runs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: { sessionId?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const sessionId = body.sessionId?.trim()
  if (!sessionId) return Response.json({ error: 'sessionId required' }, { status: 400 })

  return Response.json({ ok: true, stopped: abortActiveRun(sessionId) })
}
