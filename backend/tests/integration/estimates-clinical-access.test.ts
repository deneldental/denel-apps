/**
 * F02 / F16 / F17 — doctors work with estimates without any payment access
 * (decisions D2 and D7). See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (Step 4).
 *
 * Before this, every estimate endpoint a doctor needed sat behind `payments:*`, which
 * no doctor holds: the patient's Estimates tab was empty, "View estimate" said it had
 * been confirmed by reception when it had merely failed to load, and a standalone
 * estimate could not be created. The "Generate Invoice" button, reachable with
 * `payments:read`, wrote a checked-in visit for whichever doctor row the database
 * returned first. And every doctor's day-sheet listed every standalone estimate in
 * the clinic, with the patient's name and phone.
 *
 * Real stack: the real app, real signed-in roles, a real database. Only SMS and Google
 * Calendar are stubbed. Nothing about authorization is mocked, so each "refused" result
 * is the real permission engine speaking.
 *
 * ── Safety ── commits fixtures; local Postgres only. Patients are named `IT …`
 * so `sweepLeakedFixtures` removes them (and their invoices) afterwards.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/estimates-clinical-access.test.ts
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/sms', () => ({
  sendSMS: vi.fn(async () => ({ success: true })),
  getHubtelCredentials: vi.fn(async () => null),
}))
vi.mock('../../src/lib/google-calendar', () => ({
  enrichAppointment: vi.fn(async () => null),
  syncAppointmentCreated: vi.fn(async () => null),
  syncAppointmentDeleted: vi.fn(async () => null),
  syncAppointmentUpdated: vi.fn(async () => null),
}))

import type { DB } from '../../src/db'
import {
  appointments,
  doctors,
  invoices,
  patientCases,
  patients,
  services,
  specialists,
  treatmentPlans,
} from '../../src/db/schema'
import { sweepLeakedFixtures } from './_fixtures'
import {
  callAs,
  createLoginUser,
  deleteLoginUsers,
  hasBackendSecrets,
  type Interface,
  isLocalDb,
  localDb,
  signInAs,
  type TestApp,
} from './_session'

const skip = !(isLocalDb && hasBackendSecrets)
const db = localDb() as DB

const TAG = `estclin-${Date.now()}`

type Role = 'doctorA' | 'doctorB' | 'receptionist' | 'staff' | 'lab' | 'admin'
const ROLE_ID: Record<Role, string> = {
  doctorA: 'doctor',
  doctorB: 'doctor',
  receptionist: 'receptionist',
  staff: 'staff',
  lab: 'lab_technician',
  admin: 'admin',
}
// Staff and lab technicians only sign in to the Team app.
const IFACE: Record<Role, Interface> = {
  doctorA: 'portal',
  doctorB: 'portal',
  receptionist: 'portal',
  staff: 'pwa',
  lab: 'pwa',
  admin: 'portal',
}

let app: TestApp
const userIds: string[] = []
const userOf = {} as Record<Role, string>
const cookies = {} as Record<Role, string>
const doctorRowOf = {} as Record<'doctorA' | 'doctorB', string>
const specialistIds: string[] = []
const patientIds: string[] = []
const apptIds: string[] = []
let serviceId: string
let instalmentId: string
let patientA: string
let patientB: string
let patientR: string

const call = (role: Role, method: string, path: string, body?: unknown) =>
  callAs(app, IFACE[role], cookies[role], method, path, body)

/** A parsed JSON object whose fields the tests check one by one. */
type Json = { [key: string]: unknown }

const data = (j: Record<string, unknown> | null) => (j?.data ?? null) as Json | null
const rows = (j: Record<string, unknown> | null) => (j?.data ?? []) as Json[]

async function newEstimate(role: Role, patientId: string) {
  const res = await call(role, 'POST', '/api/invoices/estimate', {
    patientId,
    lines: [{ serviceId, quantity: 1 }],
    note: `estimate by ${role}`,
  })
  return { ...res, invoiceId: (data(res.json)?.invoiceId ?? null) as string | null }
}

