/**
 * In-process node-cron engine.
 *
 * Registers each job in the registry against node-cron. On fire, calls the
 * shared `runJob()` which handles locking + recording. Safe to run alongside
 * QStash — the Redis lock prevents double-execution.
 */

import cron, { type ScheduledTask } from 'node-cron'
import { logger } from '../../logger'
import { CRON_JOBS } from '../registry'
import { runJob } from '../runner'

interface RegisteredTask {
  jobId: string
  task: ScheduledTask
}

const registered: RegisteredTask[] = []

export function startNodeCronEngine(enabledJobIds?: string[]): void {
  if (registered.length > 0) {
    logger.info('[cron:node-cron] already started — stopping first')
    stopNodeCronEngine()
  }
  const allowed = enabledJobIds && enabledJobIds.length > 0 ? new Set(enabledJobIds) : null
  for (const job of CRON_JOBS) {
    if (allowed && !allowed.has(job.id)) continue
    if (!cron.validate(job.cron)) {
      logger.error({ jobId: job.id, cron: job.cron }, '[cron:node-cron] invalid cron expression')
      continue
    }
    const task = cron.schedule(job.cron, () => {
      runJob(job.id, { source: 'node-cron' }).catch((err) => {
        logger.error({ jobId: job.id, err: (err as Error).message }, '[cron:node-cron] uncaught')
      })
    })
    registered.push({ jobId: job.id, task })
    logger.info({ jobId: job.id, cron: job.cron }, '[cron:node-cron] scheduled')
  }
}

export function stopNodeCronEngine(): void {
  for (const r of registered) {
    r.task.stop()
  }
  registered.length = 0
  logger.info('[cron:node-cron] stopped')
}
