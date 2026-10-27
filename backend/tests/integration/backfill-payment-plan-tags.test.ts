/**
 * G07 — the one-off backfill that tags old payments with their plan. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.11).
 *
 * Payments taken from the patient's ledger before the runtime rule existed carry allocations to a
 * plan's invoices but no `paymentPlanId`. The backfill applies the same rule as the runtime
 * (`resolvePlanTag`) to those rows. It is a DRY RUN unless told to apply; it only ever fills in a
 * missing tag (never changes an existing one, an amount or an allocation); and a second run finds
 * nothing left to do.
 *
 * Runs in a rolled-back transaction against the local database.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/backfill-payment-plan-tags.test.ts
 */
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import { invoices, paymentAllocations, payments } from '../../src/db/schema'
import { issueInvoice } from '../../src/lib/invoice-service'
import { createPlan } from '../../src/lib/payment-plan-service'
import { backfillPaymentPlanTags } from '../../src/lib/payment-plan-tag-backfill'
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

/** An "old" payment: allocations in place, posted, and the tag cleared as it was before the rule. */
async function oldPayment(
  tx: DB,
  patientId: string,
  userId: string,
  amount: number,
  allocations: Array<{ targetId: string; amount: number }>,
  opts: { post?: boolean } = { post: true }
) {
  const { payment } = await createDraftPayment(
    tx,
    {
      patientId,
      amount,
      method: 'cash',
      allocations: allocations.map((a) => ({ targetType: 'invoice' as const, ...a })),
    },
    userId
  )
  if (opts.post !== false) await postPayment(tx, payment.id, userId)
  await tx.update(payments).set({ paymentPlanId: null }).where(eq(payments.id, payment.id))
  return payment.id
}

const tagOf = async (tx: DB, id: string) =>
  (await tx.select({ t: payments.paymentPlanId }).from(payments).where(eq(payments.id, id)))[0]?.t

