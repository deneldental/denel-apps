/**
 * 15-minute scheduler tick.
 *
 * Calls the existing reminder/credential/birthday engine. The previous
 * `setInterval` polling loop in `scheduler.ts` is no longer started — this
 * cron job replaces it.
 */

import { runScheduler } from '../../scheduler'
import type { JobContext, JobRunResult } from '../types'

export async function runSchedulerTick(_ctx: JobContext): Promise<JobRunResult> {
  await runScheduler()
  return { summary: 'tick complete' }
}
