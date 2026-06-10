'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, X, Plus, Image as ImageIcon } from 'lucide-react'
import {
  IMAGE_STYLE_PRESETS,
  IMAGE_ASPECT_RATIO_PRESETS,
  type ImageGenerationConfig,
  type ImageStylePreset,
} from '@/shared/config/image-generation-config'

interface UploadedRefImage {
  name: string
  url: string
  serverFilename: string
  mimeType: string
}

export interface ImageGenSettings {
  providerId: string
  aspectRatioId: string
  styleId: string
  referenceImages: UploadedRefImage[]
}

interface ImageGenToolbarProps {
  config: ImageGenerationConfig
  settings: ImageGenSettings
  onSettingsChange: (s: Partial<ImageGenSettings>) => void
  onClose: () => void
  disabled?: boolean
}

const RATIO_ICONS: Record<string, React.ReactNode> = {
  '1:1': <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" /></svg>,
  '2:3': <svg width="10" height="14" viewBox="0 0 10 14" fill="none"><rect x="1" y="1" width="8" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" /></svg>,
  '3:4': <svg width="11" height="14" viewBox="0 0 11 14" fill="none"><rect x="1" y="1" width="9" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" /></svg>,
  '4:3': <svg width="14" height="11" viewBox="0 0 14 11" fill="none"><rect x="1" y="1" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" /></svg>,
  '9:16': <svg width="9" height="14" viewBox="0 0 9 14" fill="none"><rect x="1" y="1" width="7" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" /></svg>,
  '16:9': <svg width="14" height="9" viewBox="0 0 14 9" fill="none"><rect x="1" y="1" width="12" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" /></svg>,
}

function Dropdown({ label, open, onToggle, children, disabled }: { label: React.ReactNode; open: boolean; onToggle: () => void; children: React.ReactNode; disabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onToggle()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onToggle])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => { if (!disabled) onToggle() }}
        disabled={disabled}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, height: 32,
          border: '1px solid var(--theme-border)', borderRadius: 7,
          padding: '0 10px', background: 'transparent',
          color: 'var(--color-text-muted)', cursor: disabled ? 'default' : 'pointer', fontSize: 11,
          whiteSpace: 'nowrap',
          opacity: disabled ? 0.45 : 1,
        }}
        onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.background = 'var(--theme-bg-hover)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
      >
        {label}
        <ChevronDown size={11} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 8px)', left: 0,
          background: 'var(--theme-bg-surface)', border: '1px solid var(--theme-border-strong)',
          borderRadius: 10, boxShadow: 'var(--theme-shadow-popover)',
          padding: 6, zIndex: 200, minWidth: 200,
        }}>
          {children}
        </div>
      )}
    </div>
  )
}

function PopupTitle({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 10, color: '#6b5a47', padding: '4px 10px 6px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
      {children}
    </p>
  )
}

function StyleThumbnail({ preset }: { preset: ImageStylePreset }) {
  if (preset.thumbnailUrl) {
    return (
      <img
        src={preset.thumbnailUrl}
        alt={preset.label}
        loading="lazy"
        style={{
          width: 34,
          height: 34,
          borderRadius: 5,
          objectFit: 'cover',
          flexShrink: 0,
          border: '1px solid var(--theme-border)',
          background: 'var(--theme-bg-raised)',
        }}
      />
    )
  }

  return (
    <div style={{
      width: 34,
      height: 34,
      borderRadius: 5,
      flexShrink: 0,
      border: '1px solid var(--theme-border)',
      background: 'var(--theme-bg-raised)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--color-text-disabled)',
      fontSize: 14,
    }}>
      -
    </div>
  )
}

