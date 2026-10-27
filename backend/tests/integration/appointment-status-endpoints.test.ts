/**
 * F19 / F09 / F18 / decision D6 — the status machine and the past-day rule, as
 * the three status-changing endpoints actually enforce them:
 *   PATCH /api/appointment-workflow/:id/transition   (check-in, seat, complete, no-show, cancel)
 *   PATCH /api/appointments/:id                       (the raw edit)
 *   POST  /api/appointment-workflow/public/confirm/:token   (the patient's SMS link; no sign-in)
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (Step 3).
 *
 * The pure rules are pinned in tests/unit/appointment-status-machine.test.ts; this
 * file proves the endpoints obey them. Real app, real signed-in roles, real
 * database; only SMS and Google Calendar are stubbed.
 *
 * ── Safety ── commits fixtures; local Postgres only; patients named `IT …`.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/appointment-status-endpoints.test.ts
 */
import { and, eq, inArray } from 'drizzle-orm'
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

import { zonedStartOfDay } from '@denel/utils'
import type { DB } from '../../src/db'
import {
  appointments,
  auditLogs,
  doctors,
  patients,
  pendingMedicalRecords,
  specialists,
} from '../../src/db/schema'
import { APPOINTMENT_STATUSES, canChangeStatus } from '../../src/lib/appointment-status'
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

const TAG = `status-${Date.now()}`
const HOUR = 60 * 60 * 1000

let app: TestApp
const userIds: string[] = []
const cookies = { receptionist: '', doctor: '', admin: '' }
let patientId: string
let doctorId: string
let specialistId: string
const apptIds: string[] = []
let ipCounter = 0

const startOfToday = () => zonedStartOfDay(new Date()).getTime()
const dates = {
  today: () => new Date(Date.now() + HOUR),
  yesterday: () => new Date(startOfToday() - 6 * HOUR),
  twoDaysAgo: () => new Date(startOfToday() - 30 * HOUR),
}

async function makeAppt(over: Partial<typeof appointments.$inferInsert> = {}) {
  const status = over.status ?? 'scheduled'
  const arrived = status === 'checked_in' || status === 'in_chair'
  const [a] = await db
    .insert(appointments)
    .values({
      patientId,
      doctorId,
      date: dates.today(),
      status: 'scheduled',
      type: 'consultation',
      ...(arrived ? { checkedInAt: new Date(Date.now() - HOUR) } : {}),
      ...over,
    })
    .returning()
  apptIds.push(a.id)
  return a
}
async function row(id: string) {
  const [a] = await db.select().from(appointments).where(eq(appointments.id, id))
  return a
}

const transition = (role: keyof typeof cookies, id: string, body: Record<string, unknown>) =>
  callAs(app, 'portal', cookies[role], 'PATCH', `/api/appointment-workflow/${id}/transition`, body)
const patchAppt = (
  role: keyof typeof cookies,
  id: string,
  data: Record<string, unknown>,
  extra = {}
) => callAs(app, 'portal', cookies[role], 'PATCH', `/api/appointments/${id}`, { data, ...extra })

