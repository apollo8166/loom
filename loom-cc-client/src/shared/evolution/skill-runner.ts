import crypto from 'node:crypto'
import { logger } from '@/shared/logging/logger'
import { getDb } from '@/shared/db/db'
import { getBackgroundModelCandidates, isUnavailableModelError } from '@/shared/runtime/background-model'
import type { EvolutionPacket, EvolutionSkillName } from './types'

const SKILL_SYSTEM_PROMPTS: Record<EvolutionSkillName, string> = {
  'memory-curator': `你是 Loom 的 memory-curator skill。判断对话片段中什么该记、该丢、该合并、该升级为 decision/retrospective/project_rule 候选。

只输出 JSON。不要输出解释。不要记录密钥、账号、token 值或隐私敏感内容。

输出格式：
{"actions":[{"action":"save|merge|update|discard|create_decision|create_retrospective|suggest_rule","type":"fact|preference|workflow|correction|feedback|risk|decision|retrospective|project_rule","content":"...","evidence":"...","confidence":"high|medium|low","target":"memory|decision|retrospective|project_rule"}]}`,

  'retrospective-runner': `你是 Loom 的 retrospective-runner skill。你从错误、返工、用户纠正、不满和风险中提炼复盘结论。

只输出 JSON。不要输出解释。结论必须可行动，避免泛泛而谈。

输出格式：
{"retrospectives":[{"rootCause":"...","lesson":"...","correction":"...","risk":"...","content":"...","evidence":"...","confidence":"high|medium|low","rulePotential":true}]}`,

  'rule-promoter': `你是 Loom 的 rule-promoter skill。判断 decision、retrospective 或重复 feedback 是否值得成为项目规则候选。

项目规则必须长期、稳定、可行动、有明确作用域，并能改善质量、成本、安全或一致性。不要把一次性偏好升级为项目规则。

只输出 JSON。

输出格式：
{"recommendation":"promote|keep_as_decision|keep_as_memory|reject|merge|needs_user_confirmation","title":"...","rule":"...","rationale":"...","scope":"project|module|workflow|global","priority":"low|medium|high|critical","impact":"low|medium|high","risk":"low|medium|high","confidence":0.0,"needsUserConfirmation":true,"mergeWith":null}`,

  'rule-auditor': `你是 Loom 的 rule-auditor skill。审计项目规则候选是否重复、冲突、过宽、过时或作用域错误。

只输出 JSON。

输出格式：
{"result":"pass|reject|merge|narrow_scope|needs_user_confirmation","rationale":"...","conflictsWith":["rule_id"],"mergeWith":null,"scope":"project|module|workflow|global","risk":"low|medium|high","needsUserConfirmation":true}`,

  'token-economist': `你是 Loom 的 token-economist skill。判断哪些 memory/rule 值得注入上下文，哪些只保留引用。

只输出 JSON。

输出格式：
{"includeRules":["rule_id"],"includeMemories":["memory_id"],"exclude":["id"],"rationale":"...","estimatedChars":0}`,

  'project-evolution': `你是 Loom 的 project-evolution skill。周期性审视项目 L1 observations、L2 semantic memories、L3 project dossier 和 rules，做去重、归纳、合并、降级、废弃建议。

原则：
- 不要发明新事实，只能基于输入中已有的 id 和内容整理。
- 相似或重复内容要归并为更短、更稳定的 canonical 表述。
- L3 dossier 应是项目级稳定摘要，不要堆叠近似句。
- L1 observation 被 L2/L3 吸收后，应建议标记为 promoted。
- 只引用输入中存在的 semantic memory id 和 observation id。
- 不要记录密钥、账号、token 值或隐私敏感内容。

只输出 JSON。

输出格式：
{"dossier":{"summary":"- ...","stableRules":"- ...","recentRisks":"- ...","repeatedIssues":"- ...","deprecatedUnderstanding":"- ...","nextSteps":"- ..."},"semanticUpdates":[{"id":"sem_id","action":"rewrite|merge|archive|keep","title":"...","content":"...","category":"risk|workflow|correction|feedback|decision|fact|preference|general","status":"active|stale|archived","mergeSourceIds":["sem_id"],"absorbedObservationIds":["obs_id"],"reason":"..."}],"observationUpdates":[{"id":"obs_id","status":"promoted|archived|active","reason":"..."}],"notes":"..."}`,
}

function preview(value: string, max = 220): string {
  return value.replace(/\s+/g, ' ').slice(0, max)
}

function extractTextFromResponse(response: unknown): string {
  if (!response || typeof response !== 'object') return ''
  const obj = response as Record<string, unknown>
  if (Array.isArray(obj.content)) {
    return obj.content
      .filter((block): block is { type: string; text?: string } => typeof block === 'object' && block !== null && 'type' in block)
      .filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join('\n')
  }
  if (typeof obj.content === 'string') return obj.content
  const choices = obj.choices
  if (Array.isArray(choices)) {
    return choices.map(choice => {
      const c = choice as Record<string, unknown>
      const message = c.message as Record<string, unknown> | undefined
      if (typeof message?.content === 'string') return message.content
      if (typeof c.text === 'string') return c.text
      return ''
    }).filter(Boolean).join('\n')
  }
  if (typeof obj.output_text === 'string') return obj.output_text
  return ''
}

function extractJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  const jsonText = trimmed.startsWith('{')
    ? trimmed
    : /\{[\s\S]*\}/.exec(trimmed)?.[0] || '{}'
  try {
    const parsed = JSON.parse(jsonText)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

async function callAnthropic(params: {
  apiKey: string
  baseUrl?: string
  model: string
  system: string
  user: string
}): Promise<unknown> {
  const endpoint = `${(params.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: 1200,
      temperature: 0,
      system: params.system,
      messages: [{ role: 'user', content: params.user }],
    }),
  })
  if (!res.ok) throw new Error(`Evolution skill Anthropic request failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

async function callOpenAI(params: {
  apiKey: string
  baseUrl: string
  model: string
  system: string
  user: string
}): Promise<unknown> {
  const endpoint = `${params.baseUrl.replace(/\/$/, '')}/chat/completions`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: 1200,
      temperature: 0,
      stream: false,
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
    }),
  })
  if (!res.ok) throw new Error(`Evolution skill OpenAI request failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

function createSkillRun(params: {
  skillName: EvolutionSkillName
  packet: EvolutionPacket
  inputHash: string
  inputSummary: string
  tokenEstimate: number
}): string {
  const id = crypto.randomUUID()
  getDb().prepare(
    `INSERT INTO skill_runs
      (id, project_id, session_id, workspace_path, skill_name, trigger, input_hash, input_summary, token_estimate, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running')`
  ).run(
    id,
    params.packet.projectId || '',
    params.packet.sessionId,
    params.packet.workspacePath,
    params.skillName,
    params.packet.trigger,
    params.inputHash,
    params.inputSummary,
    params.tokenEstimate,
  )
  return id
}

function finishSkillRun(params: {
  id: string
  status: 'done' | 'failed' | 'skipped'
  outputSummary?: string
  error?: string
}) {
  getDb().prepare(
    `UPDATE skill_runs
     SET status = ?,
         output_summary = ?,
         error = ?,
         completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
     WHERE id = ?`
  ).run(params.status, params.outputSummary || '', params.error || '', params.id)
}

export async function runEvolutionSkill(params: {
  skillName: EvolutionSkillName
  packet: EvolutionPacket
}): Promise<Record<string, unknown>> {
  const system = SKILL_SYSTEM_PROMPTS[params.skillName]
  const user = JSON.stringify({
    trigger: params.packet.trigger,
    snippets: params.packet.snippets.map(snippet => ({
      role: snippet.role,
      text: snippet.text.slice(0, 1800),
      messageId: snippet.messageId,
    })),
    candidate: params.packet.candidate ? {
      id: params.packet.candidate.id,
      type: params.packet.candidate.type,
      content: params.packet.candidate.content,
      evidence: params.packet.candidate.evidence,
    } : undefined,
    relatedMemories: params.packet.relatedMemories.slice(0, 5),
    projectDossier: params.packet.projectDossier,
    semanticMemories: params.packet.semanticMemories.slice(0, 40),
    recentObservations: params.packet.recentObservations.slice(0, 30),
    activeRules: params.packet.activeRules.slice(0, 20),
    shadowRules: params.packet.shadowRules.slice(0, 20),
    metrics: params.packet.metrics,
  })
  const inputHash = crypto.createHash('sha256').update(`${params.skillName}\n${user}`).digest('hex').slice(0, 24)
  const runId = createSkillRun({
    skillName: params.skillName,
    packet: params.packet,
    inputHash,
    inputSummary: preview(user),
    tokenEstimate: Math.ceil((system.length + user.length) / 4),
  })

  try {
    const candidates = getBackgroundModelCandidates()
    let lastError: unknown = null
    for (const candidate of candidates) {
      const provider = candidate.provider
      if (!provider.apiKey) {
        finishSkillRun({ id: runId, status: 'skipped', outputSummary: 'provider has no API key' })
        return {}
      }
      try {
        logger.info('evolution.skill.start', {
          runId,
          skillName: params.skillName,
          providerId: provider.providerId,
          model: candidate.modelId,
          tier: candidate.tier,
          trigger: params.packet.trigger,
          userChars: user.length,
        })
        const response = provider.apiFormat === 'openai'
          ? await callOpenAI({
              apiKey: provider.apiKey,
              baseUrl: provider.upstreamBaseUrl || provider.baseUrl || '',
              model: candidate.modelId,
              system,
              user,
            })
          : await callAnthropic({
              apiKey: provider.apiKey,
              baseUrl: provider.upstreamBaseUrl || provider.baseUrl,
              model: candidate.modelId,
              system,
              user,
            })
        const text = extractTextFromResponse(response)
        const parsed = extractJsonObject(text)
        finishSkillRun({ id: runId, status: 'done', outputSummary: preview(text) })
        return parsed
      } catch (err) {
        lastError = err
        logger.warn('evolution.skill.model_attempt_failed', {
          runId,
          skillName: params.skillName,
          providerId: provider.providerId,
          model: candidate.modelId,
          tier: candidate.tier,
          retryNextModel: isUnavailableModelError(err),
          error: err instanceof Error ? err.message : String(err),
        })
        if (!isUnavailableModelError(err)) throw err
      }
    }
    if (lastError) throw lastError
    finishSkillRun({ id: runId, status: 'skipped', outputSummary: 'no background model candidates' })
    return {}
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    finishSkillRun({ id: runId, status: 'failed', error })
    logger.warn('evolution.skill.failed', {
      runId,
      skillName: params.skillName,
      trigger: params.packet.trigger,
      error,
    })
    return {}
  }
}
