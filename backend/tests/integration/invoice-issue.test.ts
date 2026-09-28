/**
 * Regression test for M9 — `issueInvoice` zero-subtotal line assertion.
 *
 * The bug: the JE-building loop did `if (lineSubtotal.isZero()) continue` — it
 * silently dropped a zero-subtotal line from the journal entry. But the FIRST
 * loop summed `tax_total` / `total` from *every* line, including that one. A
 * line with zero subtotal but non-zero tax/total therefore left the invoice
 * header and its journal entry describing two different documents.
 *
 * The fix: a zero-subtotal line must also carry zero discount/tax/total, or
 * `issueInvoice` rejects it.
 */

import { describe, expect, it } from 'vitest'
import { invoiceLines } from '../../src/db/schema'
import { issueInvoice } from '../../src/lib/invoice-service'
import { accountIdByCode, anyUserId, makeDraftInvoice, makePatient } from './_fixtures'
import { expectRejection, noDb, withRollback } from './_setup'

describe.skipIf(noDb)('issueInvoice — zero-subtotal line guard [M9]', () => {
  it('rejects a zero-subtotal line that carries non-zero tax', async () => {
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

      // A malformed second line: zero subtotal, but it still carries tax. The
      // header-totals loop would count its tax; the JE-building loop would skip
      // the line entirely.
      await tx.insert(invoiceLines).values({
        invoiceId,
        lineNumber: 2,
        description: 'IT malformed zero-subtotal line',
        quantity: 1,
        unitPrice: 0,
        lineSubtotal: 0,
        lineAfterDiscount: 0,
        taxAmount: 5,
        lineTotal: 5,
        revenueAccountId: revAcct,
      })

      await issueInvoice(tx, invoiceId, userId)
    }, /zero subtotal/i)
    expect(err.message).toMatch(/zero subtotal/i)
  })

  it('still issues a clean invoice whose only line has a positive subtotal', async () => {
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
      const { invoice, journalEntry } = await issueInvoice(tx, invoiceId, userId)
      expect(invoice.status).toBe('issued')
      expect(Number(invoice.total)).toBe(200)
      const debit = journalEntry.lines.reduce((s, l) => s + Number(l.debit), 0)
      const credit = journalEntry.lines.reduce((s, l) => s + Number(l.credit), 0)
      expect(debit).toBeCloseTo(credit, 2)
      expect(debit).toBeCloseTo(200, 2)
    })
  })
})
