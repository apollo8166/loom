import {
  resolveAskUserQuestion,
  type AskUserQuestionAnswers,
  type AskUserQuestionAnnotations,
  type AskUserQuestionStatus,
} from '@/shared/runtime/sdk/ask-user-question-bridge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: {
    requestId?: string
    action?: string
    answers?: AskUserQuestionAnswers
    annotations?: AskUserQuestionAnnotations
  }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { requestId, action } = body
  if (!requestId || !action) {
    return Response.json({ error: 'requestId and action required' }, { status: 400 })
  }

  const validActions: AskUserQuestionStatus[] = ['submit', 'cancel']
  if (!validActions.includes(action as AskUserQuestionStatus)) {
    return Response.json({ error: 'Invalid action. Must be submit or cancel' }, { status: 400 })
  }

  const resolved = resolveAskUserQuestion(requestId, {
    action: action as AskUserQuestionStatus,
    answers: body.answers ?? {},
    annotations: body.annotations ?? {},
  })

  return Response.json({ ok: true, resolved })
}
