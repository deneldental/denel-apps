/**
 * activity-completions-service.ts — admin-v1 §1.1.
 *
 * The log behind the dashboard/CRM "Completed" tab. `recordCompletion` is the one
 * write path (idempotent per activity item); `listCompletions` is the paginated
 * read; `getCompletedRefIds` lets the Pending list subtract what's already done.
 */

import { and, count, desc, eq } from 'drizzle-orm'
import type { DB } from '../db'
import { activityCompletions, user } from '../db/schema'

export const ACTIVITY_TYPES = [
  'recare',
  'patient_reminder',
  'birthday',
  'unconfirmed',
  'overdue',
] as const
export type ActivityType = (typeof ACTIVITY_TYPES)[number]

/** Mark an activity item done. Idempotent per (activityType, refId). */
export async function recordCompletion(
  db: DB,
  p: {
    activityType: string
    refId?: string | null
    label?: string | null
    completedById?: string | null
  }
) {
  if (p.refId) {
    const existing = await db.query.activityCompletions.findFirst({
      where: and(
        eq(activityCompletions.activityType, p.activityType),
        eq(activityCompletions.refId, p.refId)
      ),
    })
    if (existing) return existing
  }
  const [row] = await db
    .insert(activityCompletions)
    .values({
      activityType: p.activityType,
      refId: p.refId ?? null,
      label: p.label ?? null,
      completedById: p.completedById ?? null,
    })
    .returning()
  return row
}

/** Paginated completed history, newest first, with the completer's name. */
export async function listCompletions(
  db: DB,
  opts: { limit?: number; offset?: number; activityType?: string } = {}
) {
  const limit = Number.isFinite(opts.limit) ? Math.min(Math.max(opts.limit as number, 1), 200) : 25
  const offset = opts.offset && opts.offset > 0 ? opts.offset : 0
  const where = opts.activityType
    ? eq(activityCompletions.activityType, opts.activityType)
    : undefined

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: activityCompletions.id,
        activityType: activityCompletions.activityType,
        refId: activityCompletions.refId,
        label: activityCompletions.label,
        completedAt: activityCompletions.completedAt,
        completedById: activityCompletions.completedById,
        completedByName: user.name,
      })
      .from(activityCompletions)
      .leftJoin(user, eq(user.id, activityCompletions.completedById))
      .where(where)
      .orderBy(desc(activityCompletions.completedAt))
      .limit(limit)
      .offset(offset),
    db.select({ n: count() }).from(activityCompletions).where(where),
  ])
  return { data: rows, total: totalRows[0]?.n ?? 0, limit, offset }
}

/** Undo a completion (the item returns to Pending). */
export async function removeCompletion(db: DB, id: string) {
  const [row] = await db
    .delete(activityCompletions)
    .where(eq(activityCompletions.id, id))
    .returning()
  return row ?? null
}

/** The set of refIds already completed for a type — used to compute Pending. */
export async function getCompletedRefIds(db: DB, activityType: string): Promise<Set<string>> {
  const rows = await db
    .select({ refId: activityCompletions.refId })
    .from(activityCompletions)
    .where(eq(activityCompletions.activityType, activityType))
  return new Set(rows.map((r) => r.refId).filter((x): x is string => !!x))
}
