'use client'

import { useState, useEffect, useCallback } from 'react'
import type { SkillItem } from '@/shared/skills/skill-types'

export type { SkillItem } from '@/shared/skills/skill-types'

interface SkillsResponse {
  skills: SkillItem[]
  globalDirExists: boolean
}

export function useSkills(projectId?: string) {
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [globalDirExists, setGlobalDirExists] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSkills = useCallback(async () => {
    try {
      setLoading(true)
      const url = projectId
        ? `/api/skills?projectId=${encodeURIComponent(projectId)}`
        : '/api/skills'
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch skills')
      const data: SkillsResponse = await res.json()
      setSkills(data.skills ?? [])
      setGlobalDirExists(data.globalDirExists ?? true)
      setError(null)
    } catch (err) {
      console.error('Failed to fetch skills:', err)
      setError('Failed to load skills')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchSkills()
  }, [fetchSkills])

  const pinSkill = useCallback(async (id: string) => {
    // Find the skill to pass metadata for upsert
    const skill = skills.find((s) => s.id === id)
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isPinned: true,
          name: skill?.name,
          description: skill?.description,
          storagePath: skill?.storagePath,
        }),
      })
      if (!res.ok) throw new Error('Failed to pin skill')
      await fetchSkills()
    } catch (err) {
      console.error('Failed to pin skill:', err)
    }
  }, [skills, fetchSkills])

  const unpinSkill = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPinned: false }),
      })
      if (!res.ok) throw new Error('Failed to unpin skill')
      await fetchSkills()
    } catch (err) {
      console.error('Failed to unpin skill:', err)
    }
  }, [fetchSkills])

  return {
    skills,
    globalDirExists,
    loading,
    error,
    pinSkill,
    unpinSkill,
    refetch: fetchSkills,
  }
}
