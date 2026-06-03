'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Brain, Database, GitBranch, Layers3, Loader2, Play, RefreshCw, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'

interface MemoryFile {
  name: string
  path: string
  kind: string
  content: string
  exists: boolean
}

interface MemoryCandidate {
  id: string
  type: string
  confidence: string
  status: string
  content: string
  evidence?: string
  target?: string
  evolutionStage?: string
  path: string
}

interface MemoryData {
  rootDir: string
  claudeFile: string
  initialized: boolean
  files: MemoryFile[]
  candidates: MemoryCandidate[]
}

interface MemoryJob {
  id: string
  sessionId: string
  reason: string
  status: string
  candidateCount: number
  error: string
  startedAt: string
  completedAt: string | null
}

interface ProjectRule {
  id: string
  title: string
  rule: string
  rationale: string
  scope: string
  priority: string
  impact: string
  risk: string
  status: string
  confidence: number
  strength: number
  occurrences: number
  appliedCount: number
  successCount: number
  conflictCount: number
  negativeEvidenceCount: number
  staleScore: number
  needsUserConfirmation: boolean
  userConfirmed: boolean
  updatedAt: string
}

interface SessionObservation {
  id: string
  observationKey: string
  category: string
  content: string
  confidence: number
  status: string
  evidenceIds: string[]
  sourceTrigger: string
  createdAt: string
}

interface SemanticMemory {
  id: string
  title: string
  content: string
  category: string
  status: string
  confidence: number
  strength: number
  occurrences: number
  evidenceIds: string[]
  staleScore: number
  updatedAt: string
}

interface ProjectDossier {
  id: string
  version: number
  summary: string
  stableRules: string
  recentRisks: string
  repeatedIssues: string
  deprecatedUnderstanding: string
  updatedAt: string
}

interface EvolutionData {
  overview: {
    needsReview: number
    activeRules: number
    semanticMemories: number
    recentObservations: number
  }
  rules: ProjectRule[]
  observations: SessionObservation[]
  semanticMemories: SemanticMemory[]
  dossier: ProjectDossier | null
}

interface MemoryPanelProps {
  projectId: string
  workspacePath: string
}

