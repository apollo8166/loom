/**
 * Singleton cron engine — polls every 60 seconds and fires matching scheduled tasks.
 */

import { getDb } from '@/shared/db/db'
import { matchesCron } from './cron-parser'
import { executeTask } from './executor'
import { logger } from '@/shared/logging/logger'
import { runPeriodicEvolutionAuditDetached } from '@/shared/evolution/background-jobs'

interface RawTask {
  id: string
  project_id: string
  name: string
  description: string
  schedule: string
  prompt: string
  agent_name: string
  skill_name: string
  model: string
  enabled: number
}

class CronEngine {
  private running = false
  private timer: ReturnType<typeof setInterval> | null = null
  private executingTasks = new Set<string>()
  private lastEvolutionAuditMinute = ''

  start() {
    if (this.running) return
    this.running = true
    this.tick()
    this.timer = setInterval(() => this.tick(), 60_000)
    logger.info('cron.engine_started')
  }

  stop() {
    if (!this.running) return
    this.running = false
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    logger.info('cron.engine_stopped')
  }

  get isRunning() { return this.running }

  private async tick() {
    if (!this.running) return
    const db = getDb()
    const tasks = db.prepare(
      'SELECT * FROM scheduled_tasks WHERE enabled = 1'
    ).all() as RawTask[]

    const now = new Date()
    const ts = now.toISOString().slice(0, 16)
    logger.debug('cron.tick', { minute: ts, enabledTaskCount: tasks.length })

    if (this.shouldRunEvolutionAudit(now)) {
      this.lastEvolutionAuditMinute = ts
      runPeriodicEvolutionAuditDetached()
    }

    for (const task of tasks) {
      if (!task.schedule.trim()) continue
      if (this.executingTasks.has(task.id)) continue
      if (!matchesCron(task.schedule, now)) continue

      logger.info('cron.task_fire', {
        taskId: task.id,
        projectId: task.project_id,
        taskName: task.name,
        schedule: task.schedule,
      })
      this.executingTasks.add(task.id)
      executeTask(task)
        .then(r => logger.info('cron.task_done', {
          taskId: task.id,
          projectId: task.project_id,
          taskName: task.name,
          status: r.status,
          sessionId: r.sessionId,
        }))
        .catch(err => logger.error('cron.task_unhandled_error', err, {
          taskId: task.id,
          projectId: task.project_id,
          taskName: task.name,
        }))
        .finally(() => this.executingTasks.delete(task.id))
    }
  }

  private shouldRunEvolutionAudit(now: Date): boolean {
    const minute = now.toISOString().slice(0, 16)
    if (this.lastEvolutionAuditMinute === minute) return false
    // Run once every six hours near the top of the hour. This keeps evolution
    // periodic without turning every minute into an LLM maintenance job.
    return now.getUTCMinutes() === 7 && now.getUTCHours() % 6 === 0
  }
}

// Module-level singleton shared across all Next.js API routes in the same process
declare const globalThis: { __loomCronEngine?: CronEngine } & typeof global

function getEngine(): CronEngine {
  if (!globalThis.__loomCronEngine) {
    globalThis.__loomCronEngine = new CronEngine()
  }
  return globalThis.__loomCronEngine
}

export function startCronEngine() {
  getEngine().start()
}

export function stopCronEngine() {
  getEngine().stop()
}

export function isCronEngineRunning(): boolean {
  return getEngine().isRunning
}
