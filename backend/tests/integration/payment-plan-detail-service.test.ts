/**
 * F05 — what `getPlanDetail` counts and lists, case by case. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.11). The HTTP behaviour (access, ids, route
 * order, the ledger payment appearing once) is in payment-plan-detail.test.ts; this file pins the
 * edge cases that need exact control of the data.
 *
 * Runs in a rolled-back transaction against the local database.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/payment-plan-detail-service.test.ts
 */
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import { invoices, paymentPlans, payments } from '../../src/db/schema'
import { issueInvoice } from '../../src/lib/invoice-service'
import { getPlanDetail, postedPaidByPlan } from '../../src/lib/payment-plan-detail'
import { createPlan } from '../../src/lib/payment-plan-service'
import { createDraftPayment, postPayment } from '../../src/lib/payment-service'
import { accountIdByCode, anyUserId, makeDraftInvoice, makePatient } from './_fixtures'
import { noDb, withRollback } from './_setup'

async function planWithMaster(tx: DB, patientId: string, userId: string, total = 100_000) {
  const made = await createPlan(
    tx,
    { patientId, totalAmount: total, scheduleType: 'flexible', startDate: new Date() },
    userId
  )
  await issueInvoice(tx, made.invoice.id, userId)
  return made
}

async function issuedInvoice(tx: DB, patientId: string, userId: string, amount: number) {
  const { invoiceId } = await makeDraftInvoice(tx, {
    patientId,
    userId,
    amount,
    revenueAccountId: await accountIdByCode(tx, '4100'),
  })
  await issueInvoice(tx, invoiceId, userId)
  return invoiceId
}

