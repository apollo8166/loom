'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  Check,
  Clipboard,
  Code2,
  Download,
  FileCode2,
  FileText,
  Folder,
  Globe2,
  Inbox,
  Layers3,
  Loader2,
  PackageCheck,
  Play,
  Presentation,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Terminal,
  X,
} from 'lucide-react'
import type { SkillItem } from '@/modules/skills/use-skills'
import type { SkillPackageTreeItem } from '@/shared/skills/skill-types'

type DetailTab = 'overview' | 'usage' | 'install' | 'security' | 'files'
type InstallTargetType = 'global' | 'project'
type Notice = { tone: 'info' | 'success' | 'error'; text: string }
type ProjectOption = { id: string; name: string; workspacePath?: string | null }

const SOURCE_LABELS: Record<string, string> = {
  builtin: 'Loom 官方',
  global: '全局能力',
  project: '项目能力',
  session: '会话能力',
  user: '用户自建',
}

const INSTALL_LABELS: Record<string, string> = {
  builtin: '未安装',
  global: '已安装到全局',
  project: '已安装到项目',
  session: '已安装到会话',
  user: '用户自建',
}

const TABS: { key: DetailTab; label: string }[] = [
  { key: 'overview', label: '概览' },
  { key: 'usage', label: '使用' },
  { key: 'install', label: '安装' },
  { key: 'security', label: '安全' },
  { key: 'files', label: '文件' },
]

