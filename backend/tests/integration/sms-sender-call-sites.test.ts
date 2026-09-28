/**
 * Six notification paths passed `process.env.HUBTEL_SENDER_ID` to sendSMS as an
 * explicit sender. sendSMS lets an explicit sender win, so on those paths the
 * environment outranked the Sender ID saved in Integrations → Hubtel. They must
 * leave the sender to sendSMS, as every other SMS path already does.
 *
 * Each path is driven for real — routes against a real database — with the
 * environment variable set, and what it hands sendSMS is captured.
 *
 * ── Safety ──────────────────────────────────────────────────────────────────
 * Routes open their own connection, so their fixtures must be COMMITTED. The
 * suite therefore refuses anything but a LOCAL Postgres (like
 * param-routes-writes) and deletes what it created afterwards. Patients are
 * named `IT …` so `sweepLeakedFixtures` also removes their payments, invoices
 * and journal entries.
 *
 *   DATABASE_URL=postgresql://framada:framada@localhost:5433/framada \
 *     npx vitest run tests/integration/sms-sender-call-sites.test.ts
 */

import { Hono } from 'hono'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

const RAW_DB_URL = process.env.DATABASE_URL ?? ''
const IS_LOCAL = /@(localhost|127\.0\.0\.1|host\.docker\.internal)([:/]|$)/.test(RAW_DB_URL)
/** Never run against Neon/production — this suite commits rows. */
const skip = !IS_LOCAL

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://localhost:5433/framada',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    BETTER_AUTH_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
  },
  validateBackendEnv: vi.fn(),
  isSelfHealEnabled: () => false,
  isDevEnvironment: () => false,
  resolvedEnvironment: () => 'production',
}))
vi.mock('../../src/lib/rbac')
vi.mock('../../src/lib/audit', () => ({
  createAuditLog: vi.fn(),
  recordDiffAudit: vi.fn(),
  computeChangedFields: vi.fn(() => ({})),
  redactForAudit: vi.fn((row: unknown) => row),
  auditMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../src/lib/sms', () => ({
  sendSMS: vi.fn(async () => ({ success: true })),
}))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../src/lib/google-calendar', () => ({
  enrichAppointment: vi.fn(async () => null),
  syncAppointmentCreated: vi.fn(async () => null),
  syncAppointmentDeleted: vi.fn(async () => null),
  syncAppointmentUpdated: vi.fn(async () => null),
}))

import { inArray, sql } from 'drizzle-orm'
import { type DB, getDb } from '../../src/db'
import {
  appointments,
  appointmentTypeReminders,
  appointmentTypes,
  doctors,
  patients,
  reminderTemplates,
  specialists,
} from '../../src/db/schema'
import { handleOnBookingReminders } from '../../src/lib/appointment-reminders-service'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { sendSMS } from '../../src/lib/sms'
import { appointmentWorkflowApp } from '../../src/routes/appointment-workflow'
import { appointmentsApp } from '../../src/routes/appointments'
import { patientsApp } from '../../src/routes/patients'
import { paymentPlansApp } from '../../src/routes/payment-plans'
import { paymentsApp } from '../../src/routes/payments'
import { sweepLeakedFixtures } from './_fixtures'
import { withRollback } from './_setup'

/** Tags every fixture so a crashed run is identifiable. */
const TAG = `sender-${Date.now()}`
const PHONE = '0240000001'

let db: DB
let app: Hono<HonoEnv>
let adminUserId: string
let patientId: string
let appointmentId: string

const created = {
  appointments: [] as string[],
  doctors: [] as string[],
  specialists: [] as string[],
}

function makeApp(): Hono<HonoEnv> {
  const a = new Hono<HonoEnv>()
  a.route('/api/patients', patientsApp)
  a.route('/api/appointments', appointmentsApp)
  a.route('/api/appointment-workflow', appointmentWorkflowApp)
  a.route('/api/payments', paymentsApp)
  a.route('/api/payment-plans', paymentPlansApp)
  return a
}

async function send(method: string, path: string, payload?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* empty body */
  }
  return { status: res.status, body }
}

/** The sender each captured sendSMS call named for messages to `phone`. */
function sendersPassedFor(phone: string): unknown[] {
  return vi
    .mocked(sendSMS)
    .mock.calls.filter(([recipients]) => recipients.some((r) => r.phone === phone))
    .map(([, from]) => from)
}

/** A doctor must link exactly one of a user or a specialist (doctors_source_xor). */
async function makeDoctor(tx: DB): Promise<{ specialistId: string; doctorId: string }> {
  const [s] = await tx
    .insert(specialists)
    .values({ name: `IT Specialist ${TAG}`, defaultCommissionRate: 0, withholdingTaxRate: 0 })
    .returning({ id: specialists.id })
  const [d] = await tx
    .insert(doctors)
    .values({ specialistId: s.id, specialty: 'General Dentistry' })
    .returning({ id: doctors.id })
  return { specialistId: s.id, doctorId: d.id }
}

