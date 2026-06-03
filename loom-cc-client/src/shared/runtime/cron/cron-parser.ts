// Minimal 5-field cron matcher: minute hour dayOfMonth month dayOfWeek
// Supports: *, N, step (slash N), N-M, N,M,O

function parseField(field: string, min: number, max: number): number[] {
  const values: number[] = []

  for (const part of field.split(',')) {
    if (part === '*') {
      for (let i = min; i <= max; i++) values.push(i)
    } else if (part.startsWith('*/')) {
      const step = parseInt(part.slice(2), 10)
      for (let i = min; i <= max; i += step) values.push(i)
    } else if (part.includes('-')) {
      const [lo, hi] = part.split('-').map(Number)
      const [range, stepStr] = [part.split('/')[0], part.split('/')[1]]
      const [low, high] = range.split('-').map(Number)
      const step = stepStr ? parseInt(stepStr, 10) : 1
      for (let i = low; i <= high; i += step) values.push(i)
      void lo; void hi
    } else {
      values.push(parseInt(part, 10))
    }
  }

  return [...new Set(values)].sort((a, b) => a - b)
}

export function matchesCron(expression: string, now: Date): boolean {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return false

  const [minuteF, hourF, domF, monthF, dowF] = parts

  const minutes  = parseField(minuteF, 0, 59)
  const hours    = parseField(hourF,   0, 23)
  const doms     = parseField(domF,    1, 31)
  const months   = parseField(monthF,  1, 12)
  const dows     = parseField(dowF,    0, 6)

  return (
    minutes.includes(now.getMinutes()) &&
    hours.includes(now.getHours()) &&
    doms.includes(now.getDate()) &&
    months.includes(now.getMonth() + 1) &&
    dows.includes(now.getDay())
  )
}

/** Return the next Date after `from` that matches the cron expression, or null if never */
export function getNextRun(expression: string, from: Date = new Date()): Date | null {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return null

  // Start at the next whole minute
  const next = new Date(from)
  next.setSeconds(0, 0)
  next.setMinutes(next.getMinutes() + 1)

  // Try up to ~1 year (527 040 minutes)
  for (let i = 0; i < 527_040; i++) {
    if (matchesCron(expression, next)) return new Date(next)
    next.setMinutes(next.getMinutes() + 1)
  }
  return null
}

/** Convert a cron expression to a human-readable Chinese label */
export function cronToLabel(expr: string): string {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return expr

  const [m, h, dom, month, dow] = parts

  if (m.startsWith('*/') && h === '*' && dom === '*' && month === '*' && dow === '*') {
    return `每 ${m.slice(2)} 分钟`
  }
  if (m !== '*' && h === '*' && dom === '*' && month === '*' && dow === '*') {
    return `每小时 :${m.padStart(2, '0')}`
  }
  const DAYS = ['日', '一', '二', '三', '四', '五', '六']
  if (m !== '*' && h !== '*' && dom === '*' && month === '*' && dow !== '*') {
    return `每周${DAYS[parseInt(dow, 10)]} ${h.padStart(2, '0')}:${m.padStart(2, '0')}`
  }
  if (m !== '*' && h !== '*' && dom !== '*' && month === '*' && dow === '*') {
    return `每月 ${dom} 日 ${h.padStart(2, '0')}:${m.padStart(2, '0')}`
  }
  if (m !== '*' && h !== '*' && dom === '*' && month === '*' && dow === '*') {
    return `每天 ${h.padStart(2, '0')}:${m.padStart(2, '0')}`
  }
  if (m !== '*' && h !== '*' && dom !== '*' && month !== '*' && dow === '*') {
    return `${month}月${dom}日 ${h.padStart(2, '0')}:${m.padStart(2, '0')} (一次性)`
  }
  return expr
}
