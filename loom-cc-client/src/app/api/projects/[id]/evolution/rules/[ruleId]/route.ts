import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'
import { getProjectRule, updateProjectRuleStatus } from '@/shared/evolution/rule-store'
import type { ProjectRuleStatus } from '@/shared/evolution/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ACTION_TO_STATUS: Record<string, ProjectRuleStatus> = {
  activate: 'active',
  shadow: 'shadow',
  pause: 'paused',
  deprecate: 'deprecated',
}

function projectExists(projectId: string): boolean {
  return Boolean(getDb().prepare('SELECT id FROM projects WHERE id = ?').get(projectId))
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; ruleId: string }> },
) {
  const { id, ruleId } = await params
  if (!projectExists(id)) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  const body = await req.json().catch(() => ({})) as {
    action?: 'activate' | 'shadow' | 'pause' | 'deprecate'
    reason?: string
  }
  const status = body.action ? ACTION_TO_STATUS[body.action] : undefined
  if (!status) return NextResponse.json({ error: 'Unsupported rule action' }, { status: 400 })
  const current = getProjectRule(ruleId)
  if (!current || current.projectId !== id) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
  const rule = updateProjectRuleStatus({
    id: ruleId,
    status,
    userConfirmed: body.action === 'activate' ? true : undefined,
    needsUserConfirmation: body.action === 'activate' ? false : undefined,
    reason: body.reason,
  })
  return NextResponse.json({ rule })
}
