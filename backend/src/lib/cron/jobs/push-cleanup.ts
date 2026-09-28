/**
 * Weekly push subscription cleanup.
 *
 * Web Push subscriptions go stale when the user clears site data, uninstalls
 * the PWA, or revokes notification permission. The dispatch path catches
 * 404/410 responses and tombstones the row by setting `endpoint` to a marker,
 * but doesn't delete (so we don't lose the audit). This job purges rows the
 * dispatch path tombstoned plus rows that haven't been touched in 90 days.
 *
 * If your push table doesn't have a dead-tombstone column the 90-day prune
 * is the safer single source of truth; we use it here.
 */

import { lt } from 'drizzle-orm'
import { env } from '../../../config/env'
import { getDb } from '../../../db'
import { pushSubscriptions } from '../../../db/schema/push'
import type { JobContext, JobRunResult } from '../types'

const STALE_DAYS = 90

export async function runPushSubscriptionCleanup(_ctx: JobContext): Promise<JobRunResult> {
  const db = getDb(env.DATABASE_URL)
  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000)

  const deleted = await db
    .delete(pushSubscriptions)
    .where(lt(pushSubscriptions.lastUsedAt, cutoff))
    .returning({ id: pushSubscriptions.id })

  return {
    summary: `deleted ${deleted.length} stale push subscriptions`,
    details: { deleted: deleted.length, staleDays: STALE_DAYS },
  }
}
