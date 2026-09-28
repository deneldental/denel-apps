/**
 * Lab 2-week fallback. Sweeps lab cases that crossed 14 days without a
 * patient payment and stamps `expenseReadyAt`. This used to be lazy
 * (recomputed on every read of /api/labs/cases); now it runs nightly so
 * the read path stays cheap and reports surface the right state at midnight.
 */

import { and, gt, isNull, sql } from 'drizzle-orm'
import { env } from '../../../config/env'
import { getDb } from '../../../db'
import { labCases } from '../../../db/schema'
import { applyTwoWeekFallback } from '../../lab-case-billing'
import type { JobContext, JobRunResult } from '../types'

export async function runLabTwoWeekFallback(_ctx: JobContext): Promise<JobRunResult> {
  const db = getDb(env.DATABASE_URL)
  // Only fetch eligible rows: no expenseReadyAt + positive labCost. The 14-day
  // cutoff is enforced inside applyTwoWeekFallback so we stay consistent with
  // the read-path version of the same logic.
  const rows = await db
    .select({
      id: labCases.id,
      createdAt: labCases.createdAt,
      labCost: labCases.labCost,
      cost: labCases.cost,
      expenseReadyAt: labCases.expenseReadyAt,
    })
    .from(labCases)
    .where(and(isNull(labCases.expenseReadyAt), gt(sql`COALESCE("labCost", "cost", 0)`, 0)))
    .limit(5000)
  const updated = await applyTwoWeekFallback(db as any, rows as any)
  const stampedCount = updated.filter((r) => r.expenseReadyAt != null).length
  return { summary: `scanned ${rows.length} cases, stamped ${stampedCount}` }
}
