import fs from 'node:fs'
import path from 'node:path'
import { getMemoryDirForScope } from './paths'
import { readMemoryCandidates, refreshApprovedMemorySummary, updateCandidateStatus } from './files'
import type { MemoryCandidate, MemoryScope } from './types'
import { logger } from '@/shared/logging/logger'
import { createProjectRule, updateProjectRuleStatus } from '@/shared/evolution/rule-store'
import { createNegativePrior } from '@/shared/evolution/negative-priors'

function targetFileForType(type: MemoryCandidate['type'], scope: MemoryScope): string {
  if (scope === 'global') {
    if (type === 'preference') return 'preferences.md'
    if (type === 'workflow') return 'workflows.md'
    if (type === 'correction') return 'corrections.md'
    return 'user.md'
  }
  if (type === 'decision') return 'decisions.md'
  if (type === 'feedback') return 'feedback.md'
  if (type === 'retrospective') return 'retrospectives.md'
  if (type === 'project_rule') return 'rules.md'
  if (type === 'correction') return 'corrections.md'
  if (type === 'workflow') return 'project.md'
  return 'project.md'
}

export function getCandidateTargetFile(type: MemoryCandidate['type'], scope: MemoryScope): string {
  return targetFileForType(type, scope)
}

export function findCandidate(params: {
  id: string
  scope: MemoryScope
  workspacePath?: string
}): MemoryCandidate | null {
  return readMemoryCandidates(params.scope, params.workspacePath).find(c => c.id === params.id) || null
}

export function approveCandidate(params: {
  id: string
  scope: MemoryScope
  workspacePath?: string
}): { candidate: MemoryCandidate; targetFile: string; targetPath: string } {
  logger.info('memory.candidate.approve_start', {
    id: params.id,
    scope: params.scope,
    workspacePath: params.workspacePath,
  })
  const candidate = findCandidate(params)
  if (!candidate) {
    logger.warn('memory.candidate.approve_not_found', {
      id: params.id,
      scope: params.scope,
      workspacePath: params.workspacePath,
    })
    throw new Error('Candidate not found')
  }

  const memoryDir = getMemoryDirForScope(candidate.scope, params.workspacePath)
  const targetFile = targetFileForType(candidate.type, candidate.scope)
  const targetPath = path.join(memoryDir, targetFile)

  if (candidate.status === 'pending') {
    if (candidate.type === 'project_rule' || candidate.target === 'project_rule') {
      const existingRuleId = typeof candidate.metadata?.ruleId === 'string' ? candidate.metadata.ruleId : ''
      if (existingRuleId) {
        const rule = updateProjectRuleStatus({
          id: existingRuleId,
          status: 'active',
          userConfirmed: true,
          needsUserConfirmation: false,
          reason: 'User approved project rule candidate from memory inbox.',
        })
        updateCandidateStatus(candidate.path, 'approved')
        return {
          candidate: { ...candidate, status: 'approved' as const },
          targetFile: 'rules.md',
          targetPath: path.join(memoryDir, 'rules.md'),
          rule,
        } as { candidate: MemoryCandidate; targetFile: string; targetPath: string; rule?: unknown }
      }
      const rule = createProjectRule({
        workspacePath: params.workspacePath || '',
        title: candidate.content.split('\n')[0].slice(0, 60) || 'Project rule',
        rule: candidate.content.trim(),
        rationale: candidate.evidence || '',
        status: 'active',
        evidenceIds: [candidate.id],
        promotedFromIds: [candidate.id],
        confidence: candidate.confidence === 'high' ? 0.9 : candidate.confidence === 'medium' ? 0.72 : 0.55,
        userConfirmed: true,
        needsUserConfirmation: false,
        createdBySkill: 'memory-inbox',
      })
      updateCandidateStatus(candidate.path, 'approved')
      return {
        candidate: { ...candidate, status: 'approved' as const },
        targetFile: 'rules.md',
        targetPath: path.join(memoryDir, 'rules.md'),
        rule,
      } as { candidate: MemoryCandidate; targetFile: string; targetPath: string; rule?: unknown }
    }
    const entry = [
      '',
      `## ${new Date().toISOString().slice(0, 10)} · ${candidate.type}`,
      '',
      candidate.content.trim(),
      candidate.evidence ? ['', '> Evidence: ' + candidate.evidence.replace(/\n/g, ' ').slice(0, 500)] : [],
      '',
    ].flat().join('\n')
    fs.appendFileSync(targetPath, entry, 'utf8')
    updateCandidateStatus(candidate.path, 'approved')
    refreshApprovedMemorySummary(candidate.scope, params.workspacePath)
  }

  const approvedCandidate = { ...candidate, status: 'approved' as const }
  logger.info('memory.candidate.approve_done', {
    id: candidate.id,
    scope: candidate.scope,
    type: candidate.type,
    previousStatus: candidate.status,
    targetFile,
    targetPath,
    contentChars: candidate.content.length,
  })
  return { candidate: approvedCandidate, targetFile, targetPath }
}

export function rejectCandidate(params: {
  id: string
  scope: MemoryScope
  workspacePath?: string
}): MemoryCandidate {
  logger.info('memory.candidate.reject_start', {
    id: params.id,
    scope: params.scope,
    workspacePath: params.workspacePath,
  })
  const candidate = findCandidate(params)
  if (!candidate) {
    logger.warn('memory.candidate.reject_not_found', {
      id: params.id,
      scope: params.scope,
      workspacePath: params.workspacePath,
    })
    throw new Error('Candidate not found')
  }
  if (candidate.status === 'pending') updateCandidateStatus(candidate.path, 'rejected')
  if (candidate.type === 'project_rule' || candidate.target === 'project_rule') {
    const existingRuleId = typeof candidate.metadata?.ruleId === 'string' ? candidate.metadata.ruleId : ''
    if (existingRuleId) {
      try {
        updateProjectRuleStatus({
          id: existingRuleId,
          status: 'deprecated',
          userConfirmed: false,
          needsUserConfirmation: false,
          reason: 'User rejected project rule candidate from memory inbox.',
        })
      } catch (err) {
        logger.warn('memory.candidate.reject_rule_deprecate_failed', {
          id: candidate.id,
          ruleId: existingRuleId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    } else if (params.workspacePath) {
      createNegativePrior({
        projectId: typeof candidate.metadata?.projectId === 'string' ? candidate.metadata.projectId : undefined,
        workspacePath: params.workspacePath,
        content: candidate.content,
        sourceEntityType: 'memory_candidate',
        sourceEntityId: candidate.id,
      })
    }
  }
  const rejectedCandidate = { ...candidate, status: 'rejected' as const }
  logger.info('memory.candidate.reject_done', {
    id: candidate.id,
    scope: candidate.scope,
    type: candidate.type,
    previousStatus: candidate.status,
    candidatePath: candidate.path,
  })
  return rejectedCandidate
}
