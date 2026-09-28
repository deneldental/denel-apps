/**
 * Regression tests for the `voidInvoice` guards — R2b.
 *
 *  - H8: the old guard tested `balance < amount` (both derived, drift-prone
 *    columns) and so could let a paid invoice be voided if its `balance` was
 *    stale. The fix keys off `paidAmount` (the direct cash-applied signal) and
 *    `balance !== total`.
 *  - C5: a void posts a blanket reversal of the invoice JE, which reverses the
 *    commission accrual lines too. If a commission was already PAID OUT, that
 *    drifts the commission sub-ledger against cash that is gone. The fix blocks
 *    the void.
 *  - H9: `reverseEventsForInvoice` (which un-recognises deferred revenue) was
 *    never wired into `voidInvoice`, so voiding a partially-recognised deferred
 *    invoice stranded the recognised portion on account 2400. The fix calls it.
 */

import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { invoices, revenueRecognitionEvents, specialistCommissions } from '../../src/db/schema'
import { recognizeRevenue } from '../../src/lib/deferred-revenue-service'
import { issueInvoice, voidInvoice } from '../../src/lib/invoice-service'
import {
  accountIdByCode,
  anyUserId,
  makeDraftInvoice,
  makePatient,
  makeSpecialist,
} from './_fixtures'
import { expectRejection, noDb, withRollback } from './_setup'

describe.skipIf(noDb)('voidInvoice guards [H8/C5/H9]', () => {
  it('H8 — refuses to void an invoice with paidAmount > 0 even if balance looks untouched', async () => {
    const err = await expectRejection(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const revAcct = await accountIdByCode(tx, '4100')
      const { invoiceId } = await makeDraftInvoice(tx, {
        patientId,
        userId,
        amount: 200,
        revenueAccountId: revAcct,
      })
      await issueInvoice(tx, invoiceId, userId)

      // Simulate the drift the old guard could not see: a payment has been
      // applied (`paidAmount > 0`) but `balance` still equals `total`. The old
      // `balance < amount` guard passed straight through and voided a paid
      // invoice; the `paidAmount`-based guard catches it.
      await tx.update(invoices).set({ paidAmount: 50 }).where(eq(invoices.id, invoiceId))

      await voidInvoice(tx, invoiceId, { userId, reason: 'IT void paid invoice' })
    }, /payments applied/i)
    expect(err.message).toMatch(/payments applied/i)
  })

  it('C5 — refuses to void an invoice that has a PAID specialist commission', async () => {
    const err = await expectRejection(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const revAcct = await accountIdByCode(tx, '4100')
      const specialistId = await makeSpecialist(tx, { commissionRate: 10 })
      const { invoiceId } = await makeDraftInvoice(tx, {
        patientId,
        userId,
        amount: 200,
        revenueAccountId: revAcct,
        specialistId,
        commissionRate: 10,
      })
      await issueInvoice(tx, invoiceId, userId)

      // The commission has been paid out to the specialist.
      await tx
        .update(specialistCommissions)
        .set({ status: 'paid', payableAmount: 20, paidAt: new Date() })
        .where(eq(specialistCommissions.invoiceId, invoiceId))

      await voidInvoice(tx, invoiceId, { userId, reason: 'IT void paid-commission invoice' })
    }, /paid specialist commission/i)
    expect(err.message).toMatch(/paid specialist commission/i)
  })

  it('H9 — voiding a deferred invoice reverses its revenue-recognition events', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const revAcct = await accountIdByCode(tx, '4100')
      const { invoiceId, invoiceLineId } = await makeDraftInvoice(tx, {
        patientId,
        userId,
        amount: 200,
        revenueAccountId: revAcct,
        deferRevenue: true,
      })
      await issueInvoice(tx, invoiceId, userId)

      // Recognise part of the deferred revenue — creates an active event.
      await recognizeRevenue(tx, { invoiceLineId, amount: 50 }, userId)
      const before = await tx.query.revenueRecognitionEvents.findMany({
        where: eq(revenueRecognitionEvents.invoiceLineId, invoiceLineId),
      })
      expect(before).toHaveLength(1)
      // `reversed` is a real boolean after migration 0043 (H18).
      expect(before[0].reversed).toBe(false)

      await voidInvoice(tx, invoiceId, { userId, reason: 'IT void deferred invoice' })

      // Pre-fix `voidInvoice` never called `reverseEventsForInvoice`, so the
      // event stayed active and its recognised 50 was stranded on account 2400.
      const after = await tx.query.revenueRecognitionEvents.findFirst({
        where: and(
          eq(revenueRecognitionEvents.invoiceLineId, invoiceLineId),
          eq(revenueRecognitionEvents.id, before[0].id)
        ),
      })
      expect(after?.reversed).toBe(true)
    })
  })
})
