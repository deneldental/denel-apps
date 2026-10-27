/**
 * Verification for the Medium finding "Outstanding balance computed
 * independently in 3 places" (project-docs/patient-records-and-scheduling-audit.md):
 * before consolidating patients.ts's summary/ledger endpoints and
 * patient-statements.ts onto `patient_balances.arBalance` (the GL-derived
 * materialized balance patient-ar-service.ts maintains), this proves the two
 * computations actually agree — not just "the numbers happen to match today"
 * asserted once, but a real scenario exercising partial payment, full
 * payment, and multiple invoices for the same patient — against a real
 * Postgres, since this is GL/ledger arithmetic.
 *
 * Kept as a permanent regression test after the consolidation: it's the
 * "nothing enforces that they keep agreeing" gap the finding named, now
 * enforced.
 */
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { invoices } from '../../src/db/schema'
import { issueInvoice, voidInvoice } from '../../src/lib/invoice-service'
import { getBalance } from '../../src/lib/patient-ar-service'
import { createDraftPayment, postPayment } from '../../src/lib/payment-service'
import { accountIdByCode, anyUserId, makeDraftInvoice, makePatient } from './_fixtures'
import { noDb, withRollback } from './_setup'

const OUTSTANDING_STATUSES = ['issued', 'partially_paid', 'pending', 'partial', 'overdue']

/** The exact ad-hoc formula patients.ts / patient-statements.ts use today. */
function adHocOutstanding(
  rows: { status: string; amount: number; paidAmount: number; balance: number | null }[]
): number {
  const remainingOf = (inv: (typeof rows)[number]) =>
    inv.balance != null ? inv.balance : inv.amount - inv.paidAmount
  return rows
    .filter((inv) => OUTSTANDING_STATUSES.includes(inv.status))
    .reduce((sum, inv) => sum + Math.max(0, remainingOf(inv)), 0)
}

describe.skipIf(noDb)('patient_balances.arBalance vs the ad-hoc invoice sum [Medium]', () => {
  it('agree for a patient with one partially-paid and one fully-paid invoice', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const revAcct = await accountIdByCode(tx, '4100')

      const inv1 = await makeDraftInvoice(tx, {
        patientId,
        userId,
        amount: 500,
        revenueAccountId: revAcct,
      })
      await issueInvoice(tx, inv1.invoiceId, userId)
      const inv2 = await makeDraftInvoice(tx, {
        patientId,
        userId,
        amount: 300,
        revenueAccountId: revAcct,
      })
      await issueInvoice(tx, inv2.invoiceId, userId)

      // Partially pay invoice 1 (200 of 500 — leaves 300 outstanding).
      const { payment: p1 } = await createDraftPayment(
        tx,
        {
          patientId,
          amount: 200,
          method: 'cash',
          allocations: [{ targetType: 'invoice', targetId: inv1.invoiceId, amount: 200 }],
        },
        userId
      )
      await postPayment(tx, p1.id, userId)

      // Fully pay invoice 2 (300 of 300 — leaves 0 outstanding, status → paid).
      const { payment: p2 } = await createDraftPayment(
        tx,
        {
          patientId,
          amount: 300,
          method: 'cash',
          allocations: [{ targetType: 'invoice', targetId: inv2.invoiceId, amount: 300 }],
        },
        userId
      )
      await postPayment(tx, p2.id, userId)

      const rows = await tx
        .select({
          status: invoices.status,
          amount: invoices.amount,
          paidAmount: invoices.paidAmount,
          balance: invoices.balance,
        })
        .from(invoices)
        .where(eq(invoices.patientId, patientId))

      const adHoc = adHocOutstanding(rows)
      const balance = await getBalance(tx, patientId)
      const arBalance = balance ? Number(balance.arBalance) : 0

      expect(arBalance).toBe(adHoc)
      expect(adHoc).toBe(300) // sanity: 500 - 200 paid = 300 still owed; inv2 fully paid.
    })
  })

  it('still agree when one invoice is voided (reversed AR, excluded status)', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const revAcct = await accountIdByCode(tx, '4100')

      const kept = await makeDraftInvoice(tx, {
        patientId,
        userId,
        amount: 400,
        revenueAccountId: revAcct,
      })
      await issueInvoice(tx, kept.invoiceId, userId)

      const voided = await makeDraftInvoice(tx, {
        patientId,
        userId,
        amount: 600,
        revenueAccountId: revAcct,
      })
      await issueInvoice(tx, voided.invoiceId, userId)
      await voidInvoice(tx, voided.invoiceId, { userId, reason: 'IT void for balance test' })

      const rows = await tx
        .select({
          status: invoices.status,
          amount: invoices.amount,
          paidAmount: invoices.paidAmount,
          balance: invoices.balance,
        })
        .from(invoices)
        .where(eq(invoices.patientId, patientId))

      const adHoc = adHocOutstanding(rows)
      const balance = await getBalance(tx, patientId)
      const arBalance = balance ? Number(balance.arBalance) : 0

      expect(arBalance).toBe(adHoc)
      expect(adHoc).toBe(400) // the voided 600 contributes nothing to either side.
    })
  })

  // [Blocker found during verification] Archiving an invoice (POST
  // /:id/archive in invoices.ts) only sets archived/archivedAt/archivedBy —
  // it never touches the GL or calls patient-ar-service's applyDelta. The
  // ad-hoc computation explicitly excludes archived invoices
  // (`!inv.archived`); patient_balances.arBalance has no way to know an
  // invoice was archived at all. A receptionist can archive an invoice with
  // a nonzero balance today (no precondition blocks it) — patient-ledger-tab
  // 's own archive-confirmation copy promises "stops appearing in ...
  // outstanding-balance calculations", which arBalance cannot honour without
  // also being adjusted on archive/unarchive.
  it('DIVERGES when an invoice with a balance is archived — not yet safe to consolidate', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const revAcct = await accountIdByCode(tx, '4100')

      const active = await makeDraftInvoice(tx, {
        patientId,
        userId,
        amount: 400,
        revenueAccountId: revAcct,
      })
      await issueInvoice(tx, active.invoiceId, userId)

      const archived = await makeDraftInvoice(tx, {
        patientId,
        userId,
        amount: 600,
        revenueAccountId: revAcct,
      })
      await issueInvoice(tx, archived.invoiceId, userId)
      // The archive action itself: only the display flag changes, no GL entry.
      await tx
        .update(invoices)
        .set({ archived: true, archivedAt: new Date() })
        .where(eq(invoices.id, archived.invoiceId))

      const rows = await tx
        .select({
          status: invoices.status,
          amount: invoices.amount,
          paidAmount: invoices.paidAmount,
          balance: invoices.balance,
          archived: invoices.archived,
        })
        .from(invoices)
        .where(eq(invoices.patientId, patientId))

      const adHoc = adHocOutstanding(rows.filter((r) => !r.archived))
      const balance = await getBalance(tx, patientId)
      const arBalance = balance ? Number(balance.arBalance) : 0

      // This assertion documents the CURRENT (diverging) reality, not the
      // desired end state — see the finding note above.
      expect(adHoc).toBe(400) // archived 600 correctly excluded
      expect(arBalance).toBe(1000) // arBalance has no concept of "archived"
      expect(arBalance).not.toBe(adHoc)
    })
  })
})
