/**
 * Integration tests for the treatment payment gate (P5).
 *
 * The 18 unit tests in `tests/unit/treatment-funding.test.ts` prove the RULE.
 * These prove the wiring around it: that the funding helpers read the database
 * correctly, that a payment plan and a deposit actually register, and that the
 * gate blocks, logs or overrides according to `treatment_gate.mode`.
 *
 * Everything runs inside `withRollback`, so no row survives the test.
 */

import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import {
  auditLogs,
  clinicSettings,
  invoices,
  paymentPlans,
  treatmentPlans,
} from '../../src/db/schema'
import { getInvoiceFunding, getPlanFunding } from '../../src/lib/treatment-funding'
import {
  enforceTreatmentGate,
  getTreatmentGateMode,
  TREATMENT_GATE_MODE_KEY,
} from '../../src/lib/treatment-gate'
import { accountIdByCode, anyUserId, makeDraftInvoice, makePatient } from './_fixtures'
import { noDb, withRollback } from './_setup'

/** Issue an invoice by hand — enough for the gate, without the GL machinery. */
async function issueFixtureInvoice(
  tx: DB,
  invoiceId: string,
  // Amounts are integer CENTS, matching the `invoices` money columns.
  opts: { total: number; paidAmount?: number }
) {
  const paid = opts.paidAmount ?? 0
  // `invoices_total_consistency_check` enforces
  // |total - (subtotal - discount_total + tax_total)| <= 0.01, so subtotal has
  // to move with total — setting `total` alone is rejected.
  await tx
    .update(invoices)
    .set({
      status: paid >= opts.total ? 'paid' : paid > 0 ? 'partially_paid' : 'issued',
      amount: opts.total,
      subtotal: opts.total,
      discountTotal: 0,
      taxTotal: 0,
      taxableAmount: opts.total,
      total: opts.total,
      paidAmount: paid,
      balance: opts.total - paid,
    })
    .where(eq(invoices.id, invoiceId))
}

async function setMode(tx: DB, mode: string) {
  await tx
    .insert(clinicSettings)
    .values({ key: TREATMENT_GATE_MODE_KEY, value: mode })
    .onConflictDoUpdate({ target: clinicSettings.key, set: { value: mode } })
}

const ctx = (tx: DB, userId: string, over?: { reason?: string; isAdmin?: boolean }) => ({
  db: tx,
  userId,
  isAdmin: over?.isAdmin ?? true,
  override: over !== undefined,
  overrideReason: over?.reason ?? null,
  action: 'plan_item:completed',
  entityId: randomUUID(),
})

describe.skipIf(noDb)('treatment gate — funding reads the database correctly', () => {
  it('blocks an issued invoice with nothing paid and no plan', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx, 'IT Gate Unpaid')
      const revenue = await accountIdByCode(tx, '4100')
      const { invoiceId } = await makeDraftInvoice(tx, {
        patientId,
        userId,
        amount: 100000,
        revenueAccountId: revenue,
      })
      await issueFixtureInvoice(tx, invoiceId, { total: 100000 })

      const f = await getInvoiceFunding(tx, invoiceId)
      expect(f.funded).toBe(false)
      expect(f.reason).toBe('unfunded')
      expect(f.balance).toBe(100000)
      expect(f.detail).toContain('1,000.00')
    })
  })

  it('funds once a deposit is recorded', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx, 'IT Gate Deposit')
      const revenue = await accountIdByCode(tx, '4100')
      const { invoiceId } = await makeDraftInvoice(tx, {
        patientId,
        userId,
        amount: 100000,
        revenueAccountId: revenue,
      })
      await issueFixtureInvoice(tx, invoiceId, { total: 100000, paidAmount: 25000 })

      const f = await getInvoiceFunding(tx, invoiceId)
      expect(f.funded).toBe(true)
      expect(f.reason).toBe('deposit')
      expect(f.balance).toBe(75000)
    })
  })

  it('funds an unpaid invoice once a payment plan covers it', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx, 'IT Gate Plan')
      const revenue = await accountIdByCode(tx, '4100')
      const { invoiceId } = await makeDraftInvoice(tx, {
        patientId,
        userId,
        amount: 100000,
        revenueAccountId: revenue,
      })
      await issueFixtureInvoice(tx, invoiceId, { total: 100000 })

      expect((await getInvoiceFunding(tx, invoiceId)).funded).toBe(false)

      // P-1: the plan points at the estimate itself, not a parallel invoice.
      await tx.insert(paymentPlans).values({
        patientId,
        type: 'fixed',
        originalAmount: 1000,
        totalAmount: 1000,
        startDate: new Date(),
        status: 'activated',
        invoiceId,
      })

      const f = await getInvoiceFunding(tx, invoiceId)
      expect(f.funded).toBe(true)
      expect(f.reason).toBe('payment_plan')
    })
  })

  it('a cancelled plan stops covering the invoice', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx, 'IT Gate Cancelled Plan')
      const revenue = await accountIdByCode(tx, '4100')
      const { invoiceId } = await makeDraftInvoice(tx, {
        patientId,
        userId,
        amount: 50000,
        revenueAccountId: revenue,
      })
      await issueFixtureInvoice(tx, invoiceId, { total: 50000 })
      await tx.insert(paymentPlans).values({
        patientId,
        type: 'fixed',
        originalAmount: 500,
        totalAmount: 500,
        startDate: new Date(),
        status: 'cancelled',
        invoiceId,
      })

      const f = await getInvoiceFunding(tx, invoiceId)
      expect(f.funded).toBe(false)
      expect(f.reason).toBe('unfunded')
    })
  })

  it('a paused plan still covers — a missed installment is not a clinical stop', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx, 'IT Gate Paused Plan')
      const revenue = await accountIdByCode(tx, '4100')
      const { invoiceId } = await makeDraftInvoice(tx, {
        patientId,
        userId,
        amount: 50000,
        revenueAccountId: revenue,
      })
      await issueFixtureInvoice(tx, invoiceId, { total: 50000 })
      await tx.insert(paymentPlans).values({
        patientId,
        type: 'fixed',
        originalAmount: 500,
        totalAmount: 500,
        startDate: new Date(),
        status: 'paused',
        invoiceId,
      })

      expect((await getInvoiceFunding(tx, invoiceId)).funded).toBe(true)
    })
  })
})

