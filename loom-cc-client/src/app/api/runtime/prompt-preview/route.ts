import { NextRequest, NextResponse } from 'next/server'
import { buildLoomMemoryContext } from '@/shared/memory/retriever'
import type { ContextBudgetSnapshot } from '@/shared/runtime/context-budget'
import { summarizeMemoryContext } from '@/shared/runtime/context-budget'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    message?: string
    workspacePath?: string
    memoryEnabled?: boolean
    sessionId?: string
    projectId?: string
    contextVersion?: number
    providerId?: string
    model?: string
    resolvedModelId?: string
    attachedFolderPaths?: string[]
    existingMsgCount?: number
    resumeSession?: boolean
    compactSummaryChars?: number
    attachmentCount?: number
    attachments?: Array<{ name: string; size?: number; tier?: string; mimeType?: string }>
  }
  const message = body.message || ''
  const memoryContext = buildLoomMemoryContext({
    userMessage: message,
    workspacePath: body.workspacePath,
    enabled: body.memoryEnabled !== false,
    mode: 'sdk',
  })
  const renderedMemory = [
    'Memory 由 Claude Agent SDK / Claude Code 通过 .claude/CLAUDE.md 和 ~/.claude/CLAUDE.md 的 @memory 引用按需加载。',
    memoryContext.debug.globalMemoryFile ? `Global: ${memoryContext.debug.globalMemoryFile}` : '',
    memoryContext.debug.projectMemoryFile ? `Project: ${memoryContext.debug.projectMemoryFile}` : '',
    memoryContext.evolutionSummary?.trim()
      ? `\n${memoryContext.evolutionSummary.trim()}`
      : '',
  ].filter(Boolean).join('\n')
  const promptChars = message.length
  const attachedFolderPaths = body.attachedFolderPaths || []
  const attachments = body.attachments || []
  const riskyAttachmentCount = attachments.filter(attachment =>
    (attachment.size || 0) >= 5 * 1024 * 1024 || attachment.tier === 'pdf'
  ).length
  const preview: ContextBudgetSnapshot = {
    traceId: `preview_${Date.now()}`,
    sessionId: body.sessionId || 'preview',
    contextVersion: body.contextVersion ?? 0,
    providerId: body.providerId || 'current',
    model: body.model || 'current',
    resolvedModelId: body.resolvedModelId || body.model || 'current',
    resumeSession: Boolean(body.resumeSession),
    parts: [
      {
        key: 'system_project',
        label: '系统 / 项目 / 工作区上下文',
        chars: (body.workspacePath || '').length + attachedFolderPaths.join('\n').length,
        count: 1 + attachedFolderPaths.length,
        metadata: {
          workspacePath: body.workspacePath || null,
          attachedFolderCount: attachedFolderPaths.length,
          note: 'Claude Agent SDK / Claude Code 还会注入内部系统上下文，Loom 只能展示结构。',
        },
      },
      {
        key: 'recent_messages',
        label: '会话历史 / SDK resume context',
        count: body.existingMsgCount ?? 0,
        metadata: {
          resumeSession: Boolean(body.resumeSession),
          note: 'SDK resume 时历史由 SDK 管理；fallback 时 Loom 才会拼接受限 recent messages。',
        },
      },
      {
        key: 'compact_summary',
        label: 'Compact 摘要',
        chars: body.compactSummaryChars ?? 0,
        count: body.compactSummaryChars ? 1 : 0,
        metadata: {
          note: 'SDK compact 由 SDK 管理；Loom fallback compact 才会注入摘要。',
        },
      },
      {
        ...summarizeMemoryContext(memoryContext),
        label: 'Memory 文件 / SDK 按需读取',
      },
      {
        key: 'project_evolution',
        label: 'L3/L2/L1 Evolution Context',
        chars: memoryContext.debug.evolutionChars || 0,
        count: (memoryContext.debug.semanticMemoryCount || 0) + (memoryContext.debug.recentObservationCount || 0) + (memoryContext.debug.activeRuleCount || 0),
        metadata: {
          note: 'Constant-size injection: dossier + top semantic memories/rules + recent observations.',
          dossierVersion: memoryContext.debug.dossierVersion,
          semanticMemoryCount: memoryContext.debug.semanticMemoryCount,
          recentObservationCount: memoryContext.debug.recentObservationCount,
          activeRuleCount: memoryContext.debug.activeRuleCount,
        },
      },
      {
        key: 'attachments',
        label: '附件',
        count: body.attachmentCount ?? attachments.length,
        truncated: riskyAttachmentCount > 0,
        metadata: {
          attachments: attachments.slice(0, 12),
          riskyAttachmentCount,
          note: '图片/PDF/文本文件的具体处理取决于类型和 SDK 处理路径。',
        },
      },
      {
        key: 'tool_results',
        label: '工具结果',
        count: 0,
        chars: 0,
        metadata: {
          note: '发送前没有本轮工具结果；执行中产生的结果会由 SDK 管理，Loom 只裁剪 DB/UI 存储。',
        },
      },
      {
        key: 'current_input',
        label: '当前用户输入',
        chars: message.length,
        count: message.trim() ? 1 : 0,
      },
    ],
  }
  return NextResponse.json({
    memoryContext,
    renderedMemory,
    preview,
    promptChars,
  })
}
