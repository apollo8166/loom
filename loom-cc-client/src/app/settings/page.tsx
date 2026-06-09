'use client'

import { useState } from 'react'
import { ChevronRight, Cpu, Volume2, Globe, FileText, Monitor, Settings2, Sliders, Keyboard, Image as ImageIcon } from 'lucide-react'
import { ProviderSettings } from '@/components/settings/provider-settings'
import { ImageGenerationSettings } from '@/components/settings/image-generation-settings'
import { TtsSettings } from '@/components/settings/tts-settings'
import { AsrSettings } from '@/components/settings/asr-settings'
import { WebSearchSettings } from '@/components/settings/web-search-settings'
import { PdfSettings } from '@/components/settings/pdf-settings'
import { AppearanceSettings } from '@/components/settings/appearance-settings'
import { McpSettings } from '@/components/settings/mcp-settings'
import { AdvancedSettings } from '@/components/settings/advanced-settings'
import { ShortcutSettings } from '@/components/settings/shortcut-settings'

/* ── Panel IDs ── */
type PanelId =
  | 'provider'
  | 'image-generation'
  | 'tts'
  | 'asr'
  | 'web-search-config'
  | 'pdf-config'
  | 'appearance-theme'
  | 'mcp-config'
  | 'shortcuts-config'
  | 'advanced-config'

/* ── Nav structure ── */
const NAV = [
  {
    id: 'ai', label: 'AI 服务商', Icon: Cpu,
    children: [{ id: 'provider' as PanelId, label: 'Provider 设置' }],
  },
  {
    id: 'image-generation-root', label: '图像生成', Icon: ImageIcon,
    children: [{ id: 'image-generation' as PanelId, label: '图像生成设置' }],
  },
  {
    id: 'voice', label: '语音配置', Icon: Volume2,
    children: [
      { id: 'tts' as PanelId, label: '语音合成' },
      { id: 'asr' as PanelId, label: '语音识别' },
    ],
  },
  {
    id: 'web-search', label: '网络搜索', Icon: Globe,
    children: [{ id: 'web-search-config' as PanelId, label: '搜索服务配置' }],
  },
  {
    id: 'pdf', label: 'PDF 解析', Icon: FileText,
    children: [{ id: 'pdf-config' as PanelId, label: 'PDF 解析配置' }],
  },
  {
    id: 'appearance', label: '外观', Icon: Monitor,
    children: [{ id: 'appearance-theme' as PanelId, label: '界面主题' }],
  },
  {
    id: 'mcp', label: 'MCP Servers', Icon: Settings2,
    children: [{ id: 'mcp-config' as PanelId, label: 'MCP 服务配置' }],
  },
  {
    id: 'shortcuts', label: '快捷键', Icon: Keyboard,
    children: [{ id: 'shortcuts-config' as PanelId, label: '截图快捷键' }],
  },
  {
    id: 'advanced', label: '高级设置', Icon: Sliders,
    children: [{ id: 'advanced-config' as PanelId, label: '高级配置' }],
  },
]