export function SkillDetailPanel({
  skill,
  onClose,
  onTogglePin,
  onInstalled,
  projects = [],
}: {
  skill: SkillItem | null
  onClose: () => void
  onTogglePin: (id: string, currentlyPinned: boolean) => void
  onInstalled?: (skill: SkillItem) => void | Promise<void>
  projects?: ProjectOption[]
}) {
  const [copied, setCopied] = useState(false)
  const [isNarrow, setIsNarrow] = useState(false)
  const [activeTab, setActiveTab] = useState<DetailTab>('overview')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [installingTarget, setInstallingTarget] = useState<InstallTargetType | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState('')

  useEffect(() => {
    const update = () => setIsNarrow(window.innerWidth < 880)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => {
    if (!skill) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [skill, onClose])

  useEffect(() => {
    setCopied(false)
    setActiveTab('overview')
    setNotice(null)
    setInstallingTarget(null)
  }, [skill?.id])

  const tags = useMemo(() => {
    if (!skill) return []
    return unique([skill.stage, skill.category, ...(skill.tags ?? [])].filter(Boolean) as string[])
  }, [skill])

  if (!skill) return null

  const command = `/${skill.slug}`
  const installed = skill.sourceType !== 'builtin'
  const installStatus = INSTALL_LABELS[skill.sourceType] ?? skill.sourceType
  const risk = getRisk(skill.riskLevel)
  const requirements = getRequirementLabels(skill)
  const installPath = skill.storagePath || `~/.claude/skills/${skill.slug}`
  const projectPath = `<project>/.claude/skills/${skill.slug}`
  const hasExamples = Boolean(skill.examples?.length)

  const copyCommand = () => {
    if (!navigator.clipboard) return
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    })
  }

  const installSkill = async (target: InstallTargetType, overwrite = false) => {
    if (installingTarget) return

    const projectId = target === 'project' ? selectedProjectId : undefined
    if (target === 'project' && !projectId) {
      setActiveTab('install')
      setNotice({
        tone: 'error',
        text: projects.length > 0 ? '请先选择要安装到哪个项目。' : '还没有可安装的项目，请先创建或打开一个项目。',
      })
      return
    }

    setInstallingTarget(target)
    setNotice(null)
    try {
      const res = await fetch('/api/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skillId: skill.id,
          slug: skill.slug,
          target,
          projectId,
          overwrite,
        }),
      })
      const data = await res.json().catch(() => ({} as { error?: string; skill?: SkillItem }))
      if (!res.ok) {
        if (res.status === 409) {
          setActiveTab('install')
          setNotice({ tone: 'error', text: '目标目录已存在。点击“更新”会覆盖现有 SKILL.md 和元数据。' })
          return
        }
        throw new Error(data.error || '安装失败')
      }

      const installedSkill = data.skill
      if (installedSkill) await onInstalled?.(installedSkill)
      window.localStorage.setItem('loom:skills-changed-at', String(Date.now()))
      window.dispatchEvent(new CustomEvent('loom:skills-changed'))
      setActiveTab('usage')
      setNotice({
        tone: 'success',
        text: target === 'global'
          ? `已安装到 ~/.claude/skills/${skill.slug}，聊天窗口现在可以使用 ${command}。`
          : `已安装到项目 .claude/skills/${skill.slug}，该项目聊天窗口现在可以使用 ${command}。`,
      })
    } catch (err) {
      setActiveTab('install')
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : '安装失败' })
    } finally {
      setInstallingTarget(null)
    }
  }

  const installOrOpenProjectPicker = () => {
    if (selectedProjectId) {
      void installSkill('project', installed && skill.sourceType === 'project')
      return
    }
    setActiveTab('install')
    setNotice({ tone: 'info', text: '请选择目标项目后安装。' })
  }

  return createPortal(
    <div style={styles.overlay} onClick={onClose}>
      <aside
        style={{
          ...styles.shell,
          width: isNarrow ? '100vw' : 'min(1040px, 92vw)',
          height: isNarrow ? '100vh' : 'min(760px, 90vh)',
          borderRadius: isNarrow ? 0 : 14,
        }}
        onClick={e => e.stopPropagation()}
      >
        <header style={styles.header}>
          <div style={styles.identityRow}>
            <div style={styles.headerIcon}>
              {skill.slug.includes('ppt') ? <Presentation size={22} /> : <Sparkles size={21} />}
            </div>
            <div style={styles.headerText}>
              <div style={styles.badgeRow}>
                <Badge tone={skill.sourceType === 'builtin' ? 'accent' : 'muted'}>{SOURCE_LABELS[skill.sourceType] ?? skill.sourceType}</Badge>
                <Badge tone={installed ? 'success' : 'muted'}>{installStatus}</Badge>
                {skill.category && <Badge>{skill.category}</Badge>}
                {skill.stage && <Badge>{skill.stage}</Badge>}
              </div>
              <h2 style={styles.title}>{skill.name}</h2>
              <p style={styles.summary}>{skill.summary || skill.description || '暂无说明'}</p>
            </div>
          </div>

          <div style={styles.headerActions}>
            {installed ? (
              <>
                <button type="button" onClick={copyCommand} style={styles.primaryButton}>
                  {copied ? <Check size={15} /> : <Play size={15} />}
                  在聊天中使用
                </button>
                <button
                  type="button"
                  disabled={Boolean(installingTarget)}
                  onClick={() => void installSkill(skill.sourceType === 'project' ? 'project' : 'global', true)}
                  style={{ ...styles.secondaryButton, ...(installingTarget ? styles.disabledControl : null) }}
                >
                  {installingTarget ? <Loader2 size={14} /> : <Download size={14} />}
                  {installingTarget ? '更新中' : '更新'}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={Boolean(installingTarget)}
                  onClick={() => void installSkill('global')}
                  style={{ ...styles.primaryButton, ...(installingTarget ? styles.disabledControl : null) }}
                >
                  {installingTarget === 'global' ? <Loader2 size={15} /> : <Download size={15} />}
                  {installingTarget === 'global' ? '安装中' : '安装到全局'}
                </button>
                <button
                  type="button"
                  disabled={Boolean(installingTarget)}
                  onClick={installOrOpenProjectPicker}
                  style={{ ...styles.secondaryButton, ...(installingTarget ? styles.disabledControl : null) }}
                >
                  {installingTarget === 'project' ? <Loader2 size={14} /> : <Folder size={14} />}
                  {installingTarget === 'project' ? '安装中' : '安装到项目'}
                </button>
              </>
            )}
            <IconButton
              title={skill.isPinned ? '取消收藏' : '收藏'}
              onClick={() => onTogglePin(skill.id, skill.isPinned)}
            >
              <Star size={15} fill={skill.isPinned ? 'var(--color-accent-primary)' : 'none'} />
            </IconButton>
            <IconButton title="关闭" onClick={onClose}>
              <X size={15} />
            </IconButton>
          </div>
        </header>

        <div style={styles.statusStrip}>
          <StatusItem label="安装位置" value={installed ? installPath : '尚未安装'} mono={installed} />
          <StatusItem label="命令" value={installed ? command : '安装后可用'} mono />
          <StatusItem label="风险" value={risk.label} color={risk.color} />
          <StatusItem label="权限" value={requirements.length ? `${requirements.length} 项` : '无特殊权限'} />
        </div>

        <nav style={styles.tabs}>
          {TABS.map(tab => {
            const active = activeTab === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                style={{
                  ...styles.tabButton,
                  color: active ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
                  borderBottomColor: active ? 'var(--color-accent-primary)' : 'transparent',
                }}
              >
                {tab.label}
              </button>
            )
          })}
        </nav>

        <div style={isNarrow ? styles.contentNarrow : styles.content}>
          <main style={styles.main}>
            {notice && (
              <div style={{ ...styles.notice, ...getNoticeToneStyle(notice.tone) }}>
                {notice.tone === 'success' ? <Check size={14} /> : <AlertTriangle size={14} />}
                <span>{notice.text}</span>
              </div>
            )}

            {activeTab === 'overview' && (
              <div style={styles.stack}>
                <Section title="这个 Skill 解决什么问题" icon={<Sparkles size={15} />}>
                  <p style={styles.paragraph}>{skill.description || '这个 skill 还没有填写完整说明。'}</p>
                </Section>

                <div style={isNarrow ? styles.singleGrid : styles.twoGrid}>
                  <Section title="适合输入" icon={<Inbox size={15} />}>
                    <ItemList items={skill.inputs} empty="未声明输入要求" />
                  </Section>
                  <Section title="交付结果" icon={<Send size={15} />}>
                    <ItemList items={skill.outputs} empty="未声明输出结果" />
                  </Section>
                </div>

                {tags.length > 0 && (
                  <Section title="场景标签" icon={<Layers3 size={15} />}>
                    <div style={styles.wrapRow}>{tags.map(tag => <Badge key={tag}>{tag}</Badge>)}</div>
                  </Section>
                )}
              </div>
            )}

            {activeTab === 'usage' && (
              <div style={styles.stack}>
                <Section title="聊天调用方式" icon={<Terminal size={15} />}>
                  <div style={styles.commandCard}>
                    <div style={styles.commandBlock}>
                      <code style={styles.commandText}>{command}</code>
                      <button type="button" onClick={copyCommand} style={styles.copyButton}>
                        {copied ? <Check size={13} /> : <Clipboard size={13} />}
                      </button>
                    </div>
                    <p style={styles.mutedText}>
                      {installed ? '在聊天框输入命令，并补充目标、材料或文件。' : '安装后会在聊天窗口出现这个命令。'}
                    </p>
                  </div>
                </Section>

                <Section title="示例说法" icon={<Presentation size={15} />}>
                  {hasExamples ? <ExampleList items={skill.examples} /> : <ExampleList items={[
                    `${command} 帮我把这份材料做成 8 页课堂汇报 PPT`,
                    `${command} 根据附件生成读书报告 PPT，风格简洁，附演讲稿`,
                    `${command} 做一份论文答辩 PPT，突出研究问题、方法和结论`,
                  ]} />}
                </Section>
              </div>
            )}

            {activeTab === 'install' && (
              <div style={styles.stack}>
                <Section title="选择安装范围" icon={<Download size={15} />}>
                  {projects.length > 0 && (
                    <div style={styles.projectPicker}>
                      <label htmlFor={`skill-project-${skill.slug}`} style={styles.projectPickerLabel}>项目安装目标</label>
                      <select
                        id={`skill-project-${skill.slug}`}
                        value={selectedProjectId}
                        onChange={e => setSelectedProjectId(e.target.value)}
                        style={styles.projectSelect}
                      >
                        <option value="">选择项目</option>
                        {projects.map(project => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div style={isNarrow ? styles.singleGrid : styles.twoGrid}>
                    <InstallTarget
                      title="全局安装"
                      icon={<Globe2 size={17} />}
                      recommended
                      path={`~/.claude/skills/${skill.slug}`}
                      description="所有项目和独立聊天都可以使用，适合 PPT、写作、学习、翻译这类通用工具。"
                      actionLabel={installed && skill.sourceType === 'global' ? '更新全局安装' : '安装到全局'}
                      loading={installingTarget === 'global'}
                      disabled={Boolean(installingTarget)}
                      onClick={() => void installSkill('global', installed && skill.sourceType === 'global')}
                    />
                    <InstallTarget
                      title="项目安装"
                      icon={<Folder size={17} />}
                      path={projectPath}
                      description="只在当前项目可用，适合团队规范、项目流程、代码风格和业务专属 skill。"
                      actionLabel={installed && skill.sourceType === 'project' ? '更新项目安装' : '安装到项目'}
                      loading={installingTarget === 'project'}
                      disabled={Boolean(installingTarget)}
                      onClick={() => void installSkill('project', installed && skill.sourceType === 'project')}
                    />
                  </div>
                </Section>

                <Section title="安装后会发生什么" icon={<PackageCheck size={15} />}>
                  <StepList items={[
                    `写入 ${skill.slug}/SKILL.md 作为 Skill 主文件`,
                    '补齐 loom.skill.json，用于列表、详情和风险信息展示',
                    '复制 references、scripts、assets 等完整包目录',
                    '按统一安装器校验路径安全、同名冲突、文件数量和文件大小',
                    `刷新聊天窗口后即可使用 ${command}`,
                  ]} />
                </Section>
              </div>
            )}

            {activeTab === 'security' && (
              <div style={styles.stack}>
                <Section title="权限与风险" icon={<ShieldCheck size={15} />}>
                  <div style={styles.riskPanel}>
                    <span style={{ ...styles.riskDot, background: risk.color }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 750, color: 'var(--color-text-primary)' }}>
                        风险等级：{risk.label}
                      </div>
                      <p style={{ ...styles.mutedText, marginTop: 4 }}>{risk.description}</p>
                    </div>
                  </div>
                  <div style={{ ...styles.wrapRow, marginTop: 12 }}>
                    {requirements.length ? requirements.map(label => <Badge key={label}>{label}</Badge>) : <Badge>无特殊权限</Badge>}
                  </div>
                </Section>

                <Section title="安全建议" icon={<AlertTriangle size={15} />}>
                  <StepList items={[
                    '安装前确认来源和发布者可信。',
                    '含命令执行或写文件权限的 skill，优先安装到项目范围试用。',
                    '运行时仍应检查将要写入或执行的内容。',
                  ]} />
                </Section>
              </div>
            )}

            {activeTab === 'files' && (
              <div style={styles.stack}>
                <Section title="Skill 包内容" icon={<FileText size={15} />}>
                  <FileList skill={skill} />
                </Section>

                {skill.raw && (
                  <details style={styles.details}>
                    <summary style={styles.summaryToggle}>查看原始 SKILL.md</summary>
                    <pre style={styles.rawBlock}>{skill.raw}</pre>
                  </details>
                )}
              </div>
            )}
          </main>

          {!isNarrow && (
            <aside style={styles.side}>
              <SideCard title="安装状态">
                <MetaRow label="状态" value={installStatus} />
                <MetaRow label="来源" value={SOURCE_LABELS[skill.sourceType] ?? skill.sourceType} />
                <MetaRow label="位置" value={installed ? installPath : '未安装'} mono />
              </SideCard>

              <SideCard title="运行信息">
                <MetaRow label="命令" value={installed ? command : '安装后可用'} mono />
                <MetaRow label="风险" value={risk.label} valueColor={risk.color} />
                <MetaRow label="收藏" value={skill.isPinned ? '已收藏' : '未收藏'} />
              </SideCard>
            </aside>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  )
}

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section style={styles.section}>
      <div style={styles.sectionHeader}>
        <span style={styles.sectionIcon}>{icon}</span>
        <h3 style={styles.sectionTitle}>{title}</h3>
      </div>
      <div style={styles.sectionBody}>{children}</div>
    </section>
  )
}

function SideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={styles.sideCard}>
      <h3 style={styles.sideTitle}>{title}</h3>
      {children}
    </section>
  )
}

