'use client'

import { X } from 'lucide-react'

interface CaptureConfirmDialogProps {
  dataUrl: string
  onCancel: () => void
  onConfirm: () => void
}

export function CaptureConfirmDialog({ dataUrl, onCancel, onConfirm }: CaptureConfirmDialogProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10001,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(10, 15, 24, 0.58)',
        backdropFilter: 'blur(10px)',
      }}
      onMouseDown={onCancel}
    >
      <div
        style={{
          width: 'min(820px, 88vw)',
          maxHeight: '86vh',
          borderRadius: 18,
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border-strong)',
          boxShadow: '0 30px 80px rgba(0,0,0,0.42)',
          overflow: 'hidden',
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div
          style={{
            height: 52,
            padding: '0 16px 0 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid var(--color-border-subtle)',
            background: 'linear-gradient(180deg, var(--color-bg-surface-high), var(--color-bg-surface))',
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--color-text-primary)' }}>截图预览</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>确认后会作为图片附件添加到当前对话输入框</div>
          </div>
          <button
            onClick={onCancel}
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              border: 'none',
              background: 'transparent',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div
          style={{
            padding: 16,
            maxHeight: 'calc(86vh - 116px)',
            overflow: 'auto',
            background: 'var(--color-bg-canvas)',
          }}
        >
          <div
            style={{
              borderRadius: 12,
              border: '1px solid var(--color-border-subtle)',
              background: 'var(--color-bg-surface)',
              padding: 10,
            }}
          >
            <img
              src={dataUrl}
              alt="截图预览"
              style={{
                display: 'block',
                maxWidth: '100%',
                maxHeight: '56vh',
                margin: '0 auto',
                borderRadius: 8,
                objectFit: 'contain',
              }}
            />
          </div>
        </div>

        <div
          style={{
            height: 64,
            padding: '0 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 10,
            borderTop: '1px solid var(--color-border-subtle)',
          }}
        >
          <button onClick={onCancel} style={buttonStyle('secondary')}>取消</button>
          <button onClick={onConfirm} style={buttonStyle('primary')}>添加到对话</button>
        </div>
      </div>
    </div>
  )
}

function buttonStyle(kind: 'primary' | 'secondary'): React.CSSProperties {
  return {
    height: 34,
    padding: '0 14px',
    borderRadius: 9,
    border: kind === 'primary' ? 'none' : '1px solid var(--color-border-strong)',
    background: kind === 'primary' ? 'var(--color-accent-primary)' : 'var(--color-bg-surface-high)',
    color: kind === 'primary' ? '#000' : 'var(--color-text-secondary)',
    fontSize: 12,
    fontWeight: 650,
    cursor: 'pointer',
  }
}
