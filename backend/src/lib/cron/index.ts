/**
 * Cron engine orchestrator.
 *
 * Picks engines based on `CronEngineConfig` from the Integrations KV. Called
 * once on boot from `node.ts`, and again from the integrations PATCH route
 * when the toggle changes.
 *
 * Engines:
 *   - node-cron: in-process scheduler. Good for dev and single-node prod.
 *   - QStash:    durable external scheduler. Good for serverless and
 *                multi-instance prod.
 *
 * Both can be on at once; the Redis lock prevents double-firing.
 */

import { getCronEngineConfig } from '../integrations'
import { logger } from '../logger'
import { startNodeCronEngine, stopNodeCronEngine } from './engines/node-cron-engine'
import { syncQStashSchedules } from './engines/qstash-engine'

export { CRON_JOBS, getJob } from './registry'
export { runJob } from './runner'
export type { CronJob, JobContext, JobRunResult } from './types'

let _bootError: string | null = null
export function getCronBootError(): string | null {
  return _bootError
}
export function setCronBootError(err: string | null): void {
  _bootError = err
}

export async function startCronEngine(): Promise<void> {
  _bootError = null // clear stale error on reload
  const cfg = await getCronEngineConfig()
  if (!cfg) {
    logger.info('[cron] no engine config — both engines off until configured')
    return
  }

  const enabledIds =
    cfg.enabledJobIds && cfg.enabledJobIds.length > 0 ? cfg.enabledJobIds : undefined

  if (cfg.nodeCronEnabled) {
    startNodeCronEngine(enabledIds)
  } else {
    stopNodeCronEngine()
  }

  if (cfg.qstashEnabled) {
    try {
      const result = await syncQStashSchedules()
      logger.info(result, '[cron:qstash] schedules synced')
    } catch (err) {
      logger.error({ err: (err as Error).message }, '[cron:qstash] schedule sync failed')
    }
  }
}

export async function reloadCronEngine(): Promise<void> {
  logger.info('[cron] reloading engines')
  await startCronEngine()
}
