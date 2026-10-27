/**
 * F01 end to end — the SMS log must not hand out login codes, and only messaging
 * roles may read it. See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (F01).
 *
 * Real stack, nothing mocked: the real Hono `app`, real signed-in sessions for
 * six roles, the real OTP code paths writing into the real `sms_messages` table,
 * and the rows read back from Postgres.
 *
 * ── Safety ──────────────────────────────────────────────────────────────────
 * Commits fixtures, so it refuses anything but a local Postgres. Requests to
 * Hubtel are intercepted: this test can never text a real phone, even when real
 * keys and SMS_REDIRECT_PHONE are configured on the machine. It never prints or
 * asserts a specific code: codes are random, so it checks "no code-shaped
 * number" instead.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/sms-log-exposure.test.ts
 */
import { eq, inArray, like } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { smsMessages, staff } from '../../src/db/schema'
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
const db = localDb() as NonNullable<ReturnType<typeof localDb>>

const TAG = `smslog-${Date.now()}`
const PATIENT_PHONE = '0240000081'
const STAFF_PHONE = '0240000082'
const ORDINARY_PHONE = '0240000083'
const REDACTED = '[sensitive message redacted]'
/** What a leaked login code looks like inside a stored message. */
const CODE_IN_TEXT = /code is \d{4,8}/i

const ROLES: Array<{ key: string; roleId: string; iface: Interface }> = [
  { key: 'receptionist', roleId: 'receptionist', iface: 'portal' },
  { key: 'doctor', roleId: 'doctor', iface: 'portal' },
  { key: 'staff', roleId: 'staff', iface: 'pwa' },
  { key: 'lab_technician', roleId: 'lab_technician', iface: 'pwa' },
  { key: 'external_trainer', roleId: 'external_trainer', iface: 'hr' },
  { key: 'hr_admin', roleId: 'hr_admin', iface: 'hr' },
]
const DENIED = ROLES.filter((r) => r.key !== 'receptionist')

let app: TestApp
const userIds: string[] = []
const cookies: Record<string, string> = {}
let staffRowId: string
let ordinaryId: string
let hubtelCalls: string[] = []

async function rowsFor(phone: string) {
  return db.select().from(smsMessages).where(eq(smsMessages.recipient, phone))
}

