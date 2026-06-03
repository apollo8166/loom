import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { getDbPath } from '@/shared/db/paths'
import { logger } from '@/shared/logging/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Range = 'all' | '30d' | '7d'

/* ── stats-cache.json types ─────────────────────────────────────────── */
interface DailyActivity { date: string; messageCount: number; sessionCount: number }
interface DailyModelTokens { date: string; tokensByModel: Record<string, number> }
interface ModelUsage {
  inputTokens: number; outputTokens: number
  cacheReadInputTokens: number; cacheCreationInputTokens: number
}
interface StatsCache {
  dailyActivity: DailyActivity[]
  dailyModelTokens: DailyModelTokens[]
  modelUsage: Record<string, ModelUsage>
  totalSessions: number
  totalMessages: number
  hourCounts: Record<string, number>
  lastComputedDate?: string
}

/* ── JSONL supplement cache types ───────────────────────────────────── */
interface SupplementCache {
  /** mtime (ms) of the newest JSONL file we have processed */
  newestMtime: number
  /** day → model → total tokens */
  dailyModelTokens: Record<string, Record<string, number>>
  /** day → session count */
  dailyActivity: Record<string, number>
  /** hour (0-23) → message count */
  hourCounts: Record<string, number>
}

/* ── Helpers ────────────────────────────────────────────────────────── */
function formatModel(id: string): string {
  // Normalize: strip provider prefix (org/model:variant) and date suffix
  const cleaned = (id.split('/').pop() ?? id)
    .replace(/:.*$/, '')           // strip :latest / :beta etc.
    .replace(/-20\d{6,}$/, '')    // strip date suffix like -20260101

  const m = cleaned.toLowerCase()

  // Claude: claude-<family>-<gen>-<minor>[-thinking]
  const claudeMatch = m.match(/^claude-([a-z]+)-(\d+)-(\d+)(?:-(thinking))?/)
  if (claudeMatch) {
    const [, family, maj, min, variant] = claudeMatch
    const name = family.charAt(0).toUpperCase() + family.slice(1)
    return variant === 'thinking'
      ? `${name} ${maj}.${min} (Think)`
      : `${name} ${maj}.${min}`
  }

  // GPT: gpt-4o, gpt-4, gpt-5.4, gpt-4o-mini …
  if (m.startsWith('gpt-')) {
    const slug = cleaned.slice(4)
    return 'GPT-' + slug.replace(/-mini$/i, ' mini').replace(/-turbo$/i, ' Turbo')
  }

  // Gemini: gemini-2.5-pro, gemini-1.5-flash …
  const geminiMatch = m.match(/^(?:models\/)?gemini-([0-9.]+(?:-[a-z]+)*)/)
  if (geminiMatch) {
    const slug = geminiMatch[1]
      .split('-')
      .map(p => p.charAt(0).toUpperCase() + p.slice(1))
      .join(' ')
    return 'Gemini ' + slug
  }

  // DeepSeek
  if (m.includes('deepseek')) return 'DeepSeek'

  // Unknown provider: title-case each hyphen/underscore segment
  // e.g. "qwen-turbo" → "Qwen Turbo", "minimax-text-01" → "Minimax Text 01"
  return cleaned
    .split(/[-_]/)
    .map(seg => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join(' ')
}

/** Filter out internal/synthetic model IDs that should not appear in stats */
function isRealModel(id: string): boolean {
  if (!id || id === '<synthetic>') return false
  return true
}

function formatPeakHour(h?: number): string {
  if (h === undefined || h === null) return '—'
  if (h === 0) return '12 AM'
  if (h < 12) return `${h} AM`
  if (h === 12) return '12 PM'
  return `${h - 12} PM`
}

function computeStreaks(activeDates: string[]): { current: number; longest: number } {
  if (!activeDates.length) return { current: 0, longest: 0 }
  const sorted = [...new Set(activeDates)].sort()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = today.toISOString().slice(0, 10)
  const yStr = new Date(today.getTime() - 86400000).toISOString().slice(0, 10)

  const desc = [...sorted].reverse()
  let current = 0
  if (desc[0] === todayStr || desc[0] === yStr) {
    current = 1
    let prev = desc[0]
    for (let i = 1; i < desc.length; i++) {
      const expected = new Date(new Date(prev + 'T00:00:00Z').getTime() - 86400000)
        .toISOString().slice(0, 10)
      if (desc[i] === expected) { current++; prev = desc[i] } else break
    }
  }

  let longest = 1, run = 1
  for (let i = 1; i < sorted.length; i++) {
    const expected = new Date(new Date(sorted[i - 1] + 'T00:00:00Z').getTime() + 86400000)
      .toISOString().slice(0, 10)
    if (sorted[i] === expected) { run++; longest = Math.max(longest, run) }
    else run = 1
  }
  return { current, longest: Math.max(longest, current) }
}

function sinceDate(range: Range): string | null {
  if (range === '7d') {
    const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10)
  }
  if (range === '30d') {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10)
  }
  return null
}

