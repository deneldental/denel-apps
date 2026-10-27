/**
 * Regression test for C4 — the legacy `POST /api/payments` path was
 * GL-invisible.
 *
 * The bug: the legacy route raw-INSERTed a `status = 'posted'` payment with no
 * journal entry. The cash receipt never reached the General Ledger, so cash
 * and AR drifted permanently — and nothing flagged it, because the payment row
 * itself looked complete.
 *
 * The fix: the route now delegates to `recordLegacyPayment`, which runs the
 * same request shape through the Phase-3 service so every payment writes a
 * balanced journal entry.
 *
 * The first test documents the bug (a raw-insert posted payment has no JE);
 * the rest prove the fix.
 *
 * G03 (Step 10) — one payment may be split across several methods (`sources`): one
 * `payments` row per method, siblings sharing `payment_group_id`, each posted on its own to
 * its method's channel account, all in ONE transaction. See the second `describe`.
 */

import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import {
  invoices,
  patientWallets,
  paymentAllocations,
  paymentMethods,
  paymentPlans,
  payments,
} from '../../src/db/schema'
import type { PostedEntry } from '../../src/lib/gl-service'
import { issueInvoice } from '../../src/lib/invoice-service'
import { postRefund, recordLegacyPayment, reversePayment } from '../../src/lib/payment-service'
import { MAX_PAYMENT_SOURCES } from '../../src/lib/payment-sources'
import { accountIdByCode, anyUserId, makeDraftInvoice, makePatient } from './_fixtures'
import { noDb, withRollback } from './_setup'

describe.skipIf(noDb)('legacy POST /api/payments — GL visibility [C4]', () => {
  it('documents the bug: a raw-inserted posted payment has no journal entry', async () => {
    await withRollback(async (tx) => {
      const patientId = await makePatient(tx)
      // This is what the legacy route did — a bare insert, status 'posted',
      // journal_entry_id left null. The payment looks complete but the GL never
      // saw the cash. (The amount split must still satisfy the R3
      // `payments_amount_split_check` constraint — the legacy route did set
      // allocated/unallocated; it just never wrote a journal entry.)
      const [raw] = await tx
        .insert(payments)
        .values({
          patientId,
          amount: 200,
          allocatedAmount: 0,
          unallocatedAmount: 200,
          method: 'cash',
          status: 'posted',
        })
        .returning()
      expect(raw.status).toBe('posted')
      expect(raw.journalEntryId).toBeNull()
    })
  })

  it('recordLegacyPayment writes a balanced journal entry and settles the invoice', async () => {
    await withRollback(async (tx) => {
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

      const result = await recordLegacyPayment(
        tx,
        { patientId, amount: 200, method: 'cash', invoiceId },
        userId
      )
      const [{ payment, journalEntry }] = result.payments

      // The payment is GL-visible now.
      expect(payment.journalEntryId).not.toBeNull()
      expect(payment.status).toBe('posted')
      expect(result.targetInvoiceId).toBe(invoiceId)

      // The journal entry is balanced.
      const debit = journalEntry.lines.reduce((s, l) => s + Number(l.debit), 0)
      const credit = journalEntry.lines.reduce((s, l) => s + Number(l.credit), 0)
      expect(debit).toBeCloseTo(credit, 2)
      expect(debit).toBeCloseTo(200, 2)

      // The allocation settled the invoice.
      const inv = await tx.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) })
      expect(Number(inv?.balance)).toBe(0)
      expect(Number(inv?.paidAmount)).toBe(200)
    })
  })

  it('routes a plan payment to the plan master invoice', async () => {
    await withRollback(async (tx) => {
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

      // No explicit invoiceId — only a payment plan whose master is `invoiceId`.
      const [plan] = await tx
        .insert(paymentPlans)
        .values({
          patientId,
          type: 'flexible',
          originalAmount: 200,
          totalAmount: 200,
          startDate: new Date(),
          status: 'activated',
          invoiceId,
          scheduleType: 'flexible',
        })
        .returning()

      const result = await recordLegacyPayment(
        tx,
        { patientId, amount: 120, method: 'cash', paymentPlanId: plan.id },
        userId
      )
      expect(result.targetInvoiceId).toBe(invoiceId)
      expect(result.payments[0].payment.journalEntryId).not.toBeNull()

      const inv = await tx.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) })
      expect(Number(inv?.balance)).toBe(80)
    })
  })

  it('an unallocated legacy payment still posts a journal entry (lands in deposits)', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)

      const result = await recordLegacyPayment(
        tx,
        { patientId, amount: 75, method: 'cash' },
        userId
      )
      const [{ payment }] = result.payments
      expect(payment.journalEntryId).not.toBeNull()
      expect(result.targetInvoiceId).toBeNull()
      expect(Number(payment.unallocatedAmount)).toBe(75)
      expect(Number(payment.allocatedAmount)).toBe(0)
    })
  })
})

