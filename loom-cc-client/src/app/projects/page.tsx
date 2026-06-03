'use client'

import { useState, useCallback } from 'react'
import { Plus, Loader2, FolderPlus, Bot, Clock, Scissors } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useProjects } from '@/modules/projects/use-projects'
import { ProjectCard } from '@/components/projects/project-card'
import { ProjectCreateDialog } from '@/components/projects/project-create-dialog'
import type { Project } from '@/shared/types'

export default function ProjectsPage() {
  const router = useRouter()
  const { projects, loading, error, createProject, pinProject, updateProject, archiveProject } = useProjects()
  const [showCreate, setShowCreate] = useState(false)

  const handleCreate = useCallback(async (name: string, workspacePath: string, defaultModel: string) => {
    const project = await createProject(name, workspacePath, defaultModel)
    if (project) {
      setShowCreate(false)
      router.push(`/projects/${project.id}`)
    }
  }, [createProject, router])

  const handleTogglePin = useCallback(async (id: string, pinned: boolean) => {
    await pinProject(id, pinned)
  }, [pinProject])

  const handleUpdate = useCallback(async (
    id: string,
    updates: Partial<Pick<Project, 'name' | 'description' | 'workspacePath'>>,
  ) => {
    await updateProject(id, updates)
  }, [updateProject])

  const handleArchive = useCallback(async (id: string) => {
    await archiveProject(id)
  }, [archiveProject])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto" style={{ padding: '32px 40px', minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div className="flex items-center justify-between" style={{ marginBottom: '16px' }}>
        <h1 className="text-[20px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          Projects
        </h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 text-[13px] font-medium transition-opacity hover:opacity-90"
          style={{
            padding: '8px 18px',
            borderRadius: 5,
            background: 'var(--color-accent-primary)',
            color: '#fff',
            marginRight: '4px',
          }}
        >
          <Plus size={15} />
          New Project
        </button>
      </div>

      {/* Divider */}
      <div style={{ borderBottom: '1px solid var(--color-border-subtle)', marginBottom: '28px' }} />

      {/* Error */}
      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg" style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
          <span className="text-[12px]" style={{ color: '#ef4444' }}>{error}</span>
        </div>
      )}

      {projects.length === 0 ? (
        /* Empty state */
        <div style={{ flex: 1, minHeight: 460, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{
            width: 'min(760px, 100%)',
            borderRadius: 20,
            border: '1px solid var(--theme-border)',
            background: 'linear-gradient(135deg, var(--theme-bg-panel) 0%, var(--theme-bg-surface) 58%, var(--theme-bg-active) 100%)',
            boxShadow: 'var(--shell-panel-shadow)',
            overflow: 'hidden',
            position: 'relative',
          }}>
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                right: -80,
                top: -90,
                width: 240,
                height: 240,
                borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(245,158,11,0.14), transparent 62%)',
                pointerEvents: 'none',
              }}
            />
            <div style={{ padding: '34px 38px 30px', position: 'relative' }}>
              <div style={{
                width: 62,
                height: 62,
                borderRadius: 17,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--theme-bg-active)',
                color: 'var(--color-accent-primary)',
                border: '1px solid var(--theme-border-strong)',
                marginBottom: 18,
              }}>
                <FolderPlus size={28} />
              </div>

              <h2 style={{ fontSize: 24, lineHeight: 1.15, fontWeight: 900, letterSpacing: '-0.04em', color: 'var(--color-text-primary)', margin: '0 0 10px' }}>
                创建你的第一个 Agent 项目
              </h2>
              <p style={{ width: 'min(560px, 100%)', fontSize: 13, lineHeight: 1.8, color: 'var(--color-text-muted)', margin: '0 0 24px' }}>
                项目会绑定一个本地工作目录，Loom CC 会围绕这个目录组织会话、文件上下文、定时任务和截图附件。
              </p>

              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 rounded-lg text-[13px] font-bold transition-opacity hover:opacity-90"
                style={{ padding: '10px 18px', background: 'var(--color-accent-primary)', color: '#fff', border: 'none', cursor: 'pointer' }}
              >
                <Plus size={15} />
                新建项目
              </button>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 1,
              background: 'var(--theme-border)',
              borderTop: '1px solid var(--theme-border)',
            }}>
              {[
                { Icon: Bot, title: '项目会话', desc: '围绕同一代码库持续对话，保留上下文。' },
                { Icon: Clock, title: '定时任务', desc: '让 Agent 自动执行巡检、总结和生成。' },
                { Icon: Scissors, title: '截图附件', desc: '区域截图后直接发送到当前 session。' },
              ].map(({ Icon, title, desc }) => (
                <div key={title} style={{ padding: '18px 20px', background: 'var(--theme-bg-surface)' }}>
                  <Icon size={16} style={{ color: 'var(--color-accent-primary)', marginBottom: 10 }} />
                  <h3 style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-text-primary)', margin: '0 0 6px' }}>{title}</h3>
                  <p style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--color-text-muted)', margin: 0 }}>{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {projects.map(p => (
            <ProjectCard
              key={p.id}
              project={p}
              onTogglePin={handleTogglePin}
              onArchive={handleArchive}
              onUpdate={handleUpdate}
            />
          ))}
        </div>
      )}

      {/* Create dialog */}
      <ProjectCreateDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={handleCreate}
      />
    </div>
  )
}
