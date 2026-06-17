// ── Scheduled task types ─────────────────────────────────────────────────────

export interface ScheduledTask {
  id: string
  projectId: string
  name: string
  description: string   // human-readable task description
  schedule: string      // 5-field cron expression
  prompt: string        // legacy task prompt; skill tasks are invoked through SDK skills
  agentName: string     // optional main-thread SDK sub-agent to run the task as
  skillName: string     // legacy single-skill storage; may contain a JSON array for multi-skill tasks
  skillNames?: string[] // normalized selected SDK skills
  model: string
  enabled: boolean
  lastRunAt: string | null
  lastRunResult: string | null
  createdAt: string
  updatedAt: string
}

export interface TaskExecution {
  id: string
  taskId: string
  sessionId: string
  status: 'ok' | 'error'
  result: string
  executedAt: string
}

// ── Task types ───────────────────────────────────────────────────────────────

// SDK TaskState.status:      'pending' | 'running' | 'completed' | 'failed' | 'killed' | 'paused'
// task_notification.status:  'completed' | 'failed' | 'stopped'
// 'stopped' comes from task_notification; runtime may pass it through before mapping to 'killed'
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'killed' | 'paused' | 'stopped'

export interface TaskInfo {
  id: string
  description: string
  status: TaskStatus
  subagentType?: string
  taskType?: string
  lastToolName?: string
  summary?: string
  error?: string
  isBackgrounded?: boolean
  startedAt: number
  endedAt?: number
  totalPausedMs?: number
  usage?: { totalTokens: number; toolUses: number; durationMs: number }
}

// ── Core domain types ───────────────────────────────────────────────────────

export interface Project {
  id: string
  name: string
  description: string
  workspacePath: string
  claudeDir: string | null
  defaultModel: string
  isPinned: boolean
  status: 'active' | 'deleted'
  createdAt: string
  updatedAt: string
  lastOpenedAt: string | null
}

export interface Session {
  id: string
  projectId: string
  title: string
  model: string
  runtimeSessionId: string | null
  status: 'active' | 'archived' | 'deleted'
  contextVersion: number
  compactSummary: string | null
  workspacePath: string | null
  attachedFolderPaths?: string[]
  useWorktree?: boolean
  runtimeTarget?: 'local'
  createdAt: string
  updatedAt: string
  lastMessageAt: string | null
}

export interface SessionWithMessages {
  session: Session
  messages: Message[]
}

export interface SessionBoundary {
  id: string
  sessionId: string
  boundaryType: 'clear' | 'compact' | 'manual'
  summary: string | null
  compactSource?: 'sdk' | 'loom' | string
  metadata?: Record<string, unknown>
  createdAt: string
}

/** A group of messages separated by a session_boundary */
export interface SessionBoundaryGroup {
  contextVersion: number
  messages: Message[]
  boundary: SessionBoundary | null // the boundary AFTER this group (null for latest group)
}

export interface SdkContextUsage {
  totalTokens: number
  maxTokens: number
  rawMaxTokens?: number
  percentage: number
  model?: string
  isAutoCompactEnabled?: boolean
  autoCompactThreshold?: number
  categories?: Array<{
    name: string
    tokens: number
    color?: string
    isDeferred?: boolean
  }>
  memoryFiles?: Array<{ path: string; type: string; tokens: number }>
  mcpTools?: Array<{ name: string; serverName: string; tokens: number; isLoaded?: boolean }>
  deferredBuiltinTools?: Array<{ name: string; tokens: number; isLoaded?: boolean }>
  systemTools?: Array<{ name: string; tokens: number }>
  systemPromptSections?: Array<{ name: string; tokens: number }>
  agents?: Array<{ agentType: string; source: string; tokens: number }>
  slashCommands?: {
    totalCommands: number
    includedCommands: number
    tokens: number
  }
  skills?: {
    totalSkills: number
    includedSkills: number
    tokens: number
    skillFrontmatter?: Array<{ name: string; source: string; tokens: number }>
  }
  messageBreakdown?: Record<string, unknown>
  apiUsage?: Record<string, number> | null
}

// ── Content block types ─────────────────────────────────────────────────────

export type PermissionStatus = 'pending' | 'allowed' | 'allowed_session' | 'denied' | 'timeout'
export type AskUserQuestionStatus = 'pending' | 'submitted' | 'cancelled' | 'timeout'

export type AskUserQuestionOption = {
  label: string
  description: string
  preview?: string
}

export type AskUserQuestionItem = {
  question: string
  header: string
  options: AskUserQuestionOption[]
  multiSelect: boolean
}

export type AskUserQuestionAnswers = Record<string, string>
export type AskUserQuestionAnnotations = Record<string, { preview?: string; notes?: string }>

export type ToolRawContent =
  | { type: 'text'; text: string }
  | { type: 'web_search'; results: { title: string; url: string }[] }

export type ThinkingMode = 'off' | 'auto' | 'max'

/** Sub-agent intermediate content block */
export type AgentSubBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error: boolean }
  | { type: 'tool_progress'; tool_use_id: string; tool_name: string; elapsed_time_seconds: number }

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error: boolean }
  | { type: 'tool_raw_result'; tool_use_id: string; tool_name: string; raw_content: ToolRawContent }
  | { type: 'tool_progress'; tool_use_id: string; tool_name: string; elapsed_time_seconds: number }
  | { type: 'agent_content'; parent_tool_use_id: string; blocks: AgentSubBlock[] }
  | { type: 'permission_request'; requestId: string; toolName: string; toolInput: Record<string, unknown>; status: PermissionStatus; toolUseId?: string; toolFailed?: boolean }
  | { type: 'ask_user_question'; requestId: string; questions: AskUserQuestionItem[]; status: AskUserQuestionStatus; toolUseId?: string; answers?: AskUserQuestionAnswers; annotations?: AskUserQuestionAnnotations }
  | { type: 'image_attachment'; url: string; name: string }
  | { type: 'file_attachment'; url: string; name: string; size: number; mimeType: string; originalFilename?: string; displayUrl?: string; displayMimeType?: string }
  | { type: 'task_event'; event: string; task_id: string; payload: Record<string, unknown>; created_at: number }

export interface Message {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  blocks: ContentBlock[]
  createdAt: string
  /** Turn-level stats (only for assistant messages during/after streaming) */
  inputTokens?: number
  outputTokens?: number
  sdkContextUsage?: SdkContextUsage | null
  elapsedSeconds?: number
}
