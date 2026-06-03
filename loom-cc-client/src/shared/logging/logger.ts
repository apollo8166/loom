import fs from 'node:fs'
import path from 'node:path'
import { getLoomDataDir } from '@/shared/db/paths'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

type LogFields = Record<string, unknown>

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const LOG_FILE_MAX_BYTES = 10 * 1024 * 1024
const ERROR_FILE_MAX_BYTES = 5 * 1024 * 1024
const MAX_ROTATED_FILES = 5

function getLogLevel(): LogLevel {
  const raw = (process.env.LOOM_LOG_LEVEL || 'info').toLowerCase()
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw
  return 'info'
}

function getLogDir(): string {
  const dir = path.join(getLoomDataDir(), 'logs')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function getLoomLogPaths() {
  const dir = getLogDir()
  return {
    dir,
    main: path.join(dir, 'loom.log'),
    error: path.join(dir, 'error.log'),
  }
}

function rotateIfNeeded(filePath: string, maxBytes: number) {
  try {
    if (!fs.existsSync(filePath)) return
    const stat = fs.statSync(filePath)
    if (stat.size < maxBytes) return

    const oldest = `${filePath}.${MAX_ROTATED_FILES}`
    if (fs.existsSync(oldest)) fs.rmSync(oldest, { force: true })
    for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
      const src = `${filePath}.${i}`
      const dst = `${filePath}.${i + 1}`
      if (fs.existsSync(src)) fs.renameSync(src, dst)
    }
    fs.renameSync(filePath, `${filePath}.1`)
  } catch {
    // Logging must never break product flow.
  }
}

function sanitize(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack?.split('\n').slice(0, 8).join('\n'),
    }
  }
  if (Array.isArray(value)) return value.map(sanitize)
  if (!value || typeof value !== 'object') return value

  const out: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase()
    if (
      lower.includes('apikey') ||
      lower.includes('api_key') ||
      lower.includes('authorization') ||
      lower === 'token' ||
      lower.includes('secret') ||
      lower.includes('password') ||
      lower.includes('base64')
    ) {
      out[key] = '[redacted]'
      continue
    }
    if (typeof raw === 'string' && raw.length > 1200) {
      out[key] = `${raw.slice(0, 1200)}...[truncated:${raw.length}]`
      continue
    }
    out[key] = sanitize(raw)
  }
  return out
}

function moduleFromEvent(event: string): string {
  return event.includes('.') ? event.split('.').slice(0, 2).join('.') : event
}

function writeLine(level: LogLevel, event: string, fields: LogFields = {}) {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[getLogLevel()]) return

  const paths = getLoomLogPaths()
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    module: moduleFromEvent(event),
    ...sanitize(fields) as LogFields,
  }
  const line = `${JSON.stringify(entry)}\n`

  try {
    rotateIfNeeded(paths.main, LOG_FILE_MAX_BYTES)
    fs.appendFileSync(paths.main, line, 'utf8')
    if (level === 'warn' || level === 'error') {
      rotateIfNeeded(paths.error, ERROR_FILE_MAX_BYTES)
      fs.appendFileSync(paths.error, line, 'utf8')
    }
  } catch {
    // Ignore file logging failures.
  }

  const consoleLine = `[loom][${event}] ${JSON.stringify(sanitize(fields))}`
  if (level === 'error') console.error(consoleLine)
  else if (level === 'warn') console.warn(consoleLine)
  else console.log(consoleLine)
}

export const logger = {
  debug(event: string, fields?: LogFields) {
    writeLine('debug', event, fields)
  },
  info(event: string, fields?: LogFields) {
    writeLine('info', event, fields)
  },
  warn(event: string, fields?: LogFields) {
    writeLine('warn', event, fields)
  },
  error(event: string, error?: unknown, fields?: LogFields) {
    writeLine('error', event, {
      ...(fields || {}),
      error: sanitize(error),
    })
  },
}