/* ── Sidebar ── */
function Sidebar({
  activePanel,
  onSelect,
}: {
  activePanel: PanelId
  onSelect: (id: PanelId) => void
}) {
  const defaultExpanded = NAV.map(g => g.id)
  const [expanded, setExpanded] = useState<string[]>(defaultExpanded)

  const toggle = (id: string) => {
    setExpanded(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  return (
    <div
      style={{
        width: 200,
        flexShrink: 0,
        borderRight: '1px solid var(--color-border-subtle)',
        overflowY: 'auto',
        paddingTop: 8,
        paddingBottom: 16,
      }}
    >
      {NAV.map(group => {
        const isExpanded = expanded.includes(group.id)
        const { Icon } = group
        return (
          <div key={group.id}>
            {/* Group header */}
            <button
              onClick={() => toggle(group.id)}
              className="flex items-center w-full transition-colors duration-100"
              style={{
                padding: '9px 16px',
                gap: 9,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-secondary)',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = 'var(--color-bg-surface-high)'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = 'transparent'
              }}
            >
              <Icon size={15} style={{ flexShrink: 0, color: 'var(--color-text-muted)' }} />
              <span style={{ flex: 1, textAlign: 'left', fontSize: 13, fontWeight: 500 }}>
                {group.label}
              </span>
              <ChevronRight
                size={13}
                style={{
                  color: 'var(--color-text-muted)',
                  transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.15s',
                  flexShrink: 0,
                }}
              />
            </button>

            {/* Sub-items */}
            {isExpanded && group.children.map(child => {
              const isActive = child.id === activePanel
              return (
                <button
                  key={child.id}
                  onClick={() => onSelect(child.id)}
                  className="flex items-center w-full transition-colors duration-100"
                  style={{
                    paddingTop: 8, paddingBottom: 8,
                    paddingLeft: 40, paddingRight: 16,
                    background: isActive ? 'rgba(245,158,11,0.08)' : 'transparent',
                    border: 'none',
                    borderRight: isActive ? '3px solid var(--color-accent-primary)' : '3px solid transparent',
                    cursor: 'pointer',
                    color: isActive ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
                    fontSize: 12,
                    fontWeight: isActive ? 600 : 400,
                    textAlign: 'left',
                  }}
                  onMouseEnter={e => {
                    if (!isActive) {
                      (e.currentTarget as HTMLElement).style.background = 'var(--color-bg-surface-high)'
                      ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isActive) {
                      (e.currentTarget as HTMLElement).style.background = 'transparent'
                      ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'
                    }
                  }}
                >
                  {child.label}
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

/* ── Panel wrapper — every panel gets its own padding ── */
function PanelWrap({
  title,
  desc,
  children,
}: {
  title: string
  desc?: string
  children: React.ReactNode
}) {
  return (
    <div style={{ padding: '28px 36px', maxWidth: 660 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: desc ? 6 : 20 }}>
        {title}
      </h2>
      {desc && (
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 24, lineHeight: 1.6 }}>
          {desc}
        </p>
      )}
      {children}
    </div>
  )
}

/* ── Page ── */
export default function SettingsPage() {
  const [activePanel, setActivePanel] = useState<PanelId>('provider')

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <Sidebar activePanel={activePanel} onSelect={setActivePanel} />

      {/* Content Area — no padding here; each panel brings its own */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {activePanel === 'provider' && (
          <PanelWrap title="Provider 设置" desc="选择并配置 AI 服务商，支持 Anthropic 和 OpenAI 兼容接口">
            <ProviderSettings />
          </PanelWrap>
        )}
        {activePanel === 'image-generation' && (
          <PanelWrap title="图像生成设置" desc="配置文生图和参考图生图服务商，支持 GPT-Image2 与 SeeDream">
            <ImageGenerationSettings />
          </PanelWrap>
        )}
        {activePanel === 'tts' && (
          <PanelWrap title="语音合成" desc="配置 TTS 服务商及音色">
            <TtsSettings />
          </PanelWrap>
        )}
        {activePanel === 'asr' && (
          <PanelWrap title="语音识别" desc="配置实时语音转文字（ASR）服务商">
            <AsrSettings />
          </PanelWrap>
        )}
        {activePanel === 'web-search-config' && (
          <PanelWrap title="搜索服务配置" desc="配置联网搜索服务商及 API Key">
            <WebSearchSettings />
          </PanelWrap>
        )}
        {activePanel === 'pdf-config' && (
          <PanelWrap title="PDF 解析配置" desc="配置 PDF 解析服务商，提取文本、图片、表格和公式">
            <PdfSettings />
          </PanelWrap>
        )}
        {activePanel === 'appearance-theme' && (
          <PanelWrap title="界面外观" desc="选择深色、浅色或跟随系统的显示模式">
            <AppearanceSettings />
          </PanelWrap>
        )}
        {activePanel === 'mcp-config' && (
          <PanelWrap title="Claude User MCP" desc="管理 Claude user scope 的 Model Context Protocol 服务器">
            <McpSettings />
          </PanelWrap>
        )}
        {activePanel === 'shortcuts-config' && (
          <PanelWrap title="快捷键" desc="配置全局快捷键和截图入口">
            <ShortcutSettings />
          </PanelWrap>
        )}
        {activePanel === 'advanced-config' && (
          <PanelWrap title="高级配置" desc="数据目录、Claude CLI 路径及危险操作">
            <AdvancedSettings />
          </PanelWrap>
        )}
      </div>
    </div>
  )
}
