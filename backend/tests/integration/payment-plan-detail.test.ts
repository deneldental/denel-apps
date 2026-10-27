/**
 * F05 — the payment-plan page loads, and what it shows is right. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.11).
 *
 * Opening a plan from the payments table goes to /payment-plans/:id, which asks the API for
 * `GET /api/payment-plans/:id`. That route did not exist (404), so the page came back empty. The
 * route now answers with the plan, the patient, the master invoice, totals and the payment
 * history. The totals come from the POSTED allocations to the plan's invoices (the same source the
 * schedule uses), not from a sum over every payment row, so a draft or a reversed payment never
 * counts as money received. Each payment appears once, however many of the plan's invoices it
 * pays. A payment taken from the patient's ledger against the plan shows up without anyone having
 * tagged it.
 *
 * Real stack: real app, real signed-in roles, real database and ledger. Commits fixtures; local
 * Postgres only. Patients are named `IT …` so `sweepLeakedFixtures` removes them and their ledger
 * entries.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/payment-plan-detail.test.ts
 */
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/sms', () => ({
  sendSMS: vi.fn(async () => ({ success: true })),
  getHubtelCredentials: vi.fn(async () => null),
}))

import type { DB } from '../../src/db'
import { patients, paymentPlans, payments } from '../../src/db/schema'
import { sweepLeakedFixtures } from './_fixtures'
import {
  callAs,
  createLoginUser,
  deleteLoginUsers,
  hasBackendSecrets,
  isLocalDb,
  localDb,
  signInAs,
  type TestApp,
} from './_session'

const skip = !(isLocalDb && hasBackendSecrets)
const APP_BOOT_TIMEOUT_MS = 180_000
const db = localDb() as DB

const TAG = `plandetail-${Date.now()}`
const MISSING_UUID = '00000000-0000-0000-0000-000000000000'

let app: TestApp
const userIds: string[] = []
const cookies = {} as Record<'admin' | 'recep' | 'lab' | 'doc', string>
let patientId: string
let otherPatientId: string

const as = (who: 'admin' | 'recep' | 'lab' | 'doc', method: string, path: string, body?: unknown) =>
  callAs(app, 'portal', cookies[who], method, path, body)

interface PaymentRow {
  id: string
  status: string
  amount: number
  appliedToPlan: number
}
interface PlanDetailData {
  id: string
  patient: { id: string; name: string; email: string | null }
  invoice: { id: string; paidAmount: number; balance: number } | null
  totals: { total: number; paid: number; balance: number }
  payments: PaymentRow[]
}
interface PlanDetailBody {
  error?: string
  data: PlanDetailData
}
interface PlanListRow {
  id: string
  overdueAmount?: number
}

/** A fixed plan of GHS 1,000.00 (100 000 pesewas) over four months, master invoice issued. */
async function newPlan(forPatient = patientId, total = 100_000) {
  const res = await as('admin', 'POST', '/api/payment-plans/v2', {
    patientId: forPatient,
    totalAmount: total,
    scheduleType: 'fixed',
    numberOfInstallments: 4,
    installmentPeriod: 'monthly',
    issueImmediately: true,
  })
  expect(res.status, JSON.stringify(res.json)).toBe(200)
  const data = (res.json as { data: { plan: { id: string }; invoice: { id: string } } }).data
  return { planId: data.plan.id as string, invoiceId: data.invoice.id as string }
}

/** What the patient ledger does: a draft with allocations and NO plan tag, then post it. */
async function ledgerPayment(forPatient: string, invoiceId: string, amount: number) {
  const draft = await as('recep', 'POST', '/api/payments/draft', {
    patientId: forPatient,
    amount,
    method: 'cash',
    allocations: [{ targetType: 'invoice', targetId: invoiceId, amount }],
  })
  expect(draft.status, JSON.stringify(draft.json)).toBe(200)
  const id = (draft.json as { data: { id: string } }).data.id
  const posted = await as('recep', 'POST', `/api/payments/${id}/post`)
  expect(posted.status, JSON.stringify(posted.json)).toBe(200)
  return id
}

const detail = async (planId: string) => {
  const res = await as('recep', 'GET', `/api/payment-plans/${planId}`)
  return { status: res.status, body: res.json as unknown as PlanDetailBody }
}

