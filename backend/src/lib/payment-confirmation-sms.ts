/**
 * The payment-confirmation text of the modern posting paths: Receive Payment's draft → post
 * (`POST /api/payments/:id/post`) and the estimate confirm (`POST /api/worklist/:id/confirm`).
 * G08 of DENEL_FRAMADA_AUDIT_2026-10-25.md, decision D11-G08.
 *
 *  - The amount is what was COMMITTED: the posted payments of the event, that is the payment itself,
 *    or every posted payment sharing its `paymentGroupId` (a split across methods). Never a figure
 *    from the caller; a sibling still a draft, or reversed, is not counted. Send it with the LAST
 *    payment of a group: the total is what has been posted when it runs.
 *  - At most once per event: its dedupe key ("payment:<id>" or "group:<paymentGroupId>") is claimed
 *    in `payment_sms_sends` before anything is sent, so a replayed post, a retried request or two
 *    requests at once find it claimed and send nothing. A failed text stays failed (the row says
 *    why); it is not sent again by itself.
 *  - The wording, sender and provider are `sendPaymentReceiptSms`'s (Denel's template resolver and
 *    `sendSMS`): a plan payment uses the "with balance" wording, the balance being what the plan's
 *    invoices still owe after the posting, by the ledger's own rule.
 *  - It NEVER throws: the payment is committed by the time this runs, and a failed text reported as a
 *    failed payment gets the patient charged twice (F31).
 */
import { Money } from '@denel/utils'
import { and, eq, inArray } from 'drizzle-orm'
import type { DB } from '../db'
import {
  invoiceLines,
  invoices,
  patients,
  paymentAllocations,
  paymentSmsSends,
  payments,
} from '../db/schema'
import { logError } from './logger'
import { sendPaymentReceiptSms } from './payment-receipt-sms'

export interface PaymentConfirmationSmsResult {
  sent: boolean
  /** Why the text failed; absent when it was sent, and when nothing was to be sent. */
  error?: string
  /** Why nothing was sent, when nothing was. */
  skipped?: 'not_posted' | 'no_phone' | 'already_sent'
}

/** The invoice states that still owe money, as the patient ledger counts them (routes/patients.ts). */
const OUTSTANDING_STATUSES = ['issued', 'partially_paid', 'pending', 'partial', 'overdue']

/** What a plan's invoices still owe, in cents, by the ledger's rule. */
async function planOutstanding(db: DB, planId: string): Promise<number> {
  const rows = await db
    .select({ amount: invoices.amount, paidAmount: invoices.paidAmount, balance: invoices.balance })
    .from(invoices)
    .where(
      and(
        eq(invoices.planId, planId),
        inArray(invoices.status, OUTSTANDING_STATUSES),
        eq(invoices.archived, false)
      )
    )
  return rows.reduce((sum, inv) => {
    const remaining =
      inv.balance != null ? Number(inv.balance) : Number(inv.amount) - Number(inv.paidAmount)
    return sum + Math.max(0, remaining)
  }, 0)
}

/** What the event paid for: the lines of the invoices it was applied to, by name. Null when none. */
async function paidFor(db: DB, paymentIds: string[]): Promise<string | null> {
  const targets = await db
    .select({ invoiceId: paymentAllocations.targetId })
    .from(paymentAllocations)
    .where(
      and(
        inArray(paymentAllocations.paymentId, paymentIds),
        eq(paymentAllocations.targetType, 'invoice')
      )
    )
  if (targets.length === 0) return null
  const lines = await db
    .select({ description: invoiceLines.description })
    .from(invoiceLines)
    .where(
      inArray(
        invoiceLines.invoiceId,
        targets.map((t) => t.invoiceId)
      )
    )
  const names = [...new Set(lines.map((l) => l.description.trim()).filter(Boolean))]
  return names.length > 0 ? names.join(', ') : null
}

export async function sendPaymentConfirmationSms(
  db: DB,
  input: { paymentId: string; userId: string }
): Promise<PaymentConfirmationSmsResult> {
  try {
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, input.paymentId))
      .limit(1)
    if (!payment || payment.status !== 'posted' || payment.direction !== 'incoming') {
      return { sent: false, skipped: 'not_posted' }
    }

    // A group is one patient's payment: an older row of another patient in it is not this text's.
    const event =
      payment.paymentGroupId && payment.patientId
        ? await db
            .select()
            .from(payments)
            .where(
              and(
                eq(payments.paymentGroupId, payment.paymentGroupId),
                eq(payments.patientId, payment.patientId),
                eq(payments.status, 'posted'),
                eq(payments.direction, 'incoming')
              )
            )
        : [payment]
    const amount = event.reduce((sum, p) => sum.add(Money.from(p.amount)), Money.zero()).toDbValue()

    const patientId = payment.patientId ?? payment.partyId
    const [patient] = patientId
      ? await db.select().from(patients).where(eq(patients.id, patientId)).limit(1)
      : []
    const contactPhone =
      patient?.isChild && patient.guardianPhone ? patient.guardianPhone : patient?.phone
    if (!patient || !contactPhone) return { sent: false, skipped: 'no_phone' }

    // Claimed before anything is sent: whoever inserts the key texts; everyone else finds it taken.
    const dedupeKey = payment.paymentGroupId
      ? `group:${payment.paymentGroupId}`
      : `payment:${payment.id}`
    const [claim] = await db
      .insert(paymentSmsSends)
      .values({ dedupeKey, paymentId: payment.id, patientId: patient.id, amount })
      .onConflictDoNothing({ target: paymentSmsSends.dedupeKey })
      .returning({ id: paymentSmsSends.id })
    if (!claim) return { sent: false, skipped: 'already_sent' }

    const planId = event.find((p) => p.paymentPlanId)?.paymentPlanId ?? null
    const result = await sendPaymentReceiptSms(db, {
      patient,
      amount,
      balance: planId ? await planOutstanding(db, planId) : null,
      description:
        (await paidFor(
          db,
          event.map((p) => p.id)
        )) ?? payment.description,
      paymentPlanId: planId,
      userId: input.userId,
    })

    await db
      .update(paymentSmsSends)
      .set(
        result.sent
          ? { status: 'sent', sentAt: new Date() }
          : { status: 'failed', error: result.error ?? 'The text was not sent' }
      )
      .where(eq(paymentSmsSends.id, claim.id))
    return result.sent ? { sent: true } : { sent: false, error: result.error }
  } catch (err) {
    logError(err, { context: 'payment confirmation SMS (non-fatal)', paymentId: input.paymentId })
    return { sent: false, error: 'The payment-confirmation text could not be sent.' }
  }
}