export function ImageGenToolbar({ config, settings, onSettingsChange, onClose, disabled }: ImageGenToolbarProps) {
  const [providerOpen, setProviderOpen] = useState(false)
  const [ratioOpen, setRatioOpen] = useState(false)
  const [styleOpen, setStyleOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const activeProvider = config.configs.find(c => c.id === settings.providerId) ?? config.configs[0]
  const activeRatio = IMAGE_ASPECT_RATIO_PRESETS.find(r => r.id === settings.aspectRatioId) ?? IMAGE_ASPECT_RATIO_PRESETS[0]
  const activeStyle = IMAGE_STYLE_PRESETS.find(s => s.id === settings.styleId) ?? IMAGE_STYLE_PRESETS[0]

  const allProviders = config.configs

  async function handleRefImageUpload(files: FileList | null) {
    if (!files) return
    const remainingSlots = Math.max(0, 8 - settings.referenceImages.length)
    const imageFiles = Array.from(files)
      .filter(file => file.type.startsWith('image/'))
      .slice(0, remainingSlots)
    if (imageFiles.length === 0) return

    const uploaded = await Promise.all(imageFiles.map(async file => {
      const form = new FormData()
      form.append('file', file)
      try {
        const res = await fetch('/api/files/upload', { method: 'POST', body: form })
        if (!res.ok) return null
        const data = await res.json() as { filename: string; url?: string; mimeType?: string }
        return {
          name: file.name,
          url: data.url ?? `/api/files/serve/${data.filename}`,
          serverFilename: data.filename,
          mimeType: data.mimeType ?? file.type ?? 'image/png',
        } satisfies UploadedRefImage
      } catch {
        return null
      }
    }))

    const refs = uploaded.filter((ref): ref is UploadedRefImage => Boolean(ref))
    if (refs.length > 0) onSettingsChange({ referenceImages: [...settings.referenceImages, ...refs] })
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, flexWrap: 'nowrap', minWidth: 0 }}>
      {/* Hidden file input for reference images (images only) */}
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        multiple
        accept="image/*"
        onChange={e => {
          void handleRefImageUpload(e.target.files)
          e.currentTarget.value = ''
        }}
      />

      {/* Upload reference image button */}
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled || settings.referenceImages.length >= 8}
        title="上传参考图"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 32, height: 32, borderRadius: 7,
          border: '1px solid var(--theme-border)', background: 'transparent',
          color: 'var(--color-text-muted)', cursor: disabled || settings.referenceImages.length >= 8 ? 'default' : 'pointer', flexShrink: 0,
          opacity: (disabled || settings.referenceImages.length >= 8) ? 0.4 : 1,
        }}
        onMouseEnter={e => { if (!disabled && settings.referenceImages.length < 8) (e.currentTarget as HTMLElement).style.background = 'var(--theme-bg-hover)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
      >
        <Plus size={13} />
      </button>

      {/* Separator */}
      <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', flexShrink: 0, margin: '0 2px' }} />

      {/* "图像生成 ×" highlighted badge */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5, height: 28,
        background: 'rgba(245,158,11,0.13)', border: '1px solid rgba(245,158,11,0.45)',
        borderRadius: 7, padding: '0 6px 0 8px', flexShrink: 0,
      }}>
        <ImageIcon size={13} style={{ color: '#F59E0B' }} />
        <span style={{ fontSize: 12, color: '#F59E0B', fontWeight: 500 }}>图像生成</span>
        <button
          onClick={onClose}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 18, height: 18, borderRadius: 4,
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: '#F59E0B', marginLeft: 2,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(245,158,11,0.2)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          title="关闭图像生成模式"
        >
          <X size={11} />
        </button>
      </div>

      {/* Provider dropdown */}
      <Dropdown
        open={providerOpen}
        onToggle={() => { setProviderOpen(!providerOpen); setRatioOpen(false); setStyleOpen(false) }}
        disabled={disabled}
        label={
          <>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ marginRight: 1, flexShrink: 0 }}>
              <path d="M8 1l1.5 3.5L13 5 10.5 7.5l.5 3.5L8 9.5 5 11l.5-3.5L3 5l3.5-.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
            <span>{activeProvider?.name ?? '选择服务商'}</span>
          </>
        }
      >
        <PopupTitle>图像生成服务商</PopupTitle>
        {allProviders.map(p => {
          const active = settings.providerId === p.id
          const hasKey = Boolean(p.apiKey?.trim())
          return (
            <button
              key={p.id}
              onClick={() => { onSettingsChange({ providerId: p.id }); setProviderOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '7px 10px', borderRadius: 7, border: 'none', cursor: 'pointer',
                background: active ? 'rgba(245,158,11,0.12)' : 'transparent',
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--theme-bg-hover)' }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = active ? 'rgba(245,158,11,0.12)' : 'transparent' }}
            >
              <span style={{ fontSize: 12, color: active ? '#F59E0B' : hasKey ? '#d8c3ad' : '#6b5a47', flex: 1, textAlign: 'left' }}>
                {p.name}
              </span>
              {!hasKey && <span style={{ fontSize: 10, color: '#6b5a47' }}>未配置</span>}
              {active && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            </button>
          )
        })}
      </Dropdown>

      {/* Ratio dropdown */}
      <Dropdown
        open={ratioOpen}
        onToggle={() => { setRatioOpen(!ratioOpen); setProviderOpen(false); setStyleOpen(false) }}
        disabled={disabled}
        label={
          <>
            {RATIO_ICONS[settings.aspectRatioId] ?? <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" /></svg>}
            <span style={{ marginLeft: 3 }}>{activeRatio.id}</span>
          </>
        }
      >
        <PopupTitle>比例</PopupTitle>
        {IMAGE_ASPECT_RATIO_PRESETS.map(r => {
          const active = settings.aspectRatioId === r.id
          return (
            <button
              key={r.id}
              onClick={() => { onSettingsChange({ aspectRatioId: r.id }); setRatioOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '7px 10px', borderRadius: 7, border: 'none', cursor: 'pointer',
                background: active ? 'rgba(245,158,11,0.12)' : 'transparent',
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--theme-bg-hover)' }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = active ? 'rgba(245,158,11,0.12)' : 'transparent' }}
            >
              <span style={{ color: active ? '#F59E0B' : '#6b5a47', flexShrink: 0 }}>{RATIO_ICONS[r.id]}</span>
              <span style={{ fontSize: 12, color: active ? '#F59E0B' : '#d8c3ad', flex: 1, textAlign: 'left' }}>{r.label}</span>
              {active && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            </button>
          )
        })}
      </Dropdown>

      {/* Style dropdown */}
      <Dropdown
        open={styleOpen}
        onToggle={() => { setStyleOpen(!styleOpen); setProviderOpen(false); setRatioOpen(false) }}
        disabled={disabled}
        label={
          <>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
              <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.3" />
              <path d="M8 1v2M8 13v2M1 8h2M13 8h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <span style={{ marginLeft: 3 }}>{activeStyle.id === 'none' ? '风格' : activeStyle.label}</span>
          </>
        }
      >
        <PopupTitle>风格</PopupTitle>
        <div style={{ maxHeight: 340, overflowY: 'auto' }}>
          {IMAGE_STYLE_PRESETS.map(s => {
            const active = settings.styleId === s.id
            return (
              <button
                key={s.id}
                onClick={() => { onSettingsChange({ styleId: s.id }); setStyleOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  padding: '6px 8px', borderRadius: 7, border: 'none', cursor: 'pointer',
                  background: active ? 'rgba(245,158,11,0.12)' : 'transparent',
                }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--theme-bg-hover)' }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = active ? 'rgba(245,158,11,0.12)' : 'transparent' }}
              >
                <StyleThumbnail preset={s} />
                <span style={{ fontSize: 12, color: active ? '#F59E0B' : '#d8c3ad', flex: 1, textAlign: 'left' }}>{s.label}</span>
                {active && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </button>
            )
          })}
        </div>
      </Dropdown>
    </div>
  )
}
