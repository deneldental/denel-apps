/**
 * F33 — a walk-in's payment names its visit, and the visit it names is checked.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md.
 *
 * The portal records a walk-in (already checked in) and then opens the ordinary
 * payment sheet, which posted the payment with no `appointmentId`, so the money was
 * never tied to the visit. The fix sends the visit with the payment. That makes the
 * `appointmentId` on `POST /api/payments` load-bearing, and the route checked nothing
 * about it: a malformed or unknown id reached the foreign key (a raw 500), and a visit
 * belonging to ANOTHER patient was linked without complaint.
 *
 * Linking only names the visit (receipt date, reporting). It never checks anyone in;
 * a walk-in is already checked in, and the check-in request would refuse to take money
 * for it.
 *
 * Real stack: real app, real signed-in receptionist, real database and ledger.
 *
 * ── Safety ── commits fixtures; local Postgres only. Patients are named `IT …` so
 * `sweepLeakedFixtures` removes their payments and journal entries.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/payment-appointment-link.test.ts
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/sms', () => ({
  sendSMS: vi.fn(async () => ({ success: true })),
  getHubtelCredentials: vi.fn(async () => null),
}))

import type { DB } from '../../src/db'
import { appointments, doctors, patients, payments, specialists } from '../../src/db/schema'
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

const TAG = `paylink-${Date.now()}`

let app: TestApp
const userIds: string[] = []
let cookie = ''
let patientA: string
let patientB: string
let specialistId: string
let doctorId: string
let visitA: string
let visitB: string
const apptIds: string[] = []

const pay = (body: Record<string, unknown>) =>
  callAs(app, 'portal', cookie, 'POST', '/api/payments', {
    amount: 15000,
    method: 'cash',
    description: 'Walk-in',
    sendNotification: false,
    ...body,
  })
const paymentsOf = (patientId: string) =>
  db.select().from(payments).where(eq(payments.patientId, patientId))

describe.skipIf(skip)('a payment names its visit, and the visit is checked (F33)', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { validateBackendEnv } = await import('../../src/config/env')
    validateBackendEnv()
    app = (await import('../../src/app')).app as unknown as TestApp
    await sweepLeakedFixtures()

    const email = `receptionist-${TAG}@paylink.test`
    userIds.push(
      await createLoginUser(db, { email, name: 'PayLink reception', roleId: 'receptionist' })
    )
    cookie = await signInAs(app, email, 'portal')

    const mk = async (label: string, phone: string) => {
      const [p] = await db
        .insert(patients)
        .values({
          name: `IT PayLink ${label} ${TAG}`,
          dob: new Date('1990-01-01'),
          gender: 'other',
          phone,
        })
        .returning({ id: patients.id })
      return p.id
    }
    patientA = await mk('A', '0240000081')
    patientB = await mk('B', '0240000082')

    const [s] = await db
      .insert(specialists)
      .values({ name: `IT PayLink Spec ${TAG}`, defaultCommissionRate: 0, withholdingTaxRate: 0 })
      .returning({ id: specialists.id })
    specialistId = s.id
    const [d] = await db
      .insert(doctors)
      .values({ specialistId, specialty: 'General Dentistry' })
      .returning({ id: doctors.id })
    doctorId = d.id

    // A walk-in: created already checked in, as the walk-in sheet does.
    const visit = async (patientId: string) => {
      const [a] = await db
        .insert(appointments)
        .values({
          patientId,
          doctorId,
          date: new Date(),
          status: 'checked_in',
          checkedInAt: new Date(),
          type: 'consultation',
          notes: 'Walk-in',
        })
        .returning({ id: appointments.id })
      apptIds.push(a.id)
      return a.id
    }
    visitA = await visit(patientA)
    visitB = await visit(patientB)
  }, 120_000)

  afterAll(async () => {
    vi.unstubAllEnvs()
    if (skip) return
    // Payments must still exist when the sweeper runs: it finds the ledger through them.
    await sweepLeakedFixtures()
    if (apptIds.length) await db.delete(appointments).where(inArray(appointments.id, apptIds))
    if (doctorId) await db.delete(doctors).where(eq(doctors.id, doctorId))
    if (specialistId) await db.delete(specialists).where(eq(specialists.id, specialistId))
    await deleteLoginUsers(db, userIds)
  })

  it('records the payment against the walk-in visit, and leaves the visit as it was', async () => {
    const { status, json } = await pay({ patientId: patientA, appointmentId: visitA })
    expect(status, JSON.stringify(json)).toBe(200)
    const linked = (await paymentsOf(patientA)).filter((p) => p.appointmentId === visitA)
    expect(linked).toHaveLength(1)
    const [after] = await db.select().from(appointments).where(eq(appointments.id, visitA))
    expect(after.status).toBe('checked_in')
  })

  it('refuses a visit that belongs to another patient, and records nothing', async () => {
    const before = (await paymentsOf(patientA)).length
    const { status, json } = await pay({ patientId: patientA, appointmentId: visitB })
    expect(status, JSON.stringify(json)).toBe(400)
    expect(await paymentsOf(patientA)).toHaveLength(before)
  })

  it('refuses an unknown visit with a 400, not a database error', async () => {
    const before = (await paymentsOf(patientA)).length
    const { status, json } = await pay({ patientId: patientA, appointmentId: crypto.randomUUID() })
    expect(status, JSON.stringify(json)).toBe(400)
    expect(JSON.stringify(json)).not.toMatch(/insert|params|Failed query|foreign key/i)
    expect(await paymentsOf(patientA)).toHaveLength(before)
  })

  it('refuses a malformed visit id with a 400, not a database error', async () => {
    const { status, json } = await pay({ patientId: patientA, appointmentId: 'not-a-uuid' })
    expect(status, JSON.stringify(json)).toBe(400)
    expect(JSON.stringify(json)).not.toMatch(/insert|params|Failed query/i)
  })

  it('still records a payment that names no visit', async () => {
    const { status, json } = await pay({ patientId: patientB })
    expect(status, JSON.stringify(json)).toBe(200)
    expect((await paymentsOf(patientB)).some((p) => p.appointmentId === null)).toBe(true)
  })

  // F41 — the explicit draft route (`POST /api/payments/draft`, used by Receive Payment)
  // took the same `appointmentId` unchecked: another patient's visit was linked, and an
  // unknown visit failed on the foreign key with the SQL returned in the error text.
  describe('the draft payment route checks the visit too (F41)', () => {
    const draft = (body: Record<string, unknown>) =>
      callAs(app, 'portal', cookie, 'POST', '/api/payments/draft', {
        amount: 15000,
        method: 'cash',
        description: 'Plan payment',
        ...body,
      })

    it('links a draft payment to the patient’s own visit', async () => {
      const { status, json } = await draft({ patientId: patientA, appointmentId: visitA })
      expect(status, JSON.stringify(json)).toBe(200)
      expect((json?.data as { appointmentId?: string })?.appointmentId).toBe(visitA)
    })

    it('refuses another patient’s visit, and creates no draft', async () => {
      const before = (await paymentsOf(patientA)).length
      const { status, json } = await draft({ patientId: patientA, appointmentId: visitB })
      expect(status, JSON.stringify(json)).toBe(400)
      expect(await paymentsOf(patientA)).toHaveLength(before)
    })

    it('refuses an unknown visit plainly, without the SQL', async () => {
      const { status, json } = await draft({
        patientId: patientA,
        appointmentId: crypto.randomUUID(),
      })
      expect(status, JSON.stringify(json)).toBe(400)
      expect(JSON.stringify(json)).not.toMatch(/insert|params|Failed query|foreign key/i)
    })
  })
})
