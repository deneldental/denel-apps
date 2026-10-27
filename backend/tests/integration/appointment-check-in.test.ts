/**
 * F09 / F10 / F11 / F18 / F19 — the server-side check-in operation (decision D6).
 * `POST /api/appointment-workflow/:id/check-in`.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (Step 3).
 *
 * Before this, "check in with payment" was two requests from the browser: record
 * the payment, then flip the status. If the second failed the payment stayed with
 * no visit, the screen reported success, and the Check In button reappeared (a
 * second payment). The payment never named its visit, and the doctor's pending
 * note was never queued for a booked patient. One request now does all of it, or
 * none of it.
 *
 * Real stack, nothing about authorization or the ledger is mocked: the real app,
 * real signed-in roles, a real database and the real general ledger. Only SMS and
 * Google Calendar are stubbed (no outside world), and the pending-note step can be
 * made to fail on demand to prove the rollback.
 *
 * ── Safety ── commits fixtures; local Postgres only. Patients are named `IT …`
 * so `sweepLeakedFixtures` also removes their payments and journal entries.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/appointment-check-in.test.ts
 */
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const failNote = vi.hoisted(() => ({ on: false }))
const failPayment = vi.hoisted(() => ({ on: false }))

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
// A database fault while the ledger records the payment (deadlock, dropped
// connection, constraint). Off unless a test turns it on.
vi.mock('../../src/lib/payment-service', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/lib/payment-service')>()
  return {
    ...original,
    recordLegacyPayment: async (...args: Parameters<typeof original.recordLegacyPayment>) => {
      if (failPayment.on) {
        const { DrizzleQueryError } = await import('drizzle-orm')
        throw new DrizzleQueryError(
          'insert into "payments" ("patientId", "amount") values ($1, $2)',
          ['secret-patient-id-123', 15000],
          new Error('deadlock detected')
        )
      }
      return original.recordLegacyPayment(...args)
    },
  }
})
vi.mock('../../src/lib/pending-medical-record-service', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../src/lib/pending-medical-record-service')>()
  return {
    ...original,
    ensurePendingMedicalRecord: (
      ...args: Parameters<typeof original.ensurePendingMedicalRecord>
    ) => {
      if (failNote.on) throw new Error('simulated failure while queueing the doctor note')
      return original.ensurePendingMedicalRecord(...args)
    },
  }
})

import type { DB } from '../../src/db'
import {
  appointments,
  auditLogs,
  doctors,
  journalEntries,
  patients,
  payments,
  pendingMedicalRecords,
  specialists,
} from '../../src/db/schema'
import { sendSMS } from '../../src/lib/sms'
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

const TAG = `checkin-${Date.now()}`
const PHONE = '0240000041'
const DAY = 24 * 60 * 60 * 1000

let app: TestApp
const userIds: string[] = []
const cookies = { receptionist: '', doctor: '', staff: '', admin: '' }
let patientId: string
let doctorId: string
let specialistId: string
const apptIds: string[] = []

/** A visit for the fixture patient, defaulting to later today. */
async function makeAppt(over: Partial<typeof appointments.$inferInsert> = {}) {
  const [a] = await db
    .insert(appointments)
    .values({
      patientId,
      doctorId,
      date: new Date(Date.now() + 60 * 60 * 1000),
      status: 'scheduled',
      type: 'consultation',
      ...over,
    })
    .returning()
  apptIds.push(a.id)
  return a
}

const checkIn = (role: keyof typeof cookies, id: string, body: unknown) =>
  callAs(app, 'portal', cookies[role], 'POST', `/api/appointment-workflow/${id}/check-in`, body)

const asPayload = (j: Record<string, unknown> | null) => (j?.data ?? {}) as Record<string, unknown>

async function apptRow(id: string) {
  const [a] = await db.select().from(appointments).where(eq(appointments.id, id))
  return a
}
const paymentsFor = (id: string) => db.select().from(payments).where(eq(payments.appointmentId, id))
const notesFor = (id: string) =>
  db.select().from(pendingMedicalRecords).where(eq(pendingMedicalRecords.appointmentId, id))

