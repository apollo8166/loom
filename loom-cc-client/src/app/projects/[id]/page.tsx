'use client'

import { useState, useEffect, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Radio, Send } from 'lucide-react'
import type { Project } from '@/shared/types'
import { useProjectSessions } from '@/modules/projects/use-project-sessions'
import { ProjectSidebar, type ProjectPane } from '@/components/projects/project-sidebar'
import { WorkbenchView } from '@/components/chat/workbench-view'
import { ContextPanel } from '@/components/projects/context-panel'
import type { TaskInfo } from '@/shared/types'
import { ProjectSettingsPane } from '@/components/projects/project-settings-pane'
import { SchedulePane } from '@/components/projects/schedule-pane'
import { ImChannelSettings } from '@/components/settings/im-channel-settings'
import { ProjectManagePane } from '@/components/projects/manage-pane'

interface ProjectPageProps {
  params: Promise<{ id: string }>
}

type ImChannelPanelId = 'feishu'

const IM_CHANNEL_NAV: Array<{ id: ImChannelPanelId; label: string; Icon: React.ElementType }> = [
  { id: 'feishu', label: 'Feishu', Icon: Send },
]

export default function ProjectPage({ params }: ProjectPageProps) {
  const { id: projectId } = use(params)
  const router = useRouter()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [activePane, setActivePane] = useState<ProjectPane>('chat')
  const [chatPreviewOpen, setChatPreviewOpen] = useState(false)
  const [treePreviewOpen, setTreePreviewOpen] = useState(false)
  const previewOpen = chatPreviewOpen || treePreviewOpen
  const [sessionTasks, setSessionTasks] = useState<Map<string, TaskInfo>>(new Map())
  const [pendingAutoSend, setPendingAutoSend] = useState<{
    sessionId: string; displayPrompt: string; effectivePrompt: string; execUpdateUrl?: string
    permissionMode?: string; thinkingMode?: string; planMode?: boolean
    agentName?: string
    enabledSkills?: string[]
    attachments?: Array<{ name: string; filename: string; mimeType: string; tier: string; originalFilename?: string }>
  } | null>(null)

  type SessionDraft = { workspacePath: string | null; attachedFolderPaths: string[]; useWorktree: boolean }
  const [sessionDraft, setSessionDraft] = useState<SessionDraft | null>(null)

  const {
    sessions,
    activeSession,
    activeSessionId,
    runningSessionIds,
    createSession,
    selectSession,
    upsertLocalSession,
    updateSession,
    deleteSession,
    refetch: refetchSessions,
  } = useProjectSessions(projectId)

  useEffect(() => {
    async function fetchProject() {
      try {
        setLoading(true)
        const res = await fetch(`/api/projects/${projectId}`)
        if (!res.ok) { router.push('/projects'); return }
        const data = await res.json()
        setProject(data.project)
      } catch {
        router.push('/projects')
      } finally {
        setLoading(false)
      }
    }
    fetchProject()
  }, [projectId, router])

  const handleSelectSession = useCallback((sessionId: string) => {
    setSessionDraft(null)
    selectSession(sessionId)
    setActivePane('chat')
  }, [selectSession])

  const handleNewSession = useCallback(() => {
    setSessionDraft({
      workspacePath: project?.workspacePath ?? null,
      attachedFolderPaths: [],
      useWorktree: false,
    })
    setActivePane('chat')
  }, [project?.id, project?.workspacePath])

  useEffect(() => {
    const handler = () => handleNewSession()
    document.addEventListener('loom:new-session', handler)
    return () => document.removeEventListener('loom:new-session', handler)
  }, [handleNewSession])

  useEffect(() => {
    const source = new EventSource(`/api/projects/${projectId}/events`)
    const seenEventIds = new Set<number>()
    source.onmessage = event => {
      let data: Record<string, unknown>
      try {
        data = JSON.parse(event.data) as Record<string, unknown>
      } catch {
        return
      }
      const eventId = Number(data.eventId || 0)
      if (eventId > 0) {
        if (seenEventIds.has(eventId)) return
        seenEventIds.add(eventId)
      }
      if (data.type !== 'im_session_activity') return
      const sessionId = data.sessionId
      if (typeof sessionId !== 'string' || !sessionId) return
      const now = new Date().toISOString()
      setSessionDraft(null)
      setActivePane('chat')
      upsertLocalSession({
        id: sessionId,
        projectId,
        title: typeof data.title === 'string' && data.title ? data.title : '[Feishu] Conversation',
        model: typeof data.model === 'string' && data.model ? data.model : project?.defaultModel || 'claude-sonnet-4-6',
        runtimeSessionId: typeof data.runtimeSessionId === 'string' ? data.runtimeSessionId : null,
        status: 'active',
        contextVersion: 0,
        compactSummary: null,
        workspacePath: typeof data.workspacePath === 'string' ? data.workspacePath : project?.workspacePath ?? null,
        attachedFolderPaths: [],
        useWorktree: false,
        runtimeTarget: 'local',
        createdAt: now,
        updatedAt: now,
        lastMessageAt: now,
      })
      refetchSessions().finally(() => selectSession(sessionId))
    }
    return () => source.close()
  }, [project?.defaultModel, project?.workspacePath, projectId, refetchSessions, selectSession, upsertLocalSession])

  const handleCreateAndSend = useCallback(async (params: {
    message: string
    effectiveMessage?: string
    enabledSkills?: string[]
    permissionMode: string
    thinkingMode: string
    attachments?: Array<{ name: string; filename: string; mimeType: string; tier: string; originalFilename?: string }>
    planMode: boolean
  }) => {
    if (!project) return
    const newSession = await createSession(project.defaultModel, 'New Session', {
      workspacePath: sessionDraft?.workspacePath ?? project.workspacePath ?? undefined,
    })
    if (!newSession) return
    setSessionDraft(null)
    setPendingAutoSend({
      sessionId: newSession.id,
      displayPrompt: params.message,
      effectivePrompt: params.effectiveMessage ?? params.message,
      permissionMode: params.permissionMode,
      thinkingMode: params.thinkingMode,
      enabledSkills: params.enabledSkills,
      attachments: params.attachments,
      planMode: params.planMode,
    })
  }, [project, sessionDraft?.workspacePath, createSession])

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    await deleteSession(sessionId)
  }, [deleteSession])

  const handleModelChange = useCallback((model: string) => {
    setProject(prev => prev ? { ...prev, defaultModel: model } : null)
  }, [])

  const handleRenameSession = useCallback(async (sessionId: string, title: string) => {
    await updateSession(sessionId, { title })
  }, [updateSession])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flex: 1 }}>
        <Loader2 size={20} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
      </div>
    )
  }

  if (!project) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flex: 1 }}>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Project not found</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flex: 1, height: '100%', overflow: 'hidden', gap: 'var(--shell-gap)' }}>
      <ProjectSidebar
        project={project}
        sessions={sessions}
        activeSessionId={sessionDraft ? null : activeSessionId}
        runningSessionIds={runningSessionIds}
        onSelect={handleSelectSession}
        onNew={handleNewSession}
        onDelete={handleDeleteSession}
        onRename={handleRenameSession}
        activePane={activePane}
        onPaneChange={setActivePane}
        onBack={() => router.push('/projects')}
        forceCollapsed={previewOpen}
      />

      {activePane === 'chat' ? (
        <>
          <WorkbenchView
            project={project}
            session={sessionDraft ? null : activeSession}
            onNewSession={handleNewSession}
            projectName={project.name}
            onPreviewChange={setChatPreviewOpen}
            onTasksChange={setSessionTasks}
            onModelChange={handleModelChange}
            pendingAutoSend={pendingAutoSend}
            onPendingAutoSendConsumed={() => setPendingAutoSend(null)}
            sessionDraft={sessionDraft}
            onCreateAndSend={handleCreateAndSend}
            workspacePath={project.workspacePath ?? undefined}
            attachedFolderPaths={activeSession?.attachedFolderPaths ?? []}
            useWorktree={activeSession?.useWorktree ?? false}
            hideWorkspaceBar
          />
          <ContextPanel
            projectId={project.id}
            workspacePath={project.workspacePath}
            projectName={project.name}
            tasks={sessionTasks}
            onPreviewChange={setTreePreviewOpen}
          />
        </>
      ) : activePane === 'settings' ? (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: 'var(--shell-panel-bg)', border: '1px solid var(--shell-panel-border)', borderRadius: 'var(--shell-radius-lg)', boxShadow: 'var(--shell-panel-shadow)' }}>
          <ProjectSettingsPane projectId={project.id} />
        </div>
      ) : activePane === 'schedule' ? (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: 'var(--shell-panel-bg)', border: '1px solid var(--shell-panel-border)', borderRadius: 'var(--shell-radius-lg)', boxShadow: 'var(--shell-panel-shadow)' }}>
          <SchedulePane
            projectId={project.id}
            defaultModel={project.defaultModel}
            workspacePath={project.workspacePath}
            projectName={project.name}
            onNavigateToSession={(sessionId, prompts) => {
              refetchSessions()
              handleSelectSession(sessionId)
              if (prompts) {
                setPendingAutoSend({ sessionId, ...prompts })
              }
            }}
          />
        </div>
      ) : activePane === 'im' ? (
        <ProjectImChannelsPane
          projectId={project.id}
          projectName={project.name}
          defaultModel={project.defaultModel}
        />
      ) : activePane === 'manage' ? (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: 'var(--shell-panel-bg)', border: '1px solid var(--shell-panel-border)', borderRadius: 'var(--shell-radius-lg)', boxShadow: 'var(--shell-panel-shadow)' }}>
          <ProjectManagePane projectId={project.id} workspacePath={project.workspacePath} />
        </div>
      ) : (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <p style={{ fontSize: 20 }}>🚧</p>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>
            Marketplace
          </p>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>即将推出</p>
        </div>
      )}
    </div>
  )
}