export function MemoryPanel({ projectId, workspacePath }: MemoryPanelProps) {
  const [memory, setMemory] = useState<MemoryData | null>(null)
  const [evolution, setEvolution] = useState<EvolutionData | null>(null)
  const [latestMemoryJob, setLatestMemoryJob] = useState<MemoryJob | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewInput, setPreviewInput] = useState('这个项目当前最重要的记忆是什么？')
  const [promptPreview, setPromptPreview] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [auditing, setAuditing] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null)
  const [busyRuleId, setBusyRuleId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const pendingCandidates = useMemo(() => memory?.candidates.filter(c => c.status === 'pending') || [], [memory])
  const needsReviewRules = useMemo(() => evolution?.rules.filter(r => r.status === 'candidate' || r.needsUserConfirmation) || [], [evolution])
  const semanticMemories = useMemo(() => evolution?.semanticMemories.filter(m => m.status === 'active' || m.status === 'stale') || [], [evolution])
  const recentObservations = useMemo(() => evolution?.observations.filter(o => o.status === 'active') || [], [evolution])

  const stopAutoRefresh = useCallback(() => {
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
  }, [])

  const load = useCallback(async (options: { silent?: boolean } = {}): Promise<MemoryJob | null> => {
    const silent = Boolean(options.silent)
    if (silent) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const [memoryRes, evolutionRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/memory`),
        fetch(`/api/projects/${projectId}/evolution`),
      ])
      const data = await memoryRes.json()
      const evolutionData = await evolutionRes.json()
      if (!memoryRes.ok) throw new Error(data.error || '加载项目记忆失败')
      if (!evolutionRes.ok) throw new Error(evolutionData.error || '加载进化状态失败')
      setMemory(data.memory)
      setEvolution(evolutionData)
      const latestJob = evolutionData.latestMemoryJob || data.latestMemoryJob || null
      setLatestMemoryJob(latestJob)
      return latestJob
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载项目记忆失败')
      return null
    } finally {
      if (silent) setRefreshing(false)
      else setLoading(false)
    }
  }, [projectId])

  useEffect(() => { load() }, [projectId])

  const startAutoRefresh = useCallback(() => {
    stopAutoRefresh()

    const startedAt = Date.now() - 3000
    let attempts = 0

    void load({ silent: true })

    refreshTimerRef.current = setInterval(() => {
      attempts += 1
      void load({ silent: true }).then(job => {
        const jobStartedAt = job?.startedAt ? Date.parse(job.startedAt) : 0
        const isRecentJob = jobStartedAt >= startedAt
        const isFinished = Boolean(job && job.status !== 'running')

        if (attempts >= 30 || (isRecentJob && isFinished)) {
          stopAutoRefresh()
        }
      })
    }, 2000)
  }, [load, stopAutoRefresh])

  useEffect(() => {
    const onMemoryRefreshRequested = () => {
      startAutoRefresh()
    }

    window.addEventListener('loom:memory-refresh-requested', onMemoryRefreshRequested)
    return () => {
      window.removeEventListener('loom:memory-refresh-requested', onMemoryRefreshRequested)
      stopAutoRefresh()
    }
  }, [startAutoRefresh, stopAutoRefresh])

  const initialize = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initialize: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '初始化失败')
      setMemory(data.memory)
      setLatestMemoryJob(data.latestMemoryJob || null)
      void load({ silent: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '初始化失败')
    } finally {
      setSaving(false)
    }
  }

  const previewPrompt = async () => {
    setPreviewLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/runtime/prompt-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: previewInput, workspacePath }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '生成预览失败')
      setPromptPreview(data.renderedMemory || '当前没有可注入的 memory。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成预览失败')
    } finally {
      setPreviewLoading(false)
    }
  }

  const runAudit = async () => {
    setAuditing(true)
    setError(null)
    setStatusMessage(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/evolution`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '进化审计失败')
      setStatusMessage('项目进化审计已完成')
      await load({ silent: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '进化审计失败')
    } finally {
      setAuditing(false)
    }
  }

  const updateCandidate = async (candidate: MemoryCandidate, action: 'approve' | 'reject') => {
    setError(null)
    setStatusMessage(null)
    setBusyCandidateId(candidate.id)
    try {
      const res = await fetch(`/api/memory/candidates/${candidate.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, scope: 'project', workspacePath }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '更新候选记忆失败')
      setStatusMessage(action === 'approve'
        ? `已确认，并写入 ${data.targetFile || 'topic 文件'}`
        : '已忽略候选记忆')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新候选记忆失败')
    } finally {
      setBusyCandidateId(null)
    }
  }

  const updateRule = async (rule: ProjectRule, action: 'activate' | 'shadow' | 'pause' | 'deprecate') => {
    setError(null)
    setStatusMessage(null)
    setBusyRuleId(rule.id)
    try {
      const res = await fetch(`/api/projects/${projectId}/evolution/rules/${rule.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '更新项目规则失败')
      setStatusMessage(formatRuleActionStatus(action))
      await load({ silent: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新项目规则失败')
    } finally {
      setBusyRuleId(null)
    }
  }

  const startEdit = (candidate: MemoryCandidate) => {
    setEditingId(candidate.id)
    setEditContent(candidate.content)
  }

  const saveCandidate = async (candidate: MemoryCandidate) => {
    setError(null)
    setStatusMessage(null)
    setBusyCandidateId(candidate.id)
    try {
      const res = await fetch(`/api/memory/candidates/${candidate.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'project',
          workspacePath,
          type: candidate.type,
          confidence: candidate.confidence,
          content: editContent,
          evidence: candidate.evidence,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '保存候选记忆失败')
      setEditingId(null)
      setEditContent('')
      setStatusMessage('候选记忆已保存，尚未写入正式记忆')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存候选记忆失败')
    } finally {
      setBusyCandidateId(null)
    }
  }

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={16} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', overflow: 'auto', paddingRight: 2 }}>
      {error && (
        <div style={{
          fontSize: 11, lineHeight: 1.5, color: 'var(--color-accent-danger)',
          background: 'rgba(232,90,79,0.08)', border: '1px solid rgba(232,90,79,0.18)',
          borderRadius: 10, padding: 10,
        }}>
          {error}
        </div>
      )}

      {statusMessage && (
        <div style={{
          fontSize: 11, lineHeight: 1.5, color: 'var(--color-accent-success)',
          background: 'rgba(46,160,91,0.08)', border: '1px solid rgba(46,160,91,0.18)',
          borderRadius: 10, padding: 10,
        }}>
          {statusMessage}
        </div>
      )}

      <section style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <GitBranch size={15} style={{ color: 'var(--color-accent-primary)' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)' }}>Evolution Center</div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>自动记忆、规则试运行和项目进化</div>
          </div>
          <button onClick={() => { void load() }} title="刷新" style={iconButtonStyle}>
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : undefined} />
          </button>
        </div>

        {!memory?.initialized && (
          <button onClick={initialize} disabled={saving} style={primaryButtonStyle}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            初始化项目记忆
          </button>
        )}
      </section>

      <section style={cardStyle}>
        <div style={sectionTitleStyle}>
          <Activity size={13} />
          自动进化
        </div>
        <div style={metricGridStyle}>
          <Metric label="需处理" value={evolution?.overview.needsReview || 0} tone={(evolution?.overview.needsReview || 0) > 0 ? 'warn' : 'normal'} />
          <Metric label="L2 规律" value={evolution?.overview.semanticMemories || 0} />
          <Metric label="L1 观察" value={evolution?.overview.recentObservations || 0} />
          <Metric label="Active 规则" value={evolution?.overview.activeRules || 0} />
        </div>
        {latestMemoryJob ? (
          <div style={compactInfoStyle}>
            {formatJobStatus(latestMemoryJob.status)} · {formatJobReason(latestMemoryJob.reason)} · 候选 {latestMemoryJob.candidateCount}
          </div>
        ) : (
          <div style={emptyStyle}>暂无进化任务。</div>
        )}
        <button onClick={runAudit} disabled={auditing} style={secondaryButtonStyle}>
          {auditing && <Loader2 size={12} className="animate-spin" />}
          刷新项目理解
        </button>
      </section>

      <section style={cardStyle}>
        <div style={sectionTitleStyle}>
          <Layers3 size={13} />
          L3 Project Dossier
          {evolution?.dossier && <span style={{ marginLeft: 'auto', color: 'var(--color-text-muted)' }}>v{evolution.dossier.version}</span>}
        </div>
        {evolution?.dossier ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <pre style={{ ...preStyle, maxHeight: 180 }}>{evolution.dossier.summary || '暂无稳定项目理解。'}</pre>
            {(evolution.dossier.recentRisks || evolution.dossier.deprecatedUnderstanding) && (
              <div style={compactInfoStyle}>
                {evolution.dossier.recentRisks && <div><strong>风险</strong><br />{evolution.dossier.recentRisks}</div>}
                {evolution.dossier.deprecatedUnderstanding && <div style={{ marginTop: 8 }}><strong>已废弃认知</strong><br />{evolution.dossier.deprecatedUnderstanding}</div>}
              </div>
            )}
          </div>
        ) : (
          <div style={emptyStyle}>还没有项目档案。</div>
        )}
      </section>

      <section style={cardStyle}>
        <div style={sectionTitleStyle}>
          <Brain size={13} />
          L2 Semantic Memories
          <span style={{ marginLeft: 'auto', color: 'var(--color-text-muted)' }}>{semanticMemories.length}</span>
        </div>
        {semanticMemories.length === 0 ? (
          <div style={emptyStyle}>暂无跨次稳定规律。重复观察会自动晋升到这里。</div>
        ) : semanticMemories.slice(0, 8).map(memory => (
          <SemanticMemoryCard key={memory.id} memory={memory} />
        ))}
      </section>

      <section style={cardStyle}>
        <div style={sectionTitleStyle}>
          <Activity size={13} />
          L1 Recent Observations
          <span style={{ marginLeft: 'auto', color: 'var(--color-text-muted)' }}>{recentObservations.length}</span>
        </div>
        {recentObservations.length === 0 ? (
          <div style={emptyStyle}>暂无近期观察。普通对话只记录有价值信号。</div>
        ) : recentObservations.slice(0, 6).map(observation => (
          <ObservationRow key={observation.id} observation={observation} />
        ))}
      </section>

      <section style={cardStyle}>
        <div style={sectionTitleStyle}>
          <ShieldCheck size={13} />
          需要处理
          <span style={{ marginLeft: 'auto', color: 'var(--color-text-muted)' }}>{needsReviewRules.length + pendingCandidates.length}</span>
        </div>
        {needsReviewRules.length === 0 && pendingCandidates.length === 0 ? (
          <div style={emptyStyle}>没有需要你处理的事项。</div>
        ) : (
          <>
            {needsReviewRules.map(rule => (
              <RuleCard
                key={rule.id}
                rule={rule}
                busy={busyRuleId === rule.id}
                primaryLabel="启用"
                primaryIcon={<Play size={11} />}
                onPrimary={() => updateRule(rule, 'activate')}
                secondary={[
                  { label: '继续观察', icon: <GitBranch size={11} />, onClick: () => updateRule(rule, 'shadow') },
                  { label: '废弃', icon: <Trash2 size={11} />, onClick: () => updateRule(rule, 'deprecate') },
                ]}
              />
            ))}
            {pendingCandidates.map(candidate => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                editing={editingId === candidate.id}
                editContent={editContent}
                busy={busyCandidateId === candidate.id}
                onEditContent={setEditContent}
                onSave={() => saveCandidate(candidate)}
                onCancel={() => setEditingId(null)}
                onApprove={() => updateCandidate(candidate, 'approve')}
                onEdit={() => startEdit(candidate)}
                onReject={() => updateCandidate(candidate, 'reject')}
              />
            ))}
          </>
        )}
      </section>

      <section style={cardStyle}>
        <div style={sectionTitleStyle}>注入预览</div>
        <textarea
          value={previewInput}
          onChange={e => setPreviewInput(e.target.value)}
          style={textareaStyle}
          rows={3}
        />
        <button onClick={previewPrompt} disabled={previewLoading} style={secondaryButtonStyle}>
          {previewLoading && <Loader2 size={12} className="animate-spin" />}
          查看 loom_context
        </button>
        {promptPreview && <pre style={{ ...preStyle, maxHeight: 260 }}>{promptPreview}</pre>}
      </section>
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 12,
  borderRadius: 12,
  background: 'var(--color-bg-surface)',
  border: '1px solid var(--color-border-subtle)',
}

const sectionTitleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--color-text-primary)',
}

const preStyle: React.CSSProperties = {
  margin: 0,
  maxHeight: 220,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: 10,
  lineHeight: 1.55,
  color: 'var(--color-text-secondary)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
}

const emptyStyle: React.CSSProperties = {
  fontSize: 11,
  lineHeight: 1.55,
  color: 'var(--color-text-muted)',
}

const metricGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 6,
}

const metricStyle: React.CSSProperties = {
  minHeight: 48,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: 3,
  borderRadius: 9,
  border: '1px solid var(--color-border-subtle)',
  background: 'var(--theme-bg-surface)',
  padding: '7px 8px',
}

const compactInfoStyle: React.CSSProperties = {
  fontSize: 11,
  lineHeight: 1.45,
  color: 'var(--color-text-secondary)',
  background: 'var(--theme-bg-surface)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 9,
  padding: 9,
}

const logItemStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  padding: '7px 8px',
  borderRadius: 8,
  background: 'var(--theme-bg-surface)',
  border: '1px solid var(--color-border-subtle)',
}

const iconButtonStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 8,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid var(--color-border-subtle)',
  background: 'transparent',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
}

const primaryButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '8px 10px',
  borderRadius: 9,
  border: 'none',
  background: 'var(--color-accent-primary)',
  color: '#fff',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
}

const secondaryButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '7px 10px',
  borderRadius: 9,
  border: '1px solid var(--color-border-subtle)',
  background: 'var(--theme-bg-surface)',
  color: 'var(--color-text-secondary)',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
}

const textareaStyle: React.CSSProperties = {
  resize: 'vertical',
  minHeight: 64,
  borderRadius: 10,
  border: '1px solid var(--color-border-subtle)',
  background: 'var(--color-bg-input)',
  color: 'var(--color-text-primary)',
  outline: 'none',
  padding: 9,
  fontSize: 12,
  lineHeight: 1.5,
}

const miniPrimaryButtonStyle: React.CSSProperties = {
  padding: '5px 9px',
  borderRadius: 7,
  border: 'none',
  background: 'var(--color-accent-primary)',
  color: '#fff',
  fontSize: 10,
  fontWeight: 700,
  cursor: 'pointer',
}

const miniGhostButtonStyle: React.CSSProperties = {
  padding: '5px 9px',
  borderRadius: 7,
  border: '1px solid var(--color-border-subtle)',
  background: 'transparent',
  color: 'var(--color-text-muted)',
  fontSize: 10,
  fontWeight: 700,
  cursor: 'pointer',
}

function Metric({ label, value, tone = 'normal' }: { label: string; value: number; tone?: 'normal' | 'warn' }) {
  return (
    <div style={metricStyle}>
      <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{label}</span>
      <span style={{
        fontSize: 18,
        lineHeight: 1,
        fontWeight: 750,
        color: tone === 'warn' ? 'var(--color-accent-primary)' : 'var(--color-text-primary)',
      }}>
        {value}
      </span>
    </div>
  )
}

function RuleCard({
  rule,
  busy,
  primaryLabel,
  primaryIcon,
  onPrimary,
  secondary,
}: {
  rule: ProjectRule
  busy: boolean
  primaryLabel: string
  primaryIcon: React.ReactNode
  onPrimary: () => void
  secondary: Array<{ label: string; icon: React.ReactNode; onClick: () => void }>
}) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      padding: 9,
      borderRadius: 10,
      background: 'var(--theme-bg-surface)',
      border: '1px solid var(--color-border-subtle)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          fontSize: 10,
          fontWeight: 800,
          color: rule.status === 'active' ? 'var(--color-accent-success)' : 'var(--color-accent-primary)',
          textTransform: 'uppercase',
        }}>
          {rule.status}
        </span>
        <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
          {rule.priority} · {rule.scope}
        </span>
      </div>
      <div style={{ fontSize: 11, fontWeight: 750, color: 'var(--color-text-primary)', lineHeight: 1.35 }}>
        {rule.title}
      </div>
      <div style={{ fontSize: 11, lineHeight: 1.55, color: 'var(--color-text-secondary)' }}>
        {rule.rule}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 10, color: 'var(--color-text-muted)' }}>
        <span>strength {Math.round((rule.strength || 0) * 100)}%</span>
        <span>seen {rule.occurrences || 0}</span>
        {rule.staleScore > 0 && <span>stale {rule.staleScore}</span>}
        <span>applied {rule.appliedCount}</span>
        <span>success {rule.successCount}</span>
        <span>conflict {rule.conflictCount}</span>
        <span>{Math.round((rule.confidence || 0) * 100)}%</span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          onClick={onPrimary}
          disabled={busy}
          style={{ ...miniPrimaryButtonStyle, display: 'inline-flex', alignItems: 'center', gap: 4, opacity: busy ? 0.65 : 1 }}
        >
          {busy ? '处理中' : primaryIcon}
          {primaryLabel}
        </button>
        {secondary.map(action => (
          <button
            key={action.label}
            onClick={action.onClick}
            disabled={busy}
            style={{ ...miniGhostButtonStyle, display: 'inline-flex', alignItems: 'center', gap: 4, opacity: busy ? 0.65 : 1 }}
          >
            {action.icon}
            {action.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function SemanticMemoryCard({ memory }: { memory: SemanticMemory }) {
  return (
    <div style={logItemStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          fontSize: 10,
          fontWeight: 800,
          color: memory.status === 'stale' ? 'var(--color-accent-primary)' : 'var(--color-accent-success)',
          textTransform: 'uppercase',
        }}>
          {memory.status}
        </span>
        <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{memory.category}</span>
      </div>
      <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--color-text-secondary)' }}>
        {memory.content}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 10, color: 'var(--color-text-muted)' }}>
        <span>strength {Math.round(memory.strength * 100)}%</span>
        <span>confidence {Math.round(memory.confidence * 100)}%</span>
        <span>seen {memory.occurrences}</span>
        {memory.staleScore > 0 && <span>stale {memory.staleScore}</span>}
      </div>
    </div>
  )
}

function ObservationRow({ observation }: { observation: SessionObservation }) {
  return (
    <div style={logItemStyle}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Database size={11} style={{ color: 'var(--color-text-muted)' }} />
        <span style={{ fontSize: 10, fontWeight: 750, color: 'var(--color-text-primary)' }}>
          {observation.category}
        </span>
        <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
          {Math.round(observation.confidence * 100)}% · {observation.sourceTrigger || 'signal'}
        </span>
      </div>
      <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--color-text-secondary)' }}>
        {observation.content}
      </div>
    </div>
  )
}

function CandidateCard({
  candidate,
  editing,
  editContent,
  busy,
  onEditContent,
  onSave,
  onCancel,
  onApprove,
  onEdit,
  onReject,
}: {
  candidate: MemoryCandidate
  editing: boolean
  editContent: string
  busy: boolean
  onEditContent: (value: string) => void
  onSave: () => void
  onCancel: () => void
  onApprove: () => void
  onEdit: () => void
  onReject: () => void
}) {
  const isProjectRule = candidate.type === 'project_rule' || candidate.target === 'project_rule'
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      padding: 9,
      borderRadius: 10,
      background: 'var(--theme-bg-surface)',
      border: '1px solid var(--color-border-subtle)',
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-primary)' }}>
        {isProjectRule ? 'project rule' : candidate.type} · {candidate.confidence}
      </div>
      {editing ? (
        <textarea
          value={editContent}
          onChange={e => onEditContent(e.target.value)}
          rows={4}
          style={textareaStyle}
        />
      ) : (
        <div style={{ fontSize: 11, lineHeight: 1.55, color: 'var(--color-text-secondary)', marginTop: 5 }}>{candidate.content}</div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {editing ? (
          <>
            <button onClick={onSave} style={miniPrimaryButtonStyle}>保存</button>
            <button onClick={onCancel} style={miniGhostButtonStyle}>取消</button>
          </>
        ) : (
          <>
            <button
              onClick={onApprove}
              disabled={busy}
              style={{ ...miniPrimaryButtonStyle, opacity: busy ? 0.65 : 1 }}
            >
              {busy ? '处理中' : isProjectRule ? '启用为项目规则' : '确认'}
            </button>
            <button onClick={onEdit} style={miniGhostButtonStyle}>编辑</button>
            <button
              onClick={onReject}
              disabled={busy}
              style={{ ...miniGhostButtonStyle, opacity: busy ? 0.65 : 1 }}
            >
              忽略
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function formatJobStatus(status: string): string {
  if (status === 'running') return '提炼中'
  if (status === 'done') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'skipped') return '已跳过'
  return status
}

function formatJobReason(reason: string): string {
  if (reason === 'after_message') return '回复后自动提炼'
  if (reason === 'compact_flush') return '/compact 后提炼'
  if (reason === 'manual') return '手动提炼'
  return reason
}

function formatRuleActionStatus(action: string): string {
  if (action === 'activate') return '项目规则已启用'
  if (action === 'shadow') return '项目规则已继续观察'
  if (action === 'pause') return '项目规则已暂停'
  if (action === 'deprecate') return '项目规则已废弃'
  return '项目规则已更新'
}