describe.skipIf(skip)('SMS paths leave the sender to the configured Sender ID', () => {
  beforeAll(async () => {
    db = getDb(RAW_DB_URL)
    await sweepLeakedFixtures()

    const users = await db.execute<{ id: string }>(
      sql`SELECT id FROM "user" ORDER BY "createdAt" LIMIT 1`
    )
    adminUserId = users.rows[0]?.id
    if (!adminUserId) throw new Error('No rows in "user" — run `pnpm --filter backend seed:admin`')

    const [p] = await db
      .insert(patients)
      .values({
        name: `IT Sender ${TAG}`,
        dob: new Date('1990-01-01'),
        gender: 'other',
        phone: PHONE,
      })
      .returning({ id: patients.id })
    patientId = p.id

    const { specialistId, doctorId } = await makeDoctor(db)
    created.specialists.push(specialistId)
    created.doctors.push(doctorId)

    const [a] = await db
      .insert(appointments)
      .values({
        patientId,
        doctorId,
        date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        status: 'scheduled',
        type: 'consultation',
      })
      .returning({ id: appointments.id })
    appointmentId = a.id
    created.appointments.push(a.id)

    app = makeApp()
  })

  afterAll(async () => {
    vi.unstubAllEnvs()
    if (skip || !db) return
    if (created.appointments.length)
      await db.delete(appointments).where(inArray(appointments.id, created.appointments))
    // Patients (and their payments, invoices, plans and journal entries).
    await sweepLeakedFixtures()
    if (created.doctors.length) await db.delete(doctors).where(inArray(doctors.id, created.doctors))
    if (created.specialists.length)
      await db.delete(specialists).where(inArray(specialists.id, created.specialists))
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('HUBTEL_SENDER_ID', 'EnvSender')
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: adminUserId,
      email: 'admin@framada.app',
      name: 'Admin',
      role: 'admin',
      roleId: 'admin',
    } as never)
    vi.mocked(checkPermission).mockResolvedValue(true)
  })

  it('welcome SMS for a new patient', async () => {
    const phone = '0240000002'
    const { status, body } = await send('POST', '/api/patients', {
      name: `IT Sender Welcome ${TAG}`,
      dob: '1990-01-01',
      gender: 'female',
      phone,
      address: 'Test Street',
      occupation: 'Tester',
    })
    expect(status, JSON.stringify(body)).toBe(200)

    expect(sendersPassedFor(phone)).toEqual([undefined])
  })

  it('appointment update SMS', async () => {
    const { status, body } = await send('PATCH', `/api/appointments/${appointmentId}`, {
      data: { status: 'confirmed' },
      sendSMS: true,
    })
    expect(status, JSON.stringify(body)).toBe(200)

    expect(sendersPassedFor(PHONE)).toEqual([undefined])
  })

  it('appointment confirmation-link SMS', async () => {
    const { status, body } = await send(
      'POST',
      `/api/appointment-workflow/${appointmentId}/send-confirmation`
    )
    expect(status, JSON.stringify(body)).toBe(200)

    expect(sendersPassedFor(PHONE)).toEqual([undefined])
  })

  it('on-booking reminder SMS', async () => {
    await withRollback(async (tx) => {
      const typeName = `IT Checkup ${TAG}`
      const [type] = await tx
        .insert(appointmentTypes)
        .values({ name: typeName })
        .returning({ id: appointmentTypes.id })
      const [template] = await tx
        .insert(reminderTemplates)
        .values({ name: `IT template ${TAG}`, messageTemplate: 'Hi {Patientname}, see you {date}' })
        .returning({ id: reminderTemplates.id })
      await tx.insert(appointmentTypeReminders).values({
        appointmentTypeId: type.id,
        triggerType: 'on_booking',
        templateId: template.id,
      })
      const [patient] = await tx
        .insert(patients)
        .values({
          name: `IT Sender Reminder ${TAG}`,
          dob: new Date('1990-01-01'),
          gender: 'other',
          phone: '0240000003',
        })
        .returning({ id: patients.id })

      await handleOnBookingReminders(
        tx,
        { patientId: patient.id, date: new Date(Date.now() + 86_400_000), type: typeName },
        adminUserId
      )
    })

    expect(sendersPassedFor('0240000003')).toEqual([undefined])
  })

  it('payment receipt SMS', async () => {
    const { status, body } = await send('POST', '/api/payments', {
      patientId,
      amount: 5000,
      method: 'cash',
      sendNotification: true,
    })
    expect(status, JSON.stringify(body)).toBe(200)

    expect(sendersPassedFor(PHONE)).toEqual([undefined])
  })

  it('payment-plan created SMS', async () => {
    const { status, body } = await send('POST', '/api/payment-plans', {
      type: 'fixed',
      patientId,
      numberOfInstallments: 2,
      paymentFrequency: 'monthly',
      startDate: new Date().toISOString(),
      lines: [
        {
          description: `IT treatment ${TAG}`,
          quantity: 1,
          unitPrice: 10000,
          discountType: 'none',
          discountValue: 0,
        },
      ],
      sendSms: true,
    })
    expect(status, JSON.stringify(body)).toBe(200)

    expect(sendersPassedFor(PHONE)).toEqual([undefined])
  })
})
