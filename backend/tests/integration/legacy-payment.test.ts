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
 */

import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { invoices, paymentPlans, payments } from '../../src/db/schema'
import { issueInvoice } from '../../src/lib/invoice-service'
import { recordLegacyPayment } from '../../src/lib/payment-service'
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

      // The payment is GL-visible now.
      expect(result.payment.journalEntryId).not.toBeNull()
      expect(result.payment.status).toBe('posted')
      expect(result.targetInvoiceId).toBe(invoiceId)

      // The journal entry is balanced.
      const debit = result.journalEntry.lines.reduce((s, l) => s + Number(l.debit), 0)
      const credit = result.journalEntry.lines.reduce((s, l) => s + Number(l.credit), 0)
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
      expect(result.payment.journalEntryId).not.toBeNull()

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
      expect(result.payment.journalEntryId).not.toBeNull()
      expect(result.targetInvoiceId).toBeNull()
      expect(Number(result.payment.unallocatedAmount)).toBe(75)
      expect(Number(result.payment.allocatedAmount)).toBe(0)
    })
  })
})
