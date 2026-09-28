/**
 * training-renewal.ts — admin-v1 §15.1 (mandatory / recurring training).
 *
 * Pure helpers + a scheduler-facing recompute for the training renewal cycle.
 *
 * The lifecycle:
 *   - An assignment (a `staff_training_progress` row) can carry a `dueDate`
 *     (when it must be done by) and a `renewalMonths` interval (re-cert cadence).
 *   - On completion the completion site stamps `expiresAt = completedAt +
 *     renewalMonths` (see `computeExpiresAt`). A one-off assignment
 *     (`renewalMonths` null) never expires.
 *   - `reopenExpiredTraining` is the scheduler/cron entry point: any completed,
 *     recurring assignment whose `expiresAt` has passed is RE-OPENED for
 *     re-certification — status back to 'not_started', completion fields
 *     cleared, and a fresh `dueDate` rolled forward so the learner has a
 *     window. The same sweep also backfills `expiresAt` for any completed
 *     recurring row that is missing it (rows completed before this column was
 *     wired, or via a path that didn't stamp it).
 *
 * Status derivation (`deriveTrainingStatus`) layers a *read-time* view on top
 * of the stored status so the list/read endpoints can surface
 * due / overdue / expired without persisting those transient states.
 */

import { addMonths } from 'date-fns'
import { and, eq, inArray, isNotNull, isNull, lte, type SQL } from 'drizzle-orm'
import type { DB } from '../db'
import { staff, staffTrainingProgress, trainingMaterials, user } from '../db/schema'

/**
 * Re-cert deadline = completedAt + renewalMonths. Returns null when the
 * assignment is one-off (no renewal interval) or has no completion date.
 */
export function computeExpiresAt(
  completedAt: Date | null | undefined,
  renewalMonths: number | null | undefined
): Date | null {
  if (!completedAt) return null
  if (renewalMonths == null || !Number.isFinite(renewalMonths) || renewalMonths <= 0) return null
  return addMonths(new Date(completedAt), renewalMonths)
}

/** A training assignment's derived (read-time) status. */
export type DerivedTrainingStatus =
  | 'completed'
  | 'expired'
  | 'overdue'
  | 'due'
  | 'in_progress'
  | 'not_started'

/** The minimal shape `deriveTrainingStatus` reads off a progress row. */
export interface TrainingStatusInput {
  status: string
  dueDate?: Date | string | null
  expiresAt?: Date | string | null
}

const asDate = (v: Date | string | null | undefined): Date | null =>
  v == null ? null : v instanceof Date ? v : new Date(v)

/**
 * Layer due / overdue / expired on top of the stored status.
 *
 *   - completed + expiresAt in the past  → 'expired'  (re-cert needed)
 *   - completed (or expiresAt in future / absent) → 'completed'
 *   - not-yet-completed + dueDate in the past → 'overdue'
 *   - not-yet-completed + dueDate today/future → 'due'
 *   - otherwise the stored status ('in_progress' | 'not_started')
 *
 * `dueWindowDays` (default 0) lets a caller treat assignments due within N days
 * as 'due' even when no dueDate is set — currently unused, reserved.
 */
export function deriveTrainingStatus(
  row: TrainingStatusInput,
  now: Date = new Date()
): DerivedTrainingStatus {
  const dueDate = asDate(row.dueDate)
  const expiresAt = asDate(row.expiresAt)

  if (row.status === 'completed') {
    if (expiresAt && expiresAt.getTime() <= now.getTime()) return 'expired'
    return 'completed'
  }

  // Not completed yet — surface the due-date pressure.
  if (dueDate) {
    return dueDate.getTime() < now.getTime() ? 'overdue' : 'due'
  }

  return row.status === 'in_progress' ? 'in_progress' : 'not_started'
}

export interface ReopenExpiredResult {
  /** Completed recurring rows whose expiresAt was null and got backfilled. */
  backfilled: number
  /** Rows re-opened (status reset to not_started, completion cleared). */
  reopened: number
}

/**
 * Scheduler/cron recompute for recurring training (admin-v1 §15.1).
 *
 * Step 1 — backfill: any completed row with a `renewalMonths` interval but a
 * null `expiresAt` gets `expiresAt = completedAt + renewalMonths` stamped, so a
 * row completed before the column was wired still enters the renewal cycle.
 *
 * Step 2 — reopen: any completed row whose `expiresAt` has now passed is
 * re-opened for re-certification — status → 'not_started', completion fields
 * cleared, and `dueDate` rolled to the just-passed `expiresAt` so the learner
 * has a concrete deadline for the new cycle. `expiresAt` itself is cleared; it
 * is re-derived on the next completion.
 *
 * Idempotent: running it twice in a row is a no-op once everything is current.
 * Returns counts for logging.
 */