/**
 * A standalone estimate made through the real service as `role`'s user, bypassing the
 * route. The F16/F17 blocks use this so they test what they claim to (who sees an
 * estimate, what sending it does) whatever the creation route's permission is; the
 * route's own permission is the F02 block's business.
 */
async function seedEstimate(role: Role, patientId: string): Promise<string> {
  const { createEstimateDraft } = await import('../../src/lib/estimate-service')
  const res = await createEstimateDraft(
    db,
    { patientId, lines: [{ serviceId, quantity: 1 }], note: `seeded for ${role}` },
    userOf[role]
  )
  return res.invoice.id
}

async function invoiceRow(id: string) {
  const [i] = await db.select().from(invoices).where(eq(invoices.id, id))
  return i
}
const apptsOf = (patientId: string) =>
  db.select().from(appointments).where(eq(appointments.patientId, patientId))

describe.skipIf(skip)('estimates without payment access (D2, D7)', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { validateBackendEnv } = await import('../../src/config/env')
    validateBackendEnv()
    app = (await import('../../src/app')).app as unknown as TestApp
    await sweepLeakedFixtures()

    for (const role of Object.keys(ROLE_ID) as Role[]) {
      // Lower-case: Better Auth normalises the address at sign-in, so a stored
      // "doctorA-…" would never match.
      const email = `${role.toLowerCase()}-${TAG}@estclin.test`
      const id = await createLoginUser(db, {
        email,
        name: `EstClin ${role} ${TAG}`,
        roleId: ROLE_ID[role],
        baRole: role === 'admin' ? 'admin' : undefined,
      })
      userIds.push(id)
      userOf[role] = id
      cookies[role] = await signInAs(app, email, IFACE[role])
    }

    // Two doctors, one in each of the two shapes that exist in real data (a doctor
    // row is either user-sourced or specialist-sourced, never both):
    //   A — specialist-sourced, how every doctor made in the portal looks;
    //   B — user-sourced, how the seed makes them.
    const [specA] = await db
      .insert(specialists)
      .values({
        name: `IT EstClin doctorA ${TAG}`,
        defaultCommissionRate: 0,
        withholdingTaxRate: 0,
        userId: userOf.doctorA,
      })
      .returning({ id: specialists.id })
    specialistIds.push(specA.id)
    const [docA] = await db
      .insert(doctors)
      .values({ specialistId: specA.id, specialty: 'General Dentistry' })
      .returning({ id: doctors.id })
    doctorRowOf.doctorA = docA.id
    const [docB] = await db
      .insert(doctors)
      .values({ userId: userOf.doctorB, specialty: 'General Dentistry' })
      .returning({ id: doctors.id })
    doctorRowOf.doctorB = docB.id

    const mk = async (label: string, phone: string) => {
      const [p] = await db
        .insert(patients)
        .values({
          name: `IT EstClin ${label} ${TAG}`,
          dob: new Date('1990-01-01'),
          gender: 'other',
          phone,
        })
        .returning({ id: patients.id })
      patientIds.push(p.id)
      return p.id
    }
    patientA = await mk('A', '0240000051')
    patientB = await mk('B', '0240000052')
    patientR = await mk('R', '0240000053')

    const [svc] = await db
      .insert(services)
      .values({
        category: 'clinic',
        name: `IT EstClin Service ${TAG}`,
        amount: 25000,
        status: 'active',
        createdById: userOf.admin,
      })
      .returning({ id: services.id })
    serviceId = svc.id

    // An invoice that is NOT an estimate, and is a draft so that only its type — not
    // its status — can keep it out of the estimate endpoints.
    const [inst] = await db
      .insert(invoices)
      .values({
        invoiceNumber: `IT-INST-${TAG}`,
        patientId: patientA,
        type: 'plan_installment',
        status: 'draft',
        amount: 5000,
        subtotal: 5000, // invoices_total_consistency_check: total = subtotal + surcharge − discount + tax
        total: 5000,
        balance: 5000,
      })
      .returning({ id: invoices.id })
    instalmentId = inst.id
  }, 120_000)

  afterAll(async () => {
    vi.unstubAllEnvs()
    if (skip) return
    // The plan/case test creates a treatment plan and a case for fixture patients.
    if (patientIds.length) {
      await db.delete(patientCases).where(inArray(patientCases.patientId, patientIds))
      await db.delete(treatmentPlans).where(inArray(treatmentPlans.patientId, patientIds))
    }
    // The sweeper removes the `IT …` patients and, with them, their invoices.
    await sweepLeakedFixtures()
    if (apptIds.length) await db.delete(appointments).where(inArray(appointments.id, apptIds))
    if (doctorRowOf.doctorA)
      await db
        .delete(doctors)
        .where(inArray(doctors.id, [doctorRowOf.doctorA, doctorRowOf.doctorB].filter(Boolean)))
    if (specialistIds.length)
      await db.delete(specialists).where(inArray(specialists.id, specialistIds))
    if (serviceId) await db.delete(services).where(eq(services.id, serviceId))
    await deleteLoginUsers(db, userIds)
  })

  // ── F02: create, list and view ─────────────────────────────────────────────

  describe('F02 — a doctor creates, lists and views estimates', () => {
    let estimateId: string

    it('a doctor creates a standalone estimate, recorded as theirs', async () => {
      const { status, json, invoiceId } = await newEstimate('doctorA', patientA)
      expect(status, JSON.stringify(json)).toBe(200)
      expect(invoiceId).toBeTruthy()
      estimateId = invoiceId as string

      const row = await invoiceRow(estimateId)
      expect(row).toMatchObject({
        patientId: patientA,
        type: 'one_time',
        status: 'draft',
        appointmentId: null,
        createdBy: userOf.doctorA,
      })
    })

    it('lists the patient’s estimates, with no payment figures', async () => {
      const { status, json } = await call('doctorA', 'GET', `/api/estimates/patient/${patientA}`)
      expect(status, JSON.stringify(json)).toBe(200)
      const list = rows(json)
      const mine = list.find((e) => e.id === estimateId)
      expect(mine, 'the estimate is listed').toBeTruthy()
      // Pinned on purpose: a new field has to be added here on purpose, so nothing
      // that describes money already paid can slip into the clinical surface.
      expect(Object.keys(mine as object).sort()).toEqual(
        ['createdAt', 'description', 'id', 'invoiceNumber', 'status', 'total'].sort()
      )
      expect(mine?.status).toBe('draft')
      expect(Number(mine?.total)).toBeGreaterThan(0)
    })

    it('does not list another patient’s estimates or non-estimate invoices', async () => {
      // Status is asserted too: against a missing route "no such row" is trivially true.
      const other = await call('doctorA', 'GET', `/api/estimates/patient/${patientB}`)
      expect(other.status, JSON.stringify(other.json)).toBe(200)
      expect(rows(other.json).map((e) => e.id)).not.toContain(estimateId)

      // A plan instalment is an invoice but not an estimate (patient A has one, as a draft).
      const res = await call('doctorA', 'GET', `/api/estimates/patient/${patientA}`)
      expect(res.status, JSON.stringify(res.json)).toBe(200)
      expect(rows(res.json).map((e) => e.id)).toContain(estimateId)
      expect(rows(res.json).map((e) => e.id)).not.toContain(instalmentId)
    })

    it('views one estimate with its lines and no payment history', async () => {
      const { status, json } = await call('doctorA', 'GET', `/api/estimates/${estimateId}`)
      expect(status, JSON.stringify(json)).toBe(200)
      const e = data(json) as Json
      expect(Object.keys(e).sort()).toEqual(
        [
          'appointmentId',
          'createdAt',
          'currency',
          'description',
          'discountTotal',
          'id',
          'invoiceNumber',
          'lines',
          'patientId',
          'status',
          'subtotal',
          'taxTotal',
          'total',
          'visitFrequency',
        ].sort()
      )
      expect(e.status).toBe('draft')
      const lines = e.lines as Json[]
      expect(lines).toHaveLength(1)
      // `serviceId` is the catalogue service: the treatment-plan builder needs it to
      // carry each procedure through to the plan. `lineSubtotal` lets a first-unit /
      // additional-unit line read as what it is (review §8.16), not as unit price × quantity.
      expect(Object.keys(lines[0]).sort()).toEqual(
        [
          'description',
          'id',
          'lineSubtotal',
          'lineTotal',
          'quantity',
          'serviceId',
          'unitPrice',
          'variantName',
        ].sort()
      )
      expect(lines[0].serviceId).toBe(serviceId)
      // Nothing about money received, the patient record, or ledger accounts.
      for (const forbidden of ['payments', 'patient', 'paidAmount', 'balance', 'plan']) {
        expect(e, `must not expose ${forbidden}`).not.toHaveProperty(forbidden)
      }
    })

    it('shows an estimate reception has already issued, with its real status', async () => {
      await db.update(invoices).set({ status: 'issued' }).where(eq(invoices.id, estimateId))
      const { json } = await call('doctorA', 'GET', `/api/estimates/${estimateId}`)
      expect(data(json)?.status).toBe('issued')
      await db.update(invoices).set({ status: 'draft' }).where(eq(invoices.id, estimateId))
    })

    it('answers 404 — never 500 — for a missing, malformed or non-estimate id', async () => {
      // Control first: the route exists and serves a real estimate, so the 404s
      // below are the route refusing, not the route being absent.
      expect((await call('doctorA', 'GET', `/api/estimates/${estimateId}`)).status).toBe(200)
      for (const id of [crypto.randomUUID(), 'not-a-uuid', instalmentId]) {
        const res = await call('doctorA', 'GET', `/api/estimates/${id}`)
        expect(res.status, `GET /api/estimates/${id}`).toBe(404)
      }
      expect((await call('doctorA', 'GET', `/api/estimates/patient/${patientA}`)).status).toBe(200)
      const bad = await call('doctorA', 'GET', '/api/estimates/patient/not-a-uuid')
      expect(bad.status).toBe(404)
    })

    it('refuses an unknown or malformed patient plainly, not with a 500 (F38)', async () => {
      // An unknown patient used to reach the insert and fail on the foreign key
      // (a generic 500); a malformed id reached Postgres as well.
      const unknown = await call('doctorA', 'POST', '/api/invoices/estimate', {
        patientId: crypto.randomUUID(),
        lines: [{ serviceId, quantity: 1 }],
      })
      expect(unknown.status, JSON.stringify(unknown.json)).toBe(404)
      expect(String(unknown.json?.error)).toMatch(/patient not found/i)

      const malformed = await call('doctorA', 'POST', '/api/invoices/estimate', {
        patientId: 'not-a-uuid',
        lines: [{ serviceId, quantity: 1 }],
      })
      expect(malformed.status, JSON.stringify(malformed.json)).toBe(400)
      for (const res of [unknown, malformed]) {
        expect(JSON.stringify(res.json)).not.toMatch(/select|insert|params|Failed query/i)
      }
    })

    it('reception can still do all of it (it holds payments:*)', async () => {
      const made = await newEstimate('receptionist', patientR)
      expect(made.status, JSON.stringify(made.json)).toBe(200)
      const list = await call('receptionist', 'GET', `/api/estimates/patient/${patientR}`)
      expect(list.status).toBe(200)
      expect(rows(list.json).map((e) => e.id)).toContain(made.invoiceId)
      const one = await call('receptionist', 'GET', `/api/estimates/${made.invoiceId}`)
      expect(one.status).toBe(200)
    })

    it('refuses roles with no estimate permission', async () => {
      for (const role of ['staff', 'lab'] as const) {
        const view = await call(role, 'GET', `/api/estimates/${estimateId}`)
        expect(view.status, `${role} view`).toBe(403)
        const list = await call(role, 'GET', `/api/estimates/patient/${patientA}`)
        expect(list.status, `${role} list`).toBe(403)
        const create = await newEstimate(role, patientA)
        expect(create.status, `${role} create`).toBe(403)
      }
    })

    it('does NOT open the payment endpoints to a doctor', async () => {
      for (const path of [
        `/api/invoices/${estimateId}`,
        `/api/invoices/patient/${patientA}`,
        `/api/invoices/${estimateId}/lines`,
        '/api/invoices',
        '/api/payments',
      ]) {
        const res = await call('doctorA', 'GET', path)
        expect(res.status, `doctor GET ${path}`).toBe(403)
      }
      const patch = await call('doctorA', 'PATCH', `/api/invoices/${estimateId}`, {
        status: 'waived',
      })
      expect(patch.status).toBe(403)
      expect((await invoiceRow(estimateId)).status).toBe('draft')
    })
  })

  // ── F17: send to reception ─────────────────────────────────────────────────

  describe('F17 — send to reception no longer invents a visit', () => {
    let standalone: string

    beforeAll(async () => {
      standalone = await seedEstimate('doctorA', patientA)
    })

    it('a doctor can send their estimate to reception, and no appointment appears', async () => {
      const before = (await apptsOf(patientA)).length

      const { status, json } = await call(
        'doctorA',
        'POST',
        `/api/invoices/${standalone}/send-to-reception`,
        {}
      )
      expect(status, JSON.stringify(json)).toBe(200)
      expect(data(json)?.appointmentId ?? null).toBeNull()

      expect(await apptsOf(patientA)).toHaveLength(before)
      expect((await invoiceRow(standalone)).appointmentId).toBeNull()
    })

    it('reception sending a standalone estimate creates no visit either', async () => {
      const id = await seedEstimate('receptionist', patientR)
      const before = (await apptsOf(patientR)).length
      const { status, json } = await call(
        'receptionist',
        'POST',
        `/api/invoices/${id}/send-to-reception`,
        {}
      )
      expect(status, JSON.stringify(json)).toBe(200)
      expect(await apptsOf(patientR)).toHaveLength(before)
      expect((await invoiceRow(id)).appointmentId).toBeNull()
    })

    it('the sent estimate is still on the reception lens, confirmable as a synthetic visit', async () => {
      const { json } = await call('receptionist', 'GET', '/api/worklist/reception')
      const visit = (data(json)?.visits as Json[]).find((v) => v.estimateInvoiceId === standalone)
      expect(visit, 'reception sees the standalone estimate').toBeTruthy()
      expect(visit?.type).toBe('estimate')
      expect(visit?.estimateStatus).toBe('estimate_ready')
    })

    it('stamps estimate_ready on the visit when the estimate belongs to one', async () => {
      const [a] = await db
        .insert(appointments)
        .values({
          patientId: patientB,
          doctorId: doctorRowOf.doctorB,
          date: new Date(Date.now() + 3_600_000),
          status: 'checked_in',
          type: 'consultation',
          requiresEstimate: true,
          estimateStatus: 'awaiting_estimate',
        })
        .returning({ id: appointments.id })
      apptIds.push(a.id)
      const made = await call('doctorB', 'POST', `/api/worklist/${a.id}/estimate`, {
        lines: [{ serviceId, quantity: 1 }],
      })
      expect(made.status, JSON.stringify(made.json)).toBe(200)
      await db
        .update(appointments)
        .set({ estimateStatus: 'awaiting_estimate' })
        .where(eq(appointments.id, a.id))

      const sent = await call(
        'doctorB',
        'POST',
        `/api/invoices/${data(made.json)?.invoiceId}/send-to-reception`,
        {}
      )
      expect(sent.status, JSON.stringify(sent.json)).toBe(200)
      expect(data(sent.json)?.appointmentId).toBe(a.id)
      const [after] = await db.select().from(appointments).where(eq(appointments.id, a.id))
      expect(after.estimateStatus).toBe('estimate_ready')
    })

    it('refuses roles with no estimate permission, and leaves the estimate alone', async () => {
      for (const role of ['staff', 'lab'] as const) {
        const res = await call(role, 'POST', `/api/invoices/${standalone}/send-to-reception`, {})
        expect(res.status, role).toBe(403)
      }
    })

    it('only sends a draft estimate', async () => {
      const id = await seedEstimate('receptionist', patientR)
      await db.update(invoices).set({ status: 'issued' }).where(eq(invoices.id, id))
      const res = await call('receptionist', 'POST', `/api/invoices/${id}/send-to-reception`, {})
      expect(res.status).toBe(400)
    })

    it('does not send an invoice that is not an estimate, even a draft one', async () => {
      const res = await call(
        'receptionist',
        'POST',
        `/api/invoices/${instalmentId}/send-to-reception`,
        {}
      )
      expect(res.status).toBe(404)
      expect((await invoiceRow(instalmentId)).appointmentId).toBeNull()
    })

    it('answers an unknown or malformed id with a plain 404 and no SQL', async () => {
      for (const id of [crypto.randomUUID(), 'not-a-uuid']) {
        const res = await call('receptionist', 'POST', `/api/invoices/${id}/send-to-reception`, {})
        expect(res.status, id).toBe(404)
        const text = JSON.stringify(res.json)
        expect(text).not.toMatch(/select|insert|params|Failed query/i)
      }
    })
  })

  // ── F16: the day-sheet ─────────────────────────────────────────────────────

  describe('F16 — a doctor’s day-sheet shows only their own', () => {
    let estA: string
    let estB: string
    let estR: string
    let apptB: string

    const visitsOf = async (role: Role, qs = '') => {
      const res = await call(role, 'GET', `/api/worklist/doctor${qs}`)
      return {
        status: res.status,
        visits: (data(res.json)?.visits ?? []) as Json[],
      }
    }
    const patientsOnSheet = (v: Json[]) => new Set(v.map((x) => x.patientName as string))

    beforeAll(async () => {
      estA = await seedEstimate('doctorA', patientA)
      estB = await seedEstimate('doctorB', patientB)
      estR = await seedEstimate('receptionist', patientR)

      const [a] = await db
        .insert(appointments)
        .values({
          patientId: patientB,
          doctorId: doctorRowOf.doctorB,
          date: new Date(),
          status: 'scheduled',
          type: 'consultation',
        })
        .returning({ id: appointments.id })
      apptB = a.id
      apptIds.push(a.id)
    })

    it('doctor A sees their own standalone estimate, and not doctor B’s or reception’s', async () => {
      const { status, visits } = await visitsOf('doctorA')
      expect(status).toBe(200)
      const ids = visits.map((v) => v.estimateInvoiceId)
      expect(ids).toContain(estA)
      expect(ids).not.toContain(estB)
      expect(ids).not.toContain(estR)
      const names = patientsOnSheet(visits)
      expect(names.has(`IT EstClin B ${TAG}`)).toBe(false)
      expect(names.has(`IT EstClin R ${TAG}`)).toBe(false)
    })

    it('doctor B sees their own, and not doctor A’s', async () => {
      const { visits } = await visitsOf('doctorB')
      const ids = visits.map((v) => v.estimateInvoiceId)
      expect(ids).toContain(estB)
      expect(ids).not.toContain(estA)
      expect(ids).not.toContain(estR)
    })

    it('holds for a date far from today (the estimate stays until it is resolved)', async () => {
      const { visits } = await visitsOf('doctorA', '?date=2031-03-04')
      const ids = visits.map((v) => v.estimateInvoiceId)
      expect(ids).toContain(estA)
      expect(ids).not.toContain(estB)
    })

    it('reception sees all of them, and an admin without a doctor filter does too', async () => {
      const rec = await call('receptionist', 'GET', '/api/worklist/reception')
      const recIds = (data(rec.json)?.visits as Json[]).map((v) => v.estimateInvoiceId)
      for (const id of [estA, estB, estR]) expect(recIds).toContain(id)

      const adm = await visitsOf('admin')
      const admIds = adm.visits.map((v) => v.estimateInvoiceId)
      for (const id of [estA, estB, estR]) expect(admIds).toContain(id)
    })

    it('an admin viewing one doctor sees that doctor’s estimates only (specialist-sourced doctor)', async () => {
      const { status, visits } = await visitsOf('admin', `?doctorId=${doctorRowOf.doctorA}`)
      expect(status).toBe(200)
      const ids = visits.map((v) => v.estimateInvoiceId)
      expect(ids).toContain(estA)
      expect(ids).not.toContain(estB)
      expect(ids).not.toContain(estR)
    })

    it('…and the same for a user-sourced doctor', async () => {
      const { status, visits } = await visitsOf('admin', `?doctorId=${doctorRowOf.doctorB}`)
      expect(status).toBe(200)
      const ids = visits.map((v) => v.estimateInvoiceId)
      expect(ids).toContain(estB)
      expect(ids).not.toContain(estA)
      expect(ids).not.toContain(estR)
    })

    it('rejects a malformed doctorId with a 400, not a database error', async () => {
      for (const role of ['admin', 'doctorA'] as const) {
        const res = await call(role, 'GET', '/api/worklist/doctor?doctorId=not-a-uuid')
        expect(res.status, role).toBe(400)
        expect(JSON.stringify(res.json)).not.toMatch(/select|params|Failed query/i)
      }
    })

    it('a doctor cannot read another doctor’s day-sheet by naming them', async () => {
      // Doctor B has a visit today. Naming B's id used to hand A that whole sheet.
      const other = await visitsOf('doctorA', `?doctorId=${doctorRowOf.doctorB}`)
      expect(other.status).toBe(403)
      expect(other.visits).toHaveLength(0)
      expect(JSON.stringify(other)).not.toContain(apptB)
    })

    it('a doctor may name themselves', async () => {
      const own = await visitsOf('doctorA', `?doctorId=${doctorRowOf.doctorA}`)
      expect(own.status).toBe(200)
      expect(own.visits.map((v) => v.estimateInvoiceId)).toContain(estA)
    })

    it('a doctor still sees their own scheduled visits', async () => {
      const { visits } = await visitsOf('doctorB')
      expect(visits.map((v) => v.appointmentId)).toContain(apptB)
    })
  })

  // ── Review finding: cancelling an estimate ─────────────────────────────────
  //
  // `POST /api/worklist/:id/cancel` is gated on `appointments:update`, which every
  // doctor holds, and when `:id` matched no visit it deleted ANY draft invoice with
  // that id. That reached a plan instalment, and another doctor's estimate. The
  // portal only calls it from the reception lens.

  describe('cancelling an estimate', () => {
    const cancel = (role: Role, id: string) => call(role, 'POST', `/api/worklist/${id}/cancel`, {})
    const stillThere = async (id: string) => Boolean(await invoiceRow(id))

    it('a doctor cannot delete another doctor’s estimate', async () => {
      const theirs = await seedEstimate('doctorB', patientB)
      const res = await cancel('doctorA', theirs)
      expect(res.status, JSON.stringify(res.json)).toBe(403)
      expect(await stillThere(theirs)).toBe(true)
    })

    it('a doctor cannot delete an invoice that is not an estimate', async () => {
      // A draft plan instalment: real money documents are not the doctor's to remove.
      const res = await cancel('doctorA', instalmentId)
      expect(res.status).toBe(200)
      expect(data(res.json)?.cancelled).toBe(0)
      expect(await stillThere(instalmentId)).toBe(true)
    })

    it('a doctor can cancel their own estimate', async () => {
      const own = await seedEstimate('doctorA', patientA)
      const res = await cancel('doctorA', own)
      expect(res.status, JSON.stringify(res.json)).toBe(200)
      expect(data(res.json)?.cancelled).toBe(1)
      expect(await stillThere(own)).toBe(false)
    })

    it('reception can cancel any standalone estimate, as the reception lens does', async () => {
      const doctors = await seedEstimate('doctorB', patientB)
      const res = await cancel('receptionist', doctors)
      expect(res.status, JSON.stringify(res.json)).toBe(200)
      expect(await stillThere(doctors)).toBe(false)
    })

    it('an admin can too', async () => {
      const doctors = await seedEstimate('doctorA', patientA)
      const res = await cancel('admin', doctors)
      expect(res.status, JSON.stringify(res.json)).toBe(200)
      expect(await stillThere(doctors)).toBe(false)
    })

    it('answers a malformed id with a plain 404, not a database error', async () => {
      const res = await cancel('receptionist', 'not-a-uuid')
      expect(res.status).toBe(404)
      expect(JSON.stringify(res.json)).not.toMatch(/select|delete|params|Failed query/i)
    })
  })

  // ── The exit criterion: estimate → view → plan, with no payment access ───────

  describe('a doctor’s whole path: estimate → view → plan', () => {
    it('creates, views, and (once reception issues it) builds a plan from it', async () => {
      // 1. The doctor creates the estimate.
      const made = await newEstimate('doctorA', patientA)
      expect(made.status, JSON.stringify(made.json)).toBe(200)
      const id = made.invoiceId as string

      // 2. …and views it, with the catalogue service the plan will need.
      const view = await call('doctorA', 'GET', `/api/estimates/${id}`)
      expect(view.status).toBe(200)
      const lines = data(view.json)?.lines as Json[]
      expect(lines).toHaveLength(1)
      expect(lines[0].serviceId).toBe(serviceId)

      // 3. A plan cannot be built from a draft: reception has not committed the charge.
      const early = await call('doctorA', 'POST', '/api/treatment-plans/from-invoice', {
        invoiceId: id,
      })
      expect(early.status, JSON.stringify(early.json)).toBe(409)

      // 4. Reception issues it (done directly: confirming it is reception's, tested elsewhere).
      await db.update(invoices).set({ status: 'issued' }).where(eq(invoices.id, id))

      // 5. Now the doctor builds the plan, and gets its case.
      const plan = await call('doctorA', 'POST', '/api/treatment-plans/from-invoice', {
        invoiceId: id,
      })
      expect(plan.status, JSON.stringify(plan.json)).toBe(200)
      expect(data(plan.json)).toMatchObject({ patientId: patientA, sourceInvoiceId: id })
      expect(data(plan.json)?.caseId).toBeTruthy()

      // At no point did the doctor touch a payment endpoint.
      expect((await call('doctorA', 'GET', `/api/invoices/${id}`)).status).toBe(403)
    })
  })

  // ── What the portal reads to decide which buttons to show ───────────────────
  //
  // The portal tests mock `/api/auth/permissions`. This is the real payload for the
  // real roles, so the buttons the portal shows are the ones the server will honour.

  describe('the permission payload the portal reads', () => {
    const permsOf = async (role: Role) => {
      const res = await call(role, 'GET', '/api/auth/permissions')
      expect(res.status, JSON.stringify(res.json)).toBe(200)
      return (data(res.json)?.permissions ?? {}) as Record<string, string[]>
    }

    it('a doctor gets estimates (read, create, update) and no payment access', async () => {
      const p = await permsOf('doctorA')
      expect([...(p.estimates ?? [])].sort()).toEqual(['create', 'read', 'update'])
      expect(p.payments).toBeUndefined()
      expect(p.financial_records).toBeUndefined()
    })

    it('a doctor can open a case and cannot archive one', async () => {
      const p = await permsOf('doctorA')
      expect(p.medical_records).toContain('create')
      expect(p.patients ?? []).not.toContain('delete')
      expect(p.patients ?? []).not.toContain('create')
    })

    it('reception gets estimates too', async () => {
      const p = await permsOf('receptionist')
      expect([...(p.estimates ?? [])].sort()).toEqual(['create', 'read', 'update'])
    })

    // Step 5 (F07): the route guard lets a user stay on a page only if the page's
    // module is in `accessibleModules`. The portal's unit tests assume what this
    // returns for the real roles, so it is checked here against the real server.
    const modulesOf = async (role: Role) => {
      const res = await call(role, 'GET', '/api/auth/permissions')
      expect(res.status, JSON.stringify(res.json)).toBe(200)
      return (data(res.json)?.accessibleModules ?? []) as string[]
    }

    it('a doctor can open ortho consent but not the compliance hub', async () => {
      const modules = await modulesOf('doctorA')
      expect(modules).toContain('ortho_consent')
      expect(modules).not.toContain('compliance')
    })

    it('reception can open both, as before', async () => {
      const modules = await modulesOf('receptionist')
      expect(modules).toContain('ortho_consent')
      expect(modules).toContain('compliance')
    })

    it('a Team-app staff member gets none of it', async () => {
      const res = await call('staff', 'GET', '/api/auth/permissions')
      const p = (data(res.json)?.permissions ?? {}) as Record<string, string[]>
      expect(p.estimates).toBeUndefined()
    })
  })
})
