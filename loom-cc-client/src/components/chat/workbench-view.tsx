'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  ChevronDown, ChevronRight, X, Check, Copy, Shield, ShieldOff,
  ZapOff, Zap, Sparkles, Bot, Crown, Rabbit, Route, PenLine,
  Loader2, Download, ArrowUp, Square, Folder, Plus, GitBranch,
  Scissors, Eye, FileVideo,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import type { Project, Session, ThinkingMode, TaskInfo } from '@/shared/types'
import { useSessionChat } from '@/modules/sessions/use-session-chat'
import {
  UserMessage, AssistantMessage, SessionBoundaryDivider,
  formatModelShort, formatFileSize, SUPPORTED_EXTENSIONS, getChipConfig,
  PERMISSION_OPTIONS, THINKING_OPTIONS, MODEL_ICONS,
} from '@/components/chat/workbench-parts'
import { FilePreviewPanel, type PreviewFile } from '@/components/chat/file-preview-panel'
import { ImageGenToolbar, type ImageGenSettings } from '@/components/chat/image-gen-toolbar'
import { ImageJobCard, useImageJobPoller } from '@/components/chat/image-job-card'
import { IMAGE_STYLE_PRESETS, type ImageGenerationConfig } from '@/shared/config/image-generation-config'
import type { ImageGenHistoryItem } from '@/shared/image-generation/job-executor'
import type { ImageGenerationJob, StoredReferenceImage } from '@/shared/image-generation/job-store'
import { ClaudeCodeUsageStats } from '@/components/chat/claude-code-usage-stats'
import { CaptureWindowOverlay } from '@/components/capture/capture-window-overlay'
import { CaptureConfirmDialog } from '@/components/capture/capture-confirm-dialog'
import type { ModelCatalogEntry } from '@/shared/config/models'
import { mergeModelCatalog } from '@/shared/config/model-catalog'
import {
  CONTEXT_WINDOW_FALLBACK_SETTING_KEY,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  formatContextWindowTokens,
  parseContextWindowFallback,
  resolveContextWindowTokens,
} from '@/shared/config/context-window'

/* ── Types ── */

interface SlashCmd {
  name: string
  args: string
  desc: string
  client: boolean
  dynamic?: boolean
  badge?: 'Skill' | 'Agent'
  skillSource?: 'builtin' | 'project' | 'global'
}

type CommandPanel =
  | { type: 'skills'; skills: { name: string; desc: string; source: 'builtin' | 'project' | 'global' }[] }
  | { type: 'agents'; running: { id: string; task: string }[]; library: { name: string; desc: string; source: string }[] }
  | { type: 'hooks'; events: { event: string; groups: { matcher: string; commands: string[] }[]; source: 'project' | 'global' }[] }
  | { type: 'mcp'; servers: { name: string; scope: string; transport: string; addr: string; overriddenBy?: string }[] }
  | { type: 'cost'; rows: { label: string; value: string; dim?: boolean }[] }
  | { type: 'help'; commands: SlashCmd[] }

type Attachment = {
  num: number
  name: string
  filename: string
  originalFilename?: string
  displayFilename?: string
  displayMimeType?: string
  readable?: boolean
  extractError?: string
  mimeType: string
  tier: string
  isImage: boolean
  size: number
}

type RuntimeAttachmentPayload = {
  name: string
  filename: string
  mimeType: string
  tier: string
  originalFilename?: string
  displayFilename?: string
  displayMimeType?: string
  readable?: boolean
  extractError?: string
  placeholder?: string
}

type ProviderConfigBrief = {
  id: string
  fastModel?: string
  mainModel?: string
  heavyModel?: string
  fastContextWindowTokens?: number
  mainContextWindowTokens?: number
  heavyContextWindowTokens?: number
}

type WorkbenchModelEntry = { id: string; label: string; tier: 'fast' | 'main' | 'heavy'; actualModel?: string; contextWindowTokens?: number }

type PromptPreviewPart = {
  key: string
  label: string
  chars?: number
  count?: number
  truncated?: boolean
  metadata?: Record<string, unknown>
}

type PromptPreviewData = {
  promptChars: number
  preview?: {
    resumeSession: boolean
    parts: PromptPreviewPart[]
  }
  memoryContext?: {
    debug?: {
      injectedChars?: number
      budgetChars?: number
      retrievedCount?: number
      truncated?: boolean
    }
  }
}

type SkillConfigEntry = {
  name: string
  description: string
  source: 'builtin' | 'project' | 'global'
  content?: string
  raw?: string
}

type AgentConfigEntry = {
  name: string
  description: string
  source: string
}

type PendingAttachment = {
  id: string
  name: string
  size: number
  progress: number
}

