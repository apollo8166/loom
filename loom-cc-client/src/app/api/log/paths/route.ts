import { NextResponse } from 'next/server'
import { getLoomLogPaths } from '@/shared/logging/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(getLoomLogPaths())
}
