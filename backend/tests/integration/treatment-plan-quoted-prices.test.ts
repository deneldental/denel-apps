/**
 * F36 / decision D12 — a treatment plan built from an estimate keeps the prices the
 * patient was quoted. See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md.
 *
 * The doctor lens's "Create treatment plan" sheet seeds its procedures from the
 * estimate and posts them to `POST /api/treatment-plans`, which resolved every
 * procedure linked to a catalogue service at the catalogue BASE price
 * (`resolveCatalogPlanItems`). A variant, tooth class, surcharge or discount on the
 * estimate was silently dropped, so the plan total disagreed with the quote. The
 * plan was not linked to the estimate either (`sourceInvoiceId`), which is how the
 * day-sheet and reception's confirm recognise that a plan already exists.
 *
 * D12: the sheet sends the estimate's id and, per seeded procedure, the estimate line
 * it came from. The server copies that line's quoted total and keeps the doctor's
 * edits to the name, tooth, phase and notes. A hand-added procedure keeps today's
 * rules (catalogue price when it names a service, its typed cost otherwise).
 *
 * Real stack: real app, real signed-in roles, real database.
 *
 * ── Safety ── commits fixtures; local Postgres only. Patients are named `IT …`.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/treatment-plan-quoted-prices.test.ts
 */
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/sms', () => ({
  sendSMS: vi.fn(async () => ({ success: true })),
  getHubtelCredentials: vi.fn(async () => null),
}))

import type { DB } from '../../src/db'
import {
  invoiceLines,
  invoices,
  patientCases,
  patients,
  services,
  treatmentPlanItems,
  treatmentPlans,
} from '../../src/db/schema'
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
const db = localDb() as DB

const TAG = `planprice-${Date.now()}`
const CATALOGUE = 25000 // the service's base price, in cents
const SURCHARGE = 5000 // added on the estimate line, so the quote differs from the catalogue

let app: TestApp
const userIds: string[] = []
let doctorUser: string
let doctorCookie = ''
let receptionCookie = ''
let patientP: string
let patientQ: string
let serviceId: string
const patientIds: string[] = []

type Json = { [key: string]: unknown }
const data = (j: Record<string, unknown> | null) => (j?.data ?? null) as Json | null

async function quotedEstimate(patientId: string, status = 'issued') {
  const { createEstimateDraft } = await import('../../src/lib/estimate-service')
  const res = await createEstimateDraft(
    db,
    {
      patientId,
      lines: [
        { serviceId, quantity: 1, surcharge: { type: 'amount', value: SURCHARGE } },
        { serviceId, quantity: 1 },
      ],
    },
    doctorUser
  )
  if (status !== 'draft') {
    await db.update(invoices).set({ status }).where(eq(invoices.id, res.invoice.id))
  }
  const lines = await db
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, res.invoice.id))
    .orderBy(invoiceLines.lineNumber)
  return { id: res.invoice.id, lines }
}

const createPlan = (cookie: string, body: unknown) =>
  callAs(app, 'portal', cookie, 'POST', '/api/treatment-plans', body)

async function itemsOf(planId: string) {
  return db
    .select()
    .from(treatmentPlanItems)
    .where(eq(treatmentPlanItems.planId, planId))
    .orderBy(treatmentPlanItems.sortOrder)
}