describe.skipIf(noDb)('treatment gate — plans resolve through sourceInvoiceId', () => {
  it('gates a plan on the estimate it was built from', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx, 'IT Gate Plan Link')
      const revenue = await accountIdByCode(tx, '4100')
      const { invoiceId } = await makeDraftInvoice(tx, {
        patientId,
        userId,
        amount: 80000,
        revenueAccountId: revenue,
      })
      await issueFixtureInvoice(tx, invoiceId, { total: 80000 })

      const [plan] = await tx
        .insert(treatmentPlans)
        .values({
          patientId,
          title: 'IT plan',
          totalEstimated: 800,
          status: 'created',
          sourceInvoiceId: invoiceId,
          createdById: userId,
        })
        .returning()

      const f = await getPlanFunding(tx, plan.id)
      expect(f.funded).toBe(false)
      expect(f.invoiceNumber).toBeTruthy()
    })
  })

  it('does NOT gate a plan with no source invoice — legacy and from-scratch plans', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx, 'IT Gate Plan NoSource')
      const [plan] = await tx
        .insert(treatmentPlans)
        .values({
          patientId,
          title: 'IT standalone plan',
          totalEstimated: 300,
          status: 'created',
          createdById: userId,
        })
        .returning()

      const f = await getPlanFunding(tx, plan.id)
      expect(f.funded).toBe(true)
      expect(f.reason).toBe('no_source_invoice')
    })
  })
})

describe.skipIf(noDb)('treatment gate — modes and override', () => {
  let unfunded: Awaited<ReturnType<typeof getInvoiceFunding>>

  beforeEach(() => {
    unfunded = {
      funded: false,
      reason: 'unfunded',
      detail: 'Estimate INV-TEST is unpaid (GH₵500.00 outstanding).',
      invoiceNumber: 'INV-TEST',
      total: 50000,
      paidAmount: 0,
      balance: 50000,
    }
  })

  it('defaults to log when no setting row exists', async () => {
    await withRollback(async (tx) => {
      await tx.delete(clinicSettings).where(eq(clinicSettings.key, TREATMENT_GATE_MODE_KEY))
      expect(await getTreatmentGateMode(tx)).toBe('log')
    })
  })

  it('mode=log never blocks', async () => {
    await withRollback(async (tx) => {
      await setMode(tx, 'log')
      const userId = await anyUserId(tx)
      expect(await enforceTreatmentGate(ctx(tx, userId), unfunded)).toBeNull()
    })
  })

  it('mode=off never blocks', async () => {
    await withRollback(async (tx) => {
      await setMode(tx, 'off')
      const userId = await anyUserId(tx)
      expect(await enforceTreatmentGate(ctx(tx, userId), unfunded)).toBeNull()
    })
  })

  it('mode=enforce blocks with 402 and the reason', async () => {
    await withRollback(async (tx) => {
      await setMode(tx, 'enforce')
      const userId = await anyUserId(tx)
      const out = await enforceTreatmentGate(ctx(tx, userId), unfunded)
      expect(out?.status).toBe(402)
      expect(out?.body.reason).toBe('unfunded')
      expect(out?.body.overridable).toBe(true)
      expect(out?.body.error).toContain('500.00')
    })
  })

  it('never blocks a funded treatment, even in enforce', async () => {
    await withRollback(async (tx) => {
      await setMode(tx, 'enforce')
      const userId = await anyUserId(tx)
      const funded = { ...unfunded, funded: true, reason: 'paid' as const }
      expect(await enforceTreatmentGate(ctx(tx, userId), funded)).toBeNull()
    })
  })

  it('refuses an override with a blank reason', async () => {
    await withRollback(async (tx) => {
      await setMode(tx, 'enforce')
      const userId = await anyUserId(tx)
      const out = await enforceTreatmentGate(ctx(tx, userId, { reason: '   ' }), unfunded)
      expect(out?.status).toBe(402)
    })
  })

  it('refuses an override from a non-admin', async () => {
    await withRollback(async (tx) => {
      await setMode(tx, 'enforce')
      const userId = await anyUserId(tx)
      const out = await enforceTreatmentGate(
        ctx(tx, userId, { reason: 'emergency', isAdmin: false }),
        unfunded
      )
      expect(out?.status).toBe(402)
    })
  })

  it('allows an admin override with a reason, and audits it', async () => {
    await withRollback(async (tx) => {
      await setMode(tx, 'enforce')
      const userId = await anyUserId(tx)
      const gctx = ctx(tx, userId, { reason: 'Emergency — acute pain' })

      expect(await enforceTreatmentGate(gctx, unfunded)).toBeNull()

      const [row] = await tx.select().from(auditLogs).where(eq(auditLogs.entityId, gctx.entityId))
      expect(row).toBeTruthy()
      expect(row.action).toBe('treatment_gate_override')
      expect(row.reason).toBe('Emergency — acute pain')
      expect((row.changes as { gatedAction?: string }).gatedAction).toBe('plan_item:completed')
    })
  })
})
