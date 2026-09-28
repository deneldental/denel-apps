/**
 * comms-cost.ts — admin-v1 §13.5. Track SMS/email send cost as an expense so
 * outreach gateway spend hits the books and flows into the §13.6 CRM digest +
 * the financial statements.
 *
 * cost = units × per-unit rate. The rate is admin-configurable via the
 * `clinic_settings` KV (keys `settings:sms_cost_per_unit` /
 * `settings:email_cost_per_unit`; see settings-store.ts), with GHS defaults
 * (SMS 0.04, email 0.001). The cost is booked through the SAME expense pipeline
 * every other expense uses: an `expenses` row in the seeded `Communications`
 * category (migration 0127) → `ensureExpensePosted` → DR 5400 Marketing /
 * CR cash. GL posting + digest inclusion therefore come for free.
 *
 * BEST-EFFORT / NON-BLOCKING — exactly like xray-charge-service.ts: a missing
 * category→account mapping or a closed period comes back as `posted: false`
 * with the expense still recorded operationally; the function never throws into
 * the send path, so a cost-tracking gap can NEVER fail an actual send. Call
 * sites still wrap it in try/catch as a belt-and-braces guard.
 */

import { Money } from '@denel/utils'
import type { DB } from '../db'
import { expenses } from '../db/schema'
import { ensureExpensePosted } from './expense-service'
import { getEmailCostPerUnit, getSmsCostPerUnit } from './settings-store'

export type CommsChannel = 'sms' | 'email'

/** The seeded expense category these costs book to (migration 0127 → GL 5400). */
export const COMMS_EXPENSE_CATEGORY = 'Communications'

export interface RecordCommsCostInput {
  channel: CommsChannel
  /** Recipient/message count for the send. */
  count: number
  createdBy: string
  /** Explicit per-unit override (GHS); skips the settings lookup when provided. */
  unitCost?: number
  /** Charge date — defaults to now. */
  date?: Date
  /** Free-text reference (e.g. the gateway batch id) for the expense description. */
  reference?: string
}

export interface RecordCommsCostResult {
  /** Created expense id, when a non-zero cost was recorded. */
  expenseId?: string
  /** The resolved per-unit rate used. */
  unitCost: number
  /** Total cost recorded (units × rate). */
  amount: number
  /** Whether the expense made it onto the GL (false = recorded but unposted). */
  posted: boolean
  /** Set when nothing was recorded (zero count / zero rate). */
  reason?: 'zero_count' | 'zero_amount'
}

/** Resolve the active per-unit rate for a channel (override > settings KV > default). */
export async function resolveCommsRate(
  db: DB,
  channel: CommsChannel,
  override?: number
): Promise<number> {
  if (override != null && Number.isFinite(override) && override >= 0) return override
  return channel === 'sms' ? getSmsCostPerUnit(db) : getEmailCostPerUnit(db)
}

/**
 * Record the cost of a send as a `Communications` expense (best-effort). Resolves
 * the rate, computes units × rate, inserts the expense, and files it to the GL via
 * the shared `ensureExpensePosted`. Returns a result; only re-throws a genuine GL
 * bug (unbalanced / missing channel) — a closed period or unmapped category is
 * captured as `posted: false`, never thrown, so the send path is always safe.
 */
export async function recordCommsCost(
  db: DB,
  input: RecordCommsCostInput
): Promise<RecordCommsCostResult> {
  const count = Math.max(0, Math.floor(Number(input.count) || 0))
  const unitCost = await resolveCommsRate(db, input.channel, input.unitCost)

  if (count <= 0) return { unitCost, amount: 0, posted: false, reason: 'zero_count' }

  // `unitCost` is an admin-set per-unit rate in CEDIS (e.g. 0.05 per SMS) and
  // `amount` must come out in CENTS for `expenses.amount`.
  //
  // The rate is multiplied out BEFORE it enters Money. Converting the rate first
  // quantised it to whole cents, so any sub-cent rate collapsed to zero and the
  // send booked nothing: the default email rate of 0.002/message meant every
  // email cost — at any volume — was recorded as GHS 0.00. Rounding now happens
  // once, on the total, which is the boundary `fromNumber` is documented for.
  const amount = Money.fromNumber(unitCost * count).toDbValue()
  if (!(amount > 0)) return { unitCost, amount: 0, posted: false, reason: 'zero_amount' }

  const date = input.date ?? new Date()
  const label = input.channel.toUpperCase()
  const description = `${count} ${label} message${count === 1 ? '' : 's'}${
    input.reference ? ` (${input.reference})` : ''
  }`

  // Record the expense WITHOUT a stamped accountId — `ensureExpensePosted`
  // resolves it from the category→GL mapping (Communications → 5400, seeded in
  // migration 0127) and stamps it back. Mirrors how every other expense files.
  const [exp] = await db
    .insert(expenses)
    .values({
      category: COMMS_EXPENSE_CATEGORY,
      amount,
      date,
      status: 'paid',
      paymentMethod: 'cash',
      description,
      createdById: input.createdBy,
    })
    .returning()

  const res = await ensureExpensePosted(db, exp, input.createdBy)
  return { expenseId: exp.id, unitCost, amount, posted: res.posted }
}