/** The patient's SMS link: no session, a distinct client address per call. */
async function publicConfirm(token: string, response: 'yes' | 'no') {
  const res = await app.request(`/api/appointment-workflow/public/confirm/${token}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cf-connecting-ip': `10.77.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`,
    },
    body: JSON.stringify({ response }),
  })
  let json: Record<string, unknown> | null = null
  try {
    json = await res.json()
  } catch {
    /* empty */
  }
  return { status: res.status, json }
}
async function publicLookup(token: string) {
  const res = await app.request(`/api/appointment-workflow/public/confirm/${token}`, {
    headers: {
      'cf-connecting-ip': `10.78.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`,
    },
  })
  return { status: res.status, json: (await res.json()) as { data?: { alreadyActed?: boolean } } }
}

const ACTIONS: Array<[string, string]> = [
  ['check-in', 'checked_in'],
  ['seat', 'in_chair'],
  ['complete', 'completed'],
  ['no-show', 'no_show'],
  ['cancel', 'cancelled'],
]

describe.skipIf(skip)(
  'F19 — the status endpoints enforce the machine and the past-day rule',
  () => {
    beforeAll(async () => {
      vi.stubEnv('NODE_ENV', 'development')
      const { validateBackendEnv } = await import('../../src/config/env')
      validateBackendEnv()
      app = (await import('../../src/app')).app as unknown as TestApp
      await sweepLeakedFixtures()

      for (const [key, roleId] of [
        ['receptionist', 'receptionist'],
        ['doctor', 'doctor'],
        ['admin', 'admin'],
      ] as const) {
        userIds.push(
          await createLoginUser(db, {
            email: `${key}-${TAG}@status.test`,
            name: `Status ${key} ${TAG}`,
            roleId,
            baRole: key === 'admin' ? 'admin' : undefined,
          })
        )
        cookies[key] = await signInAs(app, `${key}-${TAG}@status.test`, 'portal')
      }
      const [p] = await db
        .insert(patients)
        .values({
          name: `IT Status ${TAG}`,
          dob: new Date('1990-01-01'),
          gender: 'other',
          phone: '0240000051',
        })
        .returning({ id: patients.id })
      patientId = p.id
      const [s] = await db
        .insert(specialists)
        .values({ name: `IT Status Spec ${TAG}`, defaultCommissionRate: 0, withholdingTaxRate: 0 })
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
      await sweepLeakedFixtures()
      if (apptIds.length) await db.delete(appointments).where(inArray(appointments.id, apptIds))
      await db.delete(doctors).where(eq(doctors.id, doctorId))
      await db.delete(specialists).where(eq(specialists.id, specialistId))
      await deleteLoginUsers(db, userIds)
    })

    describe('PATCH …/transition: every action from every status', () => {
      const cases = APPOINTMENT_STATUSES.flatMap((from) =>
        ACTIONS.map(([action, to]) => [from, action, to] as const)
      )

      it.each(cases)('%s + %s → %s', async (from, action, to) => {
        const a = await makeAppt({ status: from })
        const { status, json } = await transition('receptionist', a.id, { action })
        const after = await row(a.id)

        if (canChangeStatus(from, to)) {
          expect(status, JSON.stringify(json)).toBe(200)
          expect(after.status).toBe(to)
        } else {
          expect(status, JSON.stringify(json)).toBe(409)
          expect(json?.code).toBe(
            ['completed', 'cancelled', 'no_show'].includes(from)
              ? 'APPOINTMENT_TERMINAL'
              : 'APPOINTMENT_INVALID_TRANSITION'
          )
          expect(after.status).toBe(from)
        }
      })

      it('an unknown action is a 400', async () => {
        const a = await makeAppt()
        expect((await transition('receptionist', a.id, { action: 'teleport' })).status).toBe(400)
      })

      it('a second check-in does not re-stamp the arrival time', async () => {
        const a = await makeAppt({ status: 'checked_in' })
        const before = (await row(a.id)).checkedInAt
        const { status } = await transition('receptionist', a.id, { action: 'check-in' })

        expect(status).toBe(409)
        expect((await row(a.id)).checkedInAt?.getTime()).toBe(before?.getTime())
      })

      it('checking in queues the doctor’s note, and stamps the arrival (F18)', async () => {
        const a = await makeAppt()
        expect((await transition('receptionist', a.id, { action: 'check-in' })).status).toBe(200)

        expect((await row(a.id)).checkedInAt).toBeInstanceOf(Date)
        const notes = await db
          .select()
          .from(pendingMedicalRecords)
          .where(eq(pendingMedicalRecords.appointmentId, a.id))
        expect(notes).toHaveLength(1)
        expect(notes[0]).toMatchObject({ patientId, doctorId, status: 'pending' })
      })

      it('any other transition queues no note', async () => {
        const a = await makeAppt()
        expect((await transition('receptionist', a.id, { action: 'no-show' })).status).toBe(200)
        const notes = await db
          .select()
          .from(pendingMedicalRecords)
          .where(eq(pendingMedicalRecords.appointmentId, a.id))
        expect(notes).toHaveLength(0)
      })
    })

    describe('PATCH …/transition: visits from a previous day (D6)', () => {
      it("a receptionist may close out yesterday's visit as no-show", async () => {
        const a = await makeAppt({ status: 'scheduled', date: dates.yesterday() })
        expect((await transition('receptionist', a.id, { action: 'no-show' })).status).toBe(200)
        expect((await row(a.id)).status).toBe('no_show')
      })

      it("…and a doctor may complete yesterday's visit that was left in the chair", async () => {
        const a = await makeAppt({ status: 'in_chair', date: dates.yesterday() })
        expect((await transition('doctor', a.id, { action: 'complete' })).status).toBe(200)
        expect((await row(a.id)).status).toBe('completed')
      })

      it.each([
        ['cancel', 'scheduled'],
        ['check-in', 'scheduled'],
        ['seat', 'checked_in'],
      ])("yesterday's visit cannot be moved by %s (from %s)", async (action, from) => {
        const a = await makeAppt({ status: from, date: dates.yesterday() })
        const { status, json } = await transition('receptionist', a.id, { action })

        expect(status).toBe(403)
        expect(json?.code).toBe('APPOINTMENT_PAST_LOCKED')
        expect((await row(a.id)).status).toBe(from)
      })

      it('a visit from two days ago is locked even for a no-show', async () => {
        const a = await makeAppt({ status: 'scheduled', date: dates.twoDaysAgo() })
        const { status, json } = await transition('receptionist', a.id, { action: 'no-show' })

        expect(status).toBe(403)
        expect(json?.code).toBe('APPOINTMENT_PAST_LOCKED')
        expect((await row(a.id)).status).toBe('scheduled')
      })

      it('an admin needs a reason, and it lands in the audit trail', async () => {
        const a = await makeAppt({ status: 'scheduled', date: dates.twoDaysAgo() })
        const without = await transition('admin', a.id, { action: 'no-show' })
        expect(without.status).toBe(400)
        expect(without.json?.code).toBe('OVERRIDE_REASON_REQUIRED')
        expect((await row(a.id)).status).toBe('scheduled')

        const withReason = await transition('admin', a.id, {
          action: 'no-show',
          overrideReason: 'Patient called to say they could not come',
        })
        expect(withReason.status, JSON.stringify(withReason.json)).toBe(200)
        expect((await row(a.id)).status).toBe('no_show')
        const rows = await db
          .select()
          .from(auditLogs)
          .where(and(eq(auditLogs.entityId, a.id), eq(auditLogs.module, 'appointments')))
        expect(rows.some((r) => r.reason?.includes('Patient called'))).toBe(true)
      })
    })

    describe('PATCH /api/appointments/:id', () => {
      it.each(['banana', 'Checked_In', ''])('refuses %j as a status', async (bad) => {
        const a = await makeAppt()
        const { status, json } = await patchAppt('receptionist', a.id, { status: bad })

        expect(status).toBe(400)
        expect(['INVALID_STATUS', undefined]).toContain(json?.code as string | undefined)
        expect((await row(a.id)).status).toBe('scheduled')
      })

      it.each([
        ['scheduled', 'completed'],
        ['scheduled', 'in_chair'],
        ['checked_in', 'scheduled'],
        ['in_chair', 'checked_in'],
      ])('refuses %s → %s', async (from, to) => {
        const a = await makeAppt({ status: from })
        const { status, json } = await patchAppt('receptionist', a.id, { status: to })

        expect(status).toBe(409)
        expect(json?.code).toBe('APPOINTMENT_INVALID_TRANSITION')
        expect((await row(a.id)).status).toBe(from)
      })

      it('an edit that repeats the current status is not a transition (the edit form does this)', async () => {
        const a = await makeAppt({ status: 'checked_in' })
        const { status } = await patchAppt('receptionist', a.id, {
          status: 'checked_in',
          notes: 'Prefers the afternoon',
        })
        expect(status).toBe(200)
        expect((await row(a.id)).notes).toBe('Prefers the afternoon')
      })

      it('scheduled → checked_in stamps the arrival and queues the doctor’s note (F18)', async () => {
        const a = await makeAppt()
        expect((await patchAppt('receptionist', a.id, { status: 'checked_in' })).status).toBe(200)

        expect((await row(a.id)).checkedInAt).toBeInstanceOf(Date)
        const notes = await db
          .select()
          .from(pendingMedicalRecords)
          .where(eq(pendingMedicalRecords.appointmentId, a.id))
        expect(notes).toHaveLength(1)
      })

      it('two overlapping check-ins: one wins, the other is told it changed, one doctor note', async () => {
        const a = await makeAppt()
        const [r1, r2] = await Promise.all([
          patchAppt('receptionist', a.id, { status: 'checked_in' }),
          patchAppt('receptionist', a.id, { status: 'checked_in' }),
        ])

        expect([r1.status, r2.status].sort()).toEqual([200, 409])
        expect((await row(a.id)).status).toBe('checked_in')
        const notes = await db
          .select()
          .from(pendingMedicalRecords)
          .where(eq(pendingMedicalRecords.appointmentId, a.id))
        expect(notes).toHaveLength(1)
      })

      it('a legacy "booked" visit can still be checked in', async () => {
        const a = await makeAppt({ status: 'booked' })
        expect((await patchAppt('receptionist', a.id, { status: 'checked_in' })).status).toBe(200)
      })

      it("yesterday's visit may be closed out as no-show by a receptionist (status only)", async () => {
        const a = await makeAppt({ status: 'scheduled', date: dates.yesterday() })
        expect((await patchAppt('receptionist', a.id, { status: 'no_show' })).status).toBe(200)
        expect((await row(a.id)).status).toBe('no_show')
      })

      it.each([
        ['cancelling it', { status: 'cancelled' }],
        ['editing its notes', { notes: 'changed history' }],
        ['closing it out while also editing notes', { status: 'no_show', notes: 'extra' }],
      ])("yesterday's visit cannot be changed by %s", async (_label, data) => {
        const a = await makeAppt({ status: 'scheduled', date: dates.yesterday() })
        const { status, json } = await patchAppt('receptionist', a.id, data)

        expect(status).toBe(403)
        expect(json?.code).toBe('APPOINTMENT_PAST_LOCKED')
        expect((await row(a.id)).status).toBe('scheduled')
      })

      it('an admin editing a past visit still needs a reason', async () => {
        const a = await makeAppt({ status: 'scheduled', date: dates.twoDaysAgo() })
        const without = await patchAppt('admin', a.id, { notes: 'fix typo' })
        expect(without.status).toBe(400)
        expect(without.json?.code).toBe('OVERRIDE_REASON_REQUIRED')

        const withReason = await patchAppt(
          'admin',
          a.id,
          { notes: 'fix typo' },
          { overrideReason: 'typo' }
        )
        expect(withReason.status).toBe(200)
      })
    })

    describe('POST /api/appointments: a visit starts in a starting status', () => {
      // Each case books a different slot so none collides with another visit.
      let slot = 0
      async function create(status: string) {
        slot += 1
        const res = await callAs(app, 'portal', cookies.receptionist, 'POST', '/api/appointments', {
          data: {
            patientId,
            doctorId,
            date: new Date(Date.now() + (3 + slot) * HOUR).toISOString(),
            status,
            type: 'consultation',
            durationMinutes: 15,
          },
        })
        // Track whatever the server created (even when it should have refused), so cleanup is complete.
        const createdId = (res.json?.data as { id?: string } | undefined)?.id
        if (createdId) apptIds.push(createdId)
        return res
      }
      const countRows = async () =>
        (await db.select().from(appointments).where(eq(appointments.patientId, patientId))).length

      it.each(['scheduled', 'confirmed', 'checked_in'])('%s is allowed', async (status) => {
        const { status: http, json } = await create(status)
        expect(http, JSON.stringify(json)).toBe(200)
      })

      it.each([
        'completed',
        'cancelled',
        'no_show',
        'in_chair',
        'rescheduled',
        'banana',
        '',
      ])('%j is refused and creates nothing', async (status) => {
        const before = await countRows()
        const { status: http, json } = await create(status)

        expect(http, JSON.stringify(json)).toBe(400)
        expect(json?.code).toBe('INVALID_STATUS')
        expect(await countRows()).toBe(before)
      })
    })

    describe('the patient’s SMS link (no sign-in)', () => {
      async function withToken(over: Partial<typeof appointments.$inferInsert> = {}) {
        const token = `tok-${TAG}-${Math.random().toString(36).slice(2, 10)}`
        const a = await makeAppt({ confirmationToken: token, ...over })
        return { a, token }
      }

      it('F32: the link works without a CSRF token, because the patient has no session to forge', async () => {
        // The confirmation page posts with `fetch` and nothing else: no cookie, no
        // token (it lives on another origin). The route is authenticated by the
        // token in the URL, so CSRF protection has nothing to protect here.
        const { a, token } = await withToken()
        const { status, json } = await publicConfirm(token, 'yes')

        expect(status, JSON.stringify(json)).toBe(200)
        expect((await row(a.id)).status).toBe('confirmed')
      })

      it('F32: the exemption stops at the public link — staff routes beside it still demand a token', async () => {
        const a = await makeAppt()
        const noCsrf = (path: string, method: string) =>
          app.request(path, {
            method,
            headers: {
              'Content-Type': 'application/json',
              Origin: 'http://localhost:5173',
              'X-App-Id': 'portal',
              Cookie: cookies.receptionist, // a real session, but no CSRF pair
            },
            body: JSON.stringify({ action: 'no-show', noPaymentReason: 'x' }),
          })

        expect((await noCsrf(`/api/appointment-workflow/${a.id}/transition`, 'PATCH')).status).toBe(
          403
        )
        expect((await noCsrf(`/api/appointment-workflow/${a.id}/check-in`, 'POST')).status).toBe(
          403
        )
        expect((await row(a.id)).status).toBe('scheduled')
      })

      it('“yes” confirms and “no” cancels a visit that has not happened yet (control)', async () => {
        const yes = await withToken()
        expect((await publicConfirm(yes.token, 'yes')).status).toBe(200)
        expect((await row(yes.a.id)).status).toBe('confirmed')

        const no = await withToken()
        expect((await publicConfirm(no.token, 'no')).status).toBe(200)
        expect((await row(no.a.id)).status).toBe('cancelled')
      })

      it.each([
        'checked_in',
        'in_chair',
      ])('an old link cannot pull a %s visit back to “confirmed”', async (state) => {
        const { a, token } = await withToken({ status: state })
        const { status } = await publicConfirm(token, 'yes')

        expect(status).toBe(200) // the patient is told their answer was received…
        expect((await row(a.id)).status).toBe(state) // …but the visit is not touched
      })

      it.each(['checked_in', 'in_chair'])('an old link cannot cancel a %s visit', async (state) => {
        const { a, token } = await withToken({ status: state })
        const { status, json } = await publicConfirm(token, 'no')

        expect(status).toBe(400)
        expect(json?.code).toBe('APPOINTMENT_ALREADY_ARRIVED')
        expect((await row(a.id)).status).toBe(state)
      })

      it('a visit whose day has passed cannot be confirmed or cancelled from the link', async () => {
        const { a, token } = await withToken({ date: dates.yesterday() })
        const { status, json } = await publicConfirm(token, 'yes')

        expect(status).toBe(400)
        expect(json?.code).toBe('APPOINTMENT_PASSED')
        expect((await row(a.id)).status).toBe('scheduled')
      })

      it.each([
        ['a scheduled visit today', {}, false],
        ['a checked-in visit', { status: 'checked_in' }, true],
        ['an in-chair visit', { status: 'in_chair' }, true],
        ['a completed visit', { status: 'completed' }, true],
        ['a visit from yesterday', { date: dates.yesterday() }, true],
      ])('the landing page knows whether the link can still act (%s)', async (_label, over, acted) => {
        const { token } = await withToken(over)
        const { status, json } = await publicLookup(token)

        expect(status).toBe(200)
        expect(json.data?.alreadyActed).toBe(acted)
      })
    })
  }
)
