'use client'

import { useEffect, useRef, useState } from 'react'

type Rect = { x: number; y: number; w: number; h: number }

interface CaptureWindowOverlayProps {
  onCancel: () => void
  onCapture: (dataUrl: string) => void
}

function normalizeRect(startX: number, startY: number, currentX: number, currentY: number): Rect {
  const x = Math.min(startX, currentX)
  const y = Math.min(startY, currentY)
  const w = Math.abs(currentX - startX)
  const h = Math.abs(currentY - startY)
  return { x, y, w, h }
}

export function CaptureWindowOverlay({ onCancel, onCapture }: CaptureWindowOverlayProps) {
  const [rect, setRect] = useState<Rect | null>(null)
  const [dragging, setDragging] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter' && rect && rect.w >= 8 && rect.h >= 8) capture()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // capture reads the latest rect and hides the overlay before grabbing pixels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rect, onCancel])

  const capture = async () => {
    if (!rect || rect.w < 8 || rect.h < 8) return
    const overlay = overlayRef.current
    if (!overlay) return
    setCapturing(true)
    overlay.style.visibility = 'hidden'
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    try {
      const dataUrl = await window.electronAPI?.captureWindowArea?.({
        x: rect.x,
        y: rect.y,
        width: rect.w,
        height: rect.h,
      })
      if (!dataUrl) throw new Error('Window capture unavailable')
      onCapture(dataUrl)
    } catch {
      onCancel()
    } finally {
      overlay.style.visibility = 'visible'
      setCapturing(false)
    }
  }

  return (
    <div
      ref={overlayRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        cursor: 'crosshair',
        background: rect ? 'transparent' : 'rgba(15, 23, 42, 0.28)',
        userSelect: 'none',
      }}
      onMouseDown={e => {
        startRef.current = { x: e.clientX, y: e.clientY }
        setRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 })
        setDragging(true)
      }}
      onMouseMove={e => {
        if (!dragging || !startRef.current) return
        setRect(normalizeRect(startRef.current.x, startRef.current.y, e.clientX, e.clientY))
      }}
      onMouseUp={e => {
        if (!startRef.current) return
        setRect(normalizeRect(startRef.current.x, startRef.current.y, e.clientX, e.clientY))
        setDragging(false)
      }}
    >
      {rect && (
        <>
          <div
            style={{
              position: 'absolute',
              left: rect.x,
              top: rect.y,
              width: rect.w,
              height: rect.h,
              border: '1px solid var(--color-accent-primary)',
              boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.42)',
              background: 'transparent',
            }}
          />
          {rect.w > 0 && rect.h > 0 && (
            <div style={{
              position: 'absolute',
              left: rect.x,
              top: Math.max(8, rect.y - 30),
              height: 24,
              padding: '0 8px',
              borderRadius: 6,
              background: 'rgba(15, 23, 42, 0.86)',
              color: 'white',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <span>{Math.round(rect.w)} x {Math.round(rect.h)}</span>
              <span style={{ color: 'rgba(255,255,255,0.55)' }}>窗口内截图 · Enter 确认 · Esc 取消</span>
            </div>
          )}
          {!dragging && rect.w >= 8 && rect.h >= 8 && (
            <div
              style={{
                position: 'absolute',
                left: Math.min(rect.x + rect.w - 168, window.innerWidth - 180),
                top: Math.min(rect.y + rect.h + 8, window.innerHeight - 44),
                display: 'flex',
                gap: 8,
              }}
              onMouseDown={e => e.stopPropagation()}
            >
              <button onClick={onCancel} style={buttonStyle('secondary')}>取消</button>
              <button onClick={capture} disabled={capturing} style={buttonStyle('primary')}>
                {capturing ? '处理中...' : '附加到 Chat'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function buttonStyle(kind: 'primary' | 'secondary'): React.CSSProperties {
  return {
    height: 32,
    padding: '0 12px',
    borderRadius: 7,
    border: kind === 'primary' ? 'none' : '1px solid rgba(255,255,255,0.18)',
    background: kind === 'primary' ? 'var(--color-accent-primary)' : 'rgba(15,23,42,0.86)',
    color: kind === 'primary' ? '#111827' : 'white',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
  }
}
