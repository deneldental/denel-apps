/**
 * F13 — the links the backend sends out lead to the right app. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.13).
 *
 * An appointment-confirmation SMS and an X-ray share link are pages of the clinic PORTAL
 * (`/c/:token`, `/xray-share/:token`). Both used to default their base address to the PATIENT app's
 * host, which has neither page, so a patient or a referring doctor who followed the link got a dead
 * page. The patient-app invitation is the opposite case and must keep going to the patient app.
 *
 * Real stack: the real app and routes, a real administrator's session, real Postgres; only the SMS
 * gateway is replaced, to read what was sent.
 *
 * ── Safety ── commits rows; local Postgres only. Every row is removed in afterAll.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/public-links.test.ts
 */
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const sent = vi.hoisted(() => [] as Array<{ phone: string; message: string }>)

vi.mock('../../src/lib/sms', () => ({
  sendSMS: vi.fn(async (recipients: Array<{ phone: string; message: string }>) => {
    sent.push(...recipients)
    return { success: true }
  }),
  getHubtelCredentials: vi.fn(async () => null),
}))
vi.mock('../../src/lib/google-calendar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/google-calendar')>()),
  enrichAppointment: vi.fn(async () => null),
  syncAppointmentCreated: vi.fn(async () => null),
  syncAppointmentDeleted: vi.fn(async () => null),
  syncAppointmentUpdated: vi.fn(async () => null),
}))

import type { DB } from '../../src/db'
import {
  appointments,
  doctors,
  patients,
  specialists,
  xrayRecords,
  xrayShareLinks,
} from '../../src/db/schema'
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
const TAG = `IT links ${Date.now()}`
const PHONE = '0240000063'

const PORTAL = 'https://portal.example.test'
const PATIENT_APP = 'https://patients.example.test'

let app: TestApp
let cookie = ''
let adminId = ''
let patientId = ''
let specialistId = ''
let doctorId = ''
let appointmentId = ''
let xrayId = ''

const send = (method: string, path: string, body?: unknown) =>
  callAs(app, 'portal', cookie, method, path, body)
const lastTo = (phone: string) => [...sent].reverse().find((s) => s.phone === phone)?.message ?? ''

describe.skipIf(skip)('links lead to the right app (F13)', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { validateBackendEnv } = await import('../../src/config/env')
    validateBackendEnv()
    app = (await import('../../src/app')).app as unknown as TestApp

    const email = `admin-${Date.now()}@links.test`
    adminId = await createLoginUser(db, {
      email,
      name: 'Links admin',
      roleId: 'admin',
      baRole: 'admin',
    })
    cookie = await signInAs(app, email, 'portal')

    const [p] = await db
      .insert(patients)
      .values({ name: TAG, dob: new Date('1990-01-01'), gender: 'other', phone: PHONE })
      .returning({ id: patients.id })
    patientId = p.id
    const [spec] = await db
      .insert(specialists)
      .values({ name: `${TAG} spec`, defaultCommissionRate: 0, withholdingTaxRate: 0 })
      .returning({ id: specialists.id })
    specialistId = spec.id
    const [doc] = await db
      .insert(doctors)
      .values({ specialistId, specialty: 'General Dentistry' })
      .returning({ id: doctors.id })
    doctorId = doc.id
    const [appt] = await db
      .insert(appointments)
      .values({
        patientId,
        doctorId,
        date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        status: 'scheduled',
        type: 'consultation',
      })
      .returning({ id: appointments.id })
    appointmentId = appt.id
    const [xray] = await db
      .insert(xrayRecords)
      .values({ patientId, imageUrl: 'private-file://r2/xrays/it-links.png#t' })
      .returning({ id: xrayRecords.id })
    xrayId = xray.id
  }, APP_BOOT_TIMEOUT_MS)

  beforeEach(() => {
    sent.length = 0
    vi.stubEnv('PORTAL_URL', PORTAL)
    vi.stubEnv('PATIENT_PORTAL_URL', PATIENT_APP)
  })

  afterAll(async () => {
    vi.unstubAllEnvs()
    if (patientId) {
      await db.delete(xrayShareLinks).where(eq(xrayShareLinks.patientId, patientId))
      await db.delete(xrayRecords).where(eq(xrayRecords.patientId, patientId))
      await db.delete(appointments).where(eq(appointments.patientId, patientId))
    }
    if (doctorId) await db.delete(doctors).where(eq(doctors.id, doctorId))
    if (specialistId) await db.delete(specialists).where(eq(specialists.id, specialistId))
    if (patientId) await db.delete(patients).where(eq(patients.id, patientId))
    await deleteLoginUsers(db, [adminId].filter(Boolean))
  })

  async function confirmationToken() {
    const [row] = await db
      .select({ token: appointments.confirmationToken })
      .from(appointments)
      .where(eq(appointments.id, appointmentId))
    return row.token as string
  }

  it('the confirmation text leads to the portal, where /c/:token lives', async () => {
    const res = await send('POST', `/api/appointment-workflow/${appointmentId}/send-confirmation`)
    expect(res.status, JSON.stringify(res.json)).toBe(200)
    const token = await confirmationToken()
    const message = lastTo(PHONE)
    expect(message).toContain(`${PORTAL}/c/${token}`)
    expect(message).not.toContain(PATIENT_APP)
    expect(message).not.toContain('app.deneldental.com')
  })

  it('a trailing slash in the configured address does not double up', async () => {
    vi.stubEnv('PORTAL_URL', `${PORTAL}/`)
    await send('POST', `/api/appointment-workflow/${appointmentId}/send-confirmation`)
    const message = lastTo(PHONE)
    expect(message).toContain(`${PORTAL}/c/`)
    expect(message).not.toContain(`${PORTAL}//c/`)
  })

  it('on a developer machine with nothing configured it is the local portal, never the patient app', async () => {
    vi.stubEnv('PORTAL_URL', undefined)
    await send('POST', `/api/appointment-workflow/${appointmentId}/send-confirmation`)
    const message = lastTo(PHONE)
    expect(message).toContain('http://localhost:5173/c/')
    expect(message).not.toContain('deneldental.com')
  })

  it('the X-ray share link leads to the portal, where /xray-share/:token lives', async () => {
    const res = await send('POST', '/api/xrays/share', {
      xrayRecordIds: [xrayId],
      recipientName: 'Dr Referrer',
    })
    expect(res.status, JSON.stringify(res.json)).toBe(200)
    const data = res.json?.data as { shareUrl: string; preformattedMessage: string }
    expect(data.shareUrl).toMatch(new RegExp(`^${PORTAL}/xray-share/[0-9a-f]{32}$`))
    expect(data.preformattedMessage).toContain(data.shareUrl)
    expect(data.shareUrl).not.toContain('app.deneldental.com')
  })

  it('the patient-app invitation still leads to the patient app', async () => {
    const res = await send('POST', `/api/patients/${patientId}/enable-pwa`, { enabled: true })
    expect(res.status, JSON.stringify(res.json)).toBe(200)
    const message = lastTo(PHONE)
    expect(message).toContain(PATIENT_APP)
    expect(message).not.toContain(PORTAL)
  })
})
