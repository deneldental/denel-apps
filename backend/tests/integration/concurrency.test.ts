/**
 * Regression tests for C3 / H6 — row locks prevent lost updates on the
 * balance-bearing rows.
 *
 * These are the only finance tests that genuinely need two *concurrent*
 * transactions to see the same committed rows, so they use
 * `withCommittedFixtures` (commit, race, then delete exactly what was created)
 * rather than the `withRollback` sandbox.
 *
 *  - C3: two payments racing the same invoice. Pre-fix both read balance 200,
 *    both post, and the invoice balance lands at -200 (a classic lost update).
 *    The fix `lockInvoice`s the row + re-validates the allocation at post time,
 *    so the loser is rejected.
 *  - H6: two `applyCreditToInvoice` calls racing the same payment's unallocated
 *    credit. Pre-fix both read `unallocated = 200` and both apply, moving 400
 *    out of a 200 credit. The fix `lockPayment`s the row so the second sees
 *    `unallocated = 0` and is rejected.
 */

import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { invoices, payments } from '../../src/db/schema'
import { issueInvoice } from '../../src/lib/invoice-service'
import {
  applyCreditToInvoice,
  createDraftPayment,
  postPayment,
} from '../../src/lib/payment-service'
import {
  accountIdByCode,
  anyUserId,
  makeDraftInvoice,
  makePatient,
  sweepLeakedFixtures,
  withCommittedFixtures,
} from './_fixtures'
import { noDb } from './_setup'

describe.skipIf(noDb)('concurrent posting — row locks prevent lost updates [C3/H6]', () => {
  // These tests commit fixtures and clean them in a `finally`; a timeout-aborted
  // prior run can leak. Sweep before starting so each run is deterministic.
  beforeAll(async () => {
    if (!noDb) await sweepLeakedFixtures()
  })

  it('two payments racing the same invoice cannot both post and overdraw it [C3]', async () => {
    await withCommittedFixtures(
      async (db) => ({ patientId: await makePatient(db, 'IT C3 Patient') }),
      async ({ db, patientId, trackEntry }) => {
        const userId = await anyUserId(db)
        const revAcct = await accountIdByCode(db, '4100')
        const { invoiceId } = await makeDraftInvoice(db, {
          patientId,
          userId,
          amount: 200,
          revenueAccountId: revAcct,
        })
        const issued = await issueInvoice(db, invoiceId, userId)
        trackEntry(issued.journalEntry.id)

        // Two draft payments, each fully allocating GHS 200 to the SAME invoice.
        // The invoice balance is only 200 — at most one may post.
        const p1 = await createDraftPayment(
          db,
          {
            patientId,
            amount: 200,
            method: 'cash',
            allocations: [{ targetType: 'invoice', targetId: invoiceId, amount: 200 }],
          },
          userId
        )
        const p2 = await createDraftPayment(
          db,
          {
            patientId,
            amount: 200,
            method: 'cash',
            allocations: [{ targetType: 'invoice', targetId: invoiceId, amount: 200 }],
          },
          userId
        )

        const results = await Promise.allSettled([
          postPayment(db, p1.payment.id, userId),
          postPayment(db, p2.payment.id, userId),
        ])
        for (const r of results) {
          if (r.status === 'fulfilled') trackEntry(r.value.journalEntry.id)
        }

        const fulfilled = results.filter((r) => r.status === 'fulfilled')
        const rejected = results.filter((r) => r.status === 'rejected')

        // Exactly one posts; the other is rejected by the post-time re-check
        // once the row lock serialized them. Pre-fix BOTH posted.
        expect(fulfilled).toHaveLength(1)
        expect(rejected).toHaveLength(1)

        const inv = await db.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) })
        // Pre-fix this landed at -200 (lost update).
        expect(Number(inv?.balance)).toBe(0)
        expect(Number(inv?.paidAmount)).toBe(200)
      }
    )
  })

  it('two apply-credit calls racing the same payment cannot both consume its credit [H6]', async () => {
    await withCommittedFixtures(
      async (db) => ({ patientId: await makePatient(db, 'IT H6 Patient') }),
      async ({ db, patientId, trackEntry }) => {
        const userId = await anyUserId(db)
        const revAcct = await accountIdByCode(db, '4100')

        // Two issued invoices, GHS 200 each.
        const invA = await makeDraftInvoice(db, {
          patientId,
          userId,
          amount: 200,
          revenueAccountId: revAcct,
        })
        const invB = await makeDraftInvoice(db, {
          patientId,
          userId,
          amount: 200,
          revenueAccountId: revAcct,
        })
        trackEntry((await issueInvoice(db, invA.invoiceId, userId)).journalEntry.id)
        trackEntry((await issueInvoice(db, invB.invoiceId, userId)).journalEntry.id)

        // One posted payment carrying GHS 200 of *unallocated* credit.
        const draft = await createDraftPayment(
          db,
          { patientId, amount: 200, method: 'cash' },
          userId
        )
        const posted = await postPayment(db, draft.payment.id, userId)
        trackEntry(posted.journalEntry.id)
        const paymentId = posted.payment.id

        // Race two apply-credit calls, each trying to spend the full 200.
        const results = await Promise.allSettled([
          applyCreditToInvoice(db, paymentId, invA.invoiceId, 200, userId),
          applyCreditToInvoice(db, paymentId, invB.invoiceId, 200, userId),
        ])
        for (const r of results) {
          if (r.status === 'fulfilled') trackEntry(r.value.journalEntry.id)
        }

        const fulfilled = results.filter((r) => r.status === 'fulfilled')
        const rejected = results.filter((r) => r.status === 'rejected')

        // Exactly one apply-credit succeeds; the other sees no credit left.
        expect(fulfilled).toHaveLength(1)
        expect(rejected).toHaveLength(1)

        const pay = await db.query.payments.findFirst({ where: eq(payments.id, paymentId) })
        // Pre-fix: allocated 400 / unallocated -200 — 400 moved out of a 200 credit.
        expect(Number(pay?.allocatedAmount)).toBe(200)
        expect(Number(pay?.unallocatedAmount)).toBe(0)
      }
    )
  })
})