function ProjectImChannelsPane({
  projectId,
  projectName,
  defaultModel,
}: {
  projectId: string
  projectName: string
  defaultModel: string
}) {
  const [activeChannel, setActiveChannel] = useState<ImChannelPanelId>('feishu')

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      overflow: 'hidden',
      background: 'var(--shell-panel-bg)',
      border: '1px solid var(--shell-panel-border)',
      borderRadius: 'var(--shell-radius-lg)',
      boxShadow: 'var(--shell-panel-shadow)',
    }}>
      <aside style={{
        width: 208,
        flexShrink: 0,
        borderRight: '1px solid var(--shell-panel-border)',
        padding: '14px 10px',
        overflowY: 'auto',
        background: 'var(--shell-panel-bg-muted)',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px 12px',
          color: 'var(--color-text-secondary)',
        }}>
          <Radio size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 700 }}>IM 通道</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {IM_CHANNEL_NAV.map(item => {
            const isActive = activeChannel === item.id
            return (
              <button
                key={item.id}
                onClick={() => setActiveChannel(item.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  width: '100%',
                  padding: '9px 10px',
                  borderRadius: 8,
                  border: isActive ? '1px solid var(--theme-border-strong)' : '1px solid transparent',
                  background: isActive ? 'var(--theme-bg-active)' : 'transparent',
                  color: isActive ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: 12,
                  fontWeight: isActive ? 650 : 500,
                }}
                onMouseEnter={e => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'var(--theme-bg-hover)'
                    e.currentTarget.style.color = 'var(--color-text-secondary)'
                  }
                }}
                onMouseLeave={e => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.color = 'var(--color-text-muted)'
                  }
                }}
              >
                <item.Icon size={14} style={{ flexShrink: 0 }} />
                <span style={{ whiteSpace: 'nowrap' }}>{item.label}</span>
              </button>
            )
          })}
        </div>
      </aside>

      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {activeChannel === 'feishu' && (
          <div style={{ maxWidth: 760 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 6 }}>
              飞书 / Feishu
            </h2>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
              配置当前项目专属的飞书 Bot。
            </p>
            <ImChannelSettings
              projectId={projectId}
              projectName={projectName}
              defaultModel={defaultModel}
            />
          </div>
        )}
      </div>
    </div>
  )
}
