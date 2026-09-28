/**
 * Regression test for C7 — `recomputeScheduleStatuses` counted reversed
 * payments.
 *
 * The bug: the schedule-status recompute summed *every* `payment_allocations`
 * row pointing at the plan's master invoice, with no regard for the payment's
 * status. `reversePayment` deliberately keeps allocation rows for the audit
 * trail — so after a payment was reversed, its allocation still inflated the
 * "payment pool" and the schedule items stayed `paid` / `partial` even though
 * the money had been refunded out.
 *
 * The fix: the pool query inner-joins `payments` and filters
 * `payments.status = 'posted'`.
 */

import { asc, eq, inArray } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { numberSequences, paymentPlanScheduleItems } from '../../src/db/schema'
import { issueInvoice } from '../../src/lib/invoice-service'
import { createPlan } from '../../src/lib/payment-plan-service'
import { createDraftPayment, postPayment, reversePayment } from '../../src/lib/payment-service'
import { anyUserId, makePatient } from './_fixtures'
import { noDb, withRollback } from './_setup'

describe.skipIf(noDb)('recomputeScheduleStatuses — ignores reversed payments [C7]', () => {
  it('a reversed payment no longer keeps a schedule item marked paid', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)

      // `createPlan` allocates real document numbers via `nextNumber`. The dev
      // DB already holds low-numbered invoices, so bump the `invoice`/`plan`
      // sequences into a free range for this rolled-back sandbox.
      await tx
        .update(numberSequences)
        .set({ nextNumber: 950_000 })
        .where(inArray(numberSequences.sequenceKey, ['invoice', 'plan']))

      // A 3 × 200 fixed plan: one master invoice + three schedule items.
      const { plan, invoice, scheduleItems } = await createPlan(
        tx,
        {
          patientId,
          totalAmount: 600,
          scheduleType: 'fixed',
          startDate: new Date('2026-05-14'),
          numberOfInstallments: 3,
          installmentPeriod: 'monthly',
          revenueAccountCode: '4100',
        },
        userId
      )
      expect(scheduleItems).toHaveLength(3)
      await issueInvoice(tx, invoice.id, userId)

      // Pay the first installment in full, against the master invoice.
      const draft = await createDraftPayment(
        tx,
        {
          patientId,
          amount: 200,
          method: 'cash',
          allocations: [{ targetType: 'invoice', targetId: invoice.id, amount: 200 }],
        },
        userId
      )
      await postPayment(tx, draft.payment.id, userId)

      // After posting, item 1 is fully paid.
      const afterPost = await tx.query.paymentPlanScheduleItems.findMany({
        where: eq(paymentPlanScheduleItems.paymentPlanId, plan.id),
        orderBy: [asc(paymentPlanScheduleItems.sequence)],
      })
      expect(afterPost[0].status).toBe('paid')
      expect(Number(afterPost[0].amountReceived)).toBe(200)

      // Reverse the payment — `reversePayment` calls recomputeScheduleStatuses.
      await reversePayment(tx, draft.payment.id, { userId, reason: 'IT reverse' })

      // Pre-fix the reversed payment's allocation still counted, leaving item 1
      // 'paid'. The fix excludes non-posted payments, so the pool drains to 0
      // and item 1 reverts.
      const afterReverse = await tx.query.paymentPlanScheduleItems.findMany({
        where: eq(paymentPlanScheduleItems.paymentPlanId, plan.id),
        orderBy: [asc(paymentPlanScheduleItems.sequence)],
      })
      expect(afterReverse[0].status).not.toBe('paid')
      expect(Number(afterReverse[0].amountReceived)).toBe(0)
    })
  })
})
