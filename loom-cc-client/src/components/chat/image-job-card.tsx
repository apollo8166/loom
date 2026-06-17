'use client'

import { useState, useEffect, useRef } from 'react'
import { Download, Edit2, RotateCcw, ZoomIn } from 'lucide-react'
import { IMAGE_PROVIDER_PRESETS, isGptImage2Model } from '@/shared/config/image-generation-config'
import type { ImageGenerationJob, ImageJobStatus } from '@/shared/image-generation/job-store'

interface ImageJobCardProps {
  job: ImageGenerationJob
  onRetry?: (jobId: string) => void
  onEditFromImage?: (imageUrl: string) => void
  onDownload?: (imageUrl: string, filename: string) => void
}

const STATUS_STEPS: Array<{ status: ImageJobStatus | string; label: string }> = [
  { status: 'merging', label: '整理上下文' },
  { status: 'submitting', label: '提交请求' },
  { status: 'waiting', label: '等待图片返回' },
]

const STATUS_TITLES: Partial<Record<string, string>> = {
  pending: '请求已发送',
  merging: '整理上下文',
  submitting: '提交请求',
  waiting: '正在等待图片返回',
}

const STATUS_DESC: Partial<Record<string, string>> = {
  pending: '图像服务正在处理请求，请保持页面开启。',
  merging: '正在分析上下文并优化提示词...',
  submitting: '正在向图像服务提交生成请求...',
  waiting: '图像生成通常需要 30 到 60 秒，网络较慢时会更久一些。',
}

function getStatusDesc(job: ImageGenerationJob): string {
  if (job.status === 'waiting' && isGptImage2Model(job.model || (job.providerId === 'openai' ? 'gpt-image-2' : ''))) {
    return 'GPT-Image2 质量相对较高，出图时间较长，通常需要约 180 秒。'
  }
  return STATUS_DESC[job.status] ?? '正在生成图像...'
}

function providerLabel(providerId: string): string {
  return IMAGE_PROVIDER_PRESETS[providerId as keyof typeof IMAGE_PROVIDER_PRESETS]?.name || providerId
}

function ElapsedTimer({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(0)
  const rafRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  useEffect(() => {
    const start = new Date(startedAt).getTime()
    function tick() {
      setElapsed(Math.floor((Date.now() - start) / 1000))
    }
    tick()
    rafRef.current = setInterval(tick, 1000)
    return () => { if (rafRef.current) clearInterval(rafRef.current) }
  }, [startedAt])

  if (elapsed < 60) return <span>{elapsed} 秒</span>
  const m = Math.floor(elapsed / 60)
  const s = elapsed % 60
  return <span>{m}m {s}s</span>
}

function SkeletonImage() {
  return (
    <div style={{
      width: 280, height: 220, borderRadius: 10,
      background: 'var(--theme-bg-surface)',
      border: '1px solid var(--theme-border)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', position: 'relative',
    }}>
      {/* Dot grid pattern */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(12, 1fr)',
        gap: 8,
        padding: 20,
        opacity: 0.4,
      }}>
        {Array.from({ length: 120 }).map((_, i) => (
          <div
            key={i}
            style={{
              width: 4, height: 4, borderRadius: '50%',
              background: `rgba(59,130,246,${0.2 + (Math.sin(i * 0.3) + 1) * 0.15})`,
              animation: `imageGenPulse ${1.5 + (i % 5) * 0.2}s ease-in-out infinite`,
              animationDelay: `${(i % 7) * 0.1}s`,
            }}
          />
        ))}
      </div>
      <style>{`
        @keyframes imageGenPulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.2); }
        }
      `}</style>
    </div>
  )
}

function StepChips({ currentStatus }: { currentStatus: string }) {
  const stepOrder = ['merging', 'submitting', 'waiting']
  const currentIdx = stepOrder.indexOf(currentStatus)

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
      {STATUS_STEPS.map((step, i) => {
        const done = currentIdx > i
        const active = currentStatus === step.status || (currentStatus === 'pending' && i === 0)
        return (
          <div
            key={step.status}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '4px 10px', borderRadius: 20,
              background: done ? 'rgba(34,197,94,0.12)' : active ? 'rgba(59,130,246,0.15)' : 'var(--theme-bg-raised)',
              border: done ? '1px solid rgba(34,197,94,0.25)' : active ? '1px solid rgba(59,130,246,0.35)' : '1px solid var(--theme-border)',
            }}
          >
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: done ? '#22c55e' : active ? '#60a5fa' : 'var(--color-text-disabled)',
            }} />
            <span style={{ fontSize: 11, color: done ? '#16a34a' : active ? '#2563eb' : 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
              {step.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function ImagePreviewModal({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out',
      }}
    >
      <img
        src={url}
        alt="Generated image"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 12, boxShadow: '0 8px 40px rgba(0,0,0,0.6)', cursor: 'default' }}
      />
    </div>
  )
}

