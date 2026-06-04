import { resolvePermission, type PermissionDecision } from '@/shared/runtime/sdk/permission-bridge'
import { persistPermissionDecisionByRequestId } from '@/shared/runtime/confirmation-block-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: { requestId?: string; decision?: string; sessionId?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { requestId, decision, sessionId } = body
  if (!requestId || !decision) {
    return new Response(JSON.stringify({ error: 'requestId and decision required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const validDecisions: PermissionDecision[] = ['allow', 'allow_session', 'deny']
  if (!validDecisions.includes(decision as PermissionDecision)) {
    return new Response(JSON.stringify({ error: 'Invalid decision. Must be allow, allow_session, or deny' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const resolved = resolvePermission(requestId, decision as PermissionDecision)
  const persisted = persistPermissionDecisionByRequestId(
    requestId,
    decision as PermissionDecision,
    sessionId,
  )

  return new Response(JSON.stringify({ ok: true, resolved, persisted }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
