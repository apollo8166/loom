type ActiveRun = {
  controller: AbortController
  startedAt: number
}

const activeRuns = new Map<string, Map<string, ActiveRun>>()

export function registerActiveRun(
  sessionId: string,
  controller: AbortController,
  options: { key?: string; replaceSessionRuns?: boolean } = {},
): () => void {
  if (!sessionId) return () => {}
  const key = options.key || 'default'
  const replaceSessionRuns = options.replaceSessionRuns ?? true
  const existingRuns = activeRuns.get(sessionId) ?? new Map<string, ActiveRun>()
  if (replaceSessionRuns) {
    for (const run of existingRuns.values()) run.controller.abort()
    existingRuns.clear()
  } else {
    existingRuns.get(key)?.controller.abort()
  }
  existingRuns.set(key, { controller, startedAt: Date.now() })
  activeRuns.set(sessionId, existingRuns)
  return () => {
    const currentRuns = activeRuns.get(sessionId)
    const current = currentRuns?.get(key)
    if (current?.controller === controller) currentRuns?.delete(key)
    if (currentRuns && currentRuns.size === 0) activeRuns.delete(sessionId)
  }
}

export function abortActiveRun(sessionId: string): boolean {
  const runs = activeRuns.get(sessionId)
  if (!runs || runs.size === 0) return false
  for (const run of runs.values()) run.controller.abort()
  activeRuns.delete(sessionId)
  return true
}

export function hasActiveRun(sessionId: string): boolean {
  return activeRuns.has(sessionId)
}

export function listActiveRunSessionIds(): string[] {
  return [...activeRuns.keys()]
}