export function ImageJobCard({ job, onRetry, onEditFromImage, onDownload }: ImageJobCardProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const isLoading = ['pending', 'merging', 'submitting', 'waiting'].includes(job.status)
  const isSuccess = job.status === 'success'
  const isError = job.status === 'error'

  const meta = job.resultMetadata as {
    model?: string; size?: string; format?: string; count?: number; mode?: string; contextRounds?: number;
    images?: Array<{ filename: string; url: string; bytes: number; mimeType: string }>
  }

  function handleDownload(url: string) {
    const filename = url.split('/').pop() ?? 'generated-image.png'
    if (onDownload) { onDownload(url, filename); return }
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
  }

  return (
    <div style={{
      border: '1px solid var(--theme-border)',
      borderRadius: 12, overflow: 'hidden',
      background: 'var(--theme-bg-raised)',
      marginTop: 8, maxWidth: 560,
    }}>
      {previewUrl && <ImagePreviewModal url={previewUrl} onClose={() => setPreviewUrl(null)} />}

      {/* Loading state */}
      {isLoading && (
        <div style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)', margin: 0 }}>
                {STATUS_TITLES[job.status] ?? '处理中...'}
              </p>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '3px 0 0' }}>
                {getStatusDesc(job)}
              </p>
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', background: 'var(--theme-bg-surface)', border: '1px solid var(--theme-border)', borderRadius: 20, padding: '3px 10px', whiteSpace: 'nowrap', flexShrink: 0, marginLeft: 12 }}>
              已等待 <ElapsedTimer startedAt={job.startedAt} />
            </div>
          </div>
          <SkeletonImage />
          <StepChips currentStatus={job.status} />
        </div>
      )}

      {/* Success state */}
      {isSuccess && (
        <div style={{ padding: '14px 16px' }}>
          {(meta.images ?? []).map((img, idx) => (
            <div key={idx} style={{ marginBottom: idx < (meta.images?.length ?? 0) - 1 ? 12 : 0 }}>
              <div
                style={{ position: 'relative', display: 'inline-block', cursor: 'zoom-in' }}
                onClick={() => setPreviewUrl(img.url)}
                title="点击查看大图"
              >
                <img
                  src={img.url}
                  alt={img.filename}
                  style={{ display: 'block', maxWidth: 340, maxHeight: 340, borderRadius: 8, border: '1px solid var(--theme-border)' }}
                />
                <div style={{
                  position: 'absolute', top: 6, right: 6,
                  background: 'rgba(0,0,0,0.5)', borderRadius: 6, padding: 4,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <ZoomIn size={12} style={{ color: '#fff' }} />
                </div>
              </div>
              <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: '6px 0 8px' }}>
                {meta.size ?? ''}{meta.size && meta.format ? ' · ' : ''}{meta.format?.toUpperCase() ?? ''}{meta.images && meta.images.length > 1 ? ` · 第 ${idx + 1} 张` : ''}
                {img.bytes ? ` · ${Math.round(img.bytes / 1024)} KB` : ''}
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                {onEditFromImage && (
                  <button
                    onClick={() => onEditFromImage(img.url)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px',
                      borderRadius: 7, border: '1px solid var(--theme-border)',
                      background: 'transparent', color: 'var(--color-text-primary)',
                      cursor: 'pointer', fontSize: 12,
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--theme-bg-hover)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                  >
                    <Edit2 size={12} />
                    引用
                  </button>
                )}
                <button
                  onClick={() => handleDownload(img.url)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px',
                    borderRadius: 7, border: '1px solid rgba(34,197,94,0.28)',
                    background: 'rgba(34,197,94,0.10)', color: '#16a34a',
                    cursor: 'pointer', fontSize: 12,
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(34,197,94,0.16)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(34,197,94,0.10)' }}
                >
                  <Download size={12} />
                  下载 {(meta.format ?? 'PNG').toUpperCase()}
                </button>
              </div>
            </div>
          ))}
          {/* Metadata bar */}
          <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 10, lineHeight: 1.7, borderTop: '1px solid var(--theme-border)', paddingTop: 8 }}>
            {[
              job.providerId ? `服务商：${providerLabel(job.providerId)}` : null,
              meta.model ? `模型：${meta.model}` : null,
              meta.size ? `尺寸：${meta.size}` : null,
              meta.format ? `格式：${meta.format}` : null,
              meta.contextRounds != null ? `上下文轮次：${meta.contextRounds}` : null,
              meta.mode ? `模式：${meta.mode === 'text_to_image' ? '文生图' : '图生图'}` : null,
            ].filter(Boolean).join(' | ')}
          </p>
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div style={{ padding: '14px 16px' }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: '#f87171', margin: '0 0 6px' }}>生成失败，请检查接口配置后重试。</p>
          {job.errorMessage && (
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 10px', wordBreak: 'break-word' }}>
              {job.errorMessage}
            </p>
          )}
        </div>
      )}

      {/* Retry button (error or success) */}
      {(isError || isSuccess) && onRetry && (
        <div style={{
          padding: isSuccess ? '0 16px 12px' : '20px 16px 18px',
          borderTop: isSuccess ? 'none' : '1px solid var(--theme-border)',
        }}>
          <button
            onClick={() => onRetry(job.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '5px 12px', borderRadius: 7,
              border: '1px solid var(--theme-border)',
              background: 'transparent', color: 'var(--color-text-muted)',
              cursor: 'pointer', fontSize: 12,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--theme-bg-hover)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            <RotateCcw size={11} />
            重新生成
          </button>
        </div>
      )}
    </div>
  )
}

/** Hook to poll a job until it reaches a terminal state */
export function useImageJobPoller(jobId: string | null, intervalMs = 2000) {
  const [job, setJob] = useState<ImageGenerationJob | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (!jobId) { setJob(null); return }

    let stopped = false

    async function poll() {
      try {
        const res = await fetch(`/api/image-generation/jobs/${jobId}`)
        if (!res.ok) return
        const data = await res.json() as ImageGenerationJob
        if (!stopped) setJob(data)
        if (!stopped && !['success', 'error'].includes(data.status)) {
          timerRef.current = setTimeout(poll, intervalMs)
        }
      } catch { /* ignore */ }
    }

    poll()
    return () => {
      stopped = true
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [jobId, intervalMs])

  return job
}
