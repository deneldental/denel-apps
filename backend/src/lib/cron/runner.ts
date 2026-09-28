/**
 * Engine-shared job runner.
 *
 * The two engines (node-cron + QStash) both ultimately call `runJob()` to
 * actually fire a handler. This module owns:
 *   - distributed locking (so node-cron + QStash don't double-fire)
 *   - timeout enforcement
 *   - run recording (cron_job_runs)
 *   - error containment
 */

import { env } from '../../config/env'
import { getDb } from '../../db'
import { cronJobRuns } from '../../db/schema'
import { logger } from '../logger'
import { acquireLock } from './lock'
import { getJob } from './registry'
import type { JobContext, JobRunResult } from './types'

export interface RunOptions {
  source: JobContext['source']
}

export async function runJob(
  jobId: string,
  opts: RunOptions
): Promise<{
  status: 'success' | 'failed' | 'skipped_locked' | 'unknown_job'
  summary?: string
  error?: string
}> {
  const job = getJob(jobId)
  if (!job) {
    logger.warn({ jobId }, '[cron] unknown job id')
    return { status: 'unknown_job' }
  }

  // Lock with a TTL just over the job timeout so a stuck handler self-clears.
  const lockTtl = Math.ceil(job.timeoutMs / 1000) + 30
  const lock = await acquireLock(jobId, lockTtl)
  if (!lock) {
    logger.info({ jobId }, '[cron] another worker holds the lock — skipping')
    await recordRun(jobId, opts.source, 'skipped_locked', null, null, new Date(), new Date())
    return { status: 'skipped_locked' }
  }

  const startedAt = new Date()
  const ctx: JobContext = {
    jobId,
    firedAt: startedAt,
    source: opts.source,
    log: (msg, extra) => logger.info({ jobId, ...extra }, `[cron:${jobId}] ${msg}`),
  }

  logger.info({ jobId, source: opts.source }, '[cron] starting')

  try {
    const result = await withTimeout(job.handler(ctx), job.timeoutMs, jobId)
    const summary = (result as JobRunResult | undefined)?.summary ?? null
    const finishedAt = new Date()
    await recordRun(jobId, opts.source, 'success', summary, null, startedAt, finishedAt)
    logger.info({ jobId, summary, ms: finishedAt.getTime() - startedAt.getTime() }, '[cron] done')
    return { status: 'success', summary: summary ?? undefined }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const finishedAt = new Date()
    await recordRun(jobId, opts.source, 'failed', null, message, startedAt, finishedAt)
    logger.error({ jobId, err: message }, '[cron] handler failed')
    return { status: 'failed', error: message }
  } finally {
    await lock.release()
  }
}

async function recordRun(
  jobId: string,
  source: JobContext['source'],
  status: 'success' | 'failed' | 'skipped_locked',
  summary: string | null,
  errorMessage: string | null,
  startedAt: Date,
  finishedAt: Date
): Promise<void> {
  try {
    const db = getDb(env.DATABASE_URL)
    await db.insert(cronJobRuns).values({
      jobId,
      source,
      status,
      summary,
      errorMessage,
      startedAt,
      finishedAt,
    })
  } catch (err) {
    // Recording a run shouldn't take down a job — log and swallow.
    logger.warn({ jobId, err: (err as Error).message }, '[cron] failed to record run')
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, jobId: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`[cron:${jobId}] timed out after ${ms}ms`)), ms)
    promise.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (err) => {
        clearTimeout(t)
        reject(err)
      }
    )
  })
}