// ── G03 — one payment split across several methods ─────────────────────────────────────────────

/** An issued invoice for `amount` pesewas, ready to be paid. */
async function issuedInvoice(tx: DB, patientId: string, userId: string, amount: number) {
  const revAcct = await accountIdByCode(tx, '4100')
  const { invoiceId } = await makeDraftInvoice(tx, {
    patientId,
    userId,
    amount,
    revenueAccountId: revAcct,
  })
  await issueInvoice(tx, invoiceId, userId)
  return invoiceId
}

/** The patient's unapplied credit (the deposits sub-ledger), in pesewas. */
async function creditOf(tx: DB, patientId: string): Promise<number> {
  const wallet = await tx.query.patientWallets.findFirst({
    where: eq(patientWallets.patientId, patientId),
  })
  return Number(wallet?.creditBalance ?? 0)
}

/** What an entry debits on one account. */
const debitedTo = (entry: PostedEntry, accountId: string) =>
  entry.lines.filter((l) => l.accountId === accountId).reduce((s, l) => s + Number(l.debit), 0)

const isBalanced = (entry: PostedEntry) =>
  entry.lines.reduce((s, l) => s + Number(l.debit), 0) ===
  entry.lines.reduce((s, l) => s + Number(l.credit), 0)

async function paymentsOf(tx: DB, patientId: string) {
  return tx.select().from(payments).where(eq(payments.patientId, patientId))
}

