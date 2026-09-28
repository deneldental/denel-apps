/**
 * Daily DB backup job. Thin wrapper around the existing `runBackup` logic
 * in backup-scheduler.ts — extracted so both the legacy in-process scheduler
 * and the new cron engine can call it without duplicate code.
 */

import { runBackupNow } from '../../backup-scheduler'
import type { JobContext, JobRunResult } from '../types'

export async function runBackup(_ctx: JobContext): Promise<JobRunResult> {
  const result = await runBackupNow()
  if (result.status === 'skipped') {
    return { summary: `skipped: ${result.reason}` }
  }
  if (result.status === 'ok') {
    return { summary: `uploaded ${result.key}`, details: { key: result.key } }
  }
  // Failed — let the runner record it as a failure by throwing.
  throw new Error(result.error ?? 'backup failed')
}
