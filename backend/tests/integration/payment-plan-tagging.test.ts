/**
 * G07 — a payment made through the patient ledger is tied to its payment plan.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.11).
 *
 * `payments.paymentPlanId` is the tag the clinic ledger, the payments page, the period
 * reports and the receipt use to tell plan money from one-off money. Only the plan screen
 * set it. A payment taken from the patient's ledger against a plan's master invoice carried
 * allocations to that invoice but no tag, so it counted as a one-time payment everywhere
 * the tag is read and was missing from the plan's history.
 *
 * The rule (one pure function, shared with the backfill): tag a payment with a plan only
 * when EVERY allocation of the payment pays that one plan's invoices. A payment that also
 * pays an ordinary invoice, or pays two plans, or allocates nothing, stays untagged: the
 * tag is a claim about the whole payment and a wrong claim moves money between reports.
 * A tag the caller sets explicitly is kept as given.
 *
 * Runs in a rolled-back transaction against the local database.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/payment-plan-tagging.test.ts
 */
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import { invoices, payments } from '../../src/db/schema'
import { issueInvoice } from '../../src/lib/invoice-service'
import { createPlan } from '../../src/lib/payment-plan-service'
import { createDraftPayment, postPayment } from '../../src/lib/payment-service'
import { accountIdByCode, anyUserId, makeDraftInvoice, makePatient } from './_fixtures'
import { noDb, withRollback } from './_setup'

async function issuedPlan(tx: DB, patientId: string, userId: string, total = 100_000) {
  const made = await createPlan(
    tx,
    { patientId, totalAmount: total, scheduleType: 'flexible', startDate: new Date() },
    userId
  )
  await issueInvoice(tx, made.invoice.id, userId)
  return made
}

async function issuedOneTime(tx: DB, patientId: string, userId: string, amount = 50_000) {
  const { invoiceId } = await makeDraftInvoice(tx, {
    patientId,
    userId,
    amount,
    revenueAccountId: await accountIdByCode(tx, '4100'),
  })
  await issueInvoice(tx, invoiceId, userId)
  return invoiceId
}

const pay = (
  tx: DB,
  patientId: string,
  userId: string,
  amount: number,
  allocations: Array<{ targetId: string; amount: number }>,
  extra: Record<string, unknown> = {}
) =>
  createDraftPayment(
    tx,
    {
      patientId,
      amount,
      method: 'cash',
      allocations: allocations.map((a) => ({ targetType: 'invoice' as const, ...a })),
      ...extra,
    },
    userId
  )