describe.skipIf(noDb)('G03 — a payment split across several methods (sources)', () => {
  it('a single payment (the one-method shape) is one row with no group id', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)

      const result = await recordLegacyPayment(
        tx,
        { patientId, amount: 5000, method: 'cash' },
        userId
      )

      expect(result.payments).toHaveLength(1)
      expect(result.payments[0].payment.paymentGroupId).toBeNull()
    })
  })

  it('one entry in sources is also a single payment with no group id', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)

      const result = await recordLegacyPayment(
        tx,
        { patientId, sources: [{ method: 'card', amount: 5000 }] },
        userId
      )

      expect(result.payments).toHaveLength(1)
      expect(result.payments[0].payment.method).toBe('card')
      expect(result.payments[0].payment.paymentGroupId).toBeNull()
    })
  })

  it('two methods post two payments in one group, each to its own channel account', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const cashAccount = await accountIdByCode(tx, '1000')
      const cardAccount = await accountIdByCode(tx, '1030')

      const result = await recordLegacyPayment(
        tx,
        {
          patientId,
          sources: [
            { method: 'cash', amount: 30000 },
            { method: 'card', amount: 20000 },
          ],
        },
        userId
      )

      const [cash, card] = result.payments
      expect(cash.payment.paymentGroupId).toBeTruthy()
      expect(card.payment.paymentGroupId).toBe(cash.payment.paymentGroupId)
      expect(cash.payment.method).toBe('cash')
      expect(card.payment.method).toBe('card')
      expect(Number(cash.payment.amount)).toBe(30000)
      expect(Number(card.payment.amount)).toBe(20000)
      expect(cash.payment.id).not.toBe(card.payment.id)
      expect(cash.payment.status).toBe('posted')
      expect(card.payment.status).toBe('posted')

      // Each method's money lands in its own account, in an entry of its own.
      expect(cash.journalEntry.id).not.toBe(card.journalEntry.id)
      expect(debitedTo(cash.journalEntry, cashAccount)).toBe(30000)
      expect(debitedTo(card.journalEntry, cardAccount)).toBe(20000)
      expect(isBalanced(cash.journalEntry)).toBe(true)
      expect(isBalanced(card.journalEntry)).toBe(true)

      // With nothing to pay down it is all unapplied patient credit, as a one-time receipt always was.
      expect(result.targetInvoiceId).toBeNull()
      expect(Number(cash.payment.unallocatedAmount)).toBe(30000)
      expect(Number(card.payment.unallocatedAmount)).toBe(20000)
      expect(await creditOf(tx, patientId)).toBe(50000)

      // What is stored is what was returned.
      const stored = await paymentsOf(tx, patientId)
      expect(stored).toHaveLength(2)
      expect(new Set(stored.map((p) => p.paymentGroupId)).size).toBe(1)
    })
  })

  it('takes the allocation to an invoice source by source, in the order given', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const invoiceId = await issuedInvoice(tx, patientId, userId, 50000)

      const result = await recordLegacyPayment(
        tx,
        {
          patientId,
          invoiceId,
          sources: [
            { method: 'cash', amount: 30000 },
            { method: 'card', amount: 20000 },
          ],
        },
        userId
      )

      expect(result.targetInvoiceId).toBe(invoiceId)
      const [cash, card] = result.payments
      expect(Number(cash.payment.allocatedAmount)).toBe(30000)
      expect(Number(card.payment.allocatedAmount)).toBe(20000)
      const inv = await tx.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) })
      expect(Number(inv?.balance)).toBe(0)
      expect(Number(inv?.paidAmount)).toBe(50000)
      expect(await creditOf(tx, patientId)).toBe(0)
    })
  })

  it('stops allocating at the invoice balance and keeps the rest as credit', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const invoiceId = await issuedInvoice(tx, patientId, userId, 25000)

      const result = await recordLegacyPayment(
        tx,
        {
          patientId,
          invoiceId,
          sources: [
            { method: 'cash', amount: 20000 },
            { method: 'card', amount: 20000 },
          ],
        },
        userId
      )

      const [cash, card] = result.payments
      // 250.00 owed: the cash covers 200.00, the card the last 50.00, and 150.00 of the card is credit.
      expect(Number(cash.payment.allocatedAmount)).toBe(20000)
      expect(Number(cash.payment.unallocatedAmount)).toBe(0)
      expect(Number(card.payment.allocatedAmount)).toBe(5000)
      expect(Number(card.payment.unallocatedAmount)).toBe(15000)
      const inv = await tx.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) })
      expect(Number(inv?.balance)).toBe(0)
      expect(await creditOf(tx, patientId)).toBe(15000)
    })
  })

  it('a method that comes after the invoice is already covered allocates nothing', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const invoiceId = await issuedInvoice(tx, patientId, userId, 10000)

      const result = await recordLegacyPayment(
        tx,
        {
          patientId,
          invoiceId,
          sources: [
            { method: 'cash', amount: 10000 },
            { method: 'card', amount: 10000 },
          ],
        },
        userId
      )

      const [cash, card] = result.payments
      expect(Number(cash.payment.allocatedAmount)).toBe(10000)
      expect(Number(card.payment.allocatedAmount)).toBe(0)
      expect(Number(card.payment.unallocatedAmount)).toBe(10000)
      const allocations = await tx
        .select()
        .from(paymentAllocations)
        .where(eq(paymentAllocations.paymentId, card.payment.id))
      expect(allocations).toHaveLength(0)
      expect(await creditOf(tx, patientId)).toBe(10000)
    })
  })

  describe('against a payment plan', () => {
    async function planOf(tx: DB, patientId: string, userId: string) {
      const invoiceId = await issuedInvoice(tx, patientId, userId, 50000)
      const [plan] = await tx
        .insert(paymentPlans)
        .values({
          patientId,
          type: 'flexible',
          originalAmount: 50000,
          totalAmount: 50000,
          startDate: new Date(),
          status: 'activated',
          invoiceId,
          scheduleType: 'flexible',
        })
        .returning()
      return { invoiceId, planId: plan.id }
    }

    it('tags every method of a plan payment with the plan and pays down its master invoice', async () => {
      await withRollback(async (tx) => {
        const userId = await anyUserId(tx)
        const patientId = await makePatient(tx)
        const { invoiceId, planId } = await planOf(tx, patientId, userId)

        const result = await recordLegacyPayment(
          tx,
          {
            patientId,
            paymentPlanId: planId,
            sources: [
              { method: 'cash', amount: 10000 },
              { method: 'card', amount: 15000 },
            ],
          },
          userId
        )

        expect(result.targetInvoiceId).toBe(invoiceId)
        for (const { payment } of result.payments) expect(payment.paymentPlanId).toBe(planId)
        const inv = await tx.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) })
        expect(Number(inv?.balance)).toBe(25000)
      })
    })

    it('tags a method with the plan only when it pays that plan’s invoice', async () => {
      await withRollback(async (tx) => {
        const userId = await anyUserId(tx)
        const patientId = await makePatient(tx)
        const { invoiceId, planId } = await planOf(tx, patientId, userId)

        // Paid by invoice, not by plan: the cash settles the 500.00 master, the card has nothing left to pay.
        const result = await recordLegacyPayment(
          tx,
          {
            patientId,
            invoiceId,
            sources: [
              { method: 'cash', amount: 50000 },
              { method: 'card', amount: 10000 },
            ],
          },
          userId
        )

        const [cash, card] = result.payments
        expect(cash.payment.paymentPlanId).toBe(planId)
        // It paid no plan invoice, so it is one-time money and carries no plan.
        expect(card.payment.paymentPlanId).toBeNull()
      })
    })
  })

  it('keeps the legacy columns on every row (what it was for, once), with a method’s own reference winning', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const treatments = [{ treatmentId: 'svc-1', name: 'Scaling', amount: 50000 }]

      const result = await recordLegacyPayment(
        tx,
        {
          patientId,
          description: 'Scaling',
          transactionId: 'TX-1',
          treatments,
          sendNotification: true,
          sources: [
            { method: 'cash', amount: 30000, externalReference: 'REF-A' },
            { method: 'card', amount: 20000 },
          ],
        },
        userId
      )

      // What the payment was for is the event's itemisation: stored once, on the first payment, so
      // nothing that adds `treatments` up over payments counts it once per method (review §8.16).
      expect(result.payments.map(({ payment }) => payment.treatments)).toEqual([treatments, []])
      for (const { payment } of result.payments) {
        expect(payment.transactionId).toBe('TX-1')
        expect(payment.sendNotification).toBe(true)
        expect(payment.description).toBe('Scaling')
      }
      expect(result.payments[0].payment.externalReference).toBe('REF-A')
      expect(result.payments[1].payment.externalReference).toBe('TX-1')
    })
  })

  it('the one-method shape still prefers the transaction id as the reference', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)

      const result = await recordLegacyPayment(
        tx,
        {
          patientId,
          amount: 5000,
          method: 'cash',
          transactionId: 'TX-2',
          externalReference: 'EXT-2',
        },
        userId
      )

      expect(result.payments[0].payment.externalReference).toBe('TX-2')
    })
  })

  describe('what it refuses', () => {
    it('an unknown payment method, with nothing recorded for the methods before it', async () => {
      await withRollback(async (tx) => {
        const userId = await anyUserId(tx)
        const patientId = await makePatient(tx)

        await expect(
          recordLegacyPayment(
            tx,
            {
              patientId,
              sources: [
                { method: 'cash', amount: 10000 },
                { method: 'banana' as never, amount: 10000 },
              ],
            },
            userId
          )
        ).rejects.toThrow(/unknown payment method.*banana/i)
        expect(await paymentsOf(tx, patientId)).toHaveLength(0)
      })
    })

    // Review §8.16: payments.amount is a 32-bit integer of pesewas. A larger figure reached the
    // database and came back as a vague failure (or its text); it is refused with a sentence first.
    it.each([
      ['the one-method shape', { amount: 2_147_483_648, method: 'cash' as const }],
      [
        'one method of a split',
        {
          sources: [
            { method: 'cash' as const, amount: 100 },
            { method: 'card' as const, amount: 2_147_483_648 },
          ],
        },
      ],
    ])('an amount the database cannot hold, in %s, with nothing recorded', async (_what, shape) => {
      await withRollback(async (tx) => {
        const userId = await anyUserId(tx)
        const patientId = await makePatient(tx)

        await expect(recordLegacyPayment(tx, { patientId, ...shape }, userId)).rejects.toThrow(
          /a payment amount must be at most GHS 21,474,836\.47/
        )
        expect(await paymentsOf(tx, patientId)).toHaveLength(0)
      })
    })

    // D23 (decided 2026-10-27): the one-method shape no longer posts a method nobody knows to Cash.
    it('an unknown payment method on the one-method shape, instead of posting it to Cash', async () => {
      await withRollback(async (tx) => {
        const userId = await anyUserId(tx)
        const patientId = await makePatient(tx)

        await expect(
          recordLegacyPayment(tx, { patientId, amount: 10000, method: 'banana' as never }, userId)
        ).rejects.toThrow(/unknown payment method.*banana/i)
        expect(await paymentsOf(tx, patientId)).toHaveLength(0)
      })
    })

    it('a standard method an administrator has switched off, on the one-method shape too', async () => {
      await withRollback(async (tx) => {
        const userId = await anyUserId(tx)
        const patientId = await makePatient(tx)
        await tx.insert(paymentMethods).values({ name: 'cheque', isActive: false })

        await expect(
          recordLegacyPayment(tx, { patientId, amount: 10000, method: 'cheque' }, userId)
        ).rejects.toThrow(/unknown payment method.*cheque/i)
        expect(await paymentsOf(tx, patientId)).toHaveLength(0)
      })
    })

    it('a method an administrator has switched off in Settings', async () => {
      await withRollback(async (tx) => {
        const userId = await anyUserId(tx)
        const patientId = await makePatient(tx)
        await tx.insert(paymentMethods).values({ name: 'it_retired', isActive: false })

        await expect(
          recordLegacyPayment(
            tx,
            { patientId, sources: [{ method: 'it_retired' as never, amount: 10000 }] },
            userId
          )
        ).rejects.toThrow(/unknown payment method/i)
      })
    })

    it('a standard method an administrator has switched off, too', async () => {
      await withRollback(async (tx) => {
        const userId = await anyUserId(tx)
        const patientId = await makePatient(tx)
        // 'cheque' is one of the built-in slugs, but Settings has retired it.
        await tx.insert(paymentMethods).values({ name: 'cheque', isActive: false })

        await expect(
          recordLegacyPayment(
            tx,
            { patientId, sources: [{ method: 'cheque', amount: 10000 }] },
            userId
          )
        ).rejects.toThrow(/unknown payment method.*cheque/i)
      })
    })

    it('accepts a method added in Settings and posts it to the account set for it', async () => {
      await withRollback(async (tx) => {
        const userId = await anyUserId(tx)
        const patientId = await makePatient(tx)
        const momoAccount = await accountIdByCode(tx, '1020')
        await tx
          .insert(paymentMethods)
          .values({ name: 'it_pos', isActive: true, glAccountCode: '1020' })

        const result = await recordLegacyPayment(
          tx,
          { patientId, sources: [{ method: 'it_pos' as never, amount: 12000 }] },
          userId
        )

        expect(result.payments[0].payment.method).toBe('it_pos')
        expect(debitedTo(result.payments[0].journalEntry, momoAccount)).toBe(12000)
      })
    })

    it('a failure on a later method, leaving nothing recorded for the earlier ones', async () => {
      await withRollback(async (tx) => {
        const userId = await anyUserId(tx)
        const patientId = await makePatient(tx)
        const invoiceId = await issuedInvoice(tx, patientId, userId, 30000)

        // The patient has no credit. The cash posts first and pays 100.00 of the invoice; the
        // wallet then asks for 200.00 it does not hold, so it is refused after the cash was posted.
        await expect(
          recordLegacyPayment(
            tx,
            {
              patientId,
              invoiceId,
              sources: [
                { method: 'cash', amount: 10000 },
                { method: 'wallet', amount: 20000 },
              ],
            },
            userId
          )
        ).rejects.toThrow(/exceeds available credit/i)
        expect(await paymentsOf(tx, patientId)).toHaveLength(0)
        expect(await creditOf(tx, patientId)).toBe(0)
      })
    })

    // Review §8.16: wallet credit spent on nothing. A payment's unallocated part becomes wallet
    // credit, so a wallet payment that pays no invoice takes the credit out and puts it straight
    // back: no money moves, yet a posted payment and a receipt "paid by wallet credit" appear.
    describe('the wallet pays an invoice or nothing', () => {
      it('refuses a one-time payment from the wallet, and says why', async () => {
        await withRollback(async (tx) => {
          const userId = await anyUserId(tx)
          const patientId = await makePatient(tx)
          await recordLegacyPayment(tx, { patientId, amount: 50000, method: 'cash' }, userId)

          await expect(
            recordLegacyPayment(tx, { patientId, amount: 20000, method: 'wallet' }, userId)
          ).rejects.toThrow(/wallet credit can only pay an invoice/i)
          await expect(
            recordLegacyPayment(
              tx,
              {
                patientId,
                sources: [
                  { method: 'cash', amount: 10000 },
                  { method: 'wallet', amount: 20000 },
                ],
              },
              userId
            )
          ).rejects.toThrow(/wallet credit can only pay an invoice/i)
          // Only the cash payment that made the credit exists, and the credit is untouched.
          expect(await paymentsOf(tx, patientId)).toHaveLength(1)
          expect(await creditOf(tx, patientId)).toBe(50000)
        })
      })

      it('refuses the part of a wallet payment that would be left over after the invoice', async () => {
        await withRollback(async (tx) => {
          const userId = await anyUserId(tx)
          const patientId = await makePatient(tx)
          await recordLegacyPayment(tx, { patientId, amount: 50000, method: 'cash' }, userId)
          const invoiceId = await issuedInvoice(tx, patientId, userId, 20000)

          await expect(
            recordLegacyPayment(
              tx,
              { patientId, invoiceId, amount: 30000, method: 'wallet' },
              userId
            )
          ).rejects.toThrow(/wallet credit can only pay an invoice/i)
        })
      })

      it('still takes a wallet payment that pays an invoice', async () => {
        await withRollback(async (tx) => {
          const userId = await anyUserId(tx)
          const patientId = await makePatient(tx)
          await recordLegacyPayment(tx, { patientId, amount: 50000, method: 'cash' }, userId)
          const invoiceId = await issuedInvoice(tx, patientId, userId, 20000)

          const result = await recordLegacyPayment(
            tx,
            { patientId, invoiceId, amount: 20000, method: 'wallet' },
            userId
          )

          expect(result.payments[0].payment.status).toBe('posted')
          expect(await creditOf(tx, patientId)).toBe(30000)
        })
      })
    })

    it.each([
      ['no method at all', { patientId: 'p' }, /method and an amount|at least one/i],
      [
        'an empty list of methods and no single method either',
        { patientId: 'p', sources: [] },
        /method and an amount|at least one/i,
      ],
      [
        'a method with no name',
        { patientId: 'p', sources: [{ method: '', amount: 100 }] },
        /needs a method/i,
      ],
      [
        'an amount of nothing',
        { patientId: 'p', sources: [{ method: 'cash', amount: 0 }] },
        /each payment amount must be positive/i,
      ],
      [
        'a negative amount',
        { patientId: 'p', sources: [{ method: 'cash', amount: -100 }] },
        /each payment amount must be positive/i,
      ],
      [
        'an amount that is not a whole number of pesewas',
        { patientId: 'p', sources: [{ method: 'cash', amount: 100.5 }] },
        /whole number of pesewas/i,
      ],
    ])('%s', async (_what, input, message) => {
      await withRollback(async (tx) => {
        const userId = await anyUserId(tx)
        const patientId = await makePatient(tx)
        await expect(
          recordLegacyPayment(tx, { ...input, patientId } as never, userId)
        ).rejects.toThrow(message)
        expect(await paymentsOf(tx, patientId)).toHaveLength(0)
      })
    })

    it('more methods than a payment can be split across', async () => {
      await withRollback(async (tx) => {
        const userId = await anyUserId(tx)
        const patientId = await makePatient(tx)
        const tooMany = Array.from({ length: MAX_PAYMENT_SOURCES + 1 }, () => ({
          method: 'cash' as const,
          amount: 100,
        }))

        await expect(
          recordLegacyPayment(tx, { patientId, sources: tooMany }, userId)
        ).rejects.toThrow(/at most/i)
        expect(await paymentsOf(tx, patientId)).toHaveLength(0)
      })
    })
  })

  describe('reversing and refunding a split payment', () => {
    it('reversing one method reverses only that method and leaves the group in place', async () => {
      await withRollback(async (tx) => {
        const userId = await anyUserId(tx)
        const patientId = await makePatient(tx)
        const result = await recordLegacyPayment(
          tx,
          {
            patientId,
            sources: [
              { method: 'cash', amount: 30000 },
              { method: 'card', amount: 20000 },
            ],
          },
          userId
        )
        const [cash, card] = result.payments

        const { payment: reversed, reversal } = await reversePayment(tx, card.payment.id, {
          userId,
          reason: 'keyed on the wrong terminal',
        })

        expect(reversed.status).toBe('reversed')
        expect(reversal.id).not.toBe(card.journalEntry.id)
        const [cashNow] = await tx.select().from(payments).where(eq(payments.id, cash.payment.id))
        expect(cashNow.status).toBe('posted')
        // The group is untouched, so a receipt can still show both rows and say which was reversed.
        expect(reversed.paymentGroupId).toBe(cash.payment.paymentGroupId)
        expect(cashNow.paymentGroupId).toBe(cash.payment.paymentGroupId)
        // Only the card's 200.00 left the patient's credit.
        expect(await creditOf(tx, patientId)).toBe(30000)
      })
    })

    it('reversing an allocated method gives back only its share of the invoice', async () => {
      await withRollback(async (tx) => {
        const userId = await anyUserId(tx)
        const patientId = await makePatient(tx)
        const invoiceId = await issuedInvoice(tx, patientId, userId, 50000)
        const result = await recordLegacyPayment(
          tx,
          {
            patientId,
            invoiceId,
            sources: [
              { method: 'cash', amount: 30000 },
              { method: 'card', amount: 20000 },
            ],
          },
          userId
        )

        await reversePayment(tx, result.payments[1].payment.id, {
          userId,
          reason: 'wrong terminal',
        })

        const inv = await tx.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) })
        expect(Number(inv?.balance)).toBe(20000)
        expect(Number(inv?.paidAmount)).toBe(30000)
        expect(inv?.status).toBe('partially_paid')
      })
    })

    it('a refund draws on the combined credit of every method, and not beyond it', async () => {
      await withRollback(async (tx) => {
        const userId = await anyUserId(tx)
        const patientId = await makePatient(tx)
        await recordLegacyPayment(
          tx,
          {
            patientId,
            sources: [
              { method: 'cash', amount: 30000 },
              { method: 'card', amount: 20000 },
            ],
          },
          userId
        )

        // 450.00 is more than either method paid, but less than the 500.00 the patient has.
        await postRefund(tx, { patientId, amount: 45000, method: 'cash' }, userId)
        expect(await creditOf(tx, patientId)).toBe(5000)

        await expect(
          postRefund(tx, { patientId, amount: 10000, method: 'cash' }, userId)
        ).rejects.toThrow(/exceeds patient deposit balance/i)
        expect(await creditOf(tx, patientId)).toBe(5000)
      })
    })
  })
})