function buildDynamicSkillCommand(skill: SkillConfigEntry, skillName: string): SlashCmd {
  return {
    name: '/' + skillName.replace(/^\//, ''),
    args: '',
    desc: skill.description || 'Skill',
    client: false,
    dynamic: true,
    badge: 'Skill',
    skillSource: skill.source,
  }
}

const configCache = new Map<string, { at: number; data: unknown }>()
const CONFIG_CACHE_TTL = 30_000
let lastSeenSkillsChangedAt = ''

async function fetchConfigJson<T>(url: string): Promise<T> {
  if (url.startsWith('/api/config/skills')) {
    const changedAt = typeof window !== 'undefined'
      ? window.localStorage.getItem('loom:skills-changed-at') || ''
      : ''
    if (changedAt !== lastSeenSkillsChangedAt) {
      for (const key of Array.from(configCache.keys())) {
        if (key.startsWith('/api/config/skills')) configCache.delete(key)
      }
      lastSeenSkillsChangedAt = changedAt
    }
  }
  const cached = configCache.get(url)
  if (cached && Date.now() - cached.at < CONFIG_CACHE_TTL) return cached.data as T
  const res = await fetch(url)
  const data = await res.json()
  configCache.set(url, { at: Date.now(), data })
  return data as T
}

async function loadSkillSummaryEntry(workspacePath: string | null | undefined, skillName: string): Promise<SkillConfigEntry | null> {
  const params = new URLSearchParams()
  if (workspacePath) params.set('workspacePath', workspacePath)
  params.set('summary', '1')
  params.set('skill', skillName.replace(/^\//, ''))
  const url = `/api/config/skills?${params.toString()}`
  const data = await fetchConfigJson<{ skills?: SkillConfigEntry[] }>(url)
  const normalized = skillName.replace(/^\//, '')
  return data.skills?.find(s => s.name === normalized) ?? null
}

const LARGE_ATTACHMENT_WARN_BYTES = 5 * 1024 * 1024
const HUGE_ATTACHMENT_BLOCK_BYTES = 20 * 1024 * 1024

function basename(filePath: string | null | undefined): string {
  if (!filePath) return 'Loom Chat'
  return filePath.split(/[\\/]/).filter(Boolean).pop() || filePath
}

function parseMcpScopeArg(parts: string[]): { scope: 'local' | 'project' | 'user'; rest: string[]; error?: string } {
  const rest = [...parts]
  let scope: 'local' | 'project' | 'user' = 'local'
  const idx = rest.indexOf('--scope')
  if (idx >= 0) {
    const value = rest[idx + 1]
    if (value !== 'local' && value !== 'project' && value !== 'user') {
      return { scope, rest, error: '--scope 必须是 local / project / user' }
    }
    scope = value
    rest.splice(idx, 2)
  }
  return { scope, rest }
}

const LOGICAL_MODELS: WorkbenchModelEntry[] = [
  { id: 'claude-haiku-4-5', label: '快速', tier: 'fast' },
  { id: 'claude-sonnet-4-6', label: '主力', tier: 'main' },
  { id: 'claude-opus-4-6', label: '强力', tier: 'heavy' },
]

function buildLogicalModelOptions(config?: ProviderConfigBrief, catalog: ModelCatalogEntry[] = []): WorkbenchModelEntry[] {
  return LOGICAL_MODELS.map(model => {
    const actualModel = model.tier === 'fast'
      ? config?.fastModel
      : model.tier === 'heavy'
        ? config?.heavyModel
        : config?.mainModel
    const catalogEntry = catalog.find(entry => entry.id === actualModel)
    return {
      ...model,
      actualModel: actualModel?.trim() || undefined,
      contextWindowTokens: catalogEntry?.contextWindowTokens,
    }
  })
}

function normalizeStoredModel(modelId: string | null | undefined, config?: ProviderConfigBrief): string {
  if (!modelId) return 'claude-sonnet-4-6'
  if (LOGICAL_MODELS.some(m => m.id === modelId)) return modelId
  if (config?.fastModel && modelId === config.fastModel) return 'claude-haiku-4-5'
  if (config?.heavyModel && modelId === config.heavyModel) return 'claude-opus-4-6'
  return 'claude-sonnet-4-6'
}

function attachmentPlaceholder(att: Attachment) {
  if (att.isImage) return `[Image #${att.num}]`
  if (att.tier === 'text' && (att.displayMimeType === 'application/pdf' || att.name.toLowerCase().endsWith('.pdf'))) return `[PDF Text #${att.num}]`
  if (att.tier === 'pdf' || att.displayMimeType === 'application/pdf' || att.name.toLowerCase().endsWith('.pdf')) return `[PDF #${att.num}]`
  if (att.mimeType === 'video/mp4' || att.name.toLowerCase().endsWith('.mp4')) return `[Video #${att.num}]`
  return `[File #${att.num}]`
}

function attachmentReadableLabel(att: Attachment): string {
  if (att.isImage) return 'Image'
  if (att.tier === 'text' && (att.displayMimeType === 'application/pdf' || att.name.toLowerCase().endsWith('.pdf'))) return 'PDF Text'
  if (att.tier === 'pdf' || att.displayMimeType === 'application/pdf' || att.name.toLowerCase().endsWith('.pdf')) return att.readable === false ? 'PDF Unreadable' : 'PDF'
  if (att.mimeType === 'video/mp4' || att.name.toLowerCase().endsWith('.mp4')) return 'Video'
  return getChipConfig(att.name, att.tier).typeLabel
}

function filenameFromServedFileUrl(url: string): string {
  const match = url.match(/\/api\/files\/(?:serve|upload)\/([^/?#]+)/)
  if (match?.[1]) return decodeURIComponent(match[1])
  return url.split('/').pop()?.split(/[?#]/)[0] || 'image.png'
}

function timestampMs(value?: string | null): number {
  const ms = Date.parse(value || '')
  return Number.isFinite(ms) ? ms : 0
}

function CompactIcon({ size = 14, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12h18" />
      <path d="M7 3l5 5 5-5" />
      <path d="M7 21l5-5 5 5" />
    </svg>
  )
}

/* ── Slash Commands ── */

const SLASH_COMMANDS: SlashCmd[] = [
  { name: '/agents',  args: '',                  desc: '查看可用 Sub-Agent 列表',            client: true  },
  { name: '/clear',   args: '',                  desc: '清空当前会话消息',                   client: true  },
  { name: '/compact', args: '',                  desc: '压缩会话历史以节省 context',         client: true  },
  { name: '/cost',    args: '',                  desc: '查看当前会话 Token 用量',            client: true  },
  { name: '/export',  args: '',                  desc: '导出会话为 Markdown',                client: false },
  { name: '/help',    args: '',                  desc: '查看可用命令列表',                   client: true  },
  { name: '/hooks',   args: '',                  desc: '管理 Claude Code Hooks 配置',        client: true  },
  { name: '/init',    args: '',                  desc: '初始化工作区 .claude/ 配置文件',     client: true  },
  { name: '/mcp',     args: 'list|add --scope …', desc: '管理 Claude MCP 服务器',             client: true  },
  { name: '/model',   args: '[name]',            desc: '切换模型',                           client: true  },
  { name: '/rename',  args: '<title>',           desc: '重命名当前会话',                     client: true  },
  { name: '/skills',  args: '',                  desc: '查看可用 Skills 技能列表',           client: true  },
  { name: '/stop',    args: '',                  desc: '停止当前 Agent 执行',               client: true  },
]

/* ── Image Gen Job Entry (uses polling hook internally) ── */
type ImageGenReference = ImageGenSettings['referenceImages'][number]

type ImageGenJobEntryState = {
  id: string
  prompt: string
  jobId: string
  startedAt: string
  aspectRatioId: string
  styleId: string
  referenceImages: ImageGenReference[]
}

function imageStyleLabel(styleId: string) {
  return IMAGE_STYLE_PRESETS.find(style => style.id === styleId)?.label ?? styleId
}

function ImageGenUserPrompt({
  prompt,
  aspectRatioId,
  styleId,
  referenceImages,
}: {
  prompt: string
  aspectRatioId: string
  styleId: string
  referenceImages: StoredReferenceImage[]
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
      <div style={{
        maxWidth: '80%',
        padding: referenceImages.length > 0 ? 8 : '10px 14px',
        borderRadius: 12,
        background: 'rgba(59,130,246,0.1)',
        border: '1px solid rgba(59,130,246,0.2)',
        color: 'var(--color-text-primary)',
      }}>
        {referenceImages.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {referenceImages.map((img, idx) => (
              <img
                key={`${img.serverFilename || img.url}-${idx}`}
                src={img.url}
                alt={img.name}
                style={{
                  width: 86,
                  height: 86,
                  objectFit: 'cover',
                  borderRadius: 8,
                  border: '1px solid var(--theme-border)',
                  background: 'var(--theme-bg-raised)',
                }}
              />
            ))}
          </div>
        )}
        <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {prompt}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>
          比例：{aspectRatioId} · 风格：{imageStyleLabel(styleId)}
        </div>
      </div>
    </div>
  )
}

function ImageGenJobEntry({
  prompt,
  jobId,
  aspectRatioId,
  styleId,
  referenceImages,
  onRetry,
  onEditFromImage,
}: {
  prompt: string
  jobId: string
  aspectRatioId: string
  styleId: string
  referenceImages: ImageGenReference[]
  onRetry?: () => void
  onEditFromImage?: (url: string) => void
}) {
  const job = useImageJobPoller(jobId || null)
  const displayedReferenceImages = (job?.referenceImages?.length ? job.referenceImages : referenceImages) as StoredReferenceImage[]
  const displayedAspectRatio = job?.aspectRatio ?? aspectRatioId
  const displayedStyleId = job?.styleId ?? styleId

  return (
    <div style={{ marginBottom: 28 }}>
      <ImageGenUserPrompt
        prompt={prompt}
        aspectRatioId={displayedAspectRatio}
        styleId={displayedStyleId}
        referenceImages={displayedReferenceImages}
      />
      {/* Job status card */}
      {jobId ? (
        job ? (
          <>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>
              {job.status === 'success' ? '已完成生成，共返回 1 张图片。' : job.status === 'error' ? '' : '正在生成图像，请保持页面开启。'}
            </p>
            <ImageJobCard
              job={job}
              onRetry={onRetry}
              onEditFromImage={onEditFromImage}
            />
          </>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>正在连接...</p>
        )
      ) : (
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>正在提交请求...</p>
      )}
    </div>
  )
}

/* ── Main Component ── */

interface WorkbenchViewProps {
  project: Project
  session: Session | null
  onNewSession: () => void
  projectName?: string
  onPreviewChange?: (open: boolean) => void
  onTasksChange?: (tasks: Map<string, import('@/shared/types').TaskInfo>) => void
  onModelChange?: (model: string) => void
  workspacePath?: string | null
  attachedFolderPaths?: string[]
  recentWorkspacePaths?: string[]
  workspaceBranch?: string | null
  useWorktree?: boolean
  workspaceRequired?: boolean
  workspaceIsDefault?: boolean
  emptyMode?: 'project' | 'chat'
  onChooseWorkspace?: (path?: string) => void
  onAddAttachedFolder?: () => void
  onToggleWorktree?: (enabled: boolean) => void
  pendingAutoSend?: {
    sessionId: string; displayPrompt: string; effectivePrompt: string; execUpdateUrl?: string
    permissionMode?: string; thinkingMode?: string; planMode?: boolean
    agentName?: string
    enabledSkills?: string[]
    attachments?: RuntimeAttachmentPayload[]
  } | null
  onPendingAutoSendConsumed?: () => void
  sessionDraft?: { workspacePath: string | null; attachedFolderPaths: string[]; useWorktree: boolean } | null
  onCreateAndSend?: (params: {
    message: string; permissionMode: string; thinkingMode: string; planMode: boolean
    effectiveMessage?: string
    enabledSkills?: string[]
    attachments?: RuntimeAttachmentPayload[]
  }) => void
  onCreateImageSession?: () => Promise<Session | null>
  hideWorkspaceBar?: boolean
}

export function WorkbenchView({ project, session, onNewSession, projectName, onPreviewChange, onTasksChange, onModelChange, workspacePath, attachedFolderPaths = [], recentWorkspacePaths = [], workspaceBranch, useWorktree = false, workspaceRequired = false, workspaceIsDefault = false, emptyMode = 'project', onChooseWorkspace, onAddAttachedFolder, onToggleWorktree, pendingAutoSend, onPendingAutoSendConsumed, sessionDraft, onCreateAndSend, onCreateImageSession, hideWorkspaceBar = false }: WorkbenchViewProps) {
  const {
    groups, messages, streaming, isThinking, error,
    isCompacting, compactingText, tasks, memoryNotice,
    sendMessage, loadMessages, stopStreaming, streamPending,
    compact, clearMessages, sendPermissionDecision, sendAskUserQuestionResponse,
  } = useSessionChat(session?.id ?? null)

  const [input, setInput] = useState('')
  const [permissionMode, setPermissionMode] = useState('confirm')
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>('auto')
  const [planMode, setPlanMode] = useState(false)
  const [selectedModel, setSelectedModel] = useState(
    session?.model || project.defaultModel || 'claude-sonnet-4-6'
  )
  const [activeProviderId, setActiveProviderId] = useState<string>('anthropic')
  const [activeProviderConfig, setActiveProviderConfig] = useState<ProviderConfigBrief | undefined>(undefined)
  const [availableModels, setAvailableModels] = useState<WorkbenchModelEntry[]>(
    LOGICAL_MODELS
  )
  const [contextWindowFallback, setContextWindowFallback] = useState(DEFAULT_CONTEXT_WINDOW_TOKENS)

  const [permOpen, setPermOpen] = useState(false)
  const [thinkOpen, setThinkOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)

  const [pickerIdx, setPickerIdx] = useState(0)
  const [dynamicCmds, setDynamicCmds] = useState<SlashCmd[]>([])
  const [commandPanel, setCommandPanel] = useState<CommandPanel | null>(null)
  const [notification, setNotification] = useState<string | null>(null)
  const [showMemoryDebug, setShowMemoryDebug] = useState(false)
  const [attachmentOverrideSignature, setAttachmentOverrideSignature] = useState<string | null>(null)
  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false)
  const [promptPreviewLoading, setPromptPreviewLoading] = useState(false)
  const [promptPreviewData, setPromptPreviewData] = useState<PromptPreviewData | null>(null)
  const notifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contextThresholdLoggedRef = useRef<string | null>(null)

  // Scheduled task entry shown in the Tasks tab for manually-triggered scheduled tasks
  const [scheduledTaskEntry, setScheduledTaskEntry] = useState<TaskInfo | null>(null)

  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const attachNumRef = useRef(0)

  // Image generation mode
  const [imageGenMode, setImageGenMode] = useState(false)
  const [imageGenConfig, setImageGenConfig] = useState<ImageGenerationConfig | null>(null)
  const [imageGenSettings, setImageGenSettings] = useState<ImageGenSettings>({
    providerId: '',
    aspectRatioId: '1:1',
    styleId: 'none',
    referenceImages: [],
  })
  const [imageGenJobs, setImageGenJobs] = useState<ImageGenJobEntryState[]>([])
  const [imageGenSubmitting, setImageGenSubmitting] = useState(false)
  const imageGenJobIdxRef = useRef(0)

  // Refs for always-fresh values inside handleSend (avoids stale closure)
  const imageGenModeRef = useRef(false)
  const imageGenConfigRef = useRef<ImageGenerationConfig | null>(null)
  const imageGenSettingsRef = useRef<ImageGenSettings>({ providerId: '', aspectRatioId: '1:1', styleId: 'none', referenceImages: [] })
  const imageGenJobsRef = useRef<ImageGenJobEntryState[]>([])

  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)

  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null)
  const [windowCaptureOpen, setWindowCaptureOpen] = useState(false)
  const [capturePreviewDataUrl, setCapturePreviewDataUrl] = useState<string | null>(null)
  // Keep refs in sync with latest state (render body — always current, no useEffect lag)
  imageGenModeRef.current = imageGenMode
  imageGenConfigRef.current = imageGenConfig
  imageGenSettingsRef.current = imageGenSettings
  imageGenJobsRef.current = imageGenJobs

  const effectiveWorkspacePath = workspacePath ?? session?.workspacePath ?? project.workspacePath
  const missingWorkspace = workspaceRequired && !effectiveWorkspacePath
  const canCreateFromEmptyProject = emptyMode === 'project' && !session && !sessionDraft && Boolean(onCreateAndSend)
  const canCompose = Boolean(session || sessionDraft || canCreateFromEmptyProject)

  const permRef = useRef<HTMLDivElement>(null)
  const thinkRef = useRef<HTMLDivElement>(null)
  const modelRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputHistoryIndexRef = useRef<number | null>(null)
  const inputHistoryDraftRef = useRef('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)
  const prevMessageCountRef = useRef(0)
  const prevSessionIdRef = useRef<string | null>(null)
  const pendingInitialScrollRef = useRef(false)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)

  // Load messages when session changes
  useEffect(() => {
    if (session?.id) loadMessages(session.id)
  }, [session?.id, loadMessages])

  useEffect(() => {
    inputHistoryIndexRef.current = null
    inputHistoryDraftRef.current = ''
  }, [session?.id])

  // Fetch image generation config
  useEffect(() => {
    fetch('/api/config/image-generation')
      .then(r => r.json())
      .then((cfg: ImageGenerationConfig) => {
        setImageGenConfig(cfg)
        if (cfg.enabled && cfg.configs.length > 0) {
          const active = cfg.configs.find(c => c.id === cfg.activeProviderId)
          setImageGenSettings(prev => ({
            ...prev,
            providerId: prev.providerId || cfg.activeProviderId,
          }))
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!session?.id) {
      setImageGenJobs([])
      return
    }

    let cancelled = false
    fetch(`/api/image-generation/jobs?sessionId=${encodeURIComponent(session.id)}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('failed to load image jobs')))
      .then((data: { jobs?: ImageGenerationJob[] }) => {
        if (cancelled) return
        setImageGenJobs((data.jobs ?? []).map(job => ({
          id: job.id,
          prompt: job.prompt,
          jobId: job.id,
          startedAt: job.startedAt,
          aspectRatioId: job.aspectRatio,
          styleId: job.styleId,
          referenceImages: job.referenceImages ?? [],
        })))
      })
      .catch(() => {
        if (!cancelled) setImageGenJobs([])
      })

    return () => { cancelled = true }
  }, [session?.id])

  useEffect(() => {
    fetch('/api/config/settings?key=memory_debug_visible')
      .then(r => r.json())
      .then(data => setShowMemoryDebug(data.value === 'true'))
      .catch(() => setShowMemoryDebug(false))
  }, [])

  // Fetch project's active provider and populate model list accordingly
  useEffect(() => {
    Promise.all([
      fetch('/api/config/provider').then(r => r.json()).catch(() => ({ active: 'anthropic' })),
      fetch(`/api/projects/${project.id}/settings`).then(r => r.json()).catch(() => ({ settings: null })),
      fetch('/api/config/models').then(r => r.json()).catch(() => ({ catalogs: {} })),
      fetch(`/api/config/settings?key=${CONTEXT_WINDOW_FALLBACK_SETTING_KEY}`).then(r => r.json()).catch(() => ({ value: null })),
    ]).then(([providerData, settingsData, modelData, fallbackData]) => {
      const globalActive = providerData.active ?? 'anthropic'
      const projectOverride = settingsData.settings?.providerId ?? null
      const effectiveId: string = projectOverride ?? globalActive
      const providerConfig = (providerData.configs as ProviderConfigBrief[] | undefined)?.find(c => c.id === effectiveId)
      const catalog = mergeModelCatalog(effectiveId, modelData.catalogs ?? {})
      setActiveProviderId(effectiveId)
      setActiveProviderConfig(providerConfig)
      setAvailableModels(buildLogicalModelOptions(providerConfig, catalog))
      setContextWindowFallback(parseContextWindowFallback(fallbackData.value))
    })
  }, [project.id])

  // Update selected model when session changes
  useEffect(() => {
    const sessionModel = normalizeStoredModel(session?.model || project.defaultModel, activeProviderConfig)
    setSelectedModel(sessionModel)
  }, [session?.model, project.defaultModel, activeProviderConfig])

  // When provider catalog loads, auto-correct selectedModel if project.defaultModel
  // is not in the current catalog (e.g. project was created with claude-sonnet-4-6
  // but the active provider is chatgpt).  Skip when an existing session already has
  // its own model — we don't want to silently change it.
  useEffect(() => {
    if (!availableModels.length) return
    const normalizedSessionModel = session?.model ? normalizeStoredModel(session.model, activeProviderConfig) : null
    const normalizedProjectModel = normalizeStoredModel(project.defaultModel, activeProviderConfig)
    const best = availableModels.find(m => m.id === (normalizedSessionModel || normalizedProjectModel))
      ?? availableModels.find(m => m.tier === 'main')
      ?? availableModels[0]
    if (selectedModel === best.id && project.defaultModel === best.id) return
    setSelectedModel(best.id)
    onModelChange?.(best.id)
    // Persist logical tier only. The concrete provider model ID is resolved from global Settings at runtime.
    fetch(`/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultModel: best.id }),
    }).catch(() => {})
    if (session?.id && session.model !== best.id) {
      fetch(`/api/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: best.id }),
      }).catch(() => {})
    }
  }, [availableModels, session?.id, session?.model, project.defaultModel, project.id, onModelChange, activeProviderConfig, selectedModel])

  const updateScrollAffordance = useCallback((container = messagesContainerRef.current) => {
    if (!container) return
    const { scrollTop, scrollHeight, clientHeight } = container
    const scrolledUp = scrollHeight - scrollTop - clientHeight > 80
    userScrolledUpRef.current = scrolledUp
    setShowScrollToBottom(prev => prev === scrolledUp ? prev : scrolledUp)
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    userScrolledUpRef.current = false
    setShowScrollToBottom(false)
    messagesEndRef.current?.scrollIntoView({ behavior })
    requestAnimationFrame(() => updateScrollAffordance())
  }, [updateScrollAffordance])

  // Follow output only while the user is already at the bottom.
  useEffect(() => {
    const currentSessionId = session?.id ?? null
    const isSessionChange = prevSessionIdRef.current !== currentSessionId
    const isNewMessage = messages.length > prevMessageCountRef.current && prevMessageCountRef.current > 0
    prevSessionIdRef.current = currentSessionId
    prevMessageCountRef.current = messages.length

    if (isSessionChange) {
      pendingInitialScrollRef.current = Boolean(currentSessionId)
      userScrolledUpRef.current = false
      setShowScrollToBottom(false)
      requestAnimationFrame(() => scrollToBottom('auto'))
      return
    }

    if (pendingInitialScrollRef.current && messages.length > 0) {
      pendingInitialScrollRef.current = false
      requestAnimationFrame(() => scrollToBottom('auto'))
      return
    }

    if (pendingInitialScrollRef.current && !currentSessionId) {
      pendingInitialScrollRef.current = false
    }

    if ((isNewMessage || streaming || isCompacting) && !userScrolledUpRef.current) {
      scrollToBottom(streaming || isCompacting ? 'auto' : 'smooth')
    }
  }, [session?.id, messages, streaming, isCompacting, scrollToBottom])

  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const handler = () => updateScrollAffordance(container)
    handler()
    container.addEventListener('scroll', handler, { passive: true })
    return () => container.removeEventListener('scroll', handler)
  }, [session?.id, updateScrollAffordance])

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 160) + 'px'
    }
  }, [input])

  useEffect(() => {
    if (input !== '') return
    inputHistoryIndexRef.current = null
    inputHistoryDraftRef.current = ''
  }, [input])

  // Notify parent when preview opens/closes
  useEffect(() => {
    onPreviewChange?.(previewFile !== null)
  }, [previewFile, onPreviewChange])

  // Bubble task state up to parent, merging in scheduled task entry if present
  useEffect(() => {
    if (!scheduledTaskEntry) {
      onTasksChange?.(tasks)
      return
    }
    const merged = new Map(tasks)
    merged.set(scheduledTaskEntry.id, scheduledTaskEntry)
    onTasksChange?.(merged)
  }, [tasks, scheduledTaskEntry, onTasksChange])

  // Load dynamic slash command metadata. Full skill bodies are fetched only when
  // a skill command is actually executed.
  useEffect(() => {
    const staticNames = new Set(SLASH_COMMANDS.map(c => c.name))
    const workspaceQuery = encodeURIComponent(effectiveWorkspacePath || '')
    let cancelled = false
    const load = () => {
      Promise.all([
        fetchConfigJson<{ skills?: SkillConfigEntry[] }>(`/api/config/skills?workspacePath=${workspaceQuery}&summary=1`).catch(() => ({ skills: [] })),
        fetchConfigJson<{ agents?: AgentConfigEntry[] }>(`/api/config/agents?workspacePath=${workspaceQuery}`).catch(() => ({ agents: [] })),
      ]).then(([skillsData, agentsData]) => {
        if (cancelled) return
        const cmds: SlashCmd[] = []
        for (const s of (skillsData.skills ?? [])) {
          const name = '/' + s.name.replace(/^\//, '')
          if (!staticNames.has(name)) cmds.push({
            name,
            args: '',
            desc: s.description || 'Skill',
            client: false,
            dynamic: true,
            badge: 'Skill',
            skillSource: s.source,
          })
        }
        for (const a of (agentsData.agents ?? [])) {
          const name = '/' + a.name.replace(/^\//, '')
          if (!staticNames.has(name)) cmds.push({ name, args: '', desc: a.description || 'Agent', client: false, dynamic: true, badge: 'Agent' })
        }
        cmds.sort((a, b) => a.name.localeCompare(b.name))
        setDynamicCmds(cmds)
      })
    }
    let idleId: number | null = null
    let timerId: number | null = null
    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(load, { timeout: 1200 })
    } else {
      timerId = window.setTimeout(load, 400)
    }
    const handleSkillsChanged = () => {
      for (const key of Array.from(configCache.keys())) {
        if (key.startsWith('/api/config/skills')) configCache.delete(key)
      }
      load()
    }
    window.addEventListener('loom:skills-changed', handleSkillsChanged)
    return () => {
      cancelled = true
      window.removeEventListener('loom:skills-changed', handleSkillsChanged)
      if (idleId !== null) window.cancelIdleCallback?.(idleId)
      if (timerId !== null) window.clearTimeout(timerId)
    }
  }, [effectiveWorkspacePath])

  // Close dropdowns on outside click
  useEffect(() => {
    if (!permOpen) return
    const h = (e: MouseEvent) => { if (permRef.current && !permRef.current.contains(e.target as Node)) setPermOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [permOpen])

  useEffect(() => {
    if (!thinkOpen) return
    const h = (e: MouseEvent) => { if (thinkRef.current && !thinkRef.current.contains(e.target as Node)) setThinkOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [thinkOpen])

  useEffect(() => {
    if (!modelOpen) return
    const h = (e: MouseEvent) => { if (modelRef.current && !modelRef.current.contains(e.target as Node)) setModelOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [modelOpen])

  useEffect(() => {
    if (!workspaceOpen) return
    const h = (e: MouseEvent) => { if (workspaceRef.current && !workspaceRef.current.contains(e.target as Node)) setWorkspaceOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [workspaceOpen])

  // Slash picker
  const allCmds = useMemo(() => [...SLASH_COMMANDS, ...dynamicCmds], [dynamicCmds])
  const slashMatch = /^\/(\S*)(?:\s|$)/.exec(input.trim())
  const slashQuery = slashMatch ? slashMatch[1].toLowerCase() : null
  const filteredCmds = slashQuery !== null ? allCmds.filter(c => c.name.slice(1).startsWith(slashQuery)) : []
  const showPicker = filteredCmds.length > 0
  useEffect(() => { setPickerIdx(0) }, [slashQuery])
  const selectedModelOption = availableModels.find(m => m.id === selectedModel)
  const messageRenderIndexById = useMemo(
    () => new Map(messages.map((message, index) => [message.id, index])),
    [messages],
  )
  const inputHistory = useMemo(() => {
    return messages
      .filter(message => message.role === 'user')
      .map(message => {
        const blockText = message.blocks
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('')
          .trim()
        return blockText || message.content.trim()
      })
      .filter(text => text.length > 0)
  }, [messages])

  // Context usage
  const lastGroup = groups[groups.length - 1]
  const activeMessages = lastGroup?.messages ?? messages
  const contextInputTokens = activeMessages.reduce((sum, message) => sum + (message.inputTokens || 0), 0)
  const contextOutputTokens = activeMessages.reduce((sum, message) => sum + (message.outputTokens || 0), 0)
  const contextUsed = contextInputTokens + contextOutputTokens
  const resolvedContextWindow = resolveContextWindowTokens({
    logicalModel: selectedModel,
    actualModel: selectedModelOption?.actualModel,
    providerConfig: activeProviderConfig,
    catalogContextWindowTokens: selectedModelOption?.contextWindowTokens,
    fallbackTokens: contextWindowFallback,
  })
  const contextMax = resolvedContextWindow.tokens
  const contextMaxLabel = formatContextWindowTokens(contextMax)
  const rawContextPct = contextUsed > 0 && contextMax > 0 ? (contextUsed / contextMax) * 100 : 0
  const boundedRawContextPct = Math.min(100, rawContextPct)
  const contextPctLabel = boundedRawContextPct > 0 && boundedRawContextPct < 0.1
    ? '<0.1%'
    : `${boundedRawContextPct < 10 ? boundedRawContextPct.toFixed(1) : Math.round(boundedRawContextPct)}%`
  const contextPct = rawContextPct > 0 ? Math.max(1, Math.min(100, Math.round(rawContextPct))) : 0
  const contextColor = contextPct >= 90 ? '#ef4444' : contextPct >= 75 ? '#f97316' : '#F59E0B'
  const contextLevel = contextPct >= 90 ? 'block' : contextPct >= 85 ? 'suggest' : contextPct >= 75 ? 'strong' : contextPct >= 60 ? 'soft' : 'normal'
  const contextUsageTitle = `当前上下文累计：${contextUsed.toLocaleString()} / ${contextMax.toLocaleString()} tokens（${contextPctLabel}，输入 ${contextInputTokens.toLocaleString()} / 输出 ${contextOutputTokens.toLocaleString()}；窗口模型 ${resolvedContextWindow.modelId || selectedModel}）`

  // Unified active mode: Plan overrides permissionMode
  const activeMode = planMode ? 'plan' : permissionMode

  const showNotification = useCallback((text: string) => {
    if (notifTimerRef.current) clearTimeout(notifTimerRef.current)
    setNotification(text)
    notifTimerRef.current = setTimeout(() => setNotification(null), 6000)
  }, [])

  useEffect(() => {
    setAttachmentOverrideSignature(null)
  }, [input, attachments])

  useEffect(() => {
    const contextVersion = lastGroup?.contextVersion ?? 0
    if (contextLevel === 'normal') {
      contextThresholdLoggedRef.current = null
      return
    }
    const key = `${session?.id || 'draft'}:${contextVersion}:${contextLevel}`
    if (contextThresholdLoggedRef.current === key) return
    contextThresholdLoggedRef.current = key
    fetch('/api/log/client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'context.threshold_crossed',
        contextLevel,
        contextPct,
        contextUsed,
        contextMax,
        contextWindowSource: resolvedContextWindow.source,
        contextWindowModel: resolvedContextWindow.modelId,
        contextVersion,
        sessionId: session?.id,
        projectId: project.id,
      }),
    }).catch(() => {})
  }, [contextLevel, contextPct, contextUsed, contextMax, resolvedContextWindow.source, resolvedContextWindow.modelId, lastGroup?.contextVersion, session?.id, project.id])

  // Attachment helpers
  const getPlaceholder = useCallback((att: Attachment) => {
    return attachmentPlaceholder(att)
  }, [])

  const openPromptPreview = useCallback(async () => {
    if (!canCompose || missingWorkspace) {
      showNotification('请先选择工作目录')
      return
    }
    const previewMessage = input.trim() || attachments.map(getPlaceholder).join(' ')
    setPromptPreviewOpen(true)
    setPromptPreviewLoading(true)
    try {
      const res = await fetch('/api/runtime/prompt-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: previewMessage,
          sessionId: session?.id,
          projectId: project.id,
          contextVersion: session?.contextVersion ?? 0,
          providerId: activeProviderId,
          model: selectedModel,
          resolvedModelId: selectedModelOption?.actualModel,
          workspacePath: effectiveWorkspacePath,
          attachedFolderPaths,
          existingMsgCount: activeMessages.length,
          resumeSession: Boolean(session && activeMessages.length > 0),
          attachmentCount: attachments.length,
          attachments: attachments.map(a => ({
            name: a.name,
            size: a.size,
            tier: a.tier,
            mimeType: a.mimeType,
            displayMimeType: a.displayMimeType,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '生成输入结构预览失败')
      setPromptPreviewData(data)
    } catch (err) {
      showNotification(err instanceof Error ? err.message : '生成输入结构预览失败')
      setPromptPreviewData(null)
    } finally {
      setPromptPreviewLoading(false)
    }
  }, [
    activeMessages.length,
    activeProviderId,
    attachments,
    attachedFolderPaths,
    canCompose,
    effectiveWorkspacePath,
    getPlaceholder,
    input,
    missingWorkspace,
    project.id,
    selectedModel,
    selectedModelOption?.actualModel,
    session,
    showNotification,
  ])

  const insertPlaceholder = useCallback((placeholder: string) => {
    const textarea = textareaRef.current
    if (!textarea) { setInput(prev => prev + (prev.endsWith(' ') || !prev ? '' : ' ') + placeholder); return }
    const start = textarea.selectionStart ?? input.length
    const end = textarea.selectionEnd ?? input.length
    const before = input.slice(0, start), after = input.slice(end)
    const sep = before && !before.endsWith(' ') ? ' ' : ''
    const newValue = before + sep + placeholder + (after && !after.startsWith(' ') ? ' ' : '') + after
    setInput(newValue)
    const cursor = before.length + sep.length + placeholder.length
    requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(cursor, cursor) })
  }, [input])

  const removeAttachment = useCallback((idx: number) => {
    setAttachments(prev => {
      const att = prev[idx]
      if (att) {
        const ph = getPlaceholder(att)
        setInput(text => text.replace(ph, '').replace(/  +/g, ' ').trim())
      }
      return prev.filter((_, i) => i !== idx)
    })
  }, [getPlaceholder])

  // File upload with XHR progress
  const handleFileUpload = useCallback((files: FileList | null) => {
    if (!files) return
    const rejected: string[] = []
    const tooLarge: string[] = []
    const largeFiles: string[] = []
    const validEntries: { uploadId: string; file: File }[] = []
    for (const file of Array.from(files)) {
      const ext = '.' + (file.name.split('.').pop()?.toLowerCase() || '')
      if (!SUPPORTED_EXTENSIONS.has(ext)) { rejected.push(file.name); continue }
      if (file.size > HUGE_ATTACHMENT_BLOCK_BYTES) { tooLarge.push(`${file.name} (${formatFileSize(file.size)})`); continue }
      if (file.size >= LARGE_ATTACHMENT_WARN_BYTES) largeFiles.push(`${file.name} (${formatFileSize(file.size)})`)
      validEntries.push({ uploadId: Math.random().toString(36).slice(2, 10), file })
    }
    if (rejected.length > 0) showNotification(`不支持的文件类型：${rejected.join('、')}`)
    if (tooLarge.length > 0) {
      showNotification(`文件超过 20MB，无法上传：${tooLarge.join('、')}。请压缩文件，或拆分后再上传。`)
      fetch('/api/log/client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'context.attachment_too_large_rejected',
          files: tooLarge,
          maxBytes: HUGE_ATTACHMENT_BLOCK_BYTES,
          projectId: project.id,
          sessionId: session?.id,
        }),
      }).catch(() => {})
    }
    if (largeFiles.length > 0) {
      showNotification(`大附件会明显增加上下文或上传耗时：${largeFiles.join('、')}`)
      fetch('/api/log/client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'context.attachment_large_added',
          files: largeFiles,
          projectId: project.id,
          sessionId: session?.id,
        }),
      }).catch(() => {})
    }
    if (validEntries.length === 0) return

    setPendingAttachments(prev => [...prev, ...validEntries.map(e => ({ id: e.uploadId, name: e.file.name, size: e.file.size, progress: 0 }))])

    const numberedEntries = validEntries.map(e => ({ ...e, num: ++attachNumRef.current }))
    for (const { uploadId, file, num } of numberedEntries) {
      const isImage = file.type.startsWith('image/')
      const ext = file.name.split('.').pop()?.toLowerCase() || ''
      const isVideo = file.type === 'video/mp4' || ext === 'mp4'
      const isPdf = file.type === 'application/pdf' || ext === 'pdf'
      const fallbackMimeType = isVideo ? 'video/mp4' : isPdf ? 'application/pdf' : file.type
      const fallbackTier = isImage ? 'image' : isPdf ? 'pdf' : isVideo ? 'binary' : 'text'
      const formData = new FormData()
      formData.append('file', file)
      const xhr = new XMLHttpRequest()
      xhr.upload.addEventListener('progress', e => {
        if (!e.lengthComputable) return
        const pct = Math.round((e.loaded / e.total) * 100)
        setPendingAttachments(prev => prev.map(p => p.id === uploadId ? { ...p, progress: pct } : p))
      })
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText) as {
              filename: string
              originalFilename?: string
              displayFilename?: string
              displayMimeType?: string
              readable?: boolean
              extractError?: string
              message?: string
              mimeType?: string
              tier?: string
              isImage?: boolean
              size?: number
            }
            const resolvedMimeType = data.mimeType || fallbackMimeType || 'application/octet-stream'
            const resolvedTier = data.tier || fallbackTier
            const resolvedIsImage = data.isImage ?? isImage
            const newAtt: Attachment = {
              num, name: file.name, filename: data.filename,
              originalFilename: data.originalFilename,
              displayFilename: data.displayFilename,
              displayMimeType: data.displayMimeType,
              readable: data.readable,
              extractError: data.extractError,
              mimeType: resolvedMimeType, tier: resolvedTier, isImage: resolvedIsImage, size: data.size ?? file.size,
            }
            setAttachments(prev => [...prev, newAtt])
            if (data.readable === false) {
              showNotification(data.message || `${file.name} 未能提取可读文字，当前不能作为聊天上下文发送。`)
            } else {
              const placeholder = attachmentPlaceholder(newAtt)
              setInput(prev => { const sep = prev && !prev.endsWith(' ') ? ' ' : ''; return prev + sep + placeholder })
            }
          } catch { /* ignore */ }
        } else {
          let msg = `文件上传失败：${file.name}`
          try {
            const data = JSON.parse(xhr.responseText)
            if (data?.error) msg = `${data.error}（${file.name}）`
          } catch { /* keep default */ }
          showNotification(msg)
        }
        setPendingAttachments(prev => prev.filter(p => p.id !== uploadId))
      })
      xhr.addEventListener('error', () => {
        showNotification(`文件上传失败：${file.name}`)
        setPendingAttachments(prev => prev.filter(p => p.id !== uploadId))
      })
      xhr.open('POST', '/api/files/upload')
      xhr.send(formData)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [project.id, session?.id, showNotification])

  const uploadCapturedImage = useCallback((dataUrl: string) => {
    fetch(dataUrl)
      .then(res => res.blob())
      .then(blob => {
        const now = new Date()
        const pad = (n: number) => String(n).padStart(2, '0')
        const name = `loom-screenshot-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`
        const file = new File([blob], name, { type: 'image/png' })
        const dt = new DataTransfer()
        dt.items.add(file)
        handleFileUpload(dt.files)
      })
      .catch(() => showNotification('截图上传失败'))
  }, [handleFileUpload, showNotification])

  const openCaptureArea = useCallback(() => {
    if (!canCompose || missingWorkspace) {
      showNotification('请先选择工作目录')
      return
    }
    if (!window.electronAPI?.startCaptureArea) {
      showNotification('桌面截图需要重启 Electron，已切换为窗口内截图')
      setWindowCaptureOpen(true)
      return
    }
    window.electronAPI.startCaptureArea().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      showNotification(`桌面截图启动失败，已切换为窗口内截图：${msg}`)
      setWindowCaptureOpen(true)
    })
  }, [canCompose, missingWorkspace, showNotification])

  useEffect(() => {
    if (!window.electronAPI?.onCaptureArea) return
    return window.electronAPI.onCaptureArea(openCaptureArea)
  }, [openCaptureArea])

  useEffect(() => {
    if (!window.electronAPI?.onCaptureResult) return
    return window.electronAPI.onCaptureResult((dataUrl) => setCapturePreviewDataUrl(dataUrl))
  }, [])

  useEffect(() => {
    if (!window.electronAPI?.onCaptureError) return
    return window.electronAPI.onCaptureError(() => showNotification('截图失败，请检查屏幕录制权限'))
  }, [showNotification])

  const isFileDragEvent = useCallback((e: React.DragEvent) => {
    return Array.from(e.dataTransfer.types || []).includes('Files')
  }, [])

  const resetDragState = useCallback(() => {
    dragCounterRef.current = 0
    setIsDragging(false)
  }, [])

  const handleDroppedFiles = useCallback((files: FileList) => {
    if (files.length === 0) return
    if (!canCompose) {
      showNotification('请先创建会话')
      return
    }
    if (missingWorkspace) {
      showNotification('请先选择工作目录')
      return
    }
    handleFileUpload(files)
    textareaRef.current?.focus()
  }, [canCompose, handleFileUpload, missingWorkspace, showNotification])

  // Drag and drop
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!isFileDragEvent(e)) return
    e.preventDefault()
    dragCounterRef.current++
    setIsDragging(true)
  }, [isFileDragEvent])
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!isFileDragEvent(e)) return
    e.preventDefault()
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
    if (dragCounterRef.current === 0) setIsDragging(false)
  }, [isFileDragEvent])
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!isFileDragEvent(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = canCompose && !missingWorkspace ? 'copy' : 'none'
  }, [canCompose, isFileDragEvent, missingWorkspace])
  const handleDrop = useCallback((e: React.DragEvent) => {
    if (!isFileDragEvent(e)) return
    e.preventDefault()
    resetDragState()
    handleDroppedFiles(e.dataTransfer.files)
  }, [handleDroppedFiles, isFileDragEvent, resetDragState])

  const handleComposerDragOver = useCallback((e: React.DragEvent) => {
    if (!isFileDragEvent(e)) return
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
    e.dataTransfer.dropEffect = canCompose && !missingWorkspace ? 'copy' : 'none'
  }, [canCompose, isFileDragEvent, missingWorkspace])

  const handleComposerDrop = useCallback((e: React.DragEvent) => {
    if (!isFileDragEvent(e)) return
    e.preventDefault()
    e.stopPropagation()
    resetDragState()
    handleDroppedFiles(e.dataTransfer.files)
  }, [handleDroppedFiles, isFileDragEvent, resetDragState])

  // Export
  const handleExport = useCallback(() => {
    if (!session) return
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
    let md = `# ${session.title || '会话记录'}\n\n> 导出时间：${now.toLocaleString('zh-CN')}\n\n---\n\n`
    for (const msg of messages) {
      md += msg.role === 'user' ? '## 用户\n\n' : '## 助手\n\n'
      for (const block of msg.blocks) {
        if (block.type === 'text') md += block.text.trim() + '\n\n'
        else if (block.type === 'thinking') md += `<details>\n<summary>思考过程</summary>\n\n${block.text.trim()}\n</details>\n\n`
        else if (block.type === 'tool_use') md += `\`[${block.name}]\`\n\n`
      }
    }
    const blob = new Blob([md], { type: 'text/markdown; charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${ts}-${session.id}.md`; a.click()
    URL.revokeObjectURL(url)
  }, [session, messages])

  // Execute slash command
  const execCommand = useCallback(async (cmd: SlashCmd, args: string) => {
    setInput('')
    setAttachments([])
    if (cmd.name === '/clear')   { clearMessages(); return }
    if (cmd.name === '/compact') { compact();       return }
    if (cmd.name === '/stop')    { stopStreaming();  return }
    if (cmd.name === '/help') {
      setCommandPanel({ type: 'help', commands: allCmds })
      return
    }
    if (cmd.name === '/cost') {
      const ctxIn  = activeMessages.reduce((s, m) => s + (m.inputTokens || 0), 0)
      const ctxOut = activeMessages.reduce((s, m) => s + (m.outputTokens || 0), 0)
      const totalIn  = messages.reduce((s, m) => s + (m.inputTokens || 0), 0)
      const totalOut = messages.reduce((s, m) => s + (m.outputTokens || 0), 0)
      const rows: { label: string; value: string; dim?: boolean }[] = []
      if (groups.length > 1) {
        rows.push({ label: '当前上下文  输入', value: ctxIn.toLocaleString() + ' tokens' })
        rows.push({ label: '当前上下文  输出', value: ctxOut.toLocaleString() + ' tokens' })
        rows.push({ label: '当前上下文  合计', value: (ctxIn + ctxOut).toLocaleString() + ' tokens' })
        rows.push({ label: '本会话累计', value: (totalIn + totalOut).toLocaleString() + ' tokens', dim: true })
      } else {
        rows.push({ label: '输入', value: totalIn.toLocaleString() + ' tokens' })
        rows.push({ label: '输出', value: totalOut.toLocaleString() + ' tokens' })
        rows.push({ label: '合计', value: (totalIn + totalOut).toLocaleString() + ' tokens' })
      }
      setCommandPanel({ type: 'cost', rows })
      return
    }
    if (cmd.name === '/model') {
      if (args) setSelectedModel(args.trim())
      else setModelOpen(true)
      return
    }
    if (cmd.name === '/export') { handleExport(); return }
    if (cmd.name === '/init') {
      if (missingWorkspace) {
        showNotification('请先为当前会话选择工作目录')
        return
      }
      if (workspaceRequired) {
        showNotification('独立 Chat 暂不支持 /init，请在项目工作区中初始化 .claude 配置')
        return
      }
      let templateBlock = ''
      let existingBlock = ''
      try {
        const res = await fetch(`/api/projects/${project.id}/init`, { method: 'POST' })
        const data = await res.json() as {
          templates?: Record<string, string>
          existingContents?: Record<string, string>
          message?: string
        }
        if (data.templates && typeof data.templates === 'object') {
          templateBlock = Object.entries(data.templates)
            .map(([name, content]) => `<template file="${name}">\n${content}\n</template>`)
            .join('\n\n')
        }
        if (data.existingContents && typeof data.existingContents === 'object' && Object.keys(data.existingContents).length > 0) {
          existingBlock = Object.entries(data.existingContents)
            .map(([name, content]) => `<existing file="${name}">\n${content}\n</existing>`)
            .join('\n\n')
        }
      } catch { /* proceed without templates */ }

      const rules = `**面试规则**：
1. 每次只问一个问题，等用户回答后再继续
2. 用户说"跳过"或"skip"时，根据项目上下文填入合理的默认值，继续下一个问题
3. 如果某个配置文件已有非空内容（见下方"已有内容"），只补充缺失的占位符部分，不要覆盖已有的好内容
4. 所有问题结束后，使用 Write 工具将文件写入 .claude/ 目录

**问题顺序**：
- Q1 → CLAUDE.md "关于这个项目"部分
- Q2 → CLAUDE.md "语言偏好"部分
- Q3 → USER.md 用户资料（名字、时区、背景）
- Q4 → SOUL.md 性格风格 + IDENTITY.md 名字与身份
- Q5 → CLAUDE.md "边界与约束"部分
- Q6 → HEARTBEAT.md 定期检查项`

      const parts: string[] = [
        `/init — 请开始工作区配置面试，每次只问一个问题。\n\n${rules}`,
        ...(existingBlock ? [`**已有配置文件内容**（面试时跳过已填写的部分，只补充空白占位符）：\n\n${existingBlock}`] : []),
        ...(templateBlock ? [`**模板结构**（将 <!-- [/init Q#] --> 占位符替换为用户答案，保留所有非占位符内容不变）：\n\n${templateBlock}`] : []),
      ]
      const initMessage = parts.join('\n\n---\n\n')

      if (!session && (sessionDraft || canCreateFromEmptyProject) && onCreateAndSend) {
        onCreateAndSend({
          message: '/init — 请开始工作区配置面试，每次只问一个问题。',
          effectiveMessage: initMessage,
          permissionMode,
          thinkingMode,
          planMode,
        })
        scrollToBottom('smooth')
        return
      }

      sendMessage(initMessage, permissionMode, thinkingMode, undefined, planMode, '/init — 请开始工作区配置面试，每次只问一个问题。')
      scrollToBottom('smooth')
      return
    }
    if (cmd.name === '/skills') {
      fetchConfigJson<{ skills?: SkillConfigEntry[] }>(`/api/config/skills?workspacePath=${encodeURIComponent(effectiveWorkspacePath || '')}&summary=1`)
        .then((data) => {
          setCommandPanel({ type: 'skills', skills: (data.skills ?? []).map(s => ({ name: s.name, desc: s.description, source: s.source })) })
        })
        .catch(() => showNotification('读取技能列表失败'))
      return
    }
    if (cmd.name === '/agents') {
      const resultIds = new Set<string>()
      for (const m of messages) for (const b of m.blocks) if (b.type === 'tool_result') resultIds.add(b.tool_use_id)
      const runningAgents: { id: string; task: string }[] = []
      for (const m of messages) for (const b of m.blocks)
        if (b.type === 'tool_use' && (b.name === 'Agent' || b.name.toLowerCase().includes('agent')) && !resultIds.has(b.id))
          runningAgents.push({ id: b.id, task: String(b.input.description || b.input.prompt || b.name).slice(0, 60) })
      fetchConfigJson<{ agents?: AgentConfigEntry[] }>(`/api/config/agents?workspacePath=${encodeURIComponent(effectiveWorkspacePath || '')}`)
        .then((data) => {
          setCommandPanel({ type: 'agents', running: runningAgents, library: (data.agents ?? []).map(a => ({ name: a.name, desc: a.description, source: a.source ?? 'project' })) })
        })
        .catch(() => showNotification('读取 Agent 列表失败'))
      return
    }
    if (cmd.name === '/hooks') {
      fetch(`/api/config/hooks?workspacePath=${encodeURIComponent(effectiveWorkspacePath || '')}`).then(r => r.json())
        .then((data: { events: { event: string; groups: { matcher: string; commands: string[] }[]; source: 'project' | 'global' }[] }) => {
          setCommandPanel({ type: 'hooks', events: data.events ?? [] })
        })
        .catch(() => showNotification('读取 Hooks 配置失败'))
      return
    }
    if (cmd.name === '/mcp') {
      const parts = args.trim().split(/\s+/).filter(Boolean)
      const sub = parts[0]?.toLowerCase()
      if (!sub || sub === 'list') {
        fetch(`/api/config/mcp?workspacePath=${encodeURIComponent(effectiveWorkspacePath || '')}`).then(r => r.json()).then((data: { servers: { name: string; scope: string; overriddenBy?: string; config: { type?: string; url?: string; command?: string; args?: string[] } }[] }) => {
          setCommandPanel({
            type: 'mcp',
            servers: (data.servers ?? []).map(s => ({
              name: s.name,
              scope: s.scope,
              overriddenBy: s.overriddenBy,
              transport: s.config.type || 'stdio',
              addr: s.config.url ?? [s.config.command, ...(s.config.args || [])].filter(Boolean).join(' '),
            })),
          })
        }).catch(() => showNotification('获取 MCP 列表失败'))
        return
      }
      if (sub === 'add') {
        const addArgs = parts.slice(1)
        if (addArgs.length < 2) { showNotification('用法：/mcp add [--scope local|project|user] [--transport http|sse|stdio] <名称> <url 或 命令>'); return }
        fetch('/api/config/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ args: addArgs, workspacePath: effectiveWorkspacePath || '' }) })
          .then(r => r.json()).then((data: { ok?: boolean; name?: string; scope?: string; config?: { type?: string }; error?: string }) => {
            showNotification(data.ok ? `✅ MCP 服务器 "${data.name}" 已添加到 ${data.scope} [${data.config?.type || 'stdio'}]` : `❌ 添加失败：${data.error}`)
          }).catch(() => showNotification('添加 MCP 服务器失败'))
        return
      }
      if (sub === 'remove' || sub === 'rm') {
        const parsed = parseMcpScopeArg(parts.slice(1))
        if (parsed.error) { showNotification(parsed.error); return }
        const name = parsed.rest[0]
        if (!name) { showNotification('用法：/mcp remove [--scope local|project|user] <名称>'); return }
        fetch('/api/config/mcp', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, scope: parsed.scope, workspacePath: effectiveWorkspacePath || '' }) })
          .then(r => r.json()).then((data: { ok?: boolean; scope?: string; error?: string }) => {
            showNotification(data.ok ? `✅ MCP 服务器 "${name}" 已从 ${data.scope} 移除` : `❌ 移除失败：${data.error}`)
          }).catch(() => showNotification('移除 MCP 服务器失败'))
        return
      }
      showNotification('用法：/mcp list | /mcp add … | /mcp remove [--scope local|project|user] <名称>')
      return
    }
    // Send to AI
    const content = cmd.name + (args ? ' ' + args : '')
    let effectiveContent = content
    let enabledSkills: string[] | undefined
    if (cmd.badge === 'Skill') {
      enabledSkills = [cmd.name.replace(/^\//, '')]
      effectiveContent = content
    }
    if (!session && (sessionDraft || canCreateFromEmptyProject) && onCreateAndSend) {
      onCreateAndSend({
        message: content,
        effectiveMessage: effectiveContent,
        enabledSkills,
        permissionMode,
        thinkingMode,
        planMode,
      })
      scrollToBottom('smooth')
      return
    }
    sendMessage(effectiveContent, permissionMode, thinkingMode, undefined, planMode, content, false, enabledSkills)
    scrollToBottom('smooth')
  }, [clearMessages, stopStreaming, compact, handleExport, sendMessage, permissionMode, thinkingMode, planMode, allCmds, messages, groups, activeMessages, showNotification, project.id, effectiveWorkspacePath, missingWorkspace, session, sessionDraft, canCreateFromEmptyProject, onCreateAndSend, scrollToBottom])

  // Handle model change — updates session + project defaultModel in DB and notifies parent
  const handleModelChange = useCallback(async (modelId: string) => {
    setSelectedModel(modelId)
    setModelOpen(false)
    // Update session model
    if (session?.id && modelId !== session.model) {
      fetch(`/api/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId }),
      }).catch(() => {})
    }
    // Persist as project default so new sessions inherit this model
    if (modelId !== project.defaultModel) {
      fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultModel: modelId }),
      }).catch(() => {})
      onModelChange?.(modelId)
    }
  }, [session?.id, session?.model, project.id, project.defaultModel, onModelChange])

  const submitImageGeneration = useCallback(async (rawPrompt?: string): Promise<boolean> => {
    const prompt = (rawPrompt ?? input).trim()
    if (!prompt || imageGenSubmitting) return false

    const cfg = imageGenConfigRef.current
    if (!cfg?.enabled) {
      showNotification('图像生成未启用，请先在设置中开启')
      return false
    }

    let sessionId = session?.id ?? ''
    if (!sessionId) {
      const created = await onCreateImageSession?.()
      sessionId = created?.id ?? ''
    }
    if (!sessionId) {
      showNotification('请先创建或选择一个会话再使用图像生成')
      return false
    }

    const settings = imageGenSettingsRef.current
    const referenceImages = settings.referenceImages.map(r => ({
      name: r.name,
      url: r.url,
      serverFilename: r.serverFilename,
      mimeType: r.mimeType,
    }))
    const history = imageGenJobsRef.current
      .slice(-5)
      .map(j => ({ prompt: j.prompt, resultUrls: [] as string[] }))
    const jobEntry: ImageGenJobEntryState = {
      id: `img-${++imageGenJobIdxRef.current}`,
      prompt,
      jobId: '',
      startedAt: new Date().toISOString(),
      aspectRatioId: settings.aspectRatioId,
      styleId: settings.styleId,
      referenceImages,
    }

    setImageGenSubmitting(true)
    setImageGenJobs(prev => [...prev, jobEntry])
    setInput('')
    setImageGenMode(false)
    setImageGenSettings(prev => ({ ...prev, referenceImages: [] }))
    setTimeout(() => scrollToBottom('smooth'), 50)

    try {
      const res = await fetch('/api/image-generation/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          prompt,
          history,
          providerId: settings.providerId || cfg.activeProviderId,
          aspectRatio: settings.aspectRatioId,
          styleId: settings.styleId,
          count: 1,
          referenceImages,
        }),
      })
      const data = await res.json().catch(() => ({})) as { jobId?: string; error?: string }
      if (!res.ok || data.error || !data.jobId) {
        showNotification(data.error ?? '图像生成失败，请检查配置')
        setImageGenJobs(prev => prev.filter(j => j.id !== jobEntry.id))
        return false
      }
      setImageGenJobs(prev => {
        const next = prev.map(j => j.id === jobEntry.id ? { ...j, jobId: data.jobId! } : j)
        return next.some(j => j.id === jobEntry.id) ? next : [...next, { ...jobEntry, jobId: data.jobId! }]
      })
      return true
    } catch {
      showNotification('图像生成请求失败，请检查网络连接')
      setImageGenJobs(prev => prev.filter(j => j.id !== jobEntry.id))
      return false
    } finally {
      setImageGenSubmitting(false)
    }
  }, [imageGenSubmitting, input, onCreateImageSession, scrollToBottom, session?.id, showNotification])

  // Handle send — image gen logic inlined with ref reads to avoid stale closures
  const handleSend = useCallback(() => {
    // ── Image generation mode ──────────────────────────────────────
    if (imageGenModeRef.current) {
      void submitImageGeneration(input)
      return
    }

    if (missingWorkspace) {
      showNotification('请先为当前会话选择工作目录')
      return
    }

    // ── Normal chat mode ───────────────────────────────────────────
    if ((!input.trim() && attachments.length === 0) || streaming) return
    const trimmed = input.trim()
    if (trimmed.startsWith('/')) {
      const spaceIdx = trimmed.indexOf(' ')
      const cmdName = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)
      const args    = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1)
      const matched = allCmds.find(c => c.name === cmdName.toLowerCase())
      if (matched) { execCommand(matched, args); return }
    }

    let orderedAttachments = [...attachments]
    if (attachments.length > 1) {
      const regex = /\[(?:Image|PDF Text|PDF|Video|File) #(\d+)\]/g
      const seen = new Set<number>(); const reordered: Attachment[] = []; let match: RegExpExecArray | null
      while ((match = regex.exec(input)) !== null) {
        const num = parseInt(match[1])
        if (!seen.has(num)) { seen.add(num); const att = attachments.find(a => a.num === num); if (att) reordered.push(att) }
      }
      for (const a of attachments) if (!seen.has(a.num)) reordered.push(a)
      if (reordered.length === attachments.length) orderedAttachments = reordered
    }

    const unreadablePdf = orderedAttachments.find(a => a.readable === false && a.tier === 'pdf')
    if (unreadablePdf) {
      showNotification(`${unreadablePdf.name} 当前无法提取可读文字，请换成可复制文字的 PDF，或先转成 txt/docx 后再发送。`)
      return
    }

    const attachmentData = orderedAttachments.length > 0
      ? orderedAttachments.map(a => ({
          name: a.name,
          filename: a.filename,
          originalFilename: a.originalFilename,
          displayFilename: a.displayFilename,
          displayMimeType: a.displayMimeType,
          readable: a.readable,
          extractError: a.extractError,
          placeholder: getPlaceholder(a),
          mimeType: a.mimeType,
          tier: a.tier,
        }))
      : undefined
    let content = input
    if (orderedAttachments.length > 0 && !content.trim()) {
      content = orderedAttachments.map(a => getPlaceholder(a)).join(' ')
    }
    if (trimmed.startsWith('/')) {
      const spaceIdx = trimmed.indexOf(' ')
      const cmdName = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)
      const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1)
      loadSkillSummaryEntry(effectiveWorkspacePath, cmdName)
        .then((skill) => {
          if (skill) {
            const skillName = cmdName.replace(/^\//, '')
            const effectiveContent = content
            if (!session && (sessionDraft || canCreateFromEmptyProject) && onCreateAndSend) {
              onCreateAndSend({
                message: content,
                effectiveMessage: effectiveContent,
                enabledSkills: [skillName],
                permissionMode,
                thinkingMode,
                attachments: attachmentData,
                planMode,
              })
              setInput('')
              setAttachments([])
              return
            }
            sendMessage(effectiveContent, permissionMode, thinkingMode, attachmentData, planMode, content, false, [skillName])
            setInput('')
            setAttachments([])
            scrollToBottom('smooth')
            return
          }
          if (!session && (sessionDraft || canCreateFromEmptyProject) && onCreateAndSend) {
            onCreateAndSend({ message: content, permissionMode, thinkingMode, attachments: attachmentData, planMode })
            setInput('')
            setAttachments([])
            return
          }
          sendMessage(content, permissionMode, thinkingMode, attachmentData, planMode)
          setInput('')
          setAttachments([])
          scrollToBottom('smooth')
        })
        .catch(() => {
          if (!session && (sessionDraft || canCreateFromEmptyProject) && onCreateAndSend) {
            onCreateAndSend({ message: content, permissionMode, thinkingMode, attachments: attachmentData, planMode })
            setInput('')
            setAttachments([])
            return
          }
          sendMessage(content, permissionMode, thinkingMode, attachmentData, planMode)
          setInput('')
          setAttachments([])
          scrollToBottom('smooth')
        })
      return
    }

    const riskyAttachments = orderedAttachments.filter(a =>
      a.size >= LARGE_ATTACHMENT_WARN_BYTES ||
      a.tier === 'pdf'
    )
    const riskyAttachmentSignature = riskyAttachments.map(a => `${a.filename}:${a.size}:${a.tier}`).join('|')
    if (riskyAttachments.length > 0 && attachmentOverrideSignature !== riskyAttachmentSignature) {
      setAttachmentOverrideSignature(riskyAttachmentSignature)
      fetch('/api/log/client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'context.attachment_send_prompted',
          attachments: riskyAttachments.map(a => ({ name: a.name, size: a.size, tier: a.tier })),
          sessionId: session?.id,
          projectId: project.id,
        }),
      }).catch(() => {})
      showNotification(`本次包含大附件或 PDF，可能明显增加上下文。确认发送请再点一次发送。`)
      return
    }

    // Empty project / draft mode: create the first session only when the user sends.
    if (!session && (sessionDraft || canCreateFromEmptyProject) && onCreateAndSend) {
      onCreateAndSend({ message: content, permissionMode, thinkingMode, attachments: attachmentData, planMode })
      setInput('')
      setAttachments([])
      return
    }

    sendMessage(content, permissionMode, thinkingMode, attachmentData, planMode)
    setAttachmentOverrideSignature(null)
    setInput('')
    setAttachments([])
    scrollToBottom('smooth')
  }, [input, attachments, streaming, allCmds, execCommand, sendMessage, permissionMode, thinkingMode, planMode, getPlaceholder, missingWorkspace, showNotification, session, sessionDraft, canCreateFromEmptyProject, onCreateAndSend, attachmentOverrideSignature, project.id, scrollToBottom, submitImageGeneration])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    inputHistoryIndexRef.current = null
    inputHistoryDraftRef.current = ''
    setInput(e.target.value)
  }, [])

  const navigateInputHistory = useCallback((direction: 'up' | 'down', textarea: HTMLTextAreaElement): boolean => {
    if (imageGenModeRef.current || inputHistory.length === 0) return false
    const start = textarea.selectionStart ?? input.length
    const end = textarea.selectionEnd ?? input.length
    if (start !== end) return false

    const before = input.slice(0, start)
    const after = input.slice(end)
    if (direction === 'up' && before.includes('\n')) return false
    if (direction === 'down' && after.includes('\n')) return false

    let nextIndex: number | null
    if (direction === 'up') {
      if (inputHistoryIndexRef.current === null) {
        inputHistoryDraftRef.current = input
        nextIndex = inputHistory.length - 1
      } else {
        nextIndex = Math.max(0, inputHistoryIndexRef.current - 1)
      }
    } else {
      if (inputHistoryIndexRef.current === null) return false
      nextIndex = inputHistoryIndexRef.current + 1
      if (nextIndex >= inputHistory.length) nextIndex = null
    }

    inputHistoryIndexRef.current = nextIndex
    const nextValue = nextIndex === null ? inputHistoryDraftRef.current : inputHistory[nextIndex]
    setInput(nextValue)
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(nextValue.length, nextValue.length)
    })
    return true
  }, [input, inputHistory])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape' && streaming) { e.preventDefault(); stopStreaming(); return }
    if (showPicker) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setPickerIdx(i => Math.min(filteredCmds.length - 1, i + 1)); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setPickerIdx(i => Math.max(0, i - 1)); return }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.nativeEvent.isComposing)) {
        const cmd = filteredCmds[pickerIdx]
        if (e.key === 'Enter' && !e.shiftKey && cmd) {
          const trimmedInput = input.trim()
          if (trimmedInput.startsWith(cmd.name) && trimmedInput.length > cmd.name.length) { e.preventDefault(); handleSend(); return }
        }
        e.preventDefault()
        if (cmd) {
          if (cmd.dynamic || cmd.args.startsWith('<') || cmd.args.startsWith('[')) {
            const currentArgs = input.trim().slice(cmd.name.length).trimStart()
            setInput(cmd.name + (currentArgs ? ' ' + currentArgs : ' '))
            setTimeout(() => textareaRef.current?.focus(), 0)
          } else {
            execCommand(cmd, '')
          }
        }
        return
      }
      if (e.key === 'Escape') { e.preventDefault(); setInput(''); return }
    }
    if (e.key === 'ArrowUp' && navigateInputHistory('up', e.currentTarget)) { e.preventDefault(); return }
    if (e.key === 'ArrowDown' && navigateInputHistory('down', e.currentTarget)) { e.preventDefault(); return }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); handleSend() }
  }, [streaming, stopStreaming, showPicker, filteredCmds, pickerIdx, input, handleSend, execCommand, navigateInputHistory])

  const lastAssistantIdx = messages.reduce((acc, message, index) => message.role === 'assistant' ? index : acc, -1)
  const hasMessages = messages.length > 0
  const canUseImageComposer = Boolean(session?.id || sessionDraft || canCreateFromEmptyProject || onCreateImageSession)
  const imagePromptReady = input.trim().length > 0
  const canSubmitImagePrompt = Boolean(imageGenConfig?.enabled && canUseImageComposer && imagePromptReady && !imageGenSubmitting)
  const timelineItems = useMemo(() => {
    const items: Array<
      | { type: 'message'; key: string; sortAt: number; order: number; groupIndex: number; messageIndex: number; message: NonNullable<typeof groups[number]['messages'][number]> }
      | { type: 'boundary'; key: string; sortAt: number; order: number; boundary: NonNullable<typeof groups[number]['boundary']> }
      | { type: 'imageJob'; key: string; sortAt: number; order: number; entry: ImageGenJobEntryState }
    > = []

    groups.forEach((group, groupIndex) => {
      group.messages.forEach((message, messageIndex) => {
        items.push({
          type: 'message',
          key: `message-${message.id}-${groupIndex}-${messageIndex}`,
          sortAt: timestampMs(message.createdAt),
          order: items.length,
          groupIndex,
          messageIndex,
          message,
        })
      })
      if (group.boundary) {
        items.push({
          type: 'boundary',
          key: `boundary-${group.boundary.id}-${groupIndex}`,
          sortAt: timestampMs(group.boundary.createdAt),
          order: items.length,
          boundary: group.boundary,
        })
      }
    })

    imageGenJobs.forEach((entry, index) => {
      items.push({
        type: 'imageJob',
        key: `image-${entry.id}`,
        sortAt: timestampMs(entry.startedAt),
        order: items.length + index,
        entry,
      })
    })

    return items.sort((a, b) => (a.sortAt - b.sortAt) || (a.order - b.order))
  }, [groups, imageGenJobs])

  const renderBoundaryStats = (boundary: NonNullable<typeof groups[number]['boundary']>) => {
    if (boundary.boundaryType !== 'compact') return null
    const loomMeta = boundary.metadata?.loom as Record<string, unknown> | undefined
    const messageCount = typeof loomMeta?.messageCount === 'number' ? loomMeta.messageCount : null
    const rowCount = typeof loomMeta?.rowCount === 'number' ? loomMeta.rowCount : null
    const messageChars = typeof loomMeta?.messageChars === 'number' ? loomMeta.messageChars : null
    const summaryChars = typeof loomMeta?.summaryChars === 'number' ? loomMeta.summaryChars : null
    const preTokens = typeof boundary.metadata?.pre_tokens === 'number' ? boundary.metadata.pre_tokens : null
    const postTokens = typeof boundary.metadata?.post_tokens === 'number' ? boundary.metadata.post_tokens : null
    const sdkTokenPair = preTokens !== null && postTokens !== null && postTokens > 0 && postTokens <= preTokens
      ? `SDK ${preTokens.toLocaleString()} -> ${postTokens.toLocaleString()} tokens`
      : null
    const summaryRatio = messageChars && summaryChars && messageChars > 0
      ? Math.round((summaryChars / messageChars) * 100)
      : null
    const trigger = typeof boundary.metadata?.trigger === 'string' ? boundary.metadata.trigger : null
    const source = boundary.compactSource === 'sdk'
      ? `SDK ${trigger === 'auto' ? 'auto ' : ''}compact`
      : 'Loom fallback'
    const chips = [
      source,
      sdkTokenPair,
      messageCount !== null ? `${messageCount} 条消息` : rowCount !== null ? `${rowCount} 条记录` : null,
      messageChars !== null ? `原文 ${messageChars.toLocaleString()} chars` : null,
      summaryChars !== null ? `摘要 ${summaryChars.toLocaleString()} chars` : null,
      summaryRatio !== null ? `摘要约 ${summaryRatio}%` : null,
    ].filter((chip): chip is string => Boolean(chip))
    if (chips.length === 0) return null
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {chips.map(chip => (
          <span key={chip} style={{
            fontSize: 10,
            color: 'var(--color-text-muted)',
            background: 'var(--theme-bg-surface)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 999,
            padding: '3px 8px',
            lineHeight: 1,
          }}>
            {chip}
          </span>
        ))}
      </div>
    )
  }

  const renderBoundaryBlock = (boundary: NonNullable<typeof groups[number]['boundary']>) => (
    <div style={{ padding: '8px 0 24px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 14, marginBottom: 12 }}>
        <div style={{ height: 2, background: 'linear-gradient(90deg, transparent, var(--color-accent-primary))', opacity: boundary.boundaryType === 'compact' ? 0.8 : 0.45 }} />
        <span style={{
          fontSize: 12,
          fontWeight: 800,
          color: boundary.boundaryType === 'compact' ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
          background: 'var(--color-bg-surface)',
          border: boundary.boundaryType === 'compact'
            ? '1px solid var(--color-accent-primary)'
            : '1px solid var(--color-border-subtle)',
          borderRadius: 999,
          padding: '6px 14px',
          whiteSpace: 'nowrap',
          userSelect: 'none',
          boxShadow: boundary.boundaryType === 'compact' ? '0 10px 28px rgba(15,23,42,0.08)' : undefined,
        }}>
          {boundary.boundaryType === 'compact'
            ? '上下文已压缩 · 新上下文从此开始'
            : '以上对话已归档，不会带入新的上下文'}
        </span>
        <div style={{ height: 2, background: 'linear-gradient(90deg, var(--color-accent-primary), transparent)', opacity: boundary.boundaryType === 'compact' ? 0.8 : 0.45 }} />
      </div>
      <div style={{
        background: 'var(--color-bg-surface)',
        border: boundary.boundaryType === 'compact'
          ? '1px solid var(--color-accent-primary)'
          : '1px solid var(--color-border-subtle)',
        borderRadius: 14,
        padding: '14px 16px',
        boxShadow: boundary.boundaryType === 'compact'
          ? '0 14px 36px rgba(15,23,42,0.07)'
          : '0 8px 24px rgba(15,23,42,0.04)',
      }}>
        <div style={{
          fontSize: 10,
          color: 'var(--color-text-muted)',
          marginBottom: 7,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          fontWeight: 700,
        }}>
          压缩摘要
        </div>
        {renderBoundaryStats(boundary)}
        <div style={{
          fontSize: 12,
          color: boundary.summary ? 'var(--color-text-secondary)' : 'var(--color-text-muted)',
          whiteSpace: 'pre-wrap',
          lineHeight: 1.65,
        }}>
          {boundary.summary || '本次压缩没有生成摘要；以上历史已从新上下文中移除。'}
        </div>
      </div>
    </div>
  )

  const renderImageJobTimelineEntry = (entry: ImageGenJobEntryState) => (
    <ImageGenJobEntry
      prompt={entry.prompt}
      jobId={entry.jobId}
      aspectRatioId={entry.aspectRatioId}
      styleId={entry.styleId}
      referenceImages={entry.referenceImages}
      onRetry={async () => {
        if (!entry.jobId || !session?.id) return
        const res = await fetch(`/api/image-generation/jobs/${entry.jobId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ history: imageGenJobs.slice(-5).map(j => ({ prompt: j.prompt, resultUrls: [] })) }),
        }).catch(() => null)
        if (!res?.ok) {
          const data = res ? await res.json().catch(() => ({})) as { error?: string } : {}
          showNotification(data.error ?? '重新生成失败，请检查配置')
          return
        }
        const data = await res.json().catch(() => ({})) as { jobId?: string }
        if (!data.jobId) {
          showNotification('重新生成失败，未返回任务 ID')
          return
        }
        setImageGenJobs(prev => ([
          ...prev,
          {
            id: data.jobId!,
            prompt: entry.prompt,
            jobId: data.jobId!,
            startedAt: new Date().toISOString(),
            aspectRatioId: entry.aspectRatioId,
            styleId: entry.styleId,
            referenceImages: entry.referenceImages,
          },
        ]))
        setTimeout(() => scrollToBottom('smooth'), 50)
      }}
      onEditFromImage={(url) => {
        const filename = filenameFromServedFileUrl(url)
        setImageGenMode(true)
        setImageGenSettings(prev => ({
          ...prev,
          referenceImages: [...prev.referenceImages, { name: filename, url, serverFilename: filename, mimeType: 'image/png' }],
        }))
      }}
    />
  )

  const renderEmptyCommandPanel = () => {
    if (!commandPanel) return null
    const title =
      commandPanel.type === 'skills' ? `Skills (${commandPanel.skills.length})`
        : commandPanel.type === 'agents' ? 'Agents'
        : commandPanel.type === 'hooks' ? 'Hooks'
        : commandPanel.type === 'mcp' ? `MCP Servers (${commandPanel.servers.length})`
        : commandPanel.type === 'help' ? `Help (${commandPanel.commands.length} 个命令)`
        : 'Token 用量'

    return (
      <div style={{ maxWidth: 700, width: '100%', margin: '18px auto 0', background: 'var(--theme-bg-surface)', border: '1px solid var(--theme-border-strong)', borderRadius: 10, padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--color-accent-primary)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{title}</span>
          <button onClick={() => setCommandPanel(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 2 }}>
            <X size={13} />
          </button>
        </div>

        {commandPanel.type === 'skills' && (
          commandPanel.skills.length === 0
            ? <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>暂无可用技能</p>
            : <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {commandPanel.skills.map(s => (
                    <tr key={s.name} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                      <td style={{ padding: '7px 0', width: 200 }}><span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--color-text-secondary)', fontWeight: 700 }}>/{s.name}</span></td>
                      <td style={{ padding: '7px 8px', fontSize: 12, color: 'var(--color-text-muted)' }}>{s.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
        )}

        {commandPanel.type === 'cost' && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>{commandPanel.rows.map((row, i) => (
              <tr key={i} style={{ borderBottom: i < commandPanel.rows.length - 1 ? '1px solid var(--color-border-subtle)' : 'none' }}>
                <td style={{ padding: '7px 0', fontSize: 12, color: row.dim ? 'var(--color-text-muted)' : 'var(--color-text-secondary)' }}>{row.label}</td>
                <td style={{ padding: '7px 0', fontSize: 12, fontFamily: 'monospace', color: 'var(--color-accent-primary)', textAlign: 'right', fontWeight: 700 }}>{row.value}</td>
              </tr>
            ))}</tbody>
          </table>
        )}

        {commandPanel.type === 'agents' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: 0 }}>RUNNING ({commandPanel.running.length})</p>
            {commandPanel.running.length === 0 && <p style={{ fontSize: 12, color: 'var(--color-text-disabled)', margin: 0 }}>当前会话无运行中的 Agent</p>}
            <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: '4px 0 0' }}>LIBRARY ({commandPanel.library.length})</p>
            {commandPanel.library.length === 0
              ? <p style={{ fontSize: 12, color: 'var(--color-text-disabled)', margin: 0 }}>暂无定义的 Agent</p>
              : commandPanel.library.map(a => (
                  <div key={a.name} style={{ display: 'flex', gap: 10, fontSize: 12 }}>
                    <span style={{ width: 180, fontFamily: 'monospace', color: 'var(--color-text-secondary)', fontWeight: 700 }}>{a.name}</span>
                    <span style={{ color: 'var(--color-text-muted)' }}>{a.desc}</span>
                  </div>
                ))}
          </div>
        )}

        {commandPanel.type === 'hooks' && (
          commandPanel.events.length === 0
            ? <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>暂无配置的 Hook</p>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {commandPanel.events.map(ev => (
                  <div key={ev.event} style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{ev.event}</span>
                    <span style={{ color: 'var(--color-text-muted)' }}> · {ev.groups.length} groups</span>
                  </div>
                ))}
              </div>
        )}

        {commandPanel.type === 'mcp' && (
          commandPanel.servers.length === 0
            ? <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>暂无配置的 MCP 服务器</p>
            : <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>{commandPanel.servers.map(s => (
                  <tr key={`${s.scope}-${s.name}`} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                    <td style={{ padding: '7px 0', width: 140, fontSize: 12, fontFamily: 'monospace', color: 'var(--color-text-secondary)', fontWeight: 700 }}>{s.name}</td>
                    <td style={{ padding: '7px 8px', width: 78, fontSize: 11, color: 'var(--color-text-muted)' }}>{s.overriddenBy ? `${s.scope}→${s.overriddenBy}` : s.scope}</td>
                    <td style={{ padding: '7px 8px', width: 70, fontSize: 11, color: 'var(--color-accent-primary)' }}>{s.transport}</td>
                    <td style={{ padding: '7px 8px', fontSize: 11, fontFamily: 'monospace', color: 'var(--color-text-muted)', wordBreak: 'break-all' }}>{s.addr}</td>
                  </tr>
                ))}</tbody>
              </table>
        )}

        {commandPanel.type === 'help' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            {commandPanel.commands.map(cmd => (
              <div key={cmd.name} style={{ display: 'flex', gap: 8, minWidth: 0, fontSize: 12 }}>
                <span style={{ fontFamily: 'monospace', color: 'var(--color-accent-primary)', fontWeight: 700 }}>{cmd.name}</span>
                <span style={{ color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cmd.desc}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Auto-start streaming when a scheduled task is manually executed.
  // `pendingAutoSend` carries the user-visible prompt plus optional SDK skill names.
  // The prompt goes to the model; enabledSkills is passed separately so Claude Agent SDK
  // handles skill discovery/loading instead of Loom inlining SKILL.md.
  const autoSendFiredRef = useRef(false)
  const execUpdateUrlRef = useRef<string | undefined>(undefined)
  const wasStreamingRef = useRef(false)
  useEffect(() => { autoSendFiredRef.current = false; execUpdateUrlRef.current = undefined }, [session?.id])
  useEffect(() => { setScheduledTaskEntry(null) }, [session?.id])

  useEffect(() => {
    if (!pendingAutoSend || !session?.id || streaming) return
    if (session.id !== pendingAutoSend.sessionId) return
    if (autoSendFiredRef.current) return
    autoSendFiredRef.current = true
    execUpdateUrlRef.current = pendingAutoSend.execUpdateUrl
    onPendingAutoSendConsumed?.()
    // Only synthesize a scheduled-task card when this is a scheduled task (not a draft first-send)
    const isScheduledTask = !pendingAutoSend.permissionMode
    if (isScheduledTask) {
      setScheduledTaskEntry({
        id: `sched-${session.id}`,
        description: pendingAutoSend.displayPrompt,
        status: 'running',
        subagentType: 'Scheduled',
        taskType: pendingAutoSend.agentName ? `Agent: ${pendingAutoSend.agentName}` : undefined,
        startedAt: Date.now(),
      })
    }
    sendMessage(
      pendingAutoSend.effectivePrompt,
      // Draft first-send uses user's chosen permission mode; scheduled tasks use 'full'
      pendingAutoSend.permissionMode ?? 'full',
      pendingAutoSend.thinkingMode,
      pendingAutoSend.attachments,
      pendingAutoSend.planMode ?? false,
      pendingAutoSend.displayPrompt,
      false,
      pendingAutoSend.enabledSkills,
      pendingAutoSend.agentName,
    )
  }, [pendingAutoSend, session?.id, streaming, sendMessage, onPendingAutoSendConsumed])

  // When streaming ends after auto-send, update the Tasks tab entry and the execution record
  useEffect(() => {
    if (streaming) { wasStreamingRef.current = true; return }
    if (!wasStreamingRef.current) return
    wasStreamingRef.current = false
    const url = execUpdateUrlRef.current
    // Extract the last assistant message text from groups
    const allMsgs = groups.flatMap(g => g.messages)
    const lastAssistant = [...allMsgs].reverse().find(m => m.role === 'assistant')
    const resultText = lastAssistant?.blocks
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('') ?? ''
    // Update scheduled task card to completed / failed
    setScheduledTaskEntry(prev => prev ? {
      ...prev,
      status: error ? 'failed' : 'completed',
      summary: resultText.slice(0, 200) || undefined,
      endedAt: Date.now(),
    } : null)
    // PATCH execution record with result preview
    if (url && resultText) {
      fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result: resultText.slice(0, 200) }),
      }).catch(() => {})
    }
  }, [streaming, groups, error])

  return (
    <div
      className="flex flex-col h-full"
      style={{
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        background: 'var(--shell-panel-bg)',
        border: '1px solid var(--shell-panel-border)',
        borderRadius: 'var(--shell-radius-lg)',
        boxShadow: 'var(--shell-panel-shadow)',
        position: 'relative',
      }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* ── Header ── */}
      {session && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '0 14px 0 16px',
          height: 48,
          margin: 12,
          marginBottom: 0,
          borderRadius: 10,
          background: 'var(--theme-bg-surface)',
          border: '1px solid var(--shell-panel-border)',
          flexShrink: 0,
          minWidth: 0,
        }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1 }}>
            {session.title}
          </span>
          {(projectName || project.name) && (
            <span style={{
              flexShrink: 0, fontSize: 12, color: 'var(--color-text-secondary)',
              background: 'var(--theme-bg-raised)', border: '1px solid var(--theme-border-strong)',
              borderRadius: 6, padding: '3px 10px', whiteSpace: 'nowrap',
            }}>
              {projectName || project.name}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={handleExport}
            title="导出会话记录 (.md)"
            style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 4, color: 'var(--color-text-muted)' }}
          >
            <Download size={14} />
          </button>
        </div>
      )}

      {/* ── No session: show the original usage stats page ── */}
      {!session && sessionDraft && (
        <div style={{ flex: 1, overflow: 'auto', padding: '32px 24px' }}>
          <ClaudeCodeUsageStats projectId={emptyMode === 'project' ? project.id : undefined} />
          {renderEmptyCommandPanel()}
        </div>
      )}
      {!session && !sessionDraft && emptyMode === 'project' && (
        <div style={{ flex: 1, overflow: 'auto', padding: '32px 24px' }}>
          <ClaudeCodeUsageStats projectId={project.id} />
          {renderEmptyCommandPanel()}
        </div>
      )}
      {!session && !sessionDraft && emptyMode === 'chat' && (
        <div style={{ flex: 1, overflow: 'auto', padding: '32px 24px' }}>
          <ClaudeCodeUsageStats />
          {renderEmptyCommandPanel()}
        </div>
      )}

      {/* ── Messages ── */}
      {session && (
        <div
          ref={messagesContainerRef}
          className="flex-1 overflow-y-auto"
          style={{
            margin: 12,
            marginBottom: 0,
            borderRadius: 11,
            background: 'var(--theme-chat-output-bg)',
            border: '1px solid var(--shell-panel-border)',
            minHeight: 0,
          }}
        >
          <div style={{
            maxWidth: 960,
            margin: '0 auto',
            padding: '36px clamp(28px, 4vw, 56px)',
            display: 'flex',
            flexDirection: 'column',
            gap: 32,
          }}>

            {(!session || (!hasMessages && imageGenJobs.length === 0 && !streaming)) && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 80, paddingBottom: 32, gap: 16 }}>
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>发消息开始对话</p>
              </div>
            )}

            {memoryNotice && (
              <div style={{
                alignSelf: 'center',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '5px 10px',
                borderRadius: 999,
                border: '1px solid var(--color-border-subtle)',
                background: 'var(--theme-bg-surface)',
                color: 'var(--color-text-muted)',
                fontSize: 10,
                lineHeight: 1.4,
                boxShadow: '0 6px 18px rgba(15,23,42,0.03)',
              }}>
                <Sparkles size={11} />
                <span>
                  Memory 由 SDK 按需读取 · 后台提炼中
                  {showMemoryDebug ? ` · 候选 ${memoryNotice.candidateCount} · SDK 托管 memory` : ''}
                </span>
              </div>
            )}

            {timelineItems.map(item => {
              if (item.type === 'boundary') {
                return <div key={item.key}>{renderBoundaryBlock(item.boundary)}</div>
              }
              if (item.type === 'imageJob') {
                return <div key={item.key}>{renderImageJobTimelineEntry(item.entry)}</div>
              }

              const msg = item.message
              const flatIdx = messageRenderIndexById.get(msg.id) ?? -1
              const group = groups[item.groupIndex]
              const isLastGroupMessage = item.groupIndex === groups.length - 1 && item.messageIndex === (group?.messages.length ?? 0) - 1
              return (
                <div key={item.key} style={{ marginBottom: 32 }}>
                  {msg.role === 'user' ? (
                    <UserMessage blocks={msg.blocks} fallbackContent={msg.content} onPreviewFile={setPreviewFile} />
                  ) : (
                    <AssistantMessage
                      blocks={msg.blocks}
                      streaming={streaming && (flatIdx === lastAssistantIdx || (isLastGroupMessage && streaming))}
                      isThinking={isThinking && streaming && flatIdx === lastAssistantIdx}
                      thinkingMode={thinkingMode}
                      onPermissionDecision={sendPermissionDecision}
                      onAskUserQuestionResponse={sendAskUserQuestionResponse}
                      onPreviewFile={setPreviewFile}
                      elapsedSeconds={msg.elapsedSeconds}
                      inputTokens={msg.inputTokens}
                      outputTokens={msg.outputTokens}
                    />
                  )}
                </div>
              )
            })}

            {/* ── Command Panel ── */}
            {commandPanel && (
              <div style={{ background: 'var(--theme-bg-surface)', border: '1px solid var(--theme-border-strong)', borderRadius: 10, padding: '14px 16px', marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--color-accent-primary)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    {commandPanel.type === 'skills' ? `Skills (${commandPanel.skills.length})`
                      : commandPanel.type === 'agents' ? 'Agents'
                      : commandPanel.type === 'hooks' ? 'Hooks'
                      : commandPanel.type === 'mcp' ? `MCP Servers (${commandPanel.servers.length})`
                      : commandPanel.type === 'help' ? `Help (${commandPanel.commands.length} 个命令)`
                      : 'Token 用量'}
                  </span>
                  <button onClick={() => setCommandPanel(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 2 }}>
                    <X size={13} />
                  </button>
                </div>

                {commandPanel.type === 'cost' && (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {commandPanel.rows.map((row, i) => (
                        <tr key={i} style={{ borderBottom: i < commandPanel.rows.length - 1 ? '1px solid var(--color-border-subtle)' : 'none' }}>
                          <td style={{ padding: '7px 0', fontSize: 12, color: row.dim ? 'var(--color-text-muted)' : 'var(--color-text-secondary)' }}>{row.label}</td>
                          <td style={{ padding: '7px 0', fontSize: 12, fontFamily: 'monospace', color: 'var(--color-accent-primary)', textAlign: 'right', fontWeight: 600 }}>{row.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {commandPanel.type === 'skills' && (
                  commandPanel.skills.length === 0
                    ? <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>暂无可用技能</p>
                    : <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <tbody>
                          {commandPanel.skills.map(s => (
                            <tr key={s.name} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                              <td style={{ padding: '6px 0', width: 200 }}><span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--color-text-secondary)', fontWeight: 600 }}>/{s.name}</span></td>
                              <td style={{ padding: '6px 8px', width: 56 }}>
                                <span style={{
                                  fontSize: 10,
                                  color: s.source === 'builtin' ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
                                  background: s.source === 'builtin' ? 'rgba(245,158,11,0.12)' : 'var(--color-bg-surface-highest)',
                                  borderRadius: 3,
                                  padding: '2px 6px',
                                  whiteSpace: 'nowrap',
                                }}>
                                  {s.source === 'builtin' ? '官方' : s.source === 'project' ? '项目' : '全局'}
                                </span>
                              </td>
                              <td style={{ padding: '6px 8px', fontSize: 12, color: 'var(--color-text-muted)' }}>{s.desc}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                )}

                {commandPanel.type === 'agents' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 7 }}>RUNNING ({commandPanel.running.length})</div>
                      {commandPanel.running.length === 0
                        ? <p style={{ fontSize: 12, color: 'var(--color-text-disabled)' }}>当前会话无运行中的 Agent</p>
                        : <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <tbody>{commandPanel.running.map(r => (
                              <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                                <td style={{ padding: '5px 0', width: 12 }}><span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--color-accent-primary)' }} /></td>
                                <td style={{ padding: '5px 8px', fontSize: 12, color: 'var(--color-text-secondary)' }}>{r.task}</td>
                              </tr>
                            ))}</tbody>
                          </table>
                      }
                    </div>
                    <div style={{ height: 1, background: 'var(--color-border-subtle)' }} />
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 7 }}>LIBRARY ({commandPanel.library.length})</div>
                      {commandPanel.library.length === 0
                        ? <p style={{ fontSize: 12, color: 'var(--color-text-disabled)' }}>暂无定义的 Agent</p>
                        : <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <tbody>{commandPanel.library.map(a => (
                              <tr key={a.name} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                                <td style={{ padding: '6px 0', width: 200 }}><span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--color-text-secondary)', fontWeight: 600 }}>{a.name}</span></td>
                                <td style={{ padding: '6px 8px', fontSize: 12, color: 'var(--color-text-muted)' }}>{a.desc}</td>
                              </tr>
                            ))}</tbody>
                          </table>
                      }
                    </div>
                  </div>
                )}

                {commandPanel.type === 'hooks' && (
                  commandPanel.events.length === 0
                    ? <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>暂无配置的 Hook</p>
                    : <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <tbody>{commandPanel.events.flatMap(ev => ev.groups.map((g, gi) => (
                          <tr key={`${ev.event}-${gi}`} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                            {gi === 0 && <td style={{ padding: '6px 0', verticalAlign: 'top' }} rowSpan={ev.groups.length}><span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--color-text-secondary)', fontWeight: 600 }}>{ev.event}</span></td>}
                            <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>{g.commands.map((c, ci) => <div key={ci} style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>{c}</div>)}</td>
                          </tr>
                        )))}</tbody>
                      </table>
                )}

                {commandPanel.type === 'mcp' && (
                  commandPanel.servers.length === 0
                    ? <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>暂无配置的 MCP 服务器</p>
                    : <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <tbody>{commandPanel.servers.map(s => (
                          <tr key={`${s.scope}-${s.name}`} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                            <td style={{ padding: '6px 0', width: 140 }}><span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--color-text-secondary)', fontWeight: 600 }}>{s.name}</span></td>
                            <td style={{ padding: '6px 8px', width: 84 }}><span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{s.overriddenBy ? `${s.scope}→${s.overriddenBy}` : s.scope}</span></td>
                            <td style={{ padding: '6px 8px', width: 70 }}><span style={{ fontSize: 10, color: 'var(--color-accent-primary)', background: 'rgba(245,158,11,0.12)', borderRadius: 3, padding: '2px 6px' }}>{s.transport}</span></td>
                            <td style={{ padding: '6px 8px', fontSize: 11, fontFamily: 'monospace', color: 'var(--color-text-muted)', wordBreak: 'break-all' }}>{s.addr}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                )}

                {commandPanel.type === 'help' && (() => {
                  const local   = commandPanel.commands.filter(c => c.client && !c.badge)
                  const backend = commandPanel.commands.filter(c => !c.client && !c.badge)
                  const skills  = commandPanel.commands.filter(c => c.badge === 'Skill')
                  const agents  = commandPanel.commands.filter(c => c.badge === 'Agent')
                  const Section = ({ title, cmds }: { title: string; cmds: SlashCmd[] }) => cmds.length === 0 ? null : (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 6, textTransform: 'uppercase' }}>{title}</div>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <tbody>{cmds.map(c => (
                          <tr key={c.name} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                            <td style={{ padding: '5px 0', verticalAlign: 'top', whiteSpace: 'nowrap', width: 1 }}><span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--color-accent-primary)', fontWeight: 600 }}>{c.name}</span></td>
                            <td style={{ padding: '5px 10px', verticalAlign: 'top', whiteSpace: 'nowrap', width: 1 }}>{c.args && <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>{c.args}</span>}</td>
                            <td style={{ padding: '5px 0', fontSize: 12, color: 'var(--color-text-secondary)', verticalAlign: 'top' }}>{c.desc}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )
                  return <div><Section title="本地命令" cmds={local} /><Section title="技能 Skills" cmds={skills} /><Section title="Sub-Agents" cmds={agents} /><Section title="转发至 Claude Code" cmds={backend} /></div>
                })()}
              </div>
            )}

            {notification && (
              <div style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--theme-bg-surface)', border: '1px solid var(--theme-border-strong)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap', flex: 1 }}>{notification}</span>
                <button onClick={() => setNotification(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', flexShrink: 0 }}><X size={12} /></button>
              </div>
            )}

            {error && (
              <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <p style={{ fontSize: 12, color: '#ef4444' }}>{error}</p>
              </div>
            )}

            {isCompacting && (
              <div style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 9 }}>
                <div style={{
                  fontSize: 13,
                  color: 'var(--color-text-secondary)',
                  background: 'var(--theme-bg-raised)',
                  border: '1px solid var(--theme-border-strong)',
                  borderRadius: 12,
                  padding: '6px 14px',
                  boxShadow: 'var(--theme-shadow-soft)',
                }}>
                  /compact
                </div>
                <div className="compact-fold-card">
                  <div className="compact-fold-label">
                    <CompactIcon size={13} strokeWidth={2.2} />
                    <span>正在压缩上下文…</span>
                  </div>
                  <div className="compact-fold-track">
                    <div className="compact-fold-core" />
                  </div>
                  {compactingText && (
                    <div style={{
                      marginTop: 8,
                      fontSize: 11,
                      color: 'var(--color-text-muted)',
                      whiteSpace: 'pre-wrap',
                      lineHeight: 1.6,
                    }}>
                      {compactingText}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>
      )}

      {session && showScrollToBottom && (
        <button
          type="button"
          onClick={() => scrollToBottom('smooth')}
          className={cn('chat-scroll-bottom-button', streaming && 'is-streaming')}
          style={{
            position: 'absolute',
            right: 28,
            bottom: 112,
            width: 38,
            height: 38,
            borderRadius: '50%',
            border: '1px solid var(--theme-border-strong)',
            background: 'var(--theme-bg-surface)',
            color: 'var(--color-text-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            zIndex: 35,
            boxShadow: 'var(--theme-shadow-popover)',
          }}
          title="回到底部"
          aria-label="回到底部"
        >
          <ChevronDown size={18} strokeWidth={2.2} />
        </button>
      )}

      {/* ── Input Area ── */}
      <div style={{ padding: '12px', flexShrink: 0 }}>
        {/* Attachment previews */}
        {(attachments.length > 0 || pendingAttachments.length > 0 || (imageGenMode && imageGenSettings.referenceImages.length > 0)) && (
          <div style={{ width: '100%', margin: '0 0 10px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {pendingAttachments.map(p => (
              <div key={p.id} style={{ position: 'relative', borderRadius: 5, padding: 6, width: 200, background: 'var(--theme-bg-raised)', border: '1px solid var(--theme-border)', overflow: 'hidden', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 4, background: 'var(--theme-bg-surface)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Loader2 size={16} className="animate-spin" style={{ color: '#F59E0B' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</p>
                    <p style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{p.progress}%</p>
                  </div>
                </div>
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: 'var(--color-border-subtle)' }}>
                  <div style={{ width: `${p.progress}%`, height: '100%', background: '#F59E0B', transition: 'width 0.15s' }} />
                </div>
              </div>
            ))}
            {attachments.map((a, i) => {
              const cfg = a.isImage ? null : getChipConfig(a.name, a.tier)
              const placeholder = getPlaceholder(a)
              const serveUrl = `/api/files/serve/${a.filename}`
              const previewFilename = a.displayFilename || a.originalFilename || a.filename
              const previewUrl = `/api/files/serve/${previewFilename}`
              const previewName = a.name
              const previewMimeType = a.displayMimeType || a.mimeType
              const ext = (previewName.split('.').pop()?.toLowerCase() || '')
              const isPptLike = ['ppt', 'pptx', 'odp'].includes(ext)
              const isPreviewable = !isPptLike
              const readableLabel = attachmentReadableLabel(a)
              return (
                <div
                  key={i}
                  className="group/att"
                  style={{ position: 'relative', borderRadius: 5, padding: 6, maxWidth: 216, background: 'var(--theme-bg-raised)', border: a.readable === false ? '1px solid #ef4444' : '1px solid var(--theme-border)', cursor: 'pointer', flexShrink: 0 }}
                  title={isPreviewable ? '点击预览' : `点击插入 ${placeholder}`}
                  onClick={() => isPreviewable
                    ? setPreviewFile({ url: previewUrl, originalFilename: a.originalFilename, name: previewName, mimeType: previewMimeType })
                    : a.readable === false
                      ? showNotification(`${a.name} 当前无法作为聊天上下文读取。`)
                      : insertPlaceholder(placeholder)
                  }
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {a.isImage ? (
                      <div style={{ width: 40, height: 40, borderRadius: 4, overflow: 'hidden', flexShrink: 0, position: 'relative' }}>
                        <img src={serveUrl} alt={a.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        <span style={{ position: 'absolute', bottom: 2, right: 2, fontSize: 9, fontWeight: 700, color: 'white', background: 'rgba(0,0,0,0.6)', borderRadius: 3, padding: '1px 3px' }}>#{a.num}</span>
                      </div>
                    ) : (
                      <div style={{ width: 40, height: 40, borderRadius: 4, background: cfg!.color, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                        {cfg!.icon === 'video'
                          ? <FileVideo size={18} style={{ color: 'white' }} />
                          : <span style={{ fontSize: cfg!.letter.length > 2 ? 9 : cfg!.letter.length > 1 ? 11 : 14, fontWeight: 700, color: 'white', fontFamily: 'monospace', lineHeight: 1 }}>{cfg!.letter}</span>
                        }
                        <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.7)', lineHeight: 1 }}>#{a.num}</span>
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</p>
                      <p style={{ fontSize: 10, color: a.readable === false ? '#ef4444' : 'var(--color-text-muted)' }}>{readableLabel}{a.size ? ` · ${formatFileSize(a.size)}` : ''}</p>
                      <p style={{ fontSize: 9, color: 'var(--color-text-disabled)', fontFamily: 'monospace' }}>{placeholder}</p>
                    </div>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); removeAttachment(i) }}
                    className="opacity-0 group-hover/att:opacity-100 transition-opacity"
                    style={{ position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer' }}
                  >
                    <X size={8} style={{ color: 'white' }} />
                  </button>
                </div>
              )
            })}
            {imageGenMode && imageGenSettings.referenceImages.map((img, i) => (
              <div
                key={`${img.serverFilename || img.url}-${i}`}
                className="group/att"
                style={{ position: 'relative', borderRadius: 5, padding: 6, maxWidth: 216, background: 'var(--theme-bg-raised)', border: '1px solid var(--theme-border)', cursor: 'pointer', flexShrink: 0 }}
                title="点击预览"
                onClick={() => setPreviewFile({ url: img.url, name: img.name, mimeType: img.mimeType })}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 4, overflow: 'hidden', flexShrink: 0, position: 'relative' }}>
                    <img src={img.url} alt={img.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{img.name}</p>
                    <p style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>参考图</p>
                  </div>
                </div>
                <button
                  onClick={e => {
                    e.stopPropagation()
                    setImageGenSettings(prev => ({
                      ...prev,
                      referenceImages: prev.referenceImages.filter((_, idx) => idx !== i),
                    }))
                  }}
                  className="opacity-0 group-hover/att:opacity-100 transition-opacity"
                  style={{ position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer' }}
                  title="移除参考图"
                >
                  <X size={8} style={{ color: 'white' }} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ width: '100%', position: 'relative' }}>
          {!hideWorkspaceBar && <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minHeight: 28 }}>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                height: 26,
                padding: '0 9px',
                borderRadius: 6,
                border: '1px solid var(--color-border-subtle)',
                background: 'var(--theme-bg-raised)',
                color: 'var(--color-text-secondary)',
                fontSize: 11,
                fontWeight: 500,
              }}>
                Local
              </span>

              <div ref={workspaceRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => { setWorkspaceOpen(!workspaceOpen); setPermOpen(false); setThinkOpen(false); setModelOpen(false) }}
                  disabled={!canCompose}
                  title={effectiveWorkspacePath || 'Loom 默认工作目录'}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    maxWidth: 220,
                    height: 26,
                    padding: '0 9px',
                    borderRadius: 6,
                    border: workspaceIsDefault ? '1px solid var(--theme-border-strong)' : '1px solid var(--theme-border)',
                    background: workspaceIsDefault ? 'var(--theme-bg-active)' : 'var(--theme-bg-raised)',
                    color: workspaceIsDefault ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
                    fontSize: 11,
                    cursor: canCompose ? 'pointer' : 'default',
                    opacity: canCompose ? 1 : 0.5,
                  }}
                >
                  <Folder size={13} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {basename(effectiveWorkspacePath)}
                  </span>
                  <ChevronDown size={11} style={{ flexShrink: 0 }} />
                </button>

                {workspaceOpen && (
                  <div style={{
                    position: 'absolute',
                    bottom: 'calc(100% + 8px)',
                    left: 0,
                    zIndex: 60,
                    width: 260,
                    padding: 6,
                    borderRadius: 10,
                    border: '1px solid var(--theme-border-strong)',
                    background: 'var(--theme-bg-surface)',
                    boxShadow: 'var(--theme-shadow-popover)',
                  }}>
                    <p style={{ fontSize: 10, color: '#6b5a47', padding: '4px 8px 6px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Recent</p>
                    {[...new Set([effectiveWorkspacePath, ...recentWorkspacePaths].filter((p): p is string => Boolean(p)))].slice(0, 8).map(path => {
                      const active = path === effectiveWorkspacePath
                      return (
                        <button
                          key={path}
                          onClick={() => { onChooseWorkspace?.(path); setWorkspaceOpen(false) }}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '7px 8px',
                            borderRadius: 7,
                            border: 'none',
                            background: active ? 'var(--theme-bg-active)' : 'transparent',
                            color: active ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                        >
                          <Check size={12} style={{ opacity: active ? 1 : 0, flexShrink: 0 }} />
                          <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{basename(path)}</span>
                        </button>
                      )
                    })}
                    <div style={{ height: 1, background: 'var(--color-border-subtle)', margin: '5px 2px' }} />
                    <button
                      onClick={() => { onChooseWorkspace?.(); setWorkspaceOpen(false) }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '7px 8px',
                        borderRadius: 7,
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--color-text-secondary)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontSize: 12,
                      }}
                    >
                      <Folder size={13} />
                      Open folder...
                    </button>
                  </div>
                )}
              </div>

              {workspaceBranch && (
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  height: 26,
                  maxWidth: 160,
                  padding: '0 9px',
                  borderRadius: 6,
                  border: '1px solid var(--theme-border)',
                  background: 'var(--theme-bg-raised)',
                  color: 'var(--color-text-muted)',
                  fontSize: 11,
                }}>
                  <GitBranch size={12} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{workspaceBranch}</span>
                </span>
              )}

              <button
                onClick={() => onToggleWorktree?.(!useWorktree)}
                disabled={!canCompose}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 26,
                  padding: '0 9px',
                  borderRadius: 6,
                  border: useWorktree ? '1px solid var(--theme-border-strong)' : '1px solid var(--theme-border)',
                  background: useWorktree ? 'var(--theme-bg-active)' : 'var(--theme-bg-raised)',
                  color: useWorktree ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
                  fontSize: 11,
                  cursor: canCompose ? 'pointer' : 'default',
                  opacity: canCompose ? 1 : 0.5,
                }}
              >
                <span style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  border: useWorktree ? '1px solid var(--color-accent-primary)' : '1px solid var(--color-text-disabled)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  {useWorktree && <Check size={9} />}
                </span>
                worktree
              </button>

              {attachedFolderPaths.slice(0, 3).map(path => (
                <span
                  key={path}
                  title={path}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    maxWidth: 150,
                    height: 26,
                    padding: '0 9px',
                    borderRadius: 6,
                    border: '1px solid var(--theme-border)',
                    background: 'var(--theme-bg-raised)',
                    color: 'var(--color-text-muted)',
                    fontSize: 11,
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{basename(path)}</span>
                </span>
              ))}
              {attachedFolderPaths.length > 3 && (
                <span style={{ fontSize: 11, color: 'var(--color-text-disabled)' }}>+{attachedFolderPaths.length - 3}</span>
              )}

              <button
                onClick={onAddAttachedFolder}
                disabled={!canCompose}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 28,
                  height: 26,
                  borderRadius: 6,
                  border: '1px solid var(--theme-border)',
                  background: 'var(--theme-bg-raised)',
                  color: 'var(--color-text-muted)',
                  cursor: canCompose ? 'pointer' : 'default',
                  opacity: canCompose ? 1 : 0.5,
                }}
                title="添加附加目录"
              >
                <span style={{ position: 'relative', width: 16, height: 16, display: 'block' }}>
                  <Folder size={15} style={{ position: 'absolute', left: 0, top: 0 }} />
                  <Plus size={8} style={{ position: 'absolute', right: -3, bottom: -2, background: 'var(--theme-bg-raised)', borderRadius: '50%' }} />
                </span>
              </button>
          </div>}

          {/* Slash command picker */}
          {showPicker && (
            <div style={{
              position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, right: 0, zIndex: 50,
              background: 'var(--theme-bg-surface)', border: '1px solid var(--theme-border-strong)',
              borderRadius: 10, boxShadow: 'var(--theme-shadow-popover)', overflow: 'hidden',
            }}>
              <div style={{ padding: '4px 0' }}>
                {filteredCmds.map((cmd, i) => {
                  const isActive = i === pickerIdx
                  return (
                    <button
                      key={cmd.name}
                      onMouseDown={e => {
                        e.preventDefault()
                        if (cmd.dynamic || cmd.args.startsWith('<') || cmd.args.startsWith('[')) {
                          const currentArgs = input.trim().slice(cmd.name.length).trimStart()
                          setInput(cmd.name + (currentArgs ? ' ' + currentArgs : ' '))
                          textareaRef.current?.focus()
                        } else {
                          execCommand(cmd, '')
                        }
                      }}
                      onMouseEnter={() => setPickerIdx(i)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        width: '100%', padding: '7px 14px', border: 'none', cursor: 'pointer', textAlign: 'left',
                        background: isActive ? 'rgba(245,158,11,0.10)' : 'transparent', transition: 'background 0.1s',
                      }}
                    >
                      <span style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600, color: isActive ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)', whiteSpace: 'nowrap', flexShrink: 0, width: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {cmd.name}
                      </span>
                      {cmd.args && <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--color-text-disabled)', whiteSpace: 'nowrap', flexShrink: 0 }}>{cmd.args}</span>}
                      {cmd.badge && <span style={{ fontSize: 10, color: 'var(--color-accent-primary)', background: 'rgba(245,158,11,0.13)', borderRadius: 3, padding: '1px 5px', flexShrink: 0, whiteSpace: 'nowrap' }}>{cmd.badge}</span>}
                      <span style={{ fontSize: 11, color: 'var(--color-text-disabled)', flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', textAlign: 'right' }}>{cmd.desc}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Input box ── */}
          <div
            className={cn('rounded-xl transition-colors', isDragging && 'border-amber-500/50')}
            onDragOver={handleComposerDragOver}
            onDrop={handleComposerDrop}
            style={{
              background: 'var(--theme-bg-raised)',
              border: `1px solid ${isDragging ? 'rgba(245,158,11,0.5)' : 'var(--shell-panel-border)'}`,
              boxShadow: 'var(--shell-panel-shadow-soft)',
              position: 'relative',
            }}
          >
            {isDragging && (
              <div style={{ position: 'absolute', inset: 0, borderRadius: 12, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, pointerEvents: 'none', background: 'rgba(245,158,11,0.06)', border: '2px dashed rgba(245,158,11,0.35)' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.8 }}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span style={{ fontSize: 12, color: '#c4a46b' }}>松开以添加附件</span>
              </div>
            )}

            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={imageGenMode ? '描述要生成的图像...' : streaming ? 'AI 正在处理中...' : missingWorkspace ? '请先选择工作目录...' : canCompose ? '和 AI 助手对话...' : '请先创建会话'}
              disabled={imageGenMode ? (!canUseImageComposer || isCompacting) : (!canCompose || isCompacting || missingWorkspace)}
              rows={1}
              className="chat-composer-textarea w-full bg-transparent resize-none outline-none text-[13px] leading-relaxed"
              style={{
                padding: '14px 16px 10px 16px',
                color: 'var(--color-text-primary)',
                minHeight: 80,
                maxHeight: 160,
                display: 'block',
                boxShadow: 'none',
              }}
            />

            {/* Toolbar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', height: 44 }}>
              {/* Image gen mode toolbar (replaces left section) */}
              {imageGenMode && imageGenConfig ? (
                <ImageGenToolbar
                  config={imageGenConfig}
                  settings={imageGenSettings}
                  onSettingsChange={partial => setImageGenSettings(prev => ({ ...prev, ...partial }))}
                  onClose={() => setImageGenMode(false)}
                  disabled={!canUseImageComposer || imageGenSubmitting}
                />
              ) : (
              /* Left: attach + permission */
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input ref={fileInputRef} type="file" className="hidden" multiple accept={Array.from(SUPPORTED_EXTENSIONS).join(',')} onChange={e => handleFileUpload(e.target.files)} />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!canCompose || missingWorkspace}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 6, background: 'none', border: 'none', cursor: canCompose ? 'pointer' : 'default', color: 'var(--color-text-muted)' }}
                  title="附件"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
                <button
                  onClick={openCaptureArea}
                  disabled={!canCompose || missingWorkspace}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 6, background: 'none', border: 'none', cursor: canCompose ? 'pointer' : 'default', color: 'var(--color-text-muted)' }}
                  title="区域截图 (⌘⇧X / Ctrl⇧X)"
                >
                  <Scissors size={14} />
                </button>
                {showMemoryDebug && (
                  <button
                    onClick={openPromptPreview}
                    disabled={!canCompose || missingWorkspace || promptPreviewLoading}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 6, background: 'none', border: 'none', cursor: canCompose ? 'pointer' : 'default', color: promptPreviewOpen ? 'var(--color-accent-primary)' : 'var(--color-text-muted)' }}
                    title="输入结构预览"
                  >
                    {promptPreviewLoading ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                  </button>
                )}

                {/* Permission mode */}
                <div ref={permRef} style={{ position: 'relative' }}>
                  <button
                    onClick={() => { setPermOpen(!permOpen); setModelOpen(false); setThinkOpen(false) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, height: 32,
                      border: activeMode === 'plan' ? '1px solid rgba(245,158,11,0.45)' : '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 7, padding: '0 10px',
                      background: activeMode === 'plan' ? 'rgba(245,158,11,0.13)' : 'transparent',
                      color: activeMode === 'plan' ? '#F59E0B' : 'var(--color-text-muted)',
                      cursor: 'pointer', fontSize: 11,
                    }}
                  >
                    {(() => { const Icon = PERMISSION_OPTIONS.find(p => p.value === activeMode)?.icon || Shield; return <Icon size={13} /> })()}
                    <span style={{ marginLeft: 2 }}>{PERMISSION_OPTIONS.find(p => p.value === activeMode)?.label || 'Confirm'}</span>
                    <ChevronDown size={11} />
                  </button>
                  {permOpen && (
                    <div style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, minWidth: 190, background: 'var(--theme-bg-surface)', border: '1px solid var(--theme-border-strong)', borderRadius: 10, boxShadow: 'var(--theme-shadow-popover)', padding: 6, zIndex: 50 }}>
                      <p style={{ fontSize: 10, color: '#6b5a47', padding: '4px 10px 6px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>权限模式</p>
                      {PERMISSION_OPTIONS.map(p => {
                        const Icon = p.icon
                        const active = activeMode === p.value
                        return (
                          <button
                            key={p.value}
                            onClick={() => {
                              if (p.value === 'plan') { setPlanMode(true) }
                              else { setPlanMode(false); setPermissionMode(p.value) }
                              setPermOpen(false)
                            }}
                            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '7px 10px', borderRadius: 7, background: active ? 'rgba(245,158,11,0.12)' : 'transparent', border: 'none', cursor: 'pointer' }}
                            onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--theme-bg-hover)' }}
                            onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                          >
                            <Icon size={14} style={{ color: active ? '#F59E0B' : '#a08e7a', flexShrink: 0 }} />
                            <span style={{ fontSize: 12, color: active ? '#F59E0B' : '#d8c3ad', fontWeight: active ? 500 : 400, flex: 1, textAlign: 'left' }}>{p.label}</span>
                            {active && <Check size={12} style={{ color: '#F59E0B' }} />}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Image generation entry button */}
                {imageGenConfig?.enabled && (
                  <>
                    <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.1)', margin: '0 2px' }} />
                    <button
                      onClick={() => setImageGenMode(true)}
                      disabled={!canUseImageComposer}
                      title="图像生成"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 5, height: 32,
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 7, padding: '0 10px',
                        background: 'transparent',
                        color: 'var(--color-text-muted)',
                        cursor: canUseImageComposer ? 'pointer' : 'default',
                        fontSize: 12, whiteSpace: 'nowrap',
                      }}
                      onMouseEnter={e => { if (canUseImageComposer) (e.currentTarget as HTMLElement).style.background = 'var(--theme-bg-hover)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21 15 16 10 5 21" />
                      </svg>
                      <span>图像生成</span>
                    </button>
                  </>
                )}
              </div>
              )}

              {/* Center: context bars + compact suggestion */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'center', position: 'relative' }}>
                {!imageGenMode && contextUsed > 0 && (
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', padding: 0 }}
                    title={contextUsageTitle}
                  >
                    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                      {Array.from({ length: 10 }, (_, i) => (
                        <div
                          key={i}
                          style={{
                            width: 7,
                            height: 14,
                            borderRadius: 2,
                            background: i < Math.ceil(contextPct / 10) ? contextColor : 'var(--theme-border-strong)',
                            boxShadow: i < Math.ceil(contextPct / 10) ? 'none' : 'inset 0 0 0 1px var(--theme-border)',
                            transition: 'background 0.3s',
                          }}
                        />
                      ))}
                    </div>
                    <span style={{ fontSize: 11, color: contextPct >= 75 ? contextColor : '#a08e7a', lineHeight: 1, whiteSpace: 'nowrap' }}>
                      {contextPctLabel} <span style={{ color: '#6b5a47' }}>of {contextMaxLabel} tokens</span>
                    </span>
                  </div>
                )}
                {!imageGenMode && contextPct >= 60 && (
                  <button
                    onClick={() => compact()}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 10,
                      color: contextPct >= 90 ? '#ef4444' : '#f97316',
                      padding: '2px 6px',
                      borderRadius: 4,
                      border: `1px solid ${contextPct >= 90 ? 'rgba(239,68,68,0.35)' : 'rgba(249,115,22,0.3)'}`,
                      background: contextPct >= 90 ? 'rgba(239,68,68,0.08)' : 'rgba(249,115,22,0.06)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <CompactIcon size={11} strokeWidth={2.3} />
                    {contextPct >= 85 ? '立即 /compact' : '/compact 建议'}
                  </button>
                )}
              </div>

              {/* Right: thinking + model + send/stop */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {/* Thinking mode */}
                <div ref={thinkRef} style={{ position: 'relative' }}>
                  <button
                    onClick={() => { setThinkOpen(!thinkOpen); setModelOpen(false); setPermOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, border: '1px solid var(--theme-border)', borderRadius: 7, padding: '0 10px', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 11 }}
                  >
                    {(() => { const Icon = THINKING_OPTIONS.find(t => t.value === thinkingMode)?.icon || Zap; return <Icon size={13} /> })()}
                    Think: {THINKING_OPTIONS.find(t => t.value === thinkingMode)?.label || 'Auto'}
                    <ChevronDown size={11} />
                  </button>
                  {thinkOpen && (
                    <div style={{ position: 'absolute', bottom: 'calc(100% + 8px)', right: 0, minWidth: 190, background: 'var(--theme-bg-surface)', border: '1px solid var(--theme-border-strong)', borderRadius: 10, boxShadow: 'var(--theme-shadow-popover)', padding: 6, zIndex: 50 }}>
                      <p style={{ fontSize: 10, color: '#6b5a47', padding: '4px 10px 6px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>推理深度</p>
                      {THINKING_OPTIONS.map(t => {
                        const Icon = t.icon
                        const active = thinkingMode === t.value
                        return (
                          <button
                            key={t.value}
                            onClick={() => { setThinkingMode(t.value as ThinkingMode); setThinkOpen(false) }}
                            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '7px 10px', borderRadius: 7, background: active ? 'rgba(245,158,11,0.12)' : 'transparent', border: 'none', cursor: 'pointer' }}
                            onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--theme-bg-hover)' }}
                            onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                          >
                            <Icon size={14} style={{ color: active ? '#F59E0B' : '#a08e7a', flexShrink: 0 }} />
                            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, textAlign: 'left' }}>
                              <span style={{ fontSize: 12, color: active ? '#F59E0B' : '#d8c3ad', fontWeight: active ? 500 : 400 }}>{t.label}</span>
                              <span style={{ fontSize: 10, color: '#6b5a47', marginTop: 1 }}>{t.desc}</span>
                            </div>
                            {active && <Check size={12} style={{ color: '#F59E0B', flexShrink: 0 }} />}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Model selector */}
                <div ref={modelRef} style={{ position: 'relative', marginLeft: 4 }}>
                  <button
                    onClick={() => { setModelOpen(!modelOpen); setPermOpen(false); setThinkOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, border: '1px solid var(--theme-border)', borderRadius: 7, padding: '0 10px', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 11 }}
                  >
                    {(() => { const Icon = MODEL_ICONS[selectedModel] || Bot; return <Icon size={13} /> })()}
                    {selectedModelOption?.label || formatModelShort(selectedModel)}
                    <ChevronDown size={11} />
                  </button>
                  {modelOpen && (
                    <div style={{ position: 'absolute', bottom: 'calc(100% + 8px)', right: 0, minWidth: 210, background: 'var(--theme-bg-surface)', border: '1px solid var(--theme-border-strong)', borderRadius: 10, boxShadow: 'var(--theme-shadow-popover)', padding: 6, zIndex: 50 }}>
                      <p style={{ fontSize: 10, color: '#6b5a47', padding: '4px 10px 6px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>选择模型</p>
                      {availableModels.map(m => {
                        const Icon = MODEL_ICONS[m.id] || Bot
                        const active = selectedModel === m.id
                        const modelName = m.label
                        const modelWindow = resolveContextWindowTokens({
                          logicalModel: m.id,
                          actualModel: m.actualModel,
                          providerConfig: activeProviderConfig,
                          catalogContextWindowTokens: m.contextWindowTokens,
                          fallbackTokens: contextWindowFallback,
                        })
                        const version = `${m.actualModel || '由全局 Settings 实时解析'} · ${formatContextWindowTokens(modelWindow.tokens)}`
                        return (
                          <button
                            key={m.id}
                            onClick={() => handleModelChange(m.id)}
                            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '7px 10px', borderRadius: 7, background: active ? 'rgba(245,158,11,0.12)' : 'transparent', border: 'none', cursor: 'pointer' }}
                            onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--theme-bg-hover)' }}
                            onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                          >
                            <Icon size={14} style={{ color: active ? '#F59E0B' : '#a08e7a', flexShrink: 0 }} />
                            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, textAlign: 'left' }}>
                              <span style={{ fontSize: 12, color: active ? '#F59E0B' : '#d8c3ad', fontWeight: active ? 500 : 400 }}>{modelName}</span>
                              {version && <span style={{ fontSize: 10, color: '#6b5a47', marginTop: 1 }}>{version}</span>}
                            </div>
                            {active && <Check size={12} style={{ color: '#F59E0B', flexShrink: 0 }} />}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Send / Stop */}
                {/* In image gen mode always show send button; stop button is only for AI chat */}
                {streaming && !imageGenMode ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 4 }}>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Esc 中断</span>
                    <button
                      onClick={stopStreaming}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 8, background: '#ef4444', border: 'none', cursor: 'pointer' }}
                      title="停止 (Esc)"
                    >
                      <Square size={14} fill="white" style={{ color: 'white' }} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={imageGenMode ? !canSubmitImagePrompt : (!canCompose || missingWorkspace || (!input.trim() && attachments.length === 0))}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 32, height: 32, borderRadius: 8, marginLeft: 4,
                      background: (imageGenMode ? canSubmitImagePrompt : (canCompose && !missingWorkspace && (!!input.trim() || attachments.length > 0))) ? '#F59E0B' : 'rgba(245,158,11,0.2)',
                      border: 'none', cursor: (imageGenMode ? canSubmitImagePrompt : (canCompose && !missingWorkspace && (!!input.trim() || attachments.length > 0))) ? 'pointer' : 'default',
                      color: (imageGenMode ? canSubmitImagePrompt : (canCompose && !missingWorkspace && (!!input.trim() || attachments.length > 0))) ? '#000' : 'rgba(245,158,11,0.4)',
                    }}
                    title={imageGenMode ? '生成图像 (Enter)' : '发送 (Enter)'}
                  >
                    <ArrowUp size={15} />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 8, minHeight: 28 }}>
            <p style={{ fontSize: 11, color: 'var(--color-text-disabled)', textAlign: 'center' }}>
              Enter 发送 · Shift+Enter 换行
            </p>
          </div>
          {showMemoryDebug && promptPreviewOpen && (
            <div style={{
              marginTop: 8,
              borderRadius: 12,
              border: '1px solid var(--theme-border-strong)',
              background: 'var(--theme-bg-surface)',
              boxShadow: 'var(--theme-shadow-soft)',
              padding: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <Eye size={13} style={{ color: 'var(--color-accent-primary)' }} />
                  <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-primary)' }}>发送前输入结构预览</span>
                  {promptPreviewData && (
                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                      {promptPreviewData.promptChars.toLocaleString()} chars · {promptPreviewData.preview?.resumeSession ? 'SDK resume' : 'new prompt'}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setPromptPreviewOpen(false)}
                  style={{ border: 'none', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 2 }}
                  title="关闭"
                >
                  <X size={13} />
                </button>
              </div>
              {promptPreviewLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text-muted)', fontSize: 11 }}>
                  <Loader2 size={13} className="animate-spin" />
                  正在生成结构预览
                </div>
              ) : promptPreviewData?.preview?.parts?.length ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                      <th style={previewThStyle}>输入部分</th>
                      <th style={{ ...previewThStyle, width: 90, textAlign: 'right' }}>数量</th>
                      <th style={{ ...previewThStyle, width: 110, textAlign: 'right' }}>字符</th>
                      <th style={{ ...previewThStyle, width: 70, textAlign: 'right' }}>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {promptPreviewData.preview.parts.map(part => (
                      <tr key={part.key} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                        <td style={previewTdStyle}>{part.label}</td>
                        <td style={{ ...previewTdStyle, textAlign: 'right', color: 'var(--color-text-muted)' }}>{part.count ?? '-'}</td>
                        <td style={{ ...previewTdStyle, textAlign: 'right', color: 'var(--color-text-muted)' }}>{typeof part.chars === 'number' ? part.chars.toLocaleString() : '-'}</td>
                        <td style={{ ...previewTdStyle, textAlign: 'right', color: part.truncated ? 'var(--color-accent-danger)' : 'var(--color-text-disabled)' }}>
                          {part.truncated ? '已裁剪' : '正常'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>暂无可预览的输入结构。</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Hidden file input */}
      {/* (already declared above) */}

      {/* File preview panel */}
      {previewFile && <FilePreviewPanel file={previewFile} onClose={() => setPreviewFile(null)} />}
      {windowCaptureOpen && (
        <CaptureWindowOverlay
          onCancel={() => setWindowCaptureOpen(false)}
          onCapture={(dataUrl) => {
            setWindowCaptureOpen(false)
            setCapturePreviewDataUrl(dataUrl)
          }}
        />
      )}
      {capturePreviewDataUrl && (
        <CaptureConfirmDialog
          dataUrl={capturePreviewDataUrl}
          onCancel={() => setCapturePreviewDataUrl(null)}
          onConfirm={() => {
            uploadCapturedImage(capturePreviewDataUrl)
            setCapturePreviewDataUrl(null)
          }}
        />
      )}
    </div>
  )
}

const previewThStyle: React.CSSProperties = {
  padding: '7px 0',
  textAlign: 'left',
  fontSize: 10,
  fontWeight: 800,
  color: 'var(--color-text-muted)',
  whiteSpace: 'nowrap',
}

const previewTdStyle: React.CSSProperties = {
  padding: '8px 0',
  fontSize: 11,
  color: 'var(--color-text-secondary)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}