export async function reopenExpiredTraining(
  db: DB,
  now: Date = new Date()
): Promise<ReopenExpiredResult> {
  // Step 1 — backfill missing expiresAt for completed recurring assignments.
  const toBackfill = await db
    .select({
      id: staffTrainingProgress.id,
      completedAt: staffTrainingProgress.completedAt,
      renewalMonths: staffTrainingProgress.renewalMonths,
    })
    .from(staffTrainingProgress)
    .where(
      and(
        eq(staffTrainingProgress.status, 'completed'),
        isNotNull(staffTrainingProgress.completedAt),
        isNotNull(staffTrainingProgress.renewalMonths),
        // Only rows that haven't been stamped yet — keeps the sweep idempotent.
        isNull(staffTrainingProgress.expiresAt)
      )
    )

  let backfilled = 0
  for (const row of toBackfill) {
    if (row.renewalMonths == null) continue
    const exp = computeExpiresAt(row.completedAt, row.renewalMonths)
    if (!exp) continue
    // Skip rows that already carry the correct value — this is what makes the
    // step idempotent without a separate isNull filter in SQL.
    const [updated] = await db
      .update(staffTrainingProgress)
      .set({ expiresAt: exp, updatedAt: now })
      .where(
        and(
          eq(staffTrainingProgress.id, row.id),
          // only stamp when currently null, so re-runs don't churn updatedAt
          isNull(staffTrainingProgress.expiresAt)
        )
      )
      .returning({ id: staffTrainingProgress.id })
    if (updated) backfilled++
  }

  // Step 2 — reopen expired recurring assignments.
  const expired = await db
    .select({
      id: staffTrainingProgress.id,
      expiresAt: staffTrainingProgress.expiresAt,
    })
    .from(staffTrainingProgress)
    .where(
      and(
        eq(staffTrainingProgress.status, 'completed'),
        isNotNull(staffTrainingProgress.expiresAt),
        lte(staffTrainingProgress.expiresAt, now)
      )
    )

  let reopened = 0
  for (const row of expired) {
    const [updated] = await db
      .update(staffTrainingProgress)
      .set({
        status: 'not_started',
        progressPercent: 0,
        score: null,
        startedAt: null,
        completedAt: null,
        // Roll the deadline forward to the cycle boundary that just passed so
        // the learner has a concrete due date for the new cycle.
        dueDate: row.expiresAt,
        expiresAt: null,
        // Clear the trainer-review layer — the prior cert no longer stands.
        trainerFeedback: null,
        reviewedAt: null,
        reviewedById: null,
        certificateIssued: false,
        updatedAt: now,
      })
      .where(
        and(
          eq(staffTrainingProgress.id, row.id),
          // guard against a concurrent recompletion between SELECT and UPDATE
          eq(staffTrainingProgress.status, 'completed')
        )
      )
      .returning({ id: staffTrainingProgress.id })
    if (updated) reopened++
  }

  return { backfilled, reopened }
}

// ─── §15.2 — role bulk assignment ───────────────────────────────────────────

export interface BulkAssignTarget {
  /** Match active staff whose linked auth user has this role id (e.g. 'doctor'). */
  role?: string | null
}

export interface BulkAssignOptions extends BulkAssignTarget {
  /** Optional due date stamped on the newly-created assignments. */
  dueDate?: Date | null
  /** Optional re-cert interval (months) stamped on the new assignments. */
  renewalMonths?: number | null
}

export interface BulkAssignResult {
  /** Active staff matched by the role filter. */
  matched: number
  /** New assignment rows actually inserted (already-assigned staff skipped). */
  assigned: number
  /** Matched staff that already had a progress row (idempotency skips). */
  skipped: number
  /** The matched staff ids (for the audit trail). */
  staffIds: string[]
}

/**
 * Assign a training material to every ACTIVE staff member matching a role,
 * inserting `staff_training_progress` rows. Idempotent: staff who already
 * have a progress row for this material are skipped (the (staffId, trainingId)
 * UNIQUE index, migration 0065, is the backstop via onConflictDoNothing).
 *
 * A `role` must be supplied (an empty filter would fan out to the whole clinic;
 * that's the existing `assignedTo: ['all']` path, not this one). Throws on an
 * unknown material or an empty filter.
 *
 * Role is resolved off the linked auth user (`user.role`) — `staff.role` no
 * longer exists. External trainers and soft-deleted staff are excluded.
 */
export async function bulkAssignTraining(
  db: DB,
  trainingId: string,
  opts: BulkAssignOptions
): Promise<BulkAssignResult> {
  const role = opts.role?.trim() || null
  if (!role) {
    throw new Error('bulkAssignTraining requires a role filter')
  }

  const material = await db.query.trainingMaterials.findFirst({
    where: eq(trainingMaterials.id, trainingId),
    columns: { id: true },
  })
  if (!material) throw new Error('Training material not found')

  // Build the matcher. Role joins through the auth user.
  const conds: SQL[] = [
    eq(staff.status, 'active'),
    eq(staff.isExternalTrainer, false),
    isNull(staff.deletedAt),
  ]
  conds.push(eq(user.role, role))

  const matchedStaff = await db
    .select({ id: staff.id })
    .from(staff)
    .leftJoin(user, eq(user.id, staff.userId))
    .where(and(...conds))

  const staffIds = matchedStaff.map((s) => s.id)
  if (staffIds.length === 0) {
    return { matched: 0, assigned: 0, skipped: 0, staffIds: [] }
  }

  // Which of the matched staff already have a row for this material?
  const existing = await db
    .select({ staffId: staffTrainingProgress.staffId })
    .from(staffTrainingProgress)
    .where(
      and(
        eq(staffTrainingProgress.trainingId, trainingId),
        inArray(staffTrainingProgress.staffId, staffIds)
      )
    )
  const already = new Set(existing.map((r) => r.staffId))
  const toInsert = staffIds.filter((id) => !already.has(id))

  if (toInsert.length > 0) {
    await db
      .insert(staffTrainingProgress)
      .values(
        toInsert.map((sId) => ({
          staffId: sId,
          trainingId,
          ...(opts.dueDate != null ? { dueDate: opts.dueDate } : {}),
          ...(opts.renewalMonths != null ? { renewalMonths: opts.renewalMonths } : {}),
        }))
      )
      // Backstop the idempotency at the DB level too (concurrent bulk assigns).
      .onConflictDoNothing()
  }

  return {
    matched: staffIds.length,
    assigned: toInsert.length,
    skipped: staffIds.length - toInsert.length,
    staffIds,
  }
}
