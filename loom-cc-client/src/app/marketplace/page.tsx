import { Store } from 'lucide-react'

export default function MarketplacePage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center h-full px-6">
      <div
        className="flex items-center justify-center w-16 h-16 rounded-2xl mb-6"
        style={{ backgroundColor: 'var(--color-bg-surface-highest)' }}
      >
        <Store
          className="w-8 h-8"
          style={{ color: 'var(--color-text-muted)' }}
        />
      </div>
      <h1
        className="text-xl font-semibold mb-2"
        style={{ color: 'var(--color-text-primary)' }}
      >
        Marketplace
      </h1>
      <p
        className="text-sm text-center max-w-xs"
        style={{ color: 'var(--color-text-muted)' }}
      >
        Community skills and agent templates — coming soon.
      </p>
    </div>
  )
}
