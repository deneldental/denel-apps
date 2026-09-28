/**
 * Regression test for M1 — `postPayment` re-validates allocations at POST time.
 *
 * The bug: `createDraftPayment` checks each allocation against the invoice
 * balance, but `postPayment`'s allocation loop only did `findFirst` + `if
 * (!inv) continue`. So an invoice that was voided (or repriced, or paid down)
 * between draft creation and posting was happily repaid — `findFirst` still
 * found the row, the loop never re-checked its status or balance.
 *
 * The fix: the loop now `lockInvoice`s each target and re-validates it is not
 * void, belongs to the same patient, and still has enough balance.
 */

import { describe, expect, it } from 'vitest'
import { issueInvoice, voidInvoice } from '../../src/lib/invoice-service'
import { createDraftPayment, postPayment } from '../../src/lib/payment-service'
import { accountIdByCode, anyUserId, makeDraftInvoice, makePatient } from './_fixtures'
import { expectRejection, noDb } from './_setup'

describe.skipIf(noDb)('postPayment — re-validates allocations at post time [M1]', () => {
  it('rejects posting a payment allocated to an invoice voided after the draft', async () => {
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

      const { payment } = await createDraftPayment(
        tx,
        {
          patientId,
          amount: 200,
          method: 'cash',
          allocations: [{ targetType: 'invoice', targetId: invoiceId, amount: 200 }],
        },
        userId
      )

      // The invoice is voided between draft creation and posting — the
      // draft-time allocation check is now stale.
      await voidInvoice(tx, invoiceId, { userId, reason: 'IT void before post' })

      // Pre-fix this resolved (the void invoice was silently repaid); the M1
      // fix makes it reject.
      await postPayment(tx, payment.id, userId)
    }, /void/i)
    expect(err.message).toMatch(/void/i)
  })

  it('rejects a draft allocation that exceeds the invoice balance at post time', async () => {
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

      // First payment fully settles the invoice.
      const first = await createDraftPayment(
        tx,
        {
          patientId,
          amount: 200,
          method: 'cash',
          allocations: [{ targetType: 'invoice', targetId: invoiceId, amount: 200 }],
        },
        userId
      )
      // Second draft is created against the still-open invoice…
      const second = await createDraftPayment(
        tx,
        {
          patientId,
          amount: 200,
          method: 'cash',
          allocations: [{ targetType: 'invoice', targetId: invoiceId, amount: 200 }],
        },
        userId
      )
      // …but the first posts first, draining the balance to zero.
      await postPayment(tx, first.payment.id, userId)
      // The second must now be rejected — its 200 allocation exceeds the
      // invoice's post-time balance of 0.
      await postPayment(tx, second.payment.id, userId)
    }, /exceeds/i)
    expect(err.message).toMatch(/balance/i)
  })
})
