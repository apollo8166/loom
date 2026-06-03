'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { Project } from '@/shared/types'
import { useProjectSessions } from '@/modules/projects/use-project-sessions'
import { ProjectSidebar } from '@/components/projects/project-sidebar'
import { WorkbenchView } from '@/components/chat/workbench-view'

type SessionDraft = { workspacePath: string | null; attachedFolderPaths: string[]; useWorktree: boolean }

export default function ChatPage() {
  const [project, setProject] = useState<Project | null>(null)
  const [defaultWorkspacePath, setDefaultWorkspacePath] = useState<string>('')
  const [recentWorkspacePaths, setRecentWorkspacePaths] = useState<string[]>([])
  const [workspaceBranch, setWorkspaceBranch] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const [sessionDraft, setSessionDraft] = useState<SessionDraft | null>(null)
  const [pendingAutoSend, setPendingAutoSend] = useState<{
    sessionId: string; displayPrompt: string; effectivePrompt: string; execUpdateUrl?: string
    permissionMode?: string; thinkingMode?: string; planMode?: boolean
    enabledSkills?: string[]
    attachments?: Array<{ name: string; filename: string; mimeType: string; tier: string; originalFilename?: string }>
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/chat/project')
      .then(r => r.json())
      .then(data => {
        if (!cancelled) {
          setProject(data.project)
          setDefaultWorkspacePath(data.defaultWorkspacePath ?? '')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const {
    sessions,
    activeSession,
    activeSessionId,
    createSession,
    selectSession,
    updateSession,
    deleteSession,
  } = useProjectSessions(project?.id ?? null, '/api/chat/sessions')

  useEffect(() => {
    fetch('/api/chat/workspaces')
      .then(r => r.json())
      .then(data => setRecentWorkspacePaths(data.workspaces ?? []))
      .catch(() => {})
  }, [])

  const effectiveWorkspacePath = sessionDraft?.workspacePath ?? activeSession?.workspacePath ?? defaultWorkspacePath
  const attachedFolderPaths = sessionDraft?.attachedFolderPaths ?? activeSession?.attachedFolderPaths ?? []

  useEffect(() => {
    if (!effectiveWorkspacePath) {
      setWorkspaceBranch(null)
      return
    }
    let cancelled = false
    fetch(`/api/chat/workspace-info?path=${encodeURIComponent(effectiveWorkspacePath)}`)
      .then(r => r.json())
      .then(data => {
        if (!cancelled) setWorkspaceBranch(data.branch ?? null)
      })
      .catch(() => {
        if (!cancelled) setWorkspaceBranch(null)
      })
    return () => { cancelled = true }
  }, [effectiveWorkspacePath])

  const openDirectory = useCallback(async () => {
    if (!window.electronAPI?.openDirectoryDialog) {
      setNotice('请选择 Electron 桌面端使用工作目录选择')
      setTimeout(() => setNotice(null), 3000)
      return null
    }
    const dir = await window.electronAPI?.openDirectoryDialog()
    return dir || null
  }, [])

  const handleChooseWorkspace = useCallback(async (path?: string) => {
    const dir = path ?? await openDirectory()
    if (!dir) return

    setRecentWorkspacePaths(prev => [dir, ...prev.filter(p => p !== dir)].slice(0, 12))

    if (sessionDraft) {
      setSessionDraft(d => d ? { ...d, workspacePath: dir } : d)
      return
    }

    if (activeSession) {
      await updateSession(activeSession.id, { workspacePath: dir })
      return
    }

    setSessionDraft(d => d ? { ...d, workspacePath: dir } : { workspacePath: dir, attachedFolderPaths: [], useWorktree: false })
  }, [sessionDraft, activeSession, openDirectory, updateSession])

  const handleAddAttachedFolder = useCallback(async () => {
    const dir = await openDirectory()
    if (!dir) return

    if (sessionDraft) {
      setSessionDraft(d => d ? { ...d, attachedFolderPaths: [...new Set([...d.attachedFolderPaths, dir])] } : d)
      return
    }

    if (activeSession) {
      await updateSession(activeSession.id, {
        attachedFolderPaths: [...new Set([...attachedFolderPaths, dir])],
      })
      return
    }

    setSessionDraft({ workspacePath: null, attachedFolderPaths: [dir], useWorktree: false })
  }, [sessionDraft, activeSession, attachedFolderPaths, openDirectory, updateSession])

  const handleToggleWorktree = useCallback(async (enabled: boolean) => {
    if (sessionDraft) {
      setSessionDraft(d => d ? { ...d, useWorktree: enabled } : d)
      return
    }
    if (!activeSession) return
    await updateSession(activeSession.id, { useWorktree: enabled })
  }, [sessionDraft, activeSession, updateSession])

  const handleNewSession = useCallback(() => {
    setSessionDraft({
      workspacePath: defaultWorkspacePath || null,
      attachedFolderPaths: [],
      useWorktree: false,
    })
  }, [defaultWorkspacePath])

  const handleCreateAndSend = useCallback(async (params: {
    message: string
    effectiveMessage?: string
    enabledSkills?: string[]
    permissionMode: string
    thinkingMode: string
    attachments?: Array<{ name: string; filename: string; mimeType: string; tier: string; originalFilename?: string }>
    planMode: boolean
  }) => {
    if (!project || !sessionDraft) return
    const newSession = await createSession(project.defaultModel, 'New Session', {
      workspacePath: sessionDraft.workspacePath ?? undefined,
      attachedFolderPaths: sessionDraft.attachedFolderPaths,
      useWorktree: sessionDraft.useWorktree,
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
  }, [project, sessionDraft, createSession])

  const handleRenameSession = useCallback(async (sessionId: string, title: string) => {
    await updateSession(sessionId, { title })
  }, [updateSession])

  const handleModelChange = useCallback((model: string) => {
    setProject(prev => prev ? { ...prev, defaultModel: model } : prev)
  }, [])

  if (loading || !project) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flex: 1 }}>
        <Loader2 size={20} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flex: 1, height: '100%', overflow: 'hidden', gap: 'var(--shell-gap)' }}>
      <ProjectSidebar
        project={project}
        sessions={sessions}
        activeSessionId={sessionDraft ? null : activeSessionId}
        onSelect={(id) => { setSessionDraft(null); selectSession(id) }}
        onNew={handleNewSession}
        onDelete={deleteSession}
        onRename={handleRenameSession}
        activePane="chat"
        onPaneChange={() => {}}
        chatOnly
      />

      <WorkbenchView
        project={project}
        session={sessionDraft ? null : activeSession}
        onNewSession={handleNewSession}
        projectName="Chat"
        workspacePath={effectiveWorkspacePath}
        attachedFolderPaths={attachedFolderPaths}
        recentWorkspacePaths={recentWorkspacePaths}
        workspaceBranch={workspaceBranch}
        useWorktree={sessionDraft?.useWorktree ?? activeSession?.useWorktree ?? false}
        workspaceRequired={false}
        workspaceIsDefault={!activeSession?.workspacePath && !sessionDraft?.workspacePath}
        emptyMode="chat"
        onChooseWorkspace={handleChooseWorkspace}
        onAddAttachedFolder={handleAddAttachedFolder}
        onToggleWorktree={handleToggleWorktree}
        onModelChange={handleModelChange}
        sessionDraft={sessionDraft}
        onCreateAndSend={handleCreateAndSend}
        pendingAutoSend={pendingAutoSend}
        onPendingAutoSendConsumed={() => setPendingAutoSend(null)}
      />
      {notice && (
        <div style={{
          position: 'fixed',
          right: 24,
          bottom: 24,
          zIndex: 200,
          padding: '10px 14px',
          borderRadius: 8,
          background: 'var(--theme-bg-surface)',
          border: '1px solid var(--theme-border-strong)',
          color: 'var(--color-text-secondary)',
          fontSize: 12,
        }}>
          {notice}
        </div>
      )}
    </div>
  )
}
