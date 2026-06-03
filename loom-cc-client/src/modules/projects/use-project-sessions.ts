'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Session } from '@/shared/types'

export function useProjectSessions(projectId: string | null, sessionsEndpoint?: string) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchSessions = useCallback(async () => {
    if (!projectId) {
      setSessions([])
      setActiveSessionId(null)
      return
    }
    try {
      setLoading(true)
      const res = await fetch(sessionsEndpoint ?? `/api/projects/${projectId}/sessions`)
      const data = await res.json()
      const fetched: Session[] = data.sessions ?? []
      setSessions(fetched)

      // Auto-select the most recent active session if none selected
      setActiveSessionId(prev => {
        if (prev && fetched.some(s => s.id === prev)) return prev
        const active = fetched.find(s => s.status === 'active')
        return active?.id ?? fetched[0]?.id ?? null
      })
    } catch (err) {
      console.error('Failed to fetch sessions:', err)
    } finally {
      setLoading(false)
    }
  }, [projectId, sessionsEndpoint])

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  // Poll every 15 s so sessions created by the cron engine appear automatically
  useEffect(() => {
    if (!projectId) return
    const id = setInterval(fetchSessions, 15_000)
    return () => clearInterval(id)
  }, [projectId, fetchSessions])

  const activeSession = sessions.find(s => s.id === activeSessionId) ?? null

  const createSession = useCallback(async (
    model?: string,
    title?: string,
    options?: string | { workspacePath?: string; attachedFolderPaths?: string[]; useWorktree?: boolean },
  ): Promise<Session | null> => {
    if (!projectId) return null
    try {
      const sessionOptions = typeof options === 'string' ? { workspacePath: options } : options
      const res = await fetch(sessionsEndpoint ?? `/api/projects/${projectId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, title, ...sessionOptions }),
      })
      if (!res.ok) return null
      const data = await res.json()
      const newSession: Session = data.session
      await fetchSessions()
      setActiveSessionId(newSession.id)
      return newSession
    } catch {
      return null
    }
  }, [projectId, fetchSessions, sessionsEndpoint])

  const selectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId)
  }, [])

  const updateSession = useCallback(async (
    sessionId: string,
    updates: Record<string, unknown>,
  ): Promise<boolean> => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) return false
      await fetchSessions()
      return true
    } catch {
      return false
    }
  }, [fetchSessions])

  const deleteSession = useCallback(async (sessionId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: 'DELETE',
      })
      if (!res.ok) return false
      await fetchSessions()
      // If deleted session was active, auto-select another
      if (activeSessionId === sessionId) {
        setActiveSessionId(null) // fetchSessions will auto-select
      }
      return true
    } catch {
      return false
    }
  }, [fetchSessions, activeSessionId])

  return {
    sessions,
    activeSession,
    activeSessionId,
    loading,
    createSession,
    selectSession,
    updateSession,
    deleteSession,
    refetch: fetchSessions,
  }
}
