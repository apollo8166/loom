import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getDb } from '@/shared/db/db'
import {
  getAllProviderConfigs,
  getActiveProviderId,
  saveAllProviderConfigs,
  setActiveProviderId,
} from '@/shared/config/provider-config'
import type { ProviderConfig } from '@/shared/config/provider-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const db = getDb()
  const active = getActiveProviderId(db)
  const configs = getAllProviderConfigs(db)
  return NextResponse.json({ active, configs })
}

export async function PUT(req: NextRequest) {
  const { activeId, configs } = await req.json() as { activeId: string; configs: ProviderConfig[] }
  const db = getDb()
  setActiveProviderId(db, activeId)
  saveAllProviderConfigs(db, configs)
  return NextResponse.json({ ok: true })
}
