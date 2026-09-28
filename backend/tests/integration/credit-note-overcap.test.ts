/**
 * Regression test for H10 — `postCreditNote` over-cap.
 *
 * The bug: a credit note can be worth more than the invoice's *outstanding
 * balance* — the invoice was already partly or fully paid. `postCreditNote`
 * credited the whole credit-note amount to AR (1200) regardless, which drove
 * the patient's AR sub-ledger negative and drifted it from the invoice's
 * actual outstanding balance.
 *
 * The fix: only the balance-covering portion settles AR; the excess is the
 * patient's money back, so it is credited to 2200 Patient Deposits (their
 * wallet) instead.
 */

import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { patientWallets } from '../../src/db/schema'
import { createDraftCreditNote, postCreditNote } from '../../src/lib/credit-note-service'
import { issueInvoice } from '../../src/lib/invoice-service'
import { createDraftPayment, postPayment } from '../../src/lib/payment-service'
import { accountIdByCode, anyUserId, makeDraftInvoice, makePatient } from './_fixtures'
import { noDb, withRollback } from './_setup'

describe.skipIf(noDb)('postCreditNote — over-cap routes excess to deposits [H10]', () => {
  it('a credit note larger than the outstanding balance credits the excess to the wallet', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const revAcct = await accountIdByCode(tx, '4100')

      // Invoice for 100, of which the patient has already paid 60 → balance 40.
      const { invoiceId } = await makeDraftInvoice(tx, {
        patientId,
        userId,
        amount: 100,
        revenueAccountId: revAcct,
      })
      await issueInvoice(tx, invoiceId, userId)
      const draft = await createDraftPayment(
        tx,
        {
          patientId,
          amount: 60,
          method: 'cash',
          allocations: [{ targetType: 'invoice', targetId: invoiceId, amount: 60 }],
        },
        userId
      )
      await postPayment(tx, draft.payment.id, userId)

      // A full 100 credit note — 60 more than the 40 outstanding.
      const cn = await createDraftCreditNote(
        tx,
        { invoiceId, reason: 'goodwill', amount: 100 },
        userId
      )
      const { journalEntry } = await postCreditNote(tx, cn.id, userId, {
        includeTaxReversal: false,
      })

      // The 60 excess landed in the patient's deposit wallet — pre-fix the
      // wallet was never touched and the whole 100 was credited to AR.
      const wallet = await tx.query.patientWallets.findFirst({
        where: eq(patientWallets.patientId, patientId),
      })
      expect(Number(wallet?.creditBalance ?? 0)).toBe(60)

      // The invoice is settled, not driven negative.
      const inv = await tx.query.invoices.findFirst({
        where: (i, { eq: e }) => e(i.id, invoiceId),
      })
      expect(Number(inv?.balance)).toBe(0)
      expect(inv?.status).toBe('paid')

      // The journal entry is balanced and splits AR (40) + Deposits (60).
      const debit = journalEntry.lines.reduce((s, l) => s + Number(l.debit), 0)
      const credit = journalEntry.lines.reduce((s, l) => s + Number(l.credit), 0)
      expect(debit).toBeCloseTo(credit, 2)
      expect(debit).toBeCloseTo(100, 2)
    })
  })

  it('a credit note within the outstanding balance still credits AR only', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const revAcct = await accountIdByCode(tx, '4100')

      const { invoiceId } = await makeDraftInvoice(tx, {
        patientId,
        userId,
        amount: 100,
        revenueAccountId: revAcct,
      })
      await issueInvoice(tx, invoiceId, userId)

      // No payment — full balance outstanding. A 30 credit note fits entirely.
      const cn = await createDraftCreditNote(
        tx,
        { invoiceId, reason: 'discount', amount: 30 },
        userId
      )
      await postCreditNote(tx, cn.id, userId, { includeTaxReversal: false })

      const wallet = await tx.query.patientWallets.findFirst({
        where: eq(patientWallets.patientId, patientId),
      })
      // Nothing went to deposits — it all settled AR.
      expect(Number(wallet?.creditBalance ?? 0)).toBe(0)

      const inv = await tx.query.invoices.findFirst({
        where: (i, { eq: e }) => e(i.id, invoiceId),
      })
      expect(Number(inv?.balance)).toBe(70)
    })
  })
})