describe.skipIf(noDb)('a ledger payment is tagged with its plan (G07)', () => {
  it('tags a payment that pays only the plan master invoice', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const { plan, invoice } = await issuedPlan(tx, patientId, userId)

      const { payment } = await pay(tx, patientId, userId, 30_000, [
        { targetId: invoice.id, amount: 30_000 },
      ])
      expect(payment.paymentPlanId).toBe(plan.id)
    })
  })

  it('tags a payment that pays a child installment invoice of the plan', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const { plan } = await issuedPlan(tx, patientId, userId)
      const childId = await issuedOneTime(tx, patientId, userId, 20_000)
      await tx.update(invoices).set({ planId: plan.id }).where(eq(invoices.id, childId))

      const { payment } = await pay(tx, patientId, userId, 20_000, [
        { targetId: childId, amount: 20_000 },
      ])
      expect(payment.paymentPlanId).toBe(plan.id)
    })
  })

  it('tags a payment that pays a master invoice the plan only points to (an older plan)', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const { plan, invoice } = await issuedPlan(tx, patientId, userId)
      // Older plans link plan -> master (payment_plans.invoice_id) without the invoice
      // pointing back (invoices.planId); the rule must find them from the plan side.
      await tx.update(invoices).set({ planId: null }).where(eq(invoices.id, invoice.id))

      const { payment } = await pay(tx, patientId, userId, 30_000, [
        { targetId: invoice.id, amount: 30_000 },
      ])
      expect(payment.paymentPlanId).toBe(plan.id)
    })
  })

  it('tags a payment that pays the plan and leaves a remainder unallocated (the remainder follows it)', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const { plan, invoice } = await issuedPlan(tx, patientId, userId)

      const { payment } = await pay(tx, patientId, userId, 35_000, [
        { targetId: invoice.id, amount: 30_000 },
      ])
      expect(payment.unallocatedAmount).toBe(5_000)
      expect(payment.paymentPlanId).toBe(plan.id)
    })
  })

  it('tags a payment split across several invoices of the same plan', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const { plan, invoice } = await issuedPlan(tx, patientId, userId)
      const childId = await issuedOneTime(tx, patientId, userId, 20_000)
      await tx.update(invoices).set({ planId: plan.id }).where(eq(invoices.id, childId))

      const { payment } = await pay(tx, patientId, userId, 50_000, [
        { targetId: invoice.id, amount: 30_000 },
        { targetId: childId, amount: 20_000 },
      ])
      expect(payment.paymentPlanId).toBe(plan.id)
    })
  })

  it('leaves a payment for an ordinary invoice untagged', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      await issuedPlan(tx, patientId, userId)
      const oneTime = await issuedOneTime(tx, patientId, userId)

      const { payment } = await pay(tx, patientId, userId, 50_000, [
        { targetId: oneTime, amount: 50_000 },
      ])
      expect(payment.paymentPlanId).toBeNull()
    })
  })

  it('leaves a payment that also pays an ordinary invoice untagged (it is not plan money alone)', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const { invoice } = await issuedPlan(tx, patientId, userId)
      const oneTime = await issuedOneTime(tx, patientId, userId)

      const { payment } = await pay(tx, patientId, userId, 60_000, [
        { targetId: invoice.id, amount: 10_000 },
        { targetId: oneTime, amount: 50_000 },
      ])
      expect(payment.paymentPlanId).toBeNull()
    })
  })

  it('leaves a payment that pays two different plans untagged', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const a = await issuedPlan(tx, patientId, userId)
      const b = await issuedPlan(tx, patientId, userId, 80_000)

      const { payment } = await pay(tx, patientId, userId, 40_000, [
        { targetId: a.invoice.id, amount: 20_000 },
        { targetId: b.invoice.id, amount: 20_000 },
      ])
      expect(payment.paymentPlanId).toBeNull()
    })
  })

  it('leaves a payment with no allocations (a deposit) untagged', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      await issuedPlan(tx, patientId, userId)

      const { payment } = await pay(tx, patientId, userId, 25_000, [])
      expect(payment.paymentPlanId).toBeNull()
    })
  })

  it('keeps a tag the caller sets explicitly, whatever the allocations say', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const { plan } = await issuedPlan(tx, patientId, userId)

      // The legacy payment sheet names the plan and allocates nothing when the master
      // invoice is not issued yet; that claim is the caller's and is kept.
      const { payment } = await pay(tx, patientId, userId, 10_000, [], {
        paymentPlanId: plan.id,
      })
      expect(payment.paymentPlanId).toBe(plan.id)
    })
  })

  it('an explicit tag wins over the one the allocations would give', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const a = await issuedPlan(tx, patientId, userId)
      const b = await issuedPlan(tx, patientId, userId, 80_000)

      const { payment } = await pay(
        tx,
        patientId,
        userId,
        10_000,
        [{ targetId: a.invoice.id, amount: 10_000 }],
        { paymentPlanId: b.plan.id }
      )
      expect(payment.paymentPlanId).toBe(b.plan.id)
    })
  })

  it('the tag survives posting', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const { plan, invoice } = await issuedPlan(tx, patientId, userId)

      const { payment } = await pay(tx, patientId, userId, 30_000, [
        { targetId: invoice.id, amount: 30_000 },
      ])
      await postPayment(tx, payment.id, userId)
      const [row] = await tx.select().from(payments).where(eq(payments.id, payment.id))
      expect(row.status).toBe('posted')
      expect(row.paymentPlanId).toBe(plan.id)
    })
  })
})
