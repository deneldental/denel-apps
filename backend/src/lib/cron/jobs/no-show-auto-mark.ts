/**
 * Daily no-show auto-mark.
 *
 * Sets `appointments.status='no_show'` for appointments where:
 *   - the scheduled date is more than 24 hours in the past
 *   - the current status is still one of: scheduled, booked, confirmed, unconfirmed
 *
 * Does NOT delete — the row stays so reports surface "patient X no-showed
 * on Y". The receptionist can still flip it to 'completed' or 'cancelled'
 * if reality differs.
 */

import { and, inArray, lt } from 'drizzle-orm'
import { env } from '../../../config/env'
import { getDb } from '../../../db'
import { appointments } from '../../../db/schema/clinical'
import type { JobContext, JobRunResult } from '../types'

const STILL_OPEN_STATUSES = ['scheduled', 'booked', 'confirmed', 'unconfirmed']

export async function runNoShowAutoMark(_ctx: JobContext): Promise<JobRunResult> {
  const db = getDb(env.DATABASE_URL)
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const flipped = await db
    .update(appointments)
    .set({ status: 'no_show', updatedAt: new Date() })
    .where(and(lt(appointments.date, cutoff), inArray(appointments.status, STILL_OPEN_STATUSES)))
    .returning({ id: appointments.id })

  return {
    summary: `marked ${flipped.length} appointments as no_show`,
    details: { markedCount: flipped.length, cutoff: cutoff.toISOString() },
  }
}