function InstallTarget({
  title,
  icon,
  recommended,
  path,
  description,
  actionLabel,
  loading,
  disabled,
  onClick,
}: {
  title: string
  icon: ReactNode
  recommended?: boolean
  path: string
  description: string
  actionLabel: string
  loading?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...styles.installTarget,
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      <div style={styles.installTargetHead}>
        <span style={styles.installIcon}>{icon}</span>
        <span style={styles.installTitle}>{title}</span>
        {recommended && <Badge tone="accent">推荐</Badge>}
      </div>
      <p style={styles.installDesc}>{description}</p>
      <code style={styles.pathLine}>{path}</code>
      <span style={styles.installAction}>
        {loading ? <Loader2 size={13} /> : <Download size={13} />}
        {loading ? '处理中' : actionLabel}
      </span>
    </button>
  )
}

function StatusItem({
  label,
  value,
  mono,
  color,
}: {
  label: string
  value: string
  mono?: boolean
  color?: string
}) {
  return (
    <div style={styles.statusItem}>
      <span style={styles.statusLabel}>{label}</span>
      <span
        title={value}
        style={{
          ...styles.statusValue,
          ...(mono ? styles.monoValue : null),
          color: color || 'var(--color-text-secondary)',
        }}
      >
        {value}
      </span>
    </div>
  )
}

