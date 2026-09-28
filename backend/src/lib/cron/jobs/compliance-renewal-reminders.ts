/**
 * Daily compliance renewal reminders — admin-v1 §17.2.
 *
 * Sends a renewal SMS for compliance documents that have entered their reminder
 * window (N months before expiry) and stamps `lastReminderSentAt` so each fires
 * once per renewal cycle. See `lib/compliance-reminders.ts` for the selection
 * + send logic (the testable unit).
 */

import { env } from '../../../config/env'
import { getDb } from '../../../db'
import { runComplianceRenewalCheck } from '../../compliance-reminders'
import type { JobContext, JobRunResult } from '../types'

export async function runComplianceRenewalReminders(_ctx: JobContext): Promise<JobRunResult> {
  const db = getDb(env.DATABASE_URL)
  const { sent, due } = await runComplianceRenewalCheck(db)
  return {
    summary: `compliance renewal reminders: sent ${sent} (due ${due})`,
    details: { sent, due },
  }
}
