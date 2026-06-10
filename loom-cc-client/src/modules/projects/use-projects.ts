'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Project } from '@/shared/types'

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/projects')
      const data = await res.json()
      setProjects(data.projects ?? [])
      setError(null)
    } catch (err) {
      console.error('Failed to fetch projects:', err)
      setError('Failed to load projects')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  const createProject = useCallback(async (
    name: string,
    workspacePath: string,
    description?: string,
    defaultModel?: string,
  ): Promise<Project | null> => {
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, workspacePath, defaultModel }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to create project')
        return null
      }
      const data = await res.json()
      await fetchProjects()
      return data.project
    } catch (err) {
      console.error('Failed to create project:', err)
      setError('Failed to create project')
      return null
    }
  }, [fetchProjects])

  const archiveProject = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' })
      if (!res.ok) return false
      await fetchProjects()
      return true
    } catch {
      return false
    }
  }, [fetchProjects])

  const hardDeleteProject = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/projects/${id}/hard-delete`, { method: 'DELETE' })
      return res.ok
    } catch {
      return false
    }
  }, [])

  const updateProject = useCallback(async (
    id: string,
    updates: Partial<Pick<Project, 'name' | 'description' | 'isPinned' | 'defaultModel' | 'workspacePath'>>,
  ): Promise<boolean> => {
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) return false
      await fetchProjects()
      return true
    } catch {
      return false
    }
  }, [fetchProjects])

  const pinProject = useCallback(async (id: string, pinned: boolean) => {
    // Optimistic local update — no refetch, no card list flicker
    setProjects(prev => prev.map(p => p.id === id ? { ...p, isPinned: pinned } : p))
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPinned: pinned }),
      })
      if (!res.ok) {
        // Revert on failure
        setProjects(prev => prev.map(p => p.id === id ? { ...p, isPinned: !pinned } : p))
        return false
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('loom:pin-changed'))
      }
      return true
    } catch {
      setProjects(prev => prev.map(p => p.id === id ? { ...p, isPinned: !pinned } : p))
      return false
    }
  }, [])

  return {
    projects,
    loading,
    error,
    createProject,
    updateProject,
    pinProject,
    archiveProject,
    hardDeleteProject,
    refetch: fetchProjects,
  }
}