describe.skipIf(noDb)('backfill of payment plan tags (G07)', () => {
  it('is a dry run by default: it reports what it would tag and writes nothing', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const { plan, invoice } = await issuedPlan(tx, patientId, userId)
      const id = await oldPayment(tx, patientId, userId, 30_000, [
        { targetId: invoice.id, amount: 30_000 },
      ])

      const report = await backfillPaymentPlanTags(tx, { patientId })
      expect(report.apply).toBe(false)
      expect(report.wouldTag).toBe(1)
      expect(report.tagged).toBe(0)
      expect(report.rows).toContainEqual(
        expect.objectContaining({ paymentId: id, planId: plan.id, outcome: 'tag' })
      )
      expect(await tagOf(tx, id)).toBeNull()
    })
  })

  it('tags the payment when told to apply, and a second run finds nothing to do', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const { plan, invoice } = await issuedPlan(tx, patientId, userId)
      const id = await oldPayment(tx, patientId, userId, 30_000, [
        { targetId: invoice.id, amount: 30_000 },
      ])

      const first = await backfillPaymentPlanTags(tx, { patientId, apply: true })
      expect(first.apply).toBe(true)
      expect(first.tagged).toBe(1)
      expect(await tagOf(tx, id)).toBe(plan.id)

      const second = await backfillPaymentPlanTags(tx, { patientId, apply: true })
      expect(second.scanned).toBe(0)
      expect(second.tagged).toBe(0)
      expect(await tagOf(tx, id)).toBe(plan.id)
    })
  })

  it('tags a payment that paid a child installment invoice of the plan', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const { plan } = await issuedPlan(tx, patientId, userId)
      const child = await issuedOneTime(tx, patientId, userId, 20_000)
      await tx.update(invoices).set({ planId: plan.id }).where(eq(invoices.id, child))
      const id = await oldPayment(tx, patientId, userId, 20_000, [
        { targetId: child, amount: 20_000 },
      ])

      await backfillPaymentPlanTags(tx, { patientId, apply: true })
      expect(await tagOf(tx, id)).toBe(plan.id)
    })
  })

  it('leaves alone what the runtime rule would leave alone', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const a = await issuedPlan(tx, patientId, userId)
      const b = await issuedPlan(tx, patientId, userId, 80_000)
      const ordinary = await issuedOneTime(tx, patientId, userId, 120_000)

      const onlyOrdinary = await oldPayment(tx, patientId, userId, 50_000, [
        { targetId: ordinary, amount: 50_000 },
      ])
      const mixed = await oldPayment(tx, patientId, userId, 60_000, [
        { targetId: a.invoice.id, amount: 10_000 },
        { targetId: ordinary, amount: 50_000 },
      ])
      const twoPlans = await oldPayment(tx, patientId, userId, 40_000, [
        { targetId: a.invoice.id, amount: 20_000 },
        { targetId: b.invoice.id, amount: 20_000 },
      ])
      const deposit = await oldPayment(tx, patientId, userId, 25_000, [])

      const report = await backfillPaymentPlanTags(tx, { patientId, apply: true })
      expect(report.tagged).toBe(0)
      for (const id of [onlyOrdinary, mixed, twoPlans, deposit]) {
        expect(await tagOf(tx, id)).toBeNull()
      }
      expect(report.mixed).toBe(2) // the mixed payment and the two-plan payment
      expect(report.noPlan).toBe(2) // the ordinary-only payment and the deposit
    })
  })

  it('never changes a tag that is already there, nor an amount or an allocation', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const a = await issuedPlan(tx, patientId, userId)
      const b = await issuedPlan(tx, patientId, userId, 80_000)
      const { payment } = await createDraftPayment(
        tx,
        {
          patientId,
          amount: 10_000,
          method: 'cash',
          paymentPlanId: b.plan.id, // the caller's explicit claim
          allocations: [{ targetType: 'invoice', targetId: a.invoice.id, amount: 10_000 }],
        },
        userId
      )

      await backfillPaymentPlanTags(tx, { patientId, apply: true })
      const [row] = await tx.select().from(payments).where(eq(payments.id, payment.id))
      expect(row.paymentPlanId).toBe(b.plan.id)
      expect(row.amount).toBe(10_000)
      expect(row.allocatedAmount).toBe(10_000)
    })
  })

  it('tags a draft and a reversed payment the way the runtime would have', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const { plan, invoice } = await issuedPlan(tx, patientId, userId)
      const draft = await oldPayment(
        tx,
        patientId,
        userId,
        10_000,
        [{ targetId: invoice.id, amount: 10_000 }],
        { post: false }
      )
      const reversed = await oldPayment(tx, patientId, userId, 15_000, [
        { targetId: invoice.id, amount: 15_000 },
      ])
      await tx.update(payments).set({ status: 'reversed' }).where(eq(payments.id, reversed))

      await backfillPaymentPlanTags(tx, { patientId, apply: true })
      expect(await tagOf(tx, draft)).toBe(plan.id)
      expect(await tagOf(tx, reversed)).toBe(plan.id)
    })
  })

  it('does not look at money paid out (a refund is not a plan payment)', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const { invoice } = await issuedPlan(tx, patientId, userId)
      const [refund] = await tx
        .insert(payments)
        .values({
          patientId,
          amount: 5_000,
          allocatedAmount: 5_000,
          unallocatedAmount: 0,
          method: 'cash',
          status: 'posted',
          direction: 'outgoing',
        })
        .returning()
      await tx.insert(paymentAllocations).values({
        paymentId: refund.id,
        targetType: 'invoice',
        targetId: invoice.id,
        amount: 5_000,
      })

      const report = await backfillPaymentPlanTags(tx, { patientId, apply: true })
      expect(report.scanned).toBe(0)
      expect(await tagOf(tx, refund.id)).toBeNull()
    })
  })

  it('stays within the patient it is scoped to', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const mine = await makePatient(tx, 'IT Backfill Mine')
      const other = await makePatient(tx, 'IT Backfill Other')
      const planMine = await issuedPlan(tx, mine, userId)
      const planOther = await issuedPlan(tx, other, userId)
      const idMine = await oldPayment(tx, mine, userId, 10_000, [
        { targetId: planMine.invoice.id, amount: 10_000 },
      ])
      const idOther = await oldPayment(tx, other, userId, 10_000, [
        { targetId: planOther.invoice.id, amount: 10_000 },
      ])

      await backfillPaymentPlanTags(tx, { patientId: mine, apply: true })
      expect(await tagOf(tx, idMine)).toBe(planMine.plan.id)
      expect(await tagOf(tx, idOther)).toBeNull()
    })
  })

  it('honours a limit', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const { invoice } = await issuedPlan(tx, patientId, userId)
      for (let i = 0; i < 3; i++) {
        await oldPayment(tx, patientId, userId, 1_000, [{ targetId: invoice.id, amount: 1_000 }])
      }
      const report = await backfillPaymentPlanTags(tx, { patientId, limit: 2 })
      expect(report.scanned).toBe(2)
    })
  })
})
