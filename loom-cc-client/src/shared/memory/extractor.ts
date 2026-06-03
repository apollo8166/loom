import { writeMemoryCandidate } from './files'
import type { MemoryCandidate, MemoryScope } from './types'

const REMEMBER_PATTERNS = [
  /(?:请|帮我)?记住[：:\s]*([\s\S]+)$/i,
  /remember(?: this)?[：:\s]*([\s\S]+)$/i,
]

const REFERENCE_PATTERNS = [
  /上面|上文|刚才|前面|之前|这个问题|这个要求|这件事|这一点|那个问题|那个要求|我的提问|我的问题/,
  /\b(this|that|above|previous|earlier|last question|my question)\b/i,
]

function inferScope(text: string): MemoryScope {
  if (/全局|跨项目|以后所有项目|所有项目|global|across projects/i.test(text)) return 'global'
  return 'project'
}

function inferType(text: string): MemoryCandidate['type'] {
  if (/偏好|喜欢|不喜欢|默认|风格|preference/i.test(text)) return 'preference'
  if (/决定|决策|以后就|不要再|方案|decision/i.test(text)) return 'decision'
  if (/纠正|错了|修正|不要这样|correction/i.test(text)) return 'correction'
  if (/流程|步骤|workflow|process/i.test(text)) return 'workflow'
  if (/反馈|评价|feedback/i.test(text)) return 'feedback'
  return 'fact'
}

function isReferentialMemory(content: string): boolean {
  const normalized = content.trim()
  return REFERENCE_PATTERNS.some(pattern => pattern.test(normalized))
}

export function extractExplicitMemoryCandidates(params: {
  userMessage: string
  workspacePath: string
  sessionId: string
}): MemoryCandidate[] {
  const text = params.userMessage.trim()
  const match = REMEMBER_PATTERNS.map(pattern => pattern.exec(text)).find(Boolean)
  if (!match?.[1]?.trim()) return []

  const content = match[1].trim()
  if (isReferentialMemory(content)) return []
  const scope = inferScope(text)
  if (scope === 'project' && !params.workspacePath) return []

  const candidate = writeMemoryCandidate({
    scope,
    workspacePath: scope === 'project' ? params.workspacePath : undefined,
    type: inferType(content),
    confidence: 'high',
    sourceSessionId: params.sessionId,
    content,
    evidence: `用户明确要求记住：${text.slice(0, 500)}`,
  })
  return [candidate]
}

export function isExplicitMemoryRequest(userMessage: string): boolean {
  return REMEMBER_PATTERNS.some(pattern => pattern.test(userMessage.trim()))
}

export function isExplicitMemoryReferenceRequest(userMessage: string): boolean {
  const text = userMessage.trim()
  const match = REMEMBER_PATTERNS.map(pattern => pattern.exec(text)).find(Boolean)
  return Boolean(match?.[1] && isReferentialMemory(match[1]))
}