const PAY = { amount: 15000, method: 'cash', description: 'Consultation', sendNotification: false }

describe.skipIf(skip)('check-in: one request, all or nothing (D6)', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { validateBackendEnv } = await import('../../src/config/env')
    validateBackendEnv()
    app = (await import('../../src/app')).app as unknown as TestApp
    await sweepLeakedFixtures()

    for (const [key, roleId] of [
      ['receptionist', 'receptionist'],
      ['doctor', 'doctor'],
      ['staff', 'staff'],
      ['admin', 'admin'],
    ] as const) {
      userIds.push(
        await createLoginUser(db, {
          email: `${key}-${TAG}@checkin.test`,
          name: `CheckIn ${key} ${TAG}`,
          roleId,
          baRole: key === 'admin' ? 'admin' : undefined,
        })
      )
      cookies[key] = await signInAs(
        app,
        `${key}-${TAG}@checkin.test`,
        key === 'staff' ? 'pwa' : 'portal'
      )
    }

    const [p] = await db
      .insert(patients)
      .values({
        name: `IT CheckIn ${TAG}`,
        dob: new Date('1990-01-01'),
        gender: 'other',
        phone: PHONE,
      })
      .returning({ id: patients.id })
    patientId = p.id
    const [s] = await db
      .insert(specialists)
      .values({ name: `IT CheckIn Spec ${TAG}`, defaultCommissionRate: 0, withholdingTaxRate: 0 })
      .returning({ id: specialists.id })
    specialistId = s.id
    const [d] = await db
      .insert(doctors)
      .values({ specialistId, specialty: 'General Dentistry' })
      .returning({ id: doctors.id })
    doctorId = d.id
  }, 120_000)

  afterAll(async () => {
    vi.unstubAllEnvs()
    if (skip) return
    if (apptIds.length) {
      await db
        .delete(pendingMedicalRecords)
        .where(inArray(pendingMedicalRecords.appointmentId, apptIds))
    }
    // The sweeper finds a patient's ledger entries THROUGH their payments, so the
    // payments must still exist when it runs (deleting them first orphans the
    // journal entries, which are immutable and then cannot be found again).
    await sweepLeakedFixtures()
    if (apptIds.length) await db.delete(appointments).where(inArray(appointments.id, apptIds))
    await db.delete(doctors).where(eq(doctors.id, doctorId))
    await db.delete(specialists).where(eq(specialists.id, specialistId))
    await deleteLoginUsers(db, userIds)
  })

  beforeEach(() => {
    failNote.on = false
    failPayment.on = false
    vi.clearAllMocks()
  })

  describe('with a payment', () => {
    it('records the payment against the visit, checks the patient in and queues the doctor note', async () => {
      const a = await makeAppt()
      const { status, json } = await checkIn('receptionist', a.id, { payment: PAY })

      expect(status, JSON.stringify(json)).toBe(200)
      expect(asPayload(json).alreadyCheckedIn).toBe(false)

      const after = await apptRow(a.id)
      expect(after.status).toBe('checked_in')
      expect(after.checkedInAt).toBeInstanceOf(Date)

      const paid = await paymentsFor(a.id)
      expect(paid).toHaveLength(1)
      expect(paid[0]).toMatchObject({
        patientId,
        appointmentId: a.id,
        method: 'cash',
        status: 'posted',
      })
      expect(Number(paid[0].amount)).toBe(15000)

      // It reached the general ledger.
      const entries = await db
        .select()
        .from(journalEntries)
        .where(eq(journalEntries.sourceDocId, paid[0].id))
      expect(entries.length).toBeGreaterThan(0)

      // The doctor's to-do exists (F18).
      const notes = await notesFor(a.id)
      expect(notes).toHaveLength(1)
      expect(notes[0]).toMatchObject({ patientId, doctorId, status: 'pending' })
    })

    it('uses the visit’s own patient, ignoring any patient the request names', async () => {
      const a = await makeAppt()
      const { status } = await checkIn('receptionist', a.id, {
        payment: { ...PAY, patientId: '00000000-0000-0000-0000-000000000000' },
      })
      expect(status).toBe(200)
      expect((await paymentsFor(a.id))[0].patientId).toBe(patientId)
    })

    it('sends the receipt SMS when asked, and a failed SMS never undoes the check-in', async () => {
      vi.mocked(sendSMS).mockRejectedValueOnce(new Error('Hubtel credentials not configured'))
      const a = await makeAppt()
      const { status, json } = await checkIn('receptionist', a.id, {
        payment: { ...PAY, sendNotification: true },
      })

      expect(status, JSON.stringify(json)).toBe(200)
      expect(json?.smsError).toContain('Hubtel credentials not configured')
      expect((await apptRow(a.id)).status).toBe('checked_in')
      expect(await paymentsFor(a.id)).toHaveLength(1)
    })

    // D23: a method nobody has set up used to be posted to the Cash account without a word.
    it('a payment method nobody has set up is refused, and the check-in rolls back', async () => {
      const a = await makeAppt()
      const { status, json } = await checkIn('receptionist', a.id, {
        payment: { ...PAY, method: 'banana' },
      })

      expect(status).toBe(400)
      expect(json?.code).toBe('CHECKIN_PAYMENT_REJECTED')
      expect(String(json?.error)).toBe('unknown payment method "banana"')
      expect((await apptRow(a.id)).status).toBe('scheduled')
      expect(await paymentsFor(a.id)).toHaveLength(0)
    })

    it('a payment the ledger refuses rolls the whole check-in back', async () => {
      const a = await makeAppt()
      // Earlier tests leave this patient with wallet credit (an unallocated cash
      // payment is stored as credit), so ask for far more than they could hold.
      const { status, json } = await checkIn('receptionist', a.id, {
        payment: { ...PAY, method: 'wallet', amount: 900_000_000 },
      })

      expect(status).toBe(400)
      expect(json?.code).toBe('CHECKIN_PAYMENT_REJECTED')
      expect((await apptRow(a.id)).status).toBe('scheduled')
      expect(await paymentsFor(a.id)).toHaveLength(0)
      expect(await notesFor(a.id)).toHaveLength(0)
    })
  })

  describe('a database fault is not a cashier error', () => {
    it('is a generic 500: no SQL, no parameters and no database wording reach the browser', async () => {
      const a = await makeAppt()
      failPayment.on = true
      const { status, json } = await checkIn('receptionist', a.id, { payment: PAY })

      expect(status).toBe(500)
      expect(json?.code).toBe('CHECKIN_FAILED')
      const body = JSON.stringify(json)
      for (const leak of [
        'insert into',
        'secret-patient-id-123',
        'deadlock',
        'Failed query',
        'params',
      ]) {
        expect(body, `response leaked "${leak}"`).not.toContain(leak)
      }
      expect((await apptRow(a.id)).status).toBe('scheduled')
      expect(await paymentsFor(a.id)).toHaveLength(0)
    })

    it('and a genuine ledger refusal is still a 400 the cashier can act on (control)', async () => {
      const a = await makeAppt()
      const { status, json } = await checkIn('receptionist', a.id, {
        payment: { ...PAY, method: 'wallet', amount: 900_000_000 },
      })
      expect(status).toBe(400)
      expect(json?.code).toBe('CHECKIN_PAYMENT_REJECTED')
    })
  })

  describe('atomicity (F10)', () => {
    it('if queueing the doctor note fails, there is no payment, no check-in and no ledger entry', async () => {
      const a = await makeAppt()
      const entriesBefore = (await db.select().from(journalEntries)).length
      failNote.on = true
      const { status, json } = await checkIn('receptionist', a.id, { payment: PAY })

      expect(status).toBe(500)
      expect(json?.code).toBe('CHECKIN_FAILED')
      expect((await apptRow(a.id)).status).toBe('scheduled')
      expect((await apptRow(a.id)).checkedInAt).toBeNull()
      expect(await paymentsFor(a.id)).toHaveLength(0)
      expect((await db.select().from(journalEntries)).length).toBe(entriesBefore)

      // …and a retry, once the fault is gone, completes cleanly with ONE payment.
      failNote.on = false
      const retry = await checkIn('receptionist', a.id, { payment: PAY })
      expect(retry.status).toBe(200)
      expect(await paymentsFor(a.id)).toHaveLength(1)
    })
  })

  describe('a second request can never charge twice (F09)', () => {
    it('a retry after success is an idempotent success with no new payment', async () => {
      const a = await makeAppt()
      expect((await checkIn('receptionist', a.id, { payment: PAY })).status).toBe(200)

      const again = await checkIn('receptionist', a.id, { payment: PAY })
      expect(again.status).toBe(200)
      expect(asPayload(again.json).alreadyCheckedIn).toBe(true)
      expect(asPayload(again.json).payment).toBeNull()
      expect(await paymentsFor(a.id)).toHaveLength(1)
      expect(await notesFor(a.id)).toHaveLength(1)
    })

    it('two simultaneous requests (a double-click) take exactly one payment', async () => {
      const a = await makeAppt()
      const [r1, r2] = await Promise.all([
        checkIn('receptionist', a.id, { payment: PAY }),
        checkIn('receptionist', a.id, { payment: PAY }),
      ])

      expect([r1.status, r2.status]).toEqual([200, 200])
      const flags = [r1, r2].map((r) => asPayload(r.json).alreadyCheckedIn)
      expect(flags.sort()).toEqual([false, true])
      expect(await paymentsFor(a.id)).toHaveLength(1)
      expect(await notesFor(a.id)).toHaveLength(1)
    })

    it.each(['checked_in', 'in_chair'])('a visit already %s takes no payment', async (state) => {
      const a = await makeAppt({ status: state, checkedInAt: new Date() })
      const { status, json } = await checkIn('receptionist', a.id, { payment: PAY })

      expect(status).toBe(200)
      expect(asPayload(json).alreadyCheckedIn).toBe(true)
      expect(await paymentsFor(a.id)).toHaveLength(0)
    })
  })

  describe('who and what may be checked in', () => {
    it.each([
      'scheduled',
      'confirmed',
      'rescheduled',
    ])('a %s visit can be checked in', async (state) => {
      const a = await makeAppt({ status: state })
      const { status } = await checkIn('receptionist', a.id, { noPaymentReason: 'courtesy visit' })
      expect(status).toBe(200)
      expect((await apptRow(a.id)).status).toBe('checked_in')
    })

    it.each([
      'completed',
      'cancelled',
      'no_show',
    ])('a %s visit is refused and takes no payment', async (state) => {
      const a = await makeAppt({ status: state })
      const { status, json } = await checkIn('receptionist', a.id, { payment: PAY })

      expect(status).toBe(409)
      expect(json?.code).toBe('APPOINTMENT_TERMINAL')
      expect((await apptRow(a.id)).status).toBe(state)
      expect(await paymentsFor(a.id)).toHaveLength(0)
    })

    it('an unknown visit is a 404', async () => {
      const { status } = await checkIn('receptionist', '00000000-0000-0000-0000-000000000000', {
        payment: PAY,
      })
      expect(status).toBe(404)
    })

    it('a doctor can check in without payment but cannot take one', async () => {
      const a = await makeAppt()
      const withPay = await checkIn('doctor', a.id, { payment: PAY })
      expect(withPay.status).toBe(403)
      expect((await apptRow(a.id)).status).toBe('scheduled')
      expect(await paymentsFor(a.id)).toHaveLength(0)

      const without = await checkIn('doctor', a.id, { noPaymentReason: 'doctor walk-through' })
      expect(without.status).toBe(200)
    })

    it('Team-app staff may not check anyone in', async () => {
      const a = await makeAppt()
      const { status } = await callAs(
        app,
        'pwa',
        cookies.staff,
        'POST',
        `/api/appointment-workflow/${a.id}/check-in`,
        { noPaymentReason: 'should be refused' }
      )
      expect(status).toBe(403)
      expect((await apptRow(a.id)).status).toBe('scheduled')
    })
  })

  describe('no payment, and payment taken elsewhere', () => {
    it('a no-payment check-in keeps the reason on the visit and creates no payment', async () => {
      const a = await makeAppt()
      const { status } = await checkIn('receptionist', a.id, {
        noPaymentReason: 'follow-up, covered',
      })

      expect(status).toBe(200)
      const after = await apptRow(a.id)
      expect(after.status).toBe('checked_in')
      expect(after.notes).toContain('Checked in without payment')
      expect(after.notes).toContain('follow-up, covered')
      expect(await paymentsFor(a.id)).toHaveLength(0)
      expect(await notesFor(a.id)).toHaveLength(1)
    })

    it('"payment recorded separately" (plan or insurance) checks in and creates no payment', async () => {
      const a = await makeAppt()
      const { status } = await checkIn('receptionist', a.id, { paymentRecordedElsewhere: true })

      expect(status).toBe(200)
      expect((await apptRow(a.id)).status).toBe('checked_in')
      expect(await paymentsFor(a.id)).toHaveLength(0)
      expect(await notesFor(a.id)).toHaveLength(1)
    })

    it.each([
      ['no mode at all', {}],
      ['two modes', { payment: PAY, noPaymentReason: 'both' }],
      ['a reason that is too short', { noPaymentReason: 'x' }],
      ['a zero amount', { payment: { ...PAY, amount: 0 } }],
      ['a negative amount', { payment: { ...PAY, amount: -5 } }],
      ['no method', { payment: { amount: 100 } }],
    ])('rejects %s and changes nothing', async (_label, body) => {
      const a = await makeAppt()
      const { status } = await checkIn('receptionist', a.id, body)

      expect(status).toBe(400)
      expect((await apptRow(a.id)).status).toBe('scheduled')
      expect(await paymentsFor(a.id)).toHaveLength(0)
      expect(await notesFor(a.id)).toHaveLength(0)
    })
  })

  describe('estimate routing is preserved', () => {
    it('a requires-estimate visit goes to the doctor’s estimate queue', async () => {
      const a = await makeAppt({ requiresEstimate: true })
      expect(
        (await checkIn('receptionist', a.id, { noPaymentReason: 'estimate visit' })).status
      ).toBe(200)
      expect((await apptRow(a.id)).estimateStatus).toBe('awaiting_estimate')
    })
  })

  describe('past days (D6)', () => {
    const yesterday = () => new Date(Date.now() - DAY - 60 * 60 * 1000)

    it('a receptionist cannot check in a visit from a previous day', async () => {
      const a = await makeAppt({ date: yesterday() })
      const { status, json } = await checkIn('receptionist', a.id, { payment: PAY })

      expect(status).toBe(403)
      expect(json?.code).toBe('APPOINTMENT_PAST_LOCKED')
      expect((await apptRow(a.id)).status).toBe('scheduled')
      expect(await paymentsFor(a.id)).toHaveLength(0)
    })

    it('an admin needs a written reason, and then it is recorded in the audit trail', async () => {
      const a = await makeAppt({ date: yesterday() })
      const without = await checkIn('admin', a.id, { noPaymentReason: 'late entry' })
      expect(without.status).toBe(400)
      expect(without.json?.code).toBe('OVERRIDE_REASON_REQUIRED')

      const withReason = await checkIn('admin', a.id, {
        noPaymentReason: 'late entry',
        overrideReason: 'Receptionist forgot to check the patient in yesterday',
      })
      expect(withReason.status, JSON.stringify(withReason.json)).toBe(200)
      expect((await apptRow(a.id)).status).toBe('checked_in')

      const rows = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityId, a.id), eq(auditLogs.module, 'appointments')))
      expect(rows.some((r) => r.reason?.includes('Receptionist forgot'))).toBe(true)
    })
  })
})
