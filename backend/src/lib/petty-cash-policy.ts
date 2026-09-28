/**
 * The petty-cash review gate and staff IOU cap (settings-domain-audit S5-B),
 * applied to an expense payload after `applyPettyCashFields` has marked it
 * `confirmationStatus: 'pending'` (i.e. its category is petty-cash).
 *
 *   - IOU cap: a staff-directed disbursement is refused while that staff
 *     member already has `maxActiveIousPerStaff` disbursements awaiting review.
 *   - Review gate: at/below `singleApprovalLimit` the disbursement is confirmed
 *     on the spot (stamped as auto-confirmed); above it stays pending for a
 *     manager. Money and GL behaviour are untouched either way.
 */

import {
  decidePettyReview,
  iouCapReached,
  type PettyCashPolicy,
  type PettyReviewDecision,
} from '@denel/utils'
import { and, count, eq } from 'drizzle-orm'
import type { DB } from '../db'
import { expenses } from '../db/schema'
import { getPettyCashPolicy } from './settings-store'

export class PettyCashPolicyError extends Error {
  readonly status = 409
}

export async function countActiveStaffIous(db: DB, staffId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(expenses)
    .where(
      and(
        eq(expenses.pettyRefType, 'staff'),
        eq(expenses.pettyRefId, staffId),
        eq(expenses.confirmationStatus, 'pending')
      )
    )
  return Number(row?.n ?? 0)
}

/**
 * Mutates `data` (the expense insert payload) in place. Returns the decision,
 * or null when the expense is not a petty disbursement awaiting review.
 * Throws `PettyCashPolicyError` when the IOU cap refuses it.
 */
export async function applyPettyCashReviewPolicy(
  db: DB,
  data: Record<string, unknown>,
  userId: string,
  policyOverride?: PettyCashPolicy
): Promise<PettyReviewDecision | null> {
  if (data.confirmationStatus !== 'pending') return null
  const policy = policyOverride ?? (await getPettyCashPolicy(db))

  if (data.pettyRefType === 'staff' && typeof data.pettyRefId === 'string') {
    const active = await countActiveStaffIous(db, data.pettyRefId)
    if (iouCapReached(active, policy.maxActiveIousPerStaff)) {
      throw new PettyCashPolicyError(
        `This staff member already has ${active} petty cash disbursement${active === 1 ? '' : 's'} awaiting review (limit ${policy.maxActiveIousPerStaff}). Confirm or flag them first.`
      )
    }
  }

  const decision = decidePettyReview(Number(data.amount ?? 0), policy.singleApprovalLimit)
  if (decision === 'auto_confirmed') {
    data.confirmationStatus = 'confirmed'
    data.confirmedById = userId
    data.confirmedAt = new Date()
    data.confirmationNote = `Auto-confirmed: at or below the GHS ${policy.singleApprovalLimit} approval limit`
  }
  return decision
}
