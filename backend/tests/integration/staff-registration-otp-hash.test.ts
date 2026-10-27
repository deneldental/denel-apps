/**
 * F30 — the staff-registration code is stored as a keyed hash, not a bare SHA-256.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md.
 *
 * `staff_registration_invites.otpHash` held `SHA-256(code)`. A six-digit code has a
 * million possible values, so anyone who could read that table (a leaked backup, a
 * replica) recovered every live code by hashing them all, well under a second, and
 * could finish someone else's registration. Finding L10 fixed exactly this for the
 * staff and patient login codes with `lib/otp-hash.ts` (an HMAC keyed on a server
 * secret); registration was missed. It now uses the same helper, in its own domain so
 * a digest from one table can never be replayed against another.
 *
 * Real database and the real route; SMS is captured.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/staff-registration-otp-hash.test.ts
 */
import { Hono } from 'hono'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

const RAW_DB_URL = process.env.DATABASE_URL ?? ''
const IS_LOCAL = /@(localhost|127\.0\.0\.1|host\.docker\.internal)([:/]|$)/.test(RAW_DB_URL)
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
vi.mock('../../src/lib/audit', () => ({
  createAuditLog: vi.fn(),
  recordDiffAudit: vi.fn(),
  computeChangedFields: vi.fn(() => ({})),
  redactForAudit: vi.fn((row: unknown) => row),
  auditMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../src/lib/sms', () => ({ sendSMS: vi.fn(async () => ({ success: true })) }))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { eq } from 'drizzle-orm'
import { type DB, getDb } from '../../src/db'
import { staffRegistrationInvites } from '../../src/db/schema'
import { hashOtp } from '../../src/lib/otp-hash'
import { sendSMS } from '../../src/lib/sms'
import { staffRegistrationApp } from '../../src/routes/staff-registration'

const TAG = `reghash-${Date.now()}`
const PHONE = '0240000091'
let db: DB
let app: Hono<HonoEnv>
const tokens: string[] = []

async function post(path: string, payload: unknown) {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  let body: Record<string, unknown> | null = null
  try {
    body = await res.json()
  } catch {
    /* empty body */
  }
  return { status: res.status, body }
}

async function bareSha256(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** A fresh invite, a code sent to PHONE, and that code as the SMS carried it. */
async function inviteWithCode() {
  const token = `reg-${TAG}-${tokens.length}`
  tokens.push(token)
  await db.insert(staffRegistrationInvites).values({
    token,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  })
  vi.mocked(sendSMS).mockClear()
  const sent = await post(`/api/staff-registration/public/${token}/send-otp`, { phone: PHONE })
  expect(sent.status, JSON.stringify(sent.body)).toBe(200)
  const message = vi
    .mocked(sendSMS)
    .mock.calls.flatMap(([recipients]) => recipients)
    .find((r) => /registration code/.test(r.message))?.message
  const code = message?.match(/\b(\d{6})\b/)?.[1]
  if (!code) throw new Error('no registration code was sent')
  const [row] = await db
    .select()
    .from(staffRegistrationInvites)
    .where(eq(staffRegistrationInvites.token, token))
  return { token, code, row }
}

describe.skipIf(skip)('staff-registration code is stored keyed (F30)', () => {
  beforeAll(() => {
    db = getDb(RAW_DB_URL)
    vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-that-is-at-least-32-characters-!!')
    app = new Hono<HonoEnv>()
    app.route('/api/staff-registration', staffRegistrationApp)
  })

  afterAll(async () => {
    vi.unstubAllEnvs()
    if (skip || !db) return
    for (const token of tokens) {
      await db.delete(staffRegistrationInvites).where(eq(staffRegistrationInvites.token, token))
    }
  })

  beforeEach(() => vi.clearAllMocks())

  it('does not store the bare SHA-256 of the code (a million guesses would recover it)', async () => {
    const { code, row } = await inviteWithCode()
    expect(row.otpHash).toBeTruthy()
    expect(row.otpHash).not.toBe(await bareSha256(code))
    // …and not the code itself, obviously.
    expect(row.otpHash).not.toContain(code)
  })

  it('still accepts the right code', async () => {
    const { token, code } = await inviteWithCode()
    const res = await post(`/api/staff-registration/public/${token}/verify-otp`, {
      phone: PHONE,
      code,
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const [after] = await db
      .select()
      .from(staffRegistrationInvites)
      .where(eq(staffRegistrationInvites.token, token))
    expect(after.phoneVerified).toBe(true)
    expect(after.otpHash).toBeNull()
  })

  it('refuses a wrong code and counts the attempt', async () => {
    const { token, code } = await inviteWithCode()
    const wrong = code === '000000' ? '111111' : '000000'
    const res = await post(`/api/staff-registration/public/${token}/verify-otp`, {
      phone: PHONE,
      code: wrong,
    })
    expect(res.status).toBe(400)
    const [after] = await db
      .select()
      .from(staffRegistrationInvites)
      .where(eq(staffRegistrationInvites.token, token))
    expect(after.otpAttempts).toBe(1)
    expect(after.phoneVerified).toBe(false)
  })

  it('a digest from the staff-login domain cannot be replayed here', async () => {
    const { token, code } = await inviteWithCode()
    // Someone who could write a staff-login digest into this row still cannot pass:
    // the registration domain is separate.
    await db
      .update(staffRegistrationInvites)
      .set({ otpHash: await hashOtp(code, 'staff') })
      .where(eq(staffRegistrationInvites.token, token))
    const res = await post(`/api/staff-registration/public/${token}/verify-otp`, {
      phone: PHONE,
      code,
    })
    expect(res.status).toBe(400)
  })

  it('a row still holding an old bare digest is refused (codes expire in minutes; ask again)', async () => {
    const { token, code } = await inviteWithCode()
    await db
      .update(staffRegistrationInvites)
      .set({ otpHash: await bareSha256(code) })
      .where(eq(staffRegistrationInvites.token, token))
    const res = await post(`/api/staff-registration/public/${token}/verify-otp`, {
      phone: PHONE,
      code,
    })
    expect(res.status).toBe(400)
  })
})