describe.skipIf(skip)('GET /api/payment-plans/:id (F05)', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { validateBackendEnv } = await import('../../src/config/env')
    validateBackendEnv()
    app = (await import('../../src/app')).app as unknown as TestApp
    await sweepLeakedFixtures()

    for (const [label, roleId, baRole] of [
      ['admin', 'admin', 'admin'],
      ['recep', 'receptionist', undefined],
      ['lab', 'lab_technician', undefined],
      ['doc', 'doctor', undefined],
    ] as const) {
      const email = `${label}-${TAG}@plandetail.test`
      userIds.push(
        await createLoginUser(db, { email, name: `PlanDetail ${label}`, roleId, baRole })
      )
      cookies[label] = await signInAs(app, email, 'portal')
    }

    const mk = async (label: string, phone: string) => {
      const [p] = await db
        .insert(patients)
        .values({
          name: `IT PlanDetail ${label} ${TAG}`,
          dob: new Date('1990-01-01'),
          gender: 'other',
          phone,
          email: `${label}-${TAG}@patient.test`,
        })
        .returning({ id: patients.id })
      return p.id
    }
    patientId = await mk('A', '0240000091')
    otherPatientId = await mk('B', '0240000092')
  }, APP_BOOT_TIMEOUT_MS)

  afterAll(async () => {
    await sweepLeakedFixtures()
    await deleteLoginUsers(db, userIds)
  })

  describe('access', () => {
    it('is refused to someone who is not signed in', async () => {
      const res = await callAs(app, 'portal', '', 'GET', `/api/payment-plans/${MISSING_UUID}`)
      expect(res.status).toBe(401)
    })

    it('is refused to a role without access to payments', async () => {
      const { planId } = await newPlan()
      // A doctor reaches the portal but has no payments permission: the route's own check.
      expect((await as('doc', 'GET', `/api/payment-plans/${planId}`)).status).toBe(403)
      // A lab technician is not let into the portal at all (interface scope).
      expect((await as('lab', 'GET', `/api/payment-plans/${planId}`)).status).toBe(403)
    })

    it('answers 404 for a plan that does not exist', async () => {
      const res = await detail(MISSING_UUID)
      expect(res.status).toBe(404)
      // The route's own answer, not the router's bare "Not Found" for a path nobody handles.
      expect(res.body?.error).toBe('Payment plan not found')
    })

    it('answers 400, not a server error, for an id that is not a UUID', async () => {
      const res = await detail('not-a-uuid')
      expect(res.status).toBe(400)
    })
  })

  describe('routes that share the path still resolve', () => {
    it.each([
      '/api/payment-plans/overdue',
      '/api/payment-plans/templates',
      '/api/payment-plans/templates/default',
    ])('%s is not swallowed by /:id', async (path) => {
      const res = await as('recep', 'GET', path)
      // /templates/default answers 404 when no default template is set; what matters is that
      // it is the route's own answer and not the 400 "not a UUID" of the id route.
      expect([200, 404], `${path}: ${JSON.stringify(res.json)}`).toContain(res.status)
      expect(JSON.stringify(res.json)).not.toMatch(/not a valid|invalid payment plan id/i)
    })

    it('/:id/schedule and /:id/invoices still resolve', async () => {
      const { planId } = await newPlan()
      expect((await as('recep', 'GET', `/api/payment-plans/${planId}/schedule`)).status).toBe(200)
      expect((await as('recep', 'GET', `/api/payment-plans/${planId}/invoices`)).status).toBe(200)
    })
  })

  describe('the plan', () => {
    it('returns the plan, the patient, the master invoice and zero paid for a new plan', async () => {
      const { planId, invoiceId } = await newPlan()
      const { status, body } = await detail(planId)
      expect(status, JSON.stringify(body)).toBe(200)
      const d = body.data
      expect(d.id).toBe(planId)
      expect(d.patient.id).toBe(patientId)
      expect(d.patient.name).toContain('IT PlanDetail A')
      expect(d.patient.email).toContain('@patient.test')
      expect(d.invoice?.id).toBe(invoiceId)
      expect(d.totals).toEqual({ total: 100_000, paid: 0, balance: 100_000 })
      expect(d.payments).toEqual([])
    })
  })

  describe('payment history and totals', () => {
    it('a payment made through the ledger appears once, with totals from the posted allocation', async () => {
      const { planId, invoiceId } = await newPlan()
      const paymentId = await ledgerPayment(patientId, invoiceId, 30_000)

      const { status, body } = await detail(planId)
      expect(status).toBe(200)
      const rows = body.data.payments.filter((p) => p.id === paymentId)
      expect(rows).toHaveLength(1)
      expect(body.data.payments).toHaveLength(1)
      expect(rows[0]).toMatchObject({ status: 'posted', amount: 30_000, appliedToPlan: 30_000 })
      expect(body.data.totals).toEqual({ total: 100_000, paid: 30_000, balance: 70_000 })
      // The page and the invoice agree: what the page calls received and owed is what the
      // master invoice (the ledger) says.
      expect(body.data.invoice).toMatchObject({ paidAmount: 30_000, balance: 70_000 })

      // …and the payment now carries the plan tag the reports read.
      const [row] = await db.select().from(payments).where(eq(payments.id, paymentId))
      expect(row.paymentPlanId).toBe(planId)
    })

    it('adds up several payments, newest first', async () => {
      const { planId, invoiceId } = await newPlan()
      const first = await ledgerPayment(patientId, invoiceId, 10_000)
      const second = await ledgerPayment(patientId, invoiceId, 25_000)

      const { body } = await detail(planId)
      expect(body.data.payments.map((p) => p.id)).toEqual([second, first])
      expect(body.data.totals.paid).toBe(35_000)
      expect(body.data.totals.balance).toBe(65_000)
    })

    it('shows a reversed payment but does not count it', async () => {
      const { planId, invoiceId } = await newPlan()
      const kept = await ledgerPayment(patientId, invoiceId, 20_000)
      const undone = await ledgerPayment(patientId, invoiceId, 15_000)
      const rev = await as('recep', 'POST', `/api/payments/${undone}/reverse`, {
        reason: 'keyed in error',
      })
      expect(rev.status, JSON.stringify(rev.json)).toBe(200)

      const { body } = await detail(planId)
      const byId = new Map(body.data.payments.map((p) => [p.id, p]))
      expect(byId.get(undone)?.status).toBe('reversed')
      expect(byId.get(kept)?.status).toBe('posted')
      expect(body.data.totals).toEqual({ total: 100_000, paid: 20_000, balance: 80_000 })
    })

    it('leaves a draft payment out entirely', async () => {
      const { planId, invoiceId } = await newPlan()
      const draft = await as('recep', 'POST', '/api/payments/draft', {
        patientId,
        amount: 40_000,
        method: 'cash',
        allocations: [{ targetType: 'invoice', targetId: invoiceId, amount: 40_000 }],
      })
      expect(draft.status).toBe(200)

      const { body } = await detail(planId)
      expect(body.data.payments).toEqual([])
      expect(body.data.totals.paid).toBe(0)
    })

    it("does not show another patient's payments or another plan's payments", async () => {
      const mine = await newPlan()
      const other = await newPlan(otherPatientId, 60_000)
      const theirs = await ledgerPayment(otherPatientId, other.invoiceId, 10_000)
      const mineId = await ledgerPayment(patientId, mine.invoiceId, 5_000)

      const { body } = await detail(mine.planId)
      const ids = body.data.payments.map((p) => p.id)
      expect(ids).toEqual([mineId])
      expect(ids).not.toContain(theirs)
    })
  })

  describe('the overdue and outstanding lists', () => {
    const ids = async (path: string) => {
      const res = await as('recep', 'GET', path)
      expect(res.status, `${path}: ${JSON.stringify(res.json)}`).toBe(200)
      return (res.json as unknown as { data: PlanListRow[] }).data.map((p) => p.id)
    }
    const setStatus = (planId: string, status: string) =>
      db.update(paymentPlans).set({ status }).where(eq(paymentPlans.id, planId))

    it('/overdue?status=overdue lists overdue plans only, /outstanding outstanding plans only, /overdue both', async () => {
      const late = (await newPlan()).planId
      const cancelled = (await newPlan()).planId
      await setStatus(late, 'overdue')
      await setStatus(cancelled, 'outstanding')

      const overdueOnly = await ids('/api/payment-plans/overdue?status=overdue')
      expect(overdueOnly).toContain(late)
      expect(overdueOnly).not.toContain(cancelled)

      const outstandingOnly = await ids('/api/payment-plans/outstanding')
      expect(outstandingOnly).toContain(cancelled)
      expect(outstandingOnly).not.toContain(late)
      expect(await ids('/api/payment-plans/overdue?status=outstanding')).toEqual(outstandingOnly)

      // The dashboard and the reminders page keep asking without a filter and keep both.
      const both = await ids('/api/payment-plans/overdue')
      expect(both).toContain(late)
      expect(both).toContain(cancelled)
    })

    it('refuses an unknown status filter', async () => {
      const res = await as('recep', 'GET', '/api/payment-plans/overdue?status=paused')
      expect(res.status).toBe(400)
    })

    it('/outstanding needs access to payments like the other lists', async () => {
      expect((await as('doc', 'GET', '/api/payment-plans/outstanding')).status).toBe(403)
      expect((await as('lab', 'GET', '/api/payment-plans/outstanding')).status).toBe(403)
      expect(
        (await callAs(app, 'portal', '', 'GET', '/api/payment-plans/outstanding')).status
      ).toBe(401)
    })

    it('the overdue amount counts posted allocations only, not drafts or reversed payments', async () => {
      const { planId, invoiceId } = await newPlan()
      await ledgerPayment(patientId, invoiceId, 30_000)
      const undone = await ledgerPayment(patientId, invoiceId, 20_000)
      await as('recep', 'POST', `/api/payments/${undone}/reverse`, { reason: 'keyed in error' })
      await as('recep', 'POST', '/api/payments/draft', {
        patientId,
        amount: 40_000,
        method: 'cash',
        allocations: [{ targetType: 'invoice', targetId: invoiceId, amount: 40_000 }],
      })

      // Four monthly instalments of GHS 250.00, started 95 days ago: three are due, GHS 750.00.
      // Set last: posting a payment re-derives the plan's status.
      await db
        .update(paymentPlans)
        .set({
          status: 'overdue',
          amountPerInstallment: 25_000,
          paymentFrequency: 'monthly',
          startDate: new Date(Date.now() - 95 * 86_400_000),
        })
        .where(eq(paymentPlans.id, planId))

      const res = await as('recep', 'GET', '/api/payment-plans/overdue?status=overdue')
      const row = (res.json as unknown as { data: PlanListRow[] }).data.find((p) => p.id === planId)
      expect(row?.overdueAmount).toBe(75_000 - 30_000)
    })
  })

  describe('editing a plan payment does not reset the plan', () => {
    const statusOf = async (planId: string) =>
      (
        await db
          .select({ s: paymentPlans.status })
          .from(paymentPlans)
          .where(eq(paymentPlans.id, planId))
      )[0]?.s

    // Payments taken from the patient's ledger carry the plan tag now (G07), so editing one reaches
    // the legacy balance recalculation, which used to flatten a plan someone had paused, written
    // off as outstanding, or that the schedule had found overdue back to 'activated'.
    it.each([
      'paused',
      'outstanding',
      'overdue',
    ])('editing a ledger payment of a %s plan leaves it as it was', async (held) => {
      const { planId, invoiceId } = await newPlan()
      const paymentId = await ledgerPayment(patientId, invoiceId, 30_000)
      // Set after the payment: posting a payment re-derives the plan's status.
      await db.update(paymentPlans).set({ status: held }).where(eq(paymentPlans.id, planId))

      const res = await as('recep', 'PATCH', `/api/payments/${paymentId}`, {
        description: 'corrected description',
      })
      expect(res.status, JSON.stringify(res.json)).toBe(200)
      expect(await statusOf(planId)).toBe(held)
    })

    it('a plan paid in full is still marked completed by the recalculation', async () => {
      const { planId, invoiceId } = await newPlan(patientId, 30_000)
      const paymentId = await ledgerPayment(patientId, invoiceId, 30_000)
      await db.update(paymentPlans).set({ status: 'activated' }).where(eq(paymentPlans.id, planId))

      const res = await as('recep', 'PATCH', `/api/payments/${paymentId}`, {
        description: 'corrected description',
      })
      expect(res.status).toBe(200)
      expect(await statusOf(planId)).toBe('completed')
    })

    it('a plan on hold that has been paid in full is completed, not left on hold', async () => {
      const { planId, invoiceId } = await newPlan(patientId, 30_000)
      const paymentId = await ledgerPayment(patientId, invoiceId, 30_000)
      await db.update(paymentPlans).set({ status: 'paused' }).where(eq(paymentPlans.id, planId))

      const res = await as('recep', 'PATCH', `/api/payments/${paymentId}`, {
        description: 'corrected description',
      })
      expect(res.status).toBe(200)
      expect(await statusOf(planId)).toBe('completed')
    })

    it('a plan with money still owing and no hold is activated by the recalculation', async () => {
      const { planId, invoiceId } = await newPlan()
      const paymentId = await ledgerPayment(patientId, invoiceId, 30_000)
      await db.update(paymentPlans).set({ status: 'completed' }).where(eq(paymentPlans.id, planId))

      const res = await as('recep', 'PATCH', `/api/payments/${paymentId}`, {
        description: 'corrected description',
      })
      expect(res.status).toBe(200)
      expect(await statusOf(planId)).toBe('activated')
    })
  })
})
