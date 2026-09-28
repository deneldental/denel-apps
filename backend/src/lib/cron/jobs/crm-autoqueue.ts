/**
 * Daily CRM auto-queue — admin-v1 §13.2.
 *
 * Queues the day's birthday + follow-up sends into `scheduled_reminders` with
 * requiresConfirmation=true, so staff review + confirm before anything goes out.
 * See `lib/crm-autoqueue.ts` for the selection + dedupe logic (the testable
 * unit). Recare is queued separately by `recare-batch`.
 */

import { env } from '../../../config/env'
import { getDb } from '../../../db'
import { runCrmAutoQueue } from '../../crm-autoqueue'
import type { JobContext, JobRunResult } from '../types'

export async function runCrmAutoQueueJob(_ctx: JobContext): Promise<JobRunResult> {
  const db = getDb(env.DATABASE_URL)
  const { queued, skipped, scanned } = await runCrmAutoQueue(db)
  return {
    summary: `CRM auto-queue: queued ${queued} · skipped ${skipped} dup · scanned ${scanned}`,
    details: { queued, skipped, scanned },
  }
}