function ItemList({ items, empty }: { items?: string[]; empty: string }) {
  if (!items || items.length === 0) {
    return <p style={styles.mutedText}>{empty}</p>
  }
  return <StepList items={items} />
}

function StepList({ items }: { items: string[] }) {
  return (
    <ul style={styles.list}>
      {items.map(item => (
        <li key={item} style={styles.listItem}>
          <span style={styles.dot} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function ExampleList({ items }: { items?: string[] }) {
  if (!items || items.length === 0) {
    return <p style={styles.mutedText}>暂无示例</p>
  }
  return (
    <div style={styles.exampleStack}>
      {items.map(item => (
        <div key={item} style={styles.example}>
          {item}
        </div>
      ))}
    </div>
  )
}

function FileList({ skill }: { skill: SkillItem }) {
  const files = skill.packageTree?.length
    ? skill.packageTree
    : [
      {
        path: 'SKILL.md',
        type: 'instruction' as const,
        description: '主说明与触发规则。',
        risk: 'none' as const,
        autoRun: false,
      },
    ]

  return (
    <div style={styles.packageTree}>
      <div style={styles.packageRoot}>
        <Folder size={14} />
        <span style={styles.packageRootName}>{skill.slug}/</span>
      </div>
      {files.map(file => (
        <div key={file.path} style={{ ...styles.fileRow, paddingLeft: 11 + getPackageDepth(file.path) * 18 }}>
          {getPackageIcon(file)}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={styles.fileName}>{file.path}</div>
            <div style={styles.fileDesc}>{file.description}</div>
            <div style={styles.fileMetaLine}>
              <span>{getPackageTypeLabel(file.type)}</span>
              {file.loadedWhen && <span>{file.loadedWhen}</span>}
            </div>
          </div>
          <span style={{ ...styles.fileState, color: getPackageRiskColor(file.risk) }}>
            {getPackageRiskLabel(file.risk)}
          </span>
          <span style={{ ...styles.fileState, color: file.autoRun ? 'var(--color-accent-danger)' : 'var(--color-text-muted)' }}>
            {file.autoRun ? '自动运行' : '不自动运行'}
          </span>
        </div>
      ))}
    </div>
  )
}

function getPackageDepth(filePath: string): number {
  return filePath.replace(/\/$/, '').split('/').length - 1
}

function getPackageIcon(file: SkillPackageTreeItem) {
  if (file.type === 'directory' || file.path.endsWith('/')) {
    return <Folder size={13} style={{ color: 'var(--color-accent-primary)' }} />
  }
  if (file.type === 'script') {
    return <Code2 size={13} style={{ color: 'var(--color-accent-primary)' }} />
  }
  if (file.type === 'template' || file.type === 'asset') {
    return <FileCode2 size={13} style={{ color: 'var(--color-accent-success)' }} />
  }
  return <FileText size={13} style={{ color: 'var(--color-text-muted)' }} />
}

function getPackageTypeLabel(type: SkillPackageTreeItem['type']): string {
  const labels: Record<SkillPackageTreeItem['type'], string> = {
    instruction: '主说明',
    metadata: '元数据',
    directory: '目录',
    reference: '参考资料',
    script: '脚本',
    template: '模板',
    asset: '资源',
  }
  return labels[type] ?? type
}

function getPackageRiskLabel(risk: SkillPackageTreeItem['risk']): string {
  if (risk === 'network') return '联网'
  if (risk === 'shell') return '命令'
  if (risk === 'file-read') return '读文件'
  if (risk === 'file-write') return '写文件'
  if (risk === 'privacy') return '隐私'
  return '安全'
}

function getPackageRiskColor(risk: SkillPackageTreeItem['risk']): string {
  if (risk === 'shell' || risk === 'privacy') return 'var(--color-accent-danger)'
  if (risk === 'network' || risk === 'file-write') return 'var(--color-accent-primary)'
  if (risk === 'file-read') return 'var(--color-text-secondary)'
  return 'var(--color-accent-success)'
}

function MetaRow({
  label,
  value,
  mono,
  valueColor,
}: {
  label: string
  value: string
  mono?: boolean
  valueColor?: string
}) {
  return (
    <div style={styles.metaRow}>
      <span style={styles.metaLabel}>{label}</span>
      <span
        title={value}
        style={{
          ...styles.metaValue,
          ...(mono ? styles.monoValue : null),
          color: valueColor || 'var(--color-text-secondary)',
        }}
      >
        {value}
      </span>
    </div>
  )
}

function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'accent' | 'success' }) {
  const styleByTone = tone === 'accent'
    ? { background: 'rgba(245,158,11,0.12)', color: 'var(--color-accent-primary)', border: '1px solid rgba(245,158,11,0.22)' }
    : tone === 'success'
      ? { background: 'rgba(46,160,91,0.10)', color: 'var(--color-accent-success)', border: '1px solid rgba(46,160,91,0.20)' }
      : { background: 'var(--theme-bg-active)', color: 'var(--color-text-muted)', border: '1px solid var(--theme-border)' }
  return <span style={{ ...styles.badge, ...styleByTone }}>{children}</span>
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={title} onClick={onClick} style={styles.iconButton}>
      {children}
    </button>
  )
}

function getRequirementLabels(skill: SkillItem): string[] {
  return [
    skill.requires?.network ? '联网' : '',
    skill.requires?.fileRead ? '读文件' : '',
    skill.requires?.fileWrite ? '写文件' : '',
    skill.requires?.shell ? '命令执行' : '',
    ...(skill.requires?.mcp?.map(name => `MCP: ${name}`) ?? []),
  ].filter(Boolean)
}

function getRisk(level: SkillItem['riskLevel']) {
  if (level === 'high') return {
    label: '高',
    color: 'var(--color-accent-danger)',
    description: '这个 skill 可能读写文件、执行命令或调用外部服务，安装前需要确认来源可信。',
  }
  if (level === 'medium') return {
    label: '中',
    color: 'var(--color-accent-primary)',
    description: '这个 skill 可能读取文件或生成可写入的结果，建议先确认输出范围。',
  }
  return {
    label: '低',
    color: 'var(--color-accent-success)',
    description: '这个 skill 未声明高风险能力，仍建议在首次运行时检查输出。',
  }
}

function getNoticeToneStyle(tone: Notice['tone']): CSSProperties {
  if (tone === 'success') return {
    border: '1px solid rgba(46,160,91,0.24)',
    background: 'rgba(46,160,91,0.10)',
    color: 'var(--color-accent-success)',
  }
  if (tone === 'error') return {
    border: '1px solid rgba(248,81,73,0.28)',
    background: 'rgba(248,81,73,0.10)',
    color: 'var(--color-accent-danger)',
  }
  return {
    border: '1px solid rgba(245,158,11,0.25)',
    background: 'rgba(245,158,11,0.09)',
    color: 'var(--color-accent-primary)',
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(v => v.trim()).filter(Boolean))]
}

const monoFont = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 9998,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    background: 'rgba(0,0,0,0.42)',
  },
  shell: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: 'var(--theme-bg-surface)',
    border: '1px solid var(--theme-border-strong)',
    boxShadow: '0 28px 90px rgba(0,0,0,0.42)',
  },
  header: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 18,
    padding: '22px 24px 18px',
    borderBottom: '1px solid var(--theme-border)',
  },
  identityRow: {
    minWidth: 0,
    display: 'flex',
    alignItems: 'flex-start',
    gap: 15,
    flex: 1,
  },
  headerIcon: {
    width: 48,
    height: 48,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    background: 'rgba(245,158,11,0.12)',
    color: 'var(--color-accent-primary)',
    border: '1px solid rgba(245,158,11,0.24)',
  },
  headerText: {
    minWidth: 0,
    flex: 1,
  },
  badgeRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  title: {
    margin: 0,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    fontSize: 22,
    lineHeight: '30px',
    fontWeight: 750,
    color: 'var(--color-text-primary)',
  },
  summary: {
    maxWidth: 680,
    margin: '8px 0 0',
    fontSize: 13,
    lineHeight: '23px',
    color: 'var(--color-text-secondary)',
  },
  headerActions: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
    maxWidth: 360,
  },
  primaryButton: {
    height: 34,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    padding: '0 14px',
    borderRadius: 8,
    border: 'none',
    background: 'var(--color-accent-primary)',
    color: '#111',
    fontSize: 12,
    fontWeight: 750,
    cursor: 'pointer',
  },
  secondaryButton: {
    height: 34,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    padding: '0 12px',
    borderRadius: 8,
    border: '1px solid var(--theme-border)',
    background: 'var(--theme-bg-raised)',
    color: 'var(--color-text-secondary)',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
  },
  disabledControl: {
    opacity: 0.62,
    cursor: 'default',
  },
  iconButton: {
    width: 34,
    height: 34,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    border: '1px solid var(--theme-border)',
    background: 'var(--theme-bg-raised)',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
  },
  statusStrip: {
    flexShrink: 0,
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 1,
    background: 'var(--theme-border)',
    borderBottom: '1px solid var(--theme-border)',
  },
  statusItem: {
    minWidth: 0,
    padding: '10px 14px',
    background: 'var(--theme-bg-raised)',
  },
  statusLabel: {
    display: 'block',
    marginBottom: 4,
    fontSize: 10,
    lineHeight: '14px',
    color: 'var(--color-text-muted)',
  },
  statusValue: {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    lineHeight: '17px',
    fontWeight: 650,
    color: 'var(--color-text-secondary)',
  },
  tabs: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 18,
    padding: '0 24px',
    height: 44,
    borderBottom: '1px solid var(--theme-border)',
    overflowX: 'auto',
  },
  tabButton: {
    height: 44,
    border: 'none',
    borderBottom: '2px solid transparent',
    background: 'transparent',
    fontSize: 12,
    lineHeight: '18px',
    fontWeight: 750,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  content: {
    minHeight: 0,
    flex: 1,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 278px',
  },
  contentNarrow: {
    minHeight: 0,
    flex: 1,
    display: 'block',
    overflowY: 'auto',
  },
  main: {
    minHeight: 0,
    overflowY: 'auto',
    padding: 24,
  },
  side: {
    minHeight: 0,
    overflowY: 'auto',
    padding: 18,
    borderLeft: '1px solid var(--theme-border)',
    background: 'var(--theme-bg-raised)',
  },
  stack: {
    display: 'grid',
    gap: 16,
  },
  twoGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
  },
  singleGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: 16,
  },
  section: {
    borderRadius: 10,
    border: '1px solid var(--theme-border)',
    background: 'var(--theme-bg-raised)',
    overflow: 'hidden',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '13px 16px',
    borderBottom: '1px solid var(--theme-border)',
  },
  sectionIcon: {
    display: 'flex',
    color: 'var(--color-accent-primary)',
  },
  sectionTitle: {
    margin: 0,
    fontSize: 13,
    lineHeight: '18px',
    fontWeight: 750,
    color: 'var(--color-text-primary)',
  },
  sectionBody: {
    padding: 16,
    color: 'var(--color-text-secondary)',
    fontSize: 12,
    lineHeight: '23px',
  },
  paragraph: {
    margin: 0,
    whiteSpace: 'pre-wrap',
  },
  mutedText: {
    margin: 0,
    fontSize: 12,
    lineHeight: '22px',
    color: 'var(--color-text-muted)',
  },
  notice: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    borderRadius: 9,
    border: '1px solid rgba(245,158,11,0.25)',
    background: 'rgba(245,158,11,0.09)',
    color: 'var(--color-accent-primary)',
    fontSize: 12,
    lineHeight: '20px',
  },
  projectPicker: {
    display: 'grid',
    gap: 7,
    marginBottom: 14,
  },
  projectPickerLabel: {
    fontSize: 11,
    lineHeight: '16px',
    fontWeight: 700,
    color: 'var(--color-text-muted)',
  },
  projectSelect: {
    width: '100%',
    height: 34,
    borderRadius: 8,
    border: '1px solid var(--theme-border)',
    background: 'var(--theme-bg-surface)',
    color: 'var(--color-text-primary)',
    padding: '0 10px',
    fontSize: 12,
    outline: 'none',
  },
  list: {
    display: 'grid',
    gap: 9,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  listItem: {
    display: 'flex',
    gap: 8,
    alignItems: 'flex-start',
    color: 'var(--color-text-secondary)',
  },
  dot: {
    width: 5,
    height: 5,
    marginTop: 9,
    borderRadius: 999,
    background: 'var(--color-accent-primary)',
    flexShrink: 0,
  },
  wrapRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 7,
  },
  commandCard: {
    display: 'grid',
    gap: 10,
  },
  commandBlock: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid var(--theme-border)',
    background: 'var(--theme-bg-surface)',
  },
  commandText: {
    minWidth: 0,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: monoFont,
    fontSize: 13,
    lineHeight: '18px',
    color: 'var(--color-text-primary)',
  },
  copyButton: {
    width: 28,
    height: 28,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
    border: '1px solid var(--theme-border)',
    background: 'transparent',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
  },
  exampleStack: {
    display: 'grid',
    gap: 9,
  },
  example: {
    padding: '10px 11px',
    borderRadius: 8,
    border: '1px solid var(--theme-border)',
    background: 'var(--theme-bg-surface)',
    color: 'var(--color-text-secondary)',
    fontFamily: monoFont,
    fontSize: 11,
    lineHeight: '20px',
  },
  installTarget: {
    display: 'block',
    width: '100%',
    minHeight: 158,
    padding: 14,
    borderRadius: 10,
    border: '1px solid var(--theme-border)',
    background: 'var(--theme-bg-surface)',
    textAlign: 'left',
  },
  installTargetHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  installIcon: {
    width: 30,
    height: 30,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    color: 'var(--color-accent-primary)',
    background: 'rgba(245,158,11,0.10)',
  },
  installTitle: {
    flex: 1,
    fontSize: 13,
    lineHeight: '18px',
    fontWeight: 780,
    color: 'var(--color-text-primary)',
  },
  installDesc: {
    minHeight: 48,
    margin: '0 0 12px',
    fontSize: 12,
    lineHeight: '21px',
    color: 'var(--color-text-muted)',
  },
  pathLine: {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    padding: '7px 8px',
    borderRadius: 7,
    background: 'var(--theme-bg-raised)',
    color: 'var(--color-text-secondary)',
    fontFamily: monoFont,
    fontSize: 10,
    lineHeight: '16px',
  },
  installAction: {
    height: 30,
    marginTop: 12,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '0 10px',
    borderRadius: 8,
    background: 'var(--color-accent-primary)',
    color: '#111',
    fontSize: 11,
    lineHeight: '16px',
    fontWeight: 750,
  },
  riskPanel: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
  },
  riskDot: {
    width: 10,
    height: 10,
    marginTop: 5,
    borderRadius: 999,
    flexShrink: 0,
  },
  packageTree: {
    display: 'grid',
    gap: 8,
  },
  packageRoot: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '9px 11px',
    borderRadius: 8,
    border: '1px solid var(--theme-border)',
    background: 'rgba(245,158,11,0.08)',
    color: 'var(--color-accent-primary)',
  },
  packageRootName: {
    fontFamily: monoFont,
    fontSize: 12,
    lineHeight: '18px',
    fontWeight: 800,
  },
  fileRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '10px 11px',
    borderRadius: 8,
    border: '1px solid var(--theme-border)',
    background: 'var(--theme-bg-surface)',
  },
  fileName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: monoFont,
    fontSize: 12,
    lineHeight: '18px',
    fontWeight: 750,
    color: 'var(--color-text-primary)',
  },
  fileDesc: {
    fontSize: 11,
    lineHeight: '18px',
    color: 'var(--color-text-muted)',
  },
  fileMetaLine: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 5,
    fontSize: 10,
    lineHeight: '14px',
    color: 'var(--color-text-disabled)',
  },
  fileState: {
    fontSize: 10,
    fontWeight: 750,
    whiteSpace: 'nowrap',
    marginTop: 1,
  },
  details: {
    borderRadius: 10,
    border: '1px solid var(--theme-border)',
    background: 'var(--theme-bg-raised)',
    overflow: 'hidden',
  },
  summaryToggle: {
    padding: '13px 16px',
    cursor: 'pointer',
    color: 'var(--color-text-secondary)',
    fontSize: 12,
    lineHeight: '18px',
    fontWeight: 650,
  },
  rawBlock: {
    maxHeight: 360,
    margin: 0,
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    padding: '14px 16px',
    borderTop: '1px solid var(--theme-border)',
    color: 'var(--color-text-muted)',
    fontFamily: monoFont,
    fontSize: 11,
    lineHeight: '20px',
  },
  sideCard: {
    display: 'grid',
    gap: 9,
    padding: 13,
    borderRadius: 10,
    border: '1px solid var(--theme-border)',
    background: 'var(--theme-bg-surface)',
    marginBottom: 12,
  },
  sideTitle: {
    margin: '0 0 2px',
    fontSize: 11,
    lineHeight: '16px',
    fontWeight: 780,
    color: 'var(--color-text-primary)',
  },
  metaRow: {
    display: 'grid',
    gridTemplateColumns: '58px minmax(0, 1fr)',
    gap: 10,
    fontSize: 11,
    lineHeight: '17px',
  },
  metaLabel: {
    color: 'var(--color-text-muted)',
  },
  metaValue: {
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    color: 'var(--color-text-secondary)',
  },
  monoValue: {
    fontFamily: monoFont,
    fontSize: 10,
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    whiteSpace: 'nowrap',
    borderRadius: 999,
    padding: '3px 8px',
    fontSize: 10,
    lineHeight: '14px',
    fontWeight: 650,
  },
}