/* ── JSONL supplement cache ─────────────────────────────────────────── */
const SUPPLEMENT_PATH = path.join(os.homedir(), '.claude', 'loom-usage-supplement.json')

/** Scan ~/.claude/projects recursively for all .jsonl files */
function scanJsonlFiles(dir: string): { filePath: string; mtime: number }[] {
  const results: { filePath: string; mtime: number }[] = []
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...scanJsonlFiles(full))
      } else if (entry.name.endsWith('.jsonl')) {
        const stat = fs.statSync(full)
        results.push({ filePath: full, mtime: stat.mtimeMs })
      }
    }
  } catch { /* ignore permission errors */ }
  return results
}

/** Parse a single JSONL file, adding usage data to the supplement (only lines after minDate) */
function processJsonlFile(
  filePath: string,
  minDate: string,
  supplement: SupplementCache,
): void {
  let content: string
  try {
    content = fs.readFileSync(filePath, 'utf-8')
  } catch { return }

  const seenUuids = new Set<string>()
  const seenSessions = new Set<string>()

  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    let obj: Record<string, unknown>
    try { obj = JSON.parse(line) } catch { continue }

    const ts = obj.timestamp as string | undefined
    if (!ts || ts.slice(0, 10) <= minDate) continue

    // Dedup by uuid
    const uuid = obj.uuid as string | undefined
    if (uuid) {
      if (seenUuids.has(uuid)) continue
      seenUuids.add(uuid)
    }

    const day = ts.slice(0, 10)
    const sessionId = obj.sessionId as string | undefined

    // Count session (user messages initiate sessions)
    if (obj.type === 'user' && sessionId && !seenSessions.has(sessionId + day)) {
      seenSessions.add(sessionId + day)
      supplement.dailyActivity[day] = (supplement.dailyActivity[day] ?? 0) + 1
    }

    // Count hour from user messages
    if (obj.type === 'user') {
      const h = new Date(ts).getHours()
      supplement.hourCounts[h] = (supplement.hourCounts[h] ?? 0) + 1
    }

    // Token usage from assistant messages
    if (obj.type !== 'assistant') continue
    const msg = obj.message as Record<string, unknown> | undefined
    if (!msg) continue
    const model = msg.model as string | undefined
    if (!model || !isRealModel(model)) continue
    const usage = msg.usage as Record<string, number> | undefined
    if (!usage) continue

    const tokens =
      (usage.input_tokens ?? 0) +
      (usage.output_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0)

    if (tokens === 0) continue  // skip zero-token entries

    if (!supplement.dailyModelTokens[day]) supplement.dailyModelTokens[day] = {}
    supplement.dailyModelTokens[day][model] =
      (supplement.dailyModelTokens[day][model] ?? 0) + tokens
  }
}

/** Build / incrementally update the supplement cache, return it */
function getSupplementCache(cacheLastDate: string): SupplementCache {
  // Load existing supplement
  let supplement: SupplementCache = {
    newestMtime: 0,
    dailyModelTokens: {},
    dailyActivity: {},
    hourCounts: {},
  }
  try {
    if (fs.existsSync(SUPPLEMENT_PATH)) {
      supplement = JSON.parse(fs.readFileSync(SUPPLEMENT_PATH, 'utf-8'))
    }
  } catch { /* start fresh */ }

  const projectsDir = path.join(os.homedir(), '.claude', 'projects')
  if (!fs.existsSync(projectsDir)) return supplement

  // Find files newer than what we've already processed
  const allFiles = scanJsonlFiles(projectsDir)
  const newFiles = allFiles.filter(f => f.mtime > supplement.newestMtime)

  if (newFiles.length === 0) return supplement

  // Process only new/updated files
  for (const { filePath, mtime } of newFiles) {
    processJsonlFile(filePath, cacheLastDate, supplement)
    if (mtime > supplement.newestMtime) supplement.newestMtime = mtime
  }

  // Persist updated cache
  try {
    fs.writeFileSync(SUPPLEMENT_PATH, JSON.stringify(supplement))
  } catch { /* non-fatal */ }

  return supplement
}