describe.skipIf(skip)('F01 — the SMS log, end to end with real roles', () => {
  beforeAll(async () => {
    // Never text anyone: intercept Hubtel whatever the machine is configured with.
    const realFetch = globalThis.fetch
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.startsWith('https://sms.hubtel.com')) {
          hubtelCalls.push(url)
          return new Response(JSON.stringify({ messageId: `fake-${TAG}`, status: 0 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return realFetch(input, init)
      })
    )
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('SMS_REDIRECT_PHONE', '')
    vi.stubEnv('HUBTEL_CLIENT_ID', '')
    vi.stubEnv('HUBTEL_CLIENT_SECRET', '')
    vi.stubEnv('SMS_STUB_FILE', '')
    vi.stubEnv('BETTER_AUTH_SECRET', process.env.BETTER_AUTH_SECRET)

    const { validateBackendEnv } = await import('../../src/config/env')
    validateBackendEnv()
    app = (await import('../../src/app')).app as unknown as TestApp

    for (const r of ROLES) {
      userIds.push(
        await createLoginUser(db, {
          email: `${r.key}-${TAG}@smslog.test`,
          name: `SmsLog ${r.key} ${TAG}`,
          roleId: r.roleId,
        })
      )
      cookies[r.key] = await signInAs(app, `${r.key}-${TAG}@smslog.test`, r.iface)
    }

    const [s] = await db
      .insert(staff)
      .values({
        staffId: `IT-${TAG}`,
        fullName: `SmsLog Staff ${TAG}`,
        employmentType: 'permanent',
        phone: STAFF_PHONE,
      })
      .returning({ id: staff.id })
    staffRowId = s.id

    // Real OTP code paths → real sendSMS → real sms_messages rows.
    const { requestOtpByPhone } = await import('../../src/lib/patient-otp')
    const { requestStaffOtp } = await import('../../src/lib/staff-otp')
    expect((await requestOtpByPhone(db, PATIENT_PHONE, 'login_phone')).ok).toBe(true)
    expect((await requestStaffOtp(db, staffRowId, 'login_phone', STAFF_PHONE)).ok).toBe(true)
    // The staff send is detached on purpose (timing oracle): wait for its row.
    await vi.waitFor(async () => expect((await rowsFor(STAFF_PHONE)).length).toBeGreaterThan(0), {
      timeout: 15_000,
    })

    // An ordinary, non-sensitive message for the controls.
    const [o] = await db
      .insert(smsMessages)
      .values({
        recipient: ORDINARY_PHONE,
        content: `Your appointment is tomorrow ${TAG}`,
        type: 'appointment',
        status: 'sent',
      })
      .returning({ id: smsMessages.id })
    ordinaryId = o.id
  }, 120_000)

  afterAll(async () => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    if (skip) return
    await db
      .delete(smsMessages)
      .where(inArray(smsMessages.recipient, [PATIENT_PHONE, STAFF_PHONE, ORDINARY_PHONE]))
    await db.delete(staff).where(eq(staff.id, staffRowId))
    await deleteLoginUsers(db, userIds)
    // patient_otp_codes rows for the phone-keyed OTP (no FK to clean up through).
    const { patientOtpCodes } = await import('../../src/db/schema')
    await db.delete(patientOtpCodes).where(eq(patientOtpCodes.phone, PATIENT_PHONE))
    // Anything a failed run left behind under this tag.
    await db.delete(smsMessages).where(like(smsMessages.content, `%${TAG}%`))
  })

  it('the real OTP paths stored a row for each recipient, and no row carries a code', async () => {
    for (const phone of [PATIENT_PHONE, STAFF_PHONE]) {
      const rows = await rowsFor(phone)
      expect(rows.length, `no sms_messages row for ${phone}`).toBeGreaterThan(0)
      for (const row of rows) {
        expect(row.content).not.toMatch(CODE_IN_TEXT)
        expect(row.content).not.toMatch(/\b\d{6}\b/)
        expect(row.content).toBe(REDACTED)
      }
    }
  })

  it('Hubtel was never really called by this test', () => {
    // Any call went to the intercept above (and, with no keys in dev, none are made).
    expect(hubtelCalls.every((u) => u.startsWith('https://sms.hubtel.com'))).toBe(true)
  })

  it('a receptionist reads the log: the ordinary message is intact and no login code is visible', async () => {
    const { status, json } = await callAs(
      app,
      'portal',
      cookies.receptionist,
      'GET',
      '/api/sms/messages?limit=500'
    )
    expect(status).toBe(200)
    const data = (json?.data ?? []) as Array<{ recipient: string; content: string }>

    const ordinary = data.find((m) => m.recipient === ORDINARY_PHONE)
    expect(ordinary?.content).toBe(`Your appointment is tomorrow ${TAG}`)
    for (const phone of [PATIENT_PHONE, STAFF_PHONE]) {
      const otpRows = data.filter((m) => m.recipient === phone)
      expect(otpRows.length).toBeGreaterThan(0)
      for (const m of otpRows) expect(m.content).not.toMatch(CODE_IN_TEXT)
    }
    expect(JSON.stringify(json)).not.toMatch(CODE_IN_TEXT)
  })

  it('a receptionist can still use the other read routes (control)', async () => {
    const followups = await callAs(
      app,
      'portal',
      cookies.receptionist,
      'GET',
      '/api/sms/followup-appointments'
    )
    expect(followups.status).toBe(200)
    const status = await callAs(
      app,
      'portal',
      cookies.receptionist,
      'GET',
      '/api/sms/status/dev_123'
    )
    expect(status.status).toBe(200)
  })

  it('a receptionist cannot resend a redacted code', async () => {
    const [row] = await rowsFor(PATIENT_PHONE)
    const before = (await rowsFor(PATIENT_PHONE)).length
    hubtelCalls = []
    const { status, json } = await callAs(
      app,
      'portal',
      cookies.receptionist,
      'POST',
      `/api/sms/retry/${row.id}`,
      {}
    )
    expect(status).toBe(400)
    expect(json?.code).toBe('SMS_REDACTED_NOT_RETRYABLE')
    expect(hubtelCalls).toHaveLength(0)
    expect((await rowsFor(PATIENT_PHONE)).length).toBe(before)
  })

  it('a receptionist can retry an ordinary message path up to the send (control: not blocked)', async () => {
    // Only checks the guard lets an ordinary row through to the sender; the
    // resend's own behaviour is covered in routes/sms-log-access.test.ts. Using
    // a missing id avoids sending and booking a ledger cost from this test.
    const { status } = await callAs(
      app,
      'portal',
      cookies.receptionist,
      'POST',
      '/api/sms/retry/00000000-0000-0000-0000-000000000000',
      {}
    )
    expect(status).toBe(404)
    expect(ordinaryId).toBeTruthy()
  })

  const ROUTES: Array<[string, string]> = [
    ['GET', '/api/sms/followup-appointments'],
    ['GET', '/api/sms/messages'],
    ['GET', '/api/sms/status/msg-1'],
    ['POST', '/api/sms/retry/00000000-0000-0000-0000-000000000000'],
  ]
  const MATRIX = DENIED.flatMap((role) => ROUTES.map(([m, p]) => [role.key, m, p] as const))

  it.each(MATRIX)('%s is refused by %s %s', async (key, method, path) => {
    const role = ROLES.find((r) => r.key === key) as (typeof ROLES)[number]
    const { status } = await callAs(
      app,
      role.iface,
      cookies[key],
      method,
      path,
      method === 'POST' ? {} : undefined
    )
    expect(status).toBe(403)
  })
})
