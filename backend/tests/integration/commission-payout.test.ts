/**
 * Regression test for M2 / C6 — specialist payout period scoping.
 *
 * The bugs:
 *  - M2: `createPayout` selected the payable commissions for the period but
 *    never recorded *which* commissions it bundled.
 *  - C6: `postPayout` then settled `WHERE specialist_id = X AND status =
 *    'payable'` — every payable commission for the specialist, ignoring the
 *    payout's period entirely. Posting one month's payout marked every other
 *    open month's commissions as paid against that single JE.
 *
 * The fix: `createPayout` stamps `payout_id` on exactly the bundled rows at
 * draft time; `postPayout` settles only `WHERE payout_id = <this payout>`.
 */

import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { specialistCommissions } from '../../src/db/schema'
import { createPayout, postPayout } from '../../src/lib/commission-service'
import { issueInvoice } from '../../src/lib/invoice-service'
import {
  accountIdByCode,
  anyUserId,
  makeDraftInvoice,
  makePatient,
  makeSpecialist,
} from './_fixtures'
import { noDb, withRollback } from './_setup'

describe.skipIf(noDb)('specialist payout — period scoping [M2/C6]', () => {
  it('createPayout bundles only its period; postPayout settles only the bundle', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const revAcct = await accountIdByCode(tx, '4100')
      const specialistId = await makeSpecialist(tx, { commissionRate: 10, whtRate: 0 })

      // Two issued invoices, each with a specialist line → two accrued
      // commissions (commission_amount = 200 * 10% = 20 each).
      const inv1 = await makeDraftInvoice(tx, {
        patientId,
        userId,
        amount: 200,
        revenueAccountId: revAcct,
        specialistId,
        commissionRate: 10,
      })
      const inv2 = await makeDraftInvoice(tx, {
        patientId,
        userId,
        amount: 200,
        revenueAccountId: revAcct,
        specialistId,
        commissionRate: 10,
      })
      await issueInvoice(tx, inv1.invoiceId, userId)
      await issueInvoice(tx, inv2.invoiceId, userId)

      // Force both commissions to `payable`, one accrued in March, one in May.
      await tx
        .update(specialistCommissions)
        .set({ status: 'payable', payableAmount: 20, accruedAt: new Date('2026-03-15T10:00:00Z') })
        .where(eq(specialistCommissions.invoiceId, inv1.invoiceId))
      await tx
        .update(specialistCommissions)
        .set({ status: 'payable', payableAmount: 20, accruedAt: new Date('2026-05-10T10:00:00Z') })
        .where(eq(specialistCommissions.invoiceId, inv2.invoiceId))

      // Draft a payout for MARCH only.
      const payout = await createPayout(
        tx,
        {
          specialistId,
          periodStart: new Date('2026-03-01'),
          periodEnd: new Date('2026-03-31'),
        },
        userId
      )
      expect(Number(payout.grossAmount)).toBe(20)

      // M2: only the March commission is stamped with this payout's id.
      const marchCommission = await tx.query.specialistCommissions.findFirst({
        where: eq(specialistCommissions.invoiceId, inv1.invoiceId),
      })
      const mayCommission = await tx.query.specialistCommissions.findFirst({
        where: eq(specialistCommissions.invoiceId, inv2.invoiceId),
      })
      expect(marchCommission?.payoutId).toBe(payout.id)
      expect(mayCommission?.payoutId).toBeNull()

      // Post the March payout.
      await postPayout(tx, payout.id, { userId, method: 'cash' })

      // C6: only the March commission is settled; May stays payable and
      // un-bundled, ready for its own payout.
      const marchAfter = await tx.query.specialistCommissions.findFirst({
        where: eq(specialistCommissions.invoiceId, inv1.invoiceId),
      })
      const mayAfter = await tx.query.specialistCommissions.findFirst({
        where: eq(specialistCommissions.invoiceId, inv2.invoiceId),
      })
      expect(marchAfter?.status).toBe('paid')
      expect(mayAfter?.status).toBe('payable')
      expect(mayAfter?.payoutId).toBeNull()
    })
  })

  it('createPayout will not double-bundle a commission already on a payout', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const revAcct = await accountIdByCode(tx, '4100')
      const specialistId = await makeSpecialist(tx, { commissionRate: 10, whtRate: 0 })

      const inv = await makeDraftInvoice(tx, {
        patientId,
        userId,
        amount: 200,
        revenueAccountId: revAcct,
        specialistId,
        commissionRate: 10,
      })
      await issueInvoice(tx, inv.invoiceId, userId)
      await tx
        .update(specialistCommissions)
        .set({ status: 'payable', payableAmount: 20, accruedAt: new Date('2026-03-15T10:00:00Z') })
        .where(eq(specialistCommissions.invoiceId, inv.invoiceId))

      // First payout bundles the commission.
      await createPayout(
        tx,
        { specialistId, periodStart: new Date('2026-03-01'), periodEnd: new Date('2026-03-31') },
        userId
      )

      // A second payout over the same period finds nothing un-bundled.
      await expect(
        createPayout(
          tx,
          { specialistId, periodStart: new Date('2026-03-01'), periodEnd: new Date('2026-03-31') },
          userId
        )
      ).rejects.toThrow(/no payable commissions/i)

      // The commission is still payable and stamped with the first payout.
      const c = await tx.query.specialistCommissions.findFirst({
        where: and(
          eq(specialistCommissions.invoiceId, inv.invoiceId),
          eq(specialistCommissions.status, 'payable')
        ),
      })
      expect(c?.payoutId).not.toBeNull()
    })
  })
})
