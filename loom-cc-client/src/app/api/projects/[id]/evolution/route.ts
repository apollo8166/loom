import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/shared/db/db'
import { listProjectRules } from '@/shared/evolution/rule-store'
import { readEvolutionEvents } from '@/shared/evolution/events'
import { listRecentObservations } from '@/shared/evolution/observation-store'
import { filterCoveredRecentObservations } from '@/shared/evolution/observation-visibility'
import { listSemanticMemories } from '@/shared/evolution/semantic-memory-store'
import { cleanProjectDossier, getLatestProjectDossier, rebuildProjectDossierDeterministic } from '@/shared/evolution/dossier-store'
import { listFactRecords } from '@/shared/evolution/fact-store'
import { listNegativePriors } from '@/shared/evolution/negative-priors'
import { readLatestMemoryJob } from '@/shared/memory/background-jobs'
import { runEvolution, auditShadowRules } from '@/shared/evolution/orchestrator'
import { messageContentToText } from '@/shared/memory/session-messages'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getProjectWorkspace(projectId: string): string | null {
  const db = getDb()
  const row = db.prepare('SELECT workspace_path FROM projects WHERE id = ?').get(projectId) as { workspace_path: string | null } | undefined
  return row?.workspace_path || null
}

function recentProjectMessages(projectId: string) {
  const rows = getDb().prepare(
    `SELECT m.role, m.content, m.id AS messageId, m.created_at AS createdAt
     FROM messages m
     JOIN sessions s ON s.id = m.session_id
     WHERE s.project_id = ?
     ORDER BY m.created_at DESC
     LIMIT 12`
  ).all(projectId) as Array<{ role: 'user' | 'assistant'; content: string; messageId: string; createdAt: string }>
  return rows.reverse().map(row => ({
    role: row.role,
    text: messageContentToText(row.content),
    messageId: row.messageId,
    createdAt: row.createdAt,
  })).filter(message => message.text.trim().length > 0)
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const workspacePath = getProjectWorkspace(id)
  if (!workspacePath) return NextResponse.json({ error: 'Project workspace not found' }, { status: 404 })
  const rules = listProjectRules({ projectId: id, workspacePath, limit: 500 })
  const observations = listRecentObservations({ projectId: id, workspacePath, limit: 80 })
  const semanticMemories = listSemanticMemories({ projectId: id, workspacePath, limit: 120 })
  const dossier = cleanProjectDossier(getLatestProjectDossier({ projectId: id, workspacePath }) || rebuildProjectDossierDeterministic({
    projectId: id,
    workspacePath,
    source: 'api',
  }))
  const visibleObservations = filterCoveredRecentObservations({
    observations,
    semanticMemories,
    dossier,
  })
  const facts = listFactRecords({ projectId: id, workspacePath, limit: 40 })
  const negativePriors = listNegativePriors({ projectId: id, workspacePath, limit: 40 })
  const events = readEvolutionEvents({ projectId: id, workspacePath, limit: 80 })
  return NextResponse.json({
    latestMemoryJob: readLatestMemoryJob({ workspacePath }),
    overview: {
      needsReview: rules.filter(rule => rule.needsUserConfirmation || rule.status === 'candidate').length,
      activeRules: rules.filter(rule => rule.status === 'active').length,
      shadowRules: rules.filter(rule => rule.status === 'shadow').length,
      deprecatedRules: rules.filter(rule => rule.status === 'deprecated' || rule.status === 'superseded').length,
      semanticMemories: semanticMemories.filter(memory => memory.status === 'active').length,
      recentObservations: visibleObservations.filter(observation => observation.status === 'active').length,
      factRecords: facts.length,
      negativePriors: negativePriors.length,
      recentEvents: events.length,
    },
    rules,
    observations: visibleObservations,
    semanticMemories,
    dossier,
    facts,
    negativePriors,
    events,
  })
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const workspacePath = getProjectWorkspace(id)
  if (!workspacePath) return NextResponse.json({ error: 'Project workspace not found' }, { status: 404 })
  const result = await runEvolution({
    projectId: id,
    sessionId: `manual:${id}`,
    workspacePath,
    messages: recentProjectMessages(id),
    reason: 'periodic',
  })
  await auditShadowRules({ projectId: id, workspacePath })
  const dossier = cleanProjectDossier(getLatestProjectDossier({ projectId: id, workspacePath }) || rebuildProjectDossierDeterministic({
    projectId: id,
    workspacePath,
    source: 'manual',
  }))
  return NextResponse.json({ result, dossier })
}
