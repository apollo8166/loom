import { hasNegativePrior } from './negative-priors'
import { stableKey } from './text'
import type { EvolutionTrigger, MessageSnippet } from './types'

type GateDecision = {
  action: 'discard' | 'record_observation' | 'needs_user_confirmation' | 'promote_candidate'
  confidence: number
  category: string
  observationKey: string
  reason: string
}

const LOW_VALUE_PATTERNS = [
  /^(谢谢|好的|可以|嗯|ok|thanks|thank you)[。.!！\s]*$/i,
  /^(继续|开始|go on|continue)[。.!！\s]*$/i,
]

const DECISION_PATTERNS = [
  /决定|以后|从现在开始|原则|规则|默认|必须|不能|不要再|always|never|must|default/i,
]

const CORRECTION_PATTERNS = [
  /错了|不对|误解|纠正|修正|不要这样|应该是|wrong|incorrect|fix this|not what i meant/i,
]

const RISK_PATTERNS = [
  /风险|危险|token|成本|太贵|隐私|安全|权限|不可控|risk|privacy|security|cost/i,
]

const FEEDBACK_PATTERNS = [
  /不满意|体验|反馈|返工|浪费|太差|不好|麻烦|frustrating|feedback|rework/i,
]

function lastUserText(messages: MessageSnippet[]): string {
  return [...messages].reverse().find(message => message.role === 'user')?.text.trim() || ''
}

function containsAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text))
}

function inferCategory(text: string, trigger: EvolutionTrigger): string {
  if (trigger === 'risk' || containsAny(text, RISK_PATTERNS)) return 'risk'
  if (trigger === 'correction' || containsAny(text, CORRECTION_PATTERNS)) return 'correction'
  if (trigger === 'feedback' || containsAny(text, FEEDBACK_PATTERNS)) return 'feedback'
  if (trigger === 'decision' || trigger === 'rule_signal' || containsAny(text, DECISION_PATTERNS)) return 'decision'
  return 'general'
}

function estimateConfidence(text: string, trigger: EvolutionTrigger): number {
  if (trigger === 'explicit_memory') return 0.9
  if (trigger === 'rule_signal') return 0.86
  if (trigger === 'decision' || trigger === 'correction') return 0.82
  if (trigger === 'feedback' || trigger === 'risk') return 0.74
  if (text.length >= 80 && containsAny(text, [...DECISION_PATTERNS, ...CORRECTION_PATTERNS])) return 0.72
  return 0.58
}

export function valueConfidenceGate(params: {
  projectId?: string
  workspacePath: string
  messages: MessageSnippet[]
  trigger: EvolutionTrigger
}): GateDecision {
  const text = lastUserText(params.messages)
  if (!text || text.length < 8 || LOW_VALUE_PATTERNS.some(pattern => pattern.test(text))) {
    return {
      action: 'discard',
      confidence: 0,
      category: 'noise',
      observationKey: 'noise',
      reason: 'low-value transient message',
    }
  }

  const category = inferCategory(text, params.trigger)
  const confidence = estimateConfidence(text, params.trigger)
  const observationKey = `${category}:${stableKey(text)}`
  if (hasNegativePrior({ projectId: params.projectId, workspacePath: params.workspacePath, content: text })) {
    return {
      action: 'discard',
      confidence: Math.max(0, confidence - 0.25),
      category,
      observationKey,
      reason: 'similar direction was previously rejected',
    }
  }

  if (confidence >= 0.85) {
    return {
      action: 'promote_candidate',
      confidence,
      category,
      observationKey,
      reason: 'high confidence durable signal',
    }
  }

  if (confidence >= 0.6) {
    return {
      action: 'record_observation',
      confidence,
      category,
      observationKey,
      reason: 'valuable observation below direct promotion threshold',
    }
  }

  return {
    action: 'discard',
    confidence,
    category,
    observationKey,
    reason: 'below confidence threshold',
  }
}