/* ── Read loom DB (for loom-cc-client sessions) ──────────────────────── */
interface LoomRow { day: string; model: string; inputTokens: number; outputTokens: number }
interface LoomActivity { day: string; sessions: number }
interface ProjectModelRow {
  model: string
  inputTokens: number
  outputTokens: number
  sessions: number
}
interface ProjectDailyModelRow {
  day: string
  model: string
  tokens: number
}
interface ProjectActivityRow {
  day: string
  sessions: number
  messages: number
}

function readLoomDb(since: string | null): {
  rows: LoomRow[]
  activity: LoomActivity[]
  hourCounts: Record<number, number>
} {
  const dbPath = getDbPath()
  if (!fs.existsSync(dbPath)) return { rows: [], activity: [], hourCounts: {} }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(dbPath, { readonly: true })
    const sinceClause = since ? `AND m.created_at >= '${since}'` : ''
    const rows: LoomRow[] = db.prepare(`
      SELECT substr(m.created_at, 1, 10) as day, s.model,
             SUM(m.input_tokens)  as inputTokens,
             SUM(m.output_tokens) as outputTokens
      FROM messages m JOIN sessions s ON m.session_id = s.id
      WHERE m.role = 'assistant' ${sinceClause}
      GROUP BY day, s.model ORDER BY day
    `).all() as LoomRow[]
    const activity: LoomActivity[] = db.prepare(`
      SELECT substr(created_at, 1, 10) as day, COUNT(*) as sessions
      FROM sessions ${since ? `WHERE created_at >= '${since}'` : ''}
      GROUP BY day ORDER BY day
    `).all() as LoomActivity[]
    const hourRows: { hour: number; cnt: number }[] = db.prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as cnt
      FROM messages WHERE role = 'user' GROUP BY hour
    `).all() as { hour: number; cnt: number }[]
    const hourCounts: Record<number, number> = {}
    for (const r of hourRows) hourCounts[r.hour] = r.cnt
    db.close()
    return { rows, activity, hourCounts }
  } catch (e) {
    logger.error('usage.loom_db_error', e)
    return { rows: [], activity: [], hourCounts: {} }
  }
}

function readProjectUsage(projectId: string, since: string | null) {
  const dbPath = getDbPath()
  if (!fs.existsSync(dbPath)) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const db = new Database(dbPath, { readonly: true })

    const project = db.prepare('SELECT id FROM projects WHERE id = ? AND status = ?').get(projectId, 'active')
    if (!project) {
      db.close()
      return null
    }

    const msgSinceClause = since ? 'AND m.created_at >= ?' : ''
    const sessionSinceClause = since ? 'AND created_at >= ?' : ''
    const sinceArgs = since ? [since] : []

    const modelRows = db.prepare(`
      SELECT
        s.model,
        COALESCE(SUM(m.input_tokens), 0) AS inputTokens,
        COALESCE(SUM(m.output_tokens), 0) AS outputTokens,
        COUNT(DISTINCT s.id) AS sessions
      FROM sessions s
      JOIN messages m ON m.session_id = s.id
      WHERE s.project_id = ?
        AND s.status != 'deleted'
        AND m.role = 'assistant'
        ${msgSinceClause}
      GROUP BY s.model
      ORDER BY (COALESCE(SUM(m.input_tokens), 0) + COALESCE(SUM(m.output_tokens), 0)) DESC
    `).all(projectId, ...sinceArgs) as ProjectModelRow[]

    const dailyModelRows = db.prepare(`
      SELECT
        substr(m.created_at, 1, 10) AS day,
        s.model,
        COALESCE(SUM(m.input_tokens + m.output_tokens), 0) AS tokens
      FROM sessions s
      JOIN messages m ON m.session_id = s.id
      WHERE s.project_id = ?
        AND s.status != 'deleted'
        AND m.role = 'assistant'
        ${msgSinceClause}
      GROUP BY day, s.model
      ORDER BY day
    `).all(projectId, ...sinceArgs) as ProjectDailyModelRow[]

    const activityRows = db.prepare(`
      SELECT
        day,
        COUNT(DISTINCT session_id) AS sessions,
        COUNT(*) AS messages
      FROM (
        SELECT
          substr(m.created_at, 1, 10) AS day,
          s.id AS session_id
        FROM sessions s
        JOIN messages m ON m.session_id = s.id
        WHERE s.project_id = ?
          AND s.status != 'deleted'
          ${msgSinceClause}
      )
      GROUP BY day
      ORDER BY day
    `).all(projectId, ...sinceArgs) as ProjectActivityRow[]

    const sessionTotal = db.prepare(`
      SELECT COUNT(*) AS count
      FROM sessions
      WHERE project_id = ?
        AND status != 'deleted'
        ${sessionSinceClause}
    `).get(projectId, ...sinceArgs) as { count: number }

    const messageTotal = db.prepare(`
      SELECT COUNT(m.id) AS count
      FROM sessions s
      JOIN messages m ON m.session_id = s.id
      WHERE s.project_id = ?
        AND s.status != 'deleted'
        ${msgSinceClause}
    `).get(projectId, ...sinceArgs) as { count: number }

    const hourRows = db.prepare(`
      SELECT CAST(strftime('%H', m.created_at) AS INTEGER) AS hour, COUNT(*) AS cnt
      FROM sessions s
      JOIN messages m ON m.session_id = s.id
      WHERE s.project_id = ?
        AND s.status != 'deleted'
        AND m.role = 'user'
        ${msgSinceClause}
      GROUP BY hour
    `).all(projectId, ...sinceArgs) as { hour: number; cnt: number }[]

    db.close()

    const totalTokens = modelRows.reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0)
    const byModel = modelRows
      .map(row => {
        const total = row.inputTokens + row.outputTokens
        return {
          modelId: row.model,
          model: formatModel(row.model),
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          totalTokens: total,
          sessions: row.sessions,
          percentage: totalTokens > 0 ? (total / totalTokens) * 100 : 0,
        }
      })
      .sort((a, b) => b.totalTokens - a.totalTokens)

    const activeDates = activityRows
      .filter(row => row.messages > 0 || row.sessions > 0)
      .map(row => row.day)
      .sort()
    const { current: currentStreak, longest: longestStreak } = computeStreaks(activeDates)

    let peakH: number | undefined, peakC = 0
    for (const row of hourRows) {
      if (row.cnt > peakC) { peakC = row.cnt; peakH = row.hour }
    }

    const heatCutoff = new Date()
    heatCutoff.setDate(heatCutoff.getDate() - 364)
    const heatCutoffStr = heatCutoff.toISOString().slice(0, 10)
    const heatmap = activityRows
      .filter(row => row.day >= heatCutoffStr)
      .map(row => ({ day: row.day, count: row.messages }))

    const chartCutoff = !since
      ? new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10)
      : since
    const dailyMap = new Map<string, Record<string, number>>()
    for (const row of dailyModelRows) {
      if (row.day < chartCutoff) continue
      if (!dailyMap.has(row.day)) dailyMap.set(row.day, {})
      const byModelForDay = dailyMap.get(row.day)!
      byModelForDay[row.model] = (byModelForDay[row.model] ?? 0) + row.tokens
    }
    const dailyModelTokens = [...dailyMap.entries()]
      .map(([day, byModelForDay]) => ({ day, byModel: byModelForDay }))
      .sort((a, b) => a.day.localeCompare(b.day))

    const byDate = activityRows.map(row => {
      const total = dailyModelRows
        .filter(modelRow => modelRow.day === row.day)
        .reduce((sum, modelRow) => sum + modelRow.tokens, 0)
      return {
        date: row.day,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: total,
      }
    })

    return {
      source: 'project',
      totals: {
        sessions: sessionTotal.count,
        messages: messageTotal.count,
        inputTokens: byModel.reduce((sum, model) => sum + model.inputTokens, 0),
        outputTokens: byModel.reduce((sum, model) => sum + model.outputTokens, 0),
        totalTokens,
        activeDays: activeDates.length,
        currentStreak,
        longestStreak,
        peakHour: formatPeakHour(peakH),
        favoriteModel: byModel[0]?.model ?? '—',
      },
      byDate,
      byModel,
      heatmap,
      dailyModelTokens,
    }
  } catch (e) {
    logger.error('usage.project_db_error', e, { projectId })
    return null
  }
}

/* ── Route handler ─────────────────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const rangeParam = req.nextUrl.searchParams.get('range')
  const range: Range = rangeParam === '7d' || rangeParam === '30d' || rangeParam === 'all'
    ? rangeParam : '30d'
  const since = sinceDate(range)
  const projectId = req.nextUrl.searchParams.get('projectId')

  if (projectId) {
    const projectUsage = readProjectUsage(projectId, since)
    if (!projectUsage) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }
    return NextResponse.json({
      ...projectUsage,
      range,
    })
  }

  // ── 1. stats-cache.json ──────────────────────────────────────────
  const cachePath = path.join(os.homedir(), '.claude', 'stats-cache.json')
  let cache: StatsCache | null = null
  try {
    if (fs.existsSync(cachePath)) cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'))
  } catch { /* ignore */ }

  const cacheLastDate = cache?.lastComputedDate ??
    (cache?.dailyActivity?.slice(-1)[0]?.date ?? '1970-01-01')

  // ── 2. JSONL supplement (new CLI sessions since stats-cache cutoff) ──
  const supp = getSupplementCache(cacheLastDate)

  // ── 3. loom DB (loom-cc-client sessions) ────────────────────────
  const loom = readLoomDb(since)

  // ── 4. Merge dailyModelTokens from all sources ───────────────────
  const mergedDaily = new Map<string, Record<string, number>>()

  function mergeDay(day: string, model: string, tokens: number) {
    if (!mergedDaily.has(day)) mergedDaily.set(day, {})
    const m = mergedDaily.get(day)!
    m[model] = (m[model] ?? 0) + tokens
  }

  // a) stats-cache (filtered by range)
  for (const d of (cache?.dailyModelTokens ?? []).filter(d => !since || d.date >= since)) {
    for (const [model, tokens] of Object.entries(d.tokensByModel)) {
      mergeDay(d.date, model, tokens)
    }
  }

  // b) JSONL supplement (filtered by range)
  for (const [day, byModel] of Object.entries(supp.dailyModelTokens)) {
    if (since && day < since) continue
    for (const [model, tokens] of Object.entries(byModel)) {
      mergeDay(day, model, tokens)
    }
  }

  // c) loom DB
  for (const row of loom.rows) {
    mergeDay(row.day, row.model, row.inputTokens + row.outputTokens)
  }

  // ── 5. Model totals ──────────────────────────────────────────────
  const modelTokMap = new Map<string, number>()
  const modelInputMap = new Map<string, number>()
  const modelOutputMap = new Map<string, number>()

  if (!since) {
    // "all": use pre-aggregated stats-cache modelUsage
    for (const [modelId, u] of Object.entries(cache?.modelUsage ?? {})) {
      const tok = u.inputTokens + u.outputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens
      modelTokMap.set(modelId, (modelTokMap.get(modelId) ?? 0) + tok)
      modelInputMap.set(modelId, (modelInputMap.get(modelId) ?? 0) +
        u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens)
      modelOutputMap.set(modelId, (modelOutputMap.get(modelId) ?? 0) + u.outputTokens)
    }
  }

  // Always add supplement + loom data (for filtered ranges this is the primary source)
  for (const [day, byModel] of mergedDaily) {
    if (since && day < since) continue
    if (!since && day <= cacheLastDate) continue  // already counted in modelUsage above
    for (const [model, tokens] of Object.entries(byModel)) {
      modelTokMap.set(model, (modelTokMap.get(model) ?? 0) + tokens)
    }
  }

  // loom DB: get input/output split
  for (const row of loom.rows) {
    if (since && row.day < since) continue
    modelInputMap.set(row.model, (modelInputMap.get(row.model) ?? 0) + row.inputTokens)
    modelOutputMap.set(row.model, (modelOutputMap.get(row.model) ?? 0) + row.outputTokens)
  }

  const totalTokens = [...modelTokMap.values()].reduce((s, v) => s + v, 0)
  const byModel = [...modelTokMap.entries()]
    .map(([modelId, totalTok]) => {
      const inp = modelInputMap.get(modelId) ?? Math.round(totalTok * 0.85)
      const out = modelOutputMap.get(modelId) ?? Math.round(totalTok * 0.15)
      return {
        modelId,
        model: formatModel(modelId),
        inputTokens: inp,
        outputTokens: out,
        totalTokens: totalTok,
        sessions: 0,
        percentage: totalTokens > 0 ? (totalTok / totalTokens) * 100 : 0,
      }
    })
    .sort((a, b) => b.totalTokens - a.totalTokens)

  // ── 6. Sessions & messages ───────────────────────────────────────
  const cacheActivity = (cache?.dailyActivity ?? []).filter(d => !since || d.date >= since)
  const cacheSessions = since
    ? cacheActivity.reduce((s, d) => s + d.sessionCount, 0)
    : (cache?.totalSessions ?? 0)
  const cacheMessages = since
    ? cacheActivity.reduce((s, d) => s + d.messageCount, 0)
    : (cache?.totalMessages ?? 0)

  const suppSessions = Object.entries(supp.dailyActivity)
    .filter(([day]) => !since || day >= since)
    .reduce((s, [, c]) => s + c, 0)

  const loomSessions = loom.activity.reduce((s, d) => s + d.sessions, 0)
  const sessions = cacheSessions + suppSessions + loomSessions
  const messages = cacheMessages + loomSessions  // approximate

  // ── 7. Active days & streaks ─────────────────────────────────────
  const activeDateSet = new Set<string>()
  for (const d of cacheActivity) activeDateSet.add(d.date)
  for (const [day, cnt] of Object.entries(supp.dailyActivity)) {
    if (cnt > 0 && (!since || day >= since)) activeDateSet.add(day)
  }
  for (const d of loom.activity) activeDateSet.add(d.day)
  const activeDates = [...activeDateSet].sort()
  const activeDays = activeDates.length
  const { current: currentStreak, longest: longestStreak } = computeStreaks(activeDates)

  // ── 8. Peak hour ─────────────────────────────────────────────────
  const hourMap: Record<number, number> = {}
  for (const [h, c] of Object.entries(cache?.hourCounts ?? {})) {
    hourMap[parseInt(h)] = (hourMap[parseInt(h)] ?? 0) + c
  }
  for (const [h, c] of Object.entries(supp.hourCounts)) {
    hourMap[parseInt(h)] = (hourMap[parseInt(h)] ?? 0) + c
  }
  for (const [h, c] of Object.entries(loom.hourCounts)) {
    hourMap[parseInt(h)] = (hourMap[parseInt(h)] ?? 0) + c
  }
  let peakH: number | undefined, peakC = 0
  for (const [h, c] of Object.entries(hourMap)) {
    if (c > peakC) { peakC = c; peakH = parseInt(h) }
  }

  // ── 9. Heatmap (last 365 days, all three sources) ─────────────────
  const heatCutoff = new Date()
  heatCutoff.setDate(heatCutoff.getDate() - 364)
  const heatCutoffStr = heatCutoff.toISOString().slice(0, 10)
  const heatMap = new Map<string, number>()

  for (const d of (cache?.dailyActivity ?? []).filter(d => d.date >= heatCutoffStr)) {
    heatMap.set(d.date, (heatMap.get(d.date) ?? 0) + d.messageCount)
  }
  for (const [day, cnt] of Object.entries(supp.dailyActivity)) {
    if (day >= heatCutoffStr) heatMap.set(day, (heatMap.get(day) ?? 0) + cnt)
  }
  for (const d of loom.activity) {
    if (d.day >= heatCutoffStr) heatMap.set(d.day, (heatMap.get(d.day) ?? 0) + d.sessions)
  }
  const heatmap = [...heatMap.entries()]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day))

  // ── 10. Daily model tokens for stacked chart (cap "all" at 60 days) ──
  const chartCutoff = !since
    ? new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10)
    : since
  const dailyModelTokens = [...mergedDaily.entries()]
    .filter(([day]) => day >= chartCutoff)
    .map(([day, byModel]) => ({ day, byModel }))
    .sort((a, b) => a.day.localeCompare(b.day))

  // byDate for compatibility
  const byDate = [...mergedDaily.entries()]
    .filter(([day]) => !since || day >= since)
    .map(([date, byModel]) => ({
      date,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: Object.values(byModel).reduce((s, v) => s + v, 0),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return NextResponse.json({
    source: 'merged',
    range,
    totals: {
      sessions,
      messages,
      inputTokens: byModel.reduce((s, m) => s + m.inputTokens, 0),
      outputTokens: byModel.reduce((s, m) => s + m.outputTokens, 0),
      totalTokens,
      activeDays,
      currentStreak,
      longestStreak,
      peakHour: formatPeakHour(peakH),
      favoriteModel: byModel[0] ? formatModel(byModel[0].modelId) : '—',
    },
    byDate,
    byModel,
    heatmap,
    dailyModelTokens,
  })
}