describe.skipIf(skip)('a plan built from an estimate keeps the quoted prices (D12)', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { validateBackendEnv } = await import('../../src/config/env')
    validateBackendEnv()
    app = (await import('../../src/app')).app as unknown as TestApp
    await sweepLeakedFixtures()

    for (const [key, roleId] of [
      ['doctor', 'doctor'],
      ['receptionist', 'receptionist'],
    ] as const) {
      const email = `${key}-${TAG}@planprice.test`
      const id = await createLoginUser(db, { email, name: `PlanPrice ${key}`, roleId })
      userIds.push(id)
      if (key === 'doctor') {
        doctorUser = id
        doctorCookie = await signInAs(app, email, 'portal')
      } else {
        receptionCookie = await signInAs(app, email, 'portal')
      }
    }

    for (const label of ['P', 'Q']) {
      const [p] = await db
        .insert(patients)
        .values({
          name: `IT PlanPrice ${label} ${TAG}`,
          dob: new Date('1990-01-01'),
          gender: 'other',
          phone: label === 'P' ? '0240000071' : '0240000072',
        })
        .returning({ id: patients.id })
      patientIds.push(p.id)
    }
    ;[patientP, patientQ] = patientIds

    const [svc] = await db
      .insert(services)
      .values({
        category: 'clinic',
        name: `IT PlanPrice Service ${TAG}`,
        amount: CATALOGUE,
        status: 'active',
        createdById: doctorUser,
      })
      .returning({ id: services.id })
    serviceId = svc.id
  }, 120_000)

  afterAll(async () => {
    vi.unstubAllEnvs()
    if (skip) return
    if (patientIds.length) {
      await db.delete(patientCases).where(inArray(patientCases.patientId, patientIds))
      await db.delete(treatmentPlans).where(inArray(treatmentPlans.patientId, patientIds))
    }
    await sweepLeakedFixtures()
    if (serviceId) await db.delete(services).where(eq(services.id, serviceId))
    await deleteLoginUsers(db, userIds)
  })

  it('the fixture really quotes a price that differs from the catalogue', async () => {
    const est = await quotedEstimate(patientP)
    expect(Number(est.lines[0].lineTotal)).toBe(CATALOGUE + SURCHARGE)
    expect(Number(est.lines[1].lineTotal)).toBe(CATALOGUE)
  })

  it('copies each seeded procedure’s quoted price and keeps the doctor’s edits', async () => {
    const est = await quotedEstimate(patientP)
    const { status, json } = await createPlan(doctorCookie, {
      patientId: patientP,
      title: 'Plan from the quote',
      sourceInvoiceId: est.id,
      items: [
        {
          sourceLineId: est.lines[0].id,
          serviceId,
          procedureName: 'Crown on 36 (edited)',
          toothNumber: 36,
          phase: 2,
          // Whatever the browser sends for a quoted line is ignored: the quote stands.
          estimatedCost: 1,
          notes: 'prep first',
        },
        { sourceLineId: est.lines[1].id, serviceId, procedureName: 'Second line', phase: 1 },
      ],
    })
    expect(status, JSON.stringify(json)).toBe(200)
    const plan = data(json) as Json
    expect(plan.sourceInvoiceId).toBe(est.id)
    expect(Number(plan.totalEstimated)).toBe(CATALOGUE + SURCHARGE + CATALOGUE)

    const items = await itemsOf(plan.id as string)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      procedureName: 'Crown on 36 (edited)',
      serviceId,
      toothNumber: 36,
      phase: 2,
      notes: 'prep first',
    })
    expect(Number(items[0].estimatedCost)).toBe(CATALOGUE + SURCHARGE)
    expect(Number(items[1].estimatedCost)).toBe(CATALOGUE)
  })

  it('keeps today’s rules for hand-added procedures alongside the quoted ones', async () => {
    const est = await quotedEstimate(patientP)
    const { status, json } = await createPlan(doctorCookie, {
      patientId: patientP,
      title: 'Quote plus extras',
      sourceInvoiceId: est.id,
      items: [
        { sourceLineId: est.lines[0].id, serviceId, procedureName: 'Quoted', phase: 1 },
        // A catalogue service with no estimate line: the catalogue price, as before.
        { serviceId, procedureName: 'Catalogue extra', phase: 1, estimatedCost: 99 },
        // A custom procedure: its typed cost (cents), as before.
        { procedureName: 'Custom splint', phase: 3, estimatedCost: 12000 },
      ],
    })
    expect(status, JSON.stringify(json)).toBe(200)
    const items = await itemsOf((data(json) as Json).id as string)
    expect(items.map((i) => Number(i.estimatedCost))).toEqual([
      CATALOGUE + SURCHARGE,
      CATALOGUE,
      12000,
    ])
    expect(Number((data(json) as Json).totalEstimated)).toBe(
      CATALOGUE + SURCHARGE + CATALOGUE + 12000
    )
  })

  it('reception building the plan gets the same quoted prices', async () => {
    const est = await quotedEstimate(patientP)
    const { status, json } = await createPlan(receptionCookie, {
      patientId: patientP,
      title: 'Reception plan',
      sourceInvoiceId: est.id,
      items: [{ sourceLineId: est.lines[0].id, serviceId, procedureName: 'Quoted', phase: 1 }],
    })
    expect(status, JSON.stringify(json)).toBe(200)
    const items = await itemsOf((data(json) as Json).id as string)
    expect(Number(items[0].estimatedCost)).toBe(CATALOGUE + SURCHARGE)
  })

  describe('refusals', () => {
    it('refuses a draft estimate: reception has not committed the charge', async () => {
      const est = await quotedEstimate(patientP, 'draft')
      const res = await createPlan(doctorCookie, {
        patientId: patientP,
        title: 'Too early',
        sourceInvoiceId: est.id,
        items: [{ sourceLineId: est.lines[0].id, serviceId, procedureName: 'x', phase: 1 }],
      })
      expect(res.status, JSON.stringify(res.json)).toBe(409)
    })

    it('refuses a voided estimate', async () => {
      const est = await quotedEstimate(patientP, 'void')
      const res = await createPlan(doctorCookie, {
        patientId: patientP,
        title: 'Voided',
        sourceInvoiceId: est.id,
        items: [{ sourceLineId: est.lines[0].id, serviceId, procedureName: 'x', phase: 1 }],
      })
      expect(res.status).toBe(409)
    })

    it('refuses a second plan for the same estimate', async () => {
      const est = await quotedEstimate(patientP)
      const body = {
        patientId: patientP,
        title: 'Once',
        sourceInvoiceId: est.id,
        items: [{ sourceLineId: est.lines[0].id, serviceId, procedureName: 'x', phase: 1 }],
      }
      expect((await createPlan(doctorCookie, body)).status).toBe(200)
      const again = await createPlan(doctorCookie, body)
      expect(again.status, JSON.stringify(again.json)).toBe(409)
      const plans = await db
        .select()
        .from(treatmentPlans)
        .where(eq(treatmentPlans.sourceInvoiceId, est.id))
      expect(plans).toHaveLength(1)
    })

    it('two simultaneous requests for the same estimate make exactly one plan', async () => {
      const est = await quotedEstimate(patientP)
      const body = {
        patientId: patientP,
        title: 'Race',
        sourceInvoiceId: est.id,
        items: [{ sourceLineId: est.lines[0].id, serviceId, procedureName: 'x', phase: 1 }],
      }
      const results = await Promise.all([
        createPlan(doctorCookie, body),
        createPlan(receptionCookie, body),
        createPlan(doctorCookie, body),
      ])
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409])
      const plans = await db
        .select()
        .from(treatmentPlans)
        .where(eq(treatmentPlans.sourceInvoiceId, est.id))
      expect(plans).toHaveLength(1)
    })

    it('refuses an estimate that belongs to another patient', async () => {
      const theirs = await quotedEstimate(patientQ)
      const res = await createPlan(doctorCookie, {
        patientId: patientP,
        title: 'Wrong patient',
        sourceInvoiceId: theirs.id,
        items: [{ sourceLineId: theirs.lines[0].id, serviceId, procedureName: 'x', phase: 1 }],
      })
      expect(res.status, JSON.stringify(res.json)).toBe(400)
    })

    it('refuses a line from a different estimate, or the same line twice', async () => {
      const mine = await quotedEstimate(patientP)
      const other = await quotedEstimate(patientP)
      const foreign = await createPlan(doctorCookie, {
        patientId: patientP,
        title: 'Foreign line',
        sourceInvoiceId: mine.id,
        items: [{ sourceLineId: other.lines[0].id, serviceId, procedureName: 'x', phase: 1 }],
      })
      expect(foreign.status, JSON.stringify(foreign.json)).toBe(400)

      const twice = await createPlan(doctorCookie, {
        patientId: patientP,
        title: 'Same line twice',
        sourceInvoiceId: mine.id,
        items: [
          { sourceLineId: mine.lines[0].id, serviceId, procedureName: 'a', phase: 1 },
          { sourceLineId: mine.lines[0].id, serviceId, procedureName: 'b', phase: 1 },
        ],
      })
      expect(twice.status, JSON.stringify(twice.json)).toBe(400)
      const made = await db
        .select()
        .from(treatmentPlans)
        .where(
          and(eq(treatmentPlans.patientId, patientP), eq(treatmentPlans.sourceInvoiceId, mine.id))
        )
      expect(made).toHaveLength(0)
    })

    it('refuses a source line without a source estimate', async () => {
      const est = await quotedEstimate(patientP)
      const res = await createPlan(doctorCookie, {
        patientId: patientP,
        title: 'Orphan line',
        items: [{ sourceLineId: est.lines[0].id, serviceId, procedureName: 'x', phase: 1 }],
      })
      expect(res.status).toBe(400)
    })

    it('refuses a typed cost that is not a whole, non-negative number of cents (F37)', async () => {
      // The old sheet posted cedis as typed: "75.50" arrived as 75.5, which the integer
      // column rejects (a raw 500), and nothing stopped a negative cost.
      for (const estimatedCost of [75.5, -100, 'abc']) {
        const res = await createPlan(doctorCookie, {
          patientId: patientP,
          title: `Bad cost ${String(estimatedCost)}`,
          items: [{ procedureName: 'Custom', phase: 1, estimatedCost }],
        })
        expect(res.status, `${String(estimatedCost)}: ${JSON.stringify(res.json)}`).toBe(400)
      }
      const left = await db
        .select()
        .from(treatmentPlans)
        .where(eq(treatmentPlans.title, 'Bad cost -100'))
      expect(left).toHaveLength(0)
    })

    it('answers a malformed estimate id with a 400, not a database error', async () => {
      const res = await createPlan(doctorCookie, {
        patientId: patientP,
        title: 'Bad id',
        sourceInvoiceId: 'not-a-uuid',
        items: [{ procedureName: 'x', phase: 1 }],
      })
      expect(res.status).toBe(400)
      expect(JSON.stringify(res.json)).not.toMatch(/select|params|Failed query/i)
    })
  })

  it('without an estimate, a plan is priced exactly as before (catalogue for services)', async () => {
    const { status, json } = await createPlan(doctorCookie, {
      patientId: patientP,
      title: 'No estimate',
      items: [{ serviceId, procedureName: 'Typed name', phase: 1, estimatedCost: 1 }],
    })
    expect(status, JSON.stringify(json)).toBe(200)
    expect((data(json) as Json).sourceInvoiceId ?? null).toBeNull()
    const items = await itemsOf((data(json) as Json).id as string)
    expect(Number(items[0].estimatedCost)).toBe(CATALOGUE)
    expect(items[0].procedureName).toBe(`IT PlanPrice Service ${TAG}`)
  })

  // F40 — "promote" (`POST /api/treatment-plans/from-invoice`, used by Clinical →
  // Estimates & Plans) had no one-plan-per-estimate rule and no lock: promoting an
  // estimate that already had a plan, or two clicks at once, made a second plan.
  describe('promoting an estimate makes at most one plan (F40)', () => {
    const promote = (invoiceId: string) =>
      callAs(app, 'portal', doctorCookie, 'POST', '/api/treatment-plans/from-invoice', {
        invoiceId,
      })
    const plansFor = (invoiceId: string) =>
      db.select().from(treatmentPlans).where(eq(treatmentPlans.sourceInvoiceId, invoiceId))

    it('refuses to promote an estimate that already has a plan', async () => {
      const est = await quotedEstimate(patientP)
      const first = await promote(est.id)
      expect(first.status, JSON.stringify(first.json)).toBe(200)
      const again = await promote(est.id)
      expect(again.status, JSON.stringify(again.json)).toBe(409)
      expect(await plansFor(est.id)).toHaveLength(1)
    })

    it('refuses to promote an estimate the plan sheet already built a plan from', async () => {
      const est = await quotedEstimate(patientP)
      const built = await createPlan(doctorCookie, {
        patientId: patientP,
        title: 'Built first',
        sourceInvoiceId: est.id,
        items: [{ sourceLineId: est.lines[0].id, serviceId, procedureName: 'x', phase: 1 }],
      })
      expect(built.status, JSON.stringify(built.json)).toBe(200)
      expect((await promote(est.id)).status).toBe(409)
      expect(await plansFor(est.id)).toHaveLength(1)
    })

    it('three simultaneous promotions make exactly one plan', async () => {
      const est = await quotedEstimate(patientP)
      const results = await Promise.all([promote(est.id), promote(est.id), promote(est.id)])
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409])
      expect(await plansFor(est.id)).toHaveLength(1)
    })
  })
})
