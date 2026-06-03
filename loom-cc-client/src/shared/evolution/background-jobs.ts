import { getDb } from '@/shared/db/db'
import { logger } from '@/shared/logging/logger'
import { runEvolution, auditShadowRules } from './orchestrator'
import { listProjectRules, syncProjectRuleFiles } from './rule-store'
import type { MessageSnippet } from './types'

let running = false

function projectRows() {
  return getDb().prepare(
    `SELECT id, name, workspace_path AS workspacePath
     FROM projects
     WHERE status = 'active' AND workspace_path <> ''`
  ).all() as Array<{ id: string; name: string; workspacePath: string }>
}

function latestProjectSnippets(projectId: string): MessageSnippet[] {
  const rows = getDb().prepare(
    `SELECT m.role, m.content, m.id, m.created_at AS createdAt
     FROM messages m
     JOIN sessions s ON s.id = m.session_id
     WHERE s.project_id = ?
     ORDER BY m.created_at DESC
     LIMIT 12`
  ).all(projectId) as Array<{ role: 'user' | 'assistant'; content: string; id: string; createdAt: string }>

  return rows.reverse().map(row => {
    let text = row.content
    try {
      const parsed = JSON.parse(row.content) as Array<{ type: string; text?: string }>
      if (Array.isArray(parsed)) text = parsed.filter(block => block.type === 'text' && block.text).map(block => block.text).join('\n')
    } catch {
      // Use raw content.
    }
    return {
      role: row.role,
      text,
      messageId: row.id,
      createdAt: row.createdAt,
    }
  }).filter(message => message.text.trim().length > 0)
}

export async function runPeriodicEvolutionAudit() {
  if (running) return
  running = true
  try {
    for (const project of projectRows()) {
      const snippets = latestProjectSnippets(project.id)
      const rules = listProjectRules({ projectId: project.id, workspacePath: project.workspacePath, limit: 20 })
      if (snippets.length === 0 && rules.length === 0) continue

      logger.info('evolution.periodic.start', {
        projectId: project.id,
        workspacePath: project.workspacePath,
        snippetCount: snippets.length,
        ruleCount: rules.length,
      })

      await runEvolution({
        projectId: project.id,
        sessionId: `periodic:${project.id}`,
        workspacePath: project.workspacePath,
        messages: snippets,
        reason: 'periodic',
      })
      await auditShadowRules({
        projectId: project.id,
        workspacePath: project.workspacePath,
      })
      syncProjectRuleFiles(project.workspacePath)
    }
  } catch (err) {
    logger.warn('evolution.periodic.failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  } finally {
    running = false
  }
}

export function runPeriodicEvolutionAuditDetached() {
  setTimeout(() => {
    runPeriodicEvolutionAudit().catch(err => {
      logger.warn('evolution.periodic.detached_failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }, 0)
}
