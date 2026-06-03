import type { EvolutionTrigger, GateResult, MessageSnippet } from './types'

const FEEDBACK_PATTERNS = [
  /不满意|不好|太差|问题很大|不对劲|体验差|麻烦|浪费|反复|返工/,
  /\b(bad|poor|wrong|annoying|frustrating|waste|rework)\b/i,
]

const CORRECTION_PATTERNS = [
  /错了|不对|你误解|不是这个意思|纠正|修正|改正|不要这样|应该是/,
  /\b(wrong|incorrect|misunderstood|correction|fix this|not what i meant)\b/i,
]

const RISK_PATTERNS = [
  /风险|危险|成本高|token|太贵|浪费 token|上下文太大|不可控|隐私|安全|权限/,
  /\b(risk|unsafe|costly|token|privacy|security|permission|uncontrolled)\b/i,
]

const DECISION_PATTERNS = [
  /决定|决策|以后就|以后都|以后要|从现在开始|定下来|原则是|结论是/,
  /\b(decision|decide|from now on|going forward|principle|rule)\b/i,
]

const EXPLICIT_MEMORY_PATTERNS = [
  /(?:请|帮我)?记住[：:\s]/,
  /\bremember(?: this)?[：:\s]/i,
]

const RULE_SIGNAL_PATTERNS = [
  /项目规则|规则|必须|不能|永远|不要再|默认应该|长期|稳定执行|自我进化/,
  /\b(project rule|always|never|must|default|long-term|self-evolution)\b/i,
]

function matchAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text))
}

function lastUserText(messages: MessageSnippet[]): string {
  return [...messages].reverse().find(message => message.role === 'user')?.text || ''
}

export function cheapGate(params: {
  messages: MessageSnippet[]
  reason: 'after_message' | 'compact_flush' | 'manual' | 'session_end' | 'periodic'
  tokenStats?: {
    inputTokens?: number
    outputTokens?: number
    contextPercent?: number
  }
}): GateResult {
  const text = lastUserText(params.messages)
  const joined = params.messages.map(message => message.text).join('\n')

  if (params.reason === 'compact_flush') {
    return {
      shouldRunEvolution: true,
      trigger: 'compact_flush',
      confidence: 0.95,
      suggestedSkills: ['memory-curator', 'retrospective-runner', 'rule-promoter'],
      reason: 'compact flush should batch-evolve the archived context',
    }
  }

  if (params.reason === 'periodic') {
    return {
      shouldRunEvolution: true,
      trigger: 'periodic',
      confidence: 0.9,
      suggestedSkills: ['project-evolution', 'rule-auditor', 'token-economist'],
      reason: 'periodic evolution audit',
    }
  }

  if (params.reason === 'manual') {
    return {
      shouldRunEvolution: true,
      trigger: 'manual',
      confidence: 0.9,
      suggestedSkills: ['memory-curator', 'retrospective-runner', 'rule-promoter', 'rule-auditor'],
      reason: 'manual batch evolution requested',
    }
  }

  if (params.tokenStats?.contextPercent && params.tokenStats.contextPercent >= 85) {
    return {
      shouldRunEvolution: true,
      trigger: 'token_anomaly',
      confidence: 0.85,
      suggestedSkills: ['token-economist'],
      reason: 'context usage is above threshold',
    }
  }

  if (matchAny(text, EXPLICIT_MEMORY_PATTERNS)) {
    return {
      shouldRunEvolution: true,
      trigger: 'explicit_memory',
      confidence: 0.95,
      suggestedSkills: ['memory-curator'],
      reason: 'user explicitly asked Loom to remember something',
    }
  }

  if (matchAny(text, CORRECTION_PATTERNS)) {
    return {
      shouldRunEvolution: true,
      trigger: 'correction',
      confidence: 0.88,
      suggestedSkills: ['retrospective-runner', 'memory-curator'],
      reason: 'user corrected the assistant or the process',
    }
  }

  if (matchAny(text, FEEDBACK_PATTERNS)) {
    return {
      shouldRunEvolution: true,
      trigger: 'feedback',
      confidence: 0.8,
      suggestedSkills: ['retrospective-runner', 'memory-curator'],
      reason: 'user expressed feedback or dissatisfaction',
    }
  }

  if (matchAny(joined, RISK_PATTERNS)) {
    return {
      shouldRunEvolution: true,
      trigger: 'risk',
      confidence: 0.78,
      suggestedSkills: ['retrospective-runner', 'memory-curator'],
      reason: 'conversation contains cost, safety, token, or control risk',
    }
  }

  if (matchAny(text, DECISION_PATTERNS)) {
    const ruleSignal = matchAny(text, RULE_SIGNAL_PATTERNS)
    const trigger: EvolutionTrigger = ruleSignal ? 'rule_signal' : 'decision'
    return {
      shouldRunEvolution: true,
      trigger,
      confidence: ruleSignal ? 0.86 : 0.82,
      suggestedSkills: ruleSignal ? ['memory-curator', 'rule-promoter'] : ['memory-curator'],
      reason: ruleSignal ? 'user stated a durable rule-like principle' : 'user stated a durable decision',
    }
  }

  return {
    shouldRunEvolution: false,
    trigger: 'none',
    confidence: 0,
    suggestedSkills: [],
    reason: 'no evolution signal detected',
  }
}