async function payAndPost(
  tx: DB,
  patientId: string,
  userId: string,
  amount: number,
  allocations: Array<{ targetId: string; amount: number }>,
  extra: Record<string, unknown> = {}
) {
  const { payment } = await createDraftPayment(
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
  await postPayment(tx, payment.id, userId)
  return payment.id
}

describe.skipIf(noDb)('getPlanDetail — what is counted and listed (F05)', () => {
  it('lists a payment once and sums its share when it pays the master and a child invoice', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const { plan, invoice } = await planWithMaster(tx, patientId, userId)
      const child = await issuedInvoice(tx, patientId, userId, 20_000)
      await tx.update(invoices).set({ planId: plan.id }).where(eq(invoices.id, child))

      const id = await payAndPost(tx, patientId, userId, 50_000, [
        { targetId: invoice.id, amount: 30_000 },
        { targetId: child, amount: 20_000 },
      ])

      const detail = await getPlanDetail(tx, plan.id)
      expect(detail?.payments.map((p) => p.id)).toEqual([id])
      expect(detail?.payments[0]).toMatchObject({ amount: 50_000, appliedToPlan: 50_000 })
      expect(detail?.totals.paid).toBe(50_000)
    })
  })

  it('counts only the share of a mixed payment that went to the plan', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const { plan, invoice } = await planWithMaster(tx, patientId, userId)
      const ordinary = await issuedInvoice(tx, patientId, userId, 40_000)

      const id = await payAndPost(tx, patientId, userId, 50_000, [
        { targetId: invoice.id, amount: 10_000 },
        { targetId: ordinary, amount: 40_000 },
      ])

      const detail = await getPlanDetail(tx, plan.id)
      expect(detail?.payments).toHaveLength(1)
      expect(detail?.payments[0]).toMatchObject({ id, amount: 50_000, appliedToPlan: 10_000 })
      expect(detail?.totals.paid).toBe(10_000)
    })
  })

  it('does not list a payment that only paid an ordinary invoice', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const { plan } = await planWithMaster(tx, patientId, userId)
      const ordinary = await issuedInvoice(tx, patientId, userId, 40_000)
      await payAndPost(tx, patientId, userId, 40_000, [{ targetId: ordinary, amount: 40_000 }])

      const detail = await getPlanDetail(tx, plan.id)
      expect(detail?.payments).toEqual([])
      expect(detail?.totals.paid).toBe(0)
    })
  })

  it('lists a payment tagged to the plan but allocated nowhere, applying nothing', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const { plan } = await planWithMaster(tx, patientId, userId)
      const id = await payAndPost(tx, patientId, userId, 15_000, [], { paymentPlanId: plan.id })

      const detail = await getPlanDetail(tx, plan.id)
      expect(detail?.payments).toHaveLength(1)
      expect(detail?.payments[0]).toMatchObject({ id, amount: 15_000, appliedToPlan: 0 })
      expect(detail?.totals).toEqual({ total: 100_000, paid: 0, balance: 100_000 })
    })
  })

  it('lists a payment once when it is both tagged and allocated', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const { plan, invoice } = await planWithMaster(tx, patientId, userId)
      const id = await payAndPost(tx, patientId, userId, 25_000, [
        { targetId: invoice.id, amount: 25_000 },
      ])
      // Explicitly tagged AND allocated: the two sources of "belongs to this plan" overlap.
      await tx.update(payments).set({ paymentPlanId: plan.id }).where(eq(payments.id, id))

      const detail = await getPlanDetail(tx, plan.id)
      expect(detail?.payments.map((p) => p.id)).toEqual([id])
      expect(detail?.totals.paid).toBe(25_000)
    })
  })

  it('shows a reversed payment without counting it, even though its allocation rows remain', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const { plan, invoice } = await planWithMaster(tx, patientId, userId)
      const id = await payAndPost(tx, patientId, userId, 25_000, [
        { targetId: invoice.id, amount: 25_000 },
      ])
      await tx.update(payments).set({ status: 'reversed' }).where(eq(payments.id, id))

      const detail = await getPlanDetail(tx, plan.id)
      expect(detail?.payments[0]).toMatchObject({ id, status: 'reversed', appliedToPlan: 25_000 })
      expect(detail?.totals.paid).toBe(0)
    })
  })

  it('an old plan with no master invoice: balance is total minus what was paid on its child invoices', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const [plan] = await tx
        .insert(paymentPlans)
        .values({
          patientId,
          type: 'fixed',
          originalAmount: 100_000,
          totalAmount: 100_000,
          startDate: new Date(),
          status: 'activated',
        })
        .returning()
      const child = await issuedInvoice(tx, patientId, userId, 25_000)
      await tx.update(invoices).set({ planId: plan.id }).where(eq(invoices.id, child))
      await payAndPost(tx, patientId, userId, 25_000, [{ targetId: child, amount: 25_000 }])

      const detail = await getPlanDetail(tx, plan.id)
      expect(detail?.invoice).toBeNull()
      expect(detail?.totals).toEqual({ total: 100_000, paid: 25_000, balance: 75_000 })
    })
  })

  it('the balance is what the master invoice still owes, which includes credit notes', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const { plan, invoice } = await planWithMaster(tx, patientId, userId)
      // A credit note of GHS 300.00 lowers the invoice's balance without any payment.
      await tx.update(invoices).set({ balance: 70_000 }).where(eq(invoices.id, invoice.id))

      const detail = await getPlanDetail(tx, plan.id)
      expect(detail?.totals).toEqual({ total: 100_000, paid: 0, balance: 70_000 })
    })
  })

  it('returns null for an unknown plan', async () => {
    await withRollback(async (tx) => {
      expect(await getPlanDetail(tx, '00000000-0000-0000-0000-000000000000')).toBeNull()
    })
  })

  it('the plan page and the lists agree on what has been received', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const { plan, invoice } = await planWithMaster(tx, patientId, userId)
      const child = await issuedInvoice(tx, patientId, userId, 20_000)
      await tx.update(invoices).set({ planId: plan.id }).where(eq(invoices.id, child))
      const ordinary = await issuedInvoice(tx, patientId, userId, 40_000)

      await payAndPost(tx, patientId, userId, 50_000, [
        { targetId: invoice.id, amount: 30_000 },
        { targetId: child, amount: 20_000 },
      ])
      await payAndPost(tx, patientId, userId, 50_000, [
        { targetId: invoice.id, amount: 10_000 },
        { targetId: ordinary, amount: 40_000 },
      ])
      const undone = await payAndPost(tx, patientId, userId, 5_000, [
        { targetId: invoice.id, amount: 5_000 },
      ])
      await tx.update(payments).set({ status: 'reversed' }).where(eq(payments.id, undone))
      await createDraftPayment(
        tx,
        {
          patientId,
          amount: 7_000,
          method: 'cash',
          allocations: [{ targetType: 'invoice', targetId: invoice.id, amount: 7_000 }],
        },
        userId
      )

      const detail = await getPlanDetail(tx, plan.id)
      const listed = await postedPaidByPlan(tx, [{ id: plan.id, invoiceId: plan.invoiceId }])
      expect(detail?.totals.paid).toBe(50_000 + 10_000)
      expect(listed.get(plan.id)).toBe(detail?.totals.paid)
    })
  })
})
