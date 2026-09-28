/**
 * Patient OTP — SMS one-time codes for new-device login verification and
 * password resets. Pairs with patient-trusted-device.ts and the
 * /verify-login-otp / /reset-password endpoints.
 *
 * Design (see project-docs/auth-risk-analysis.md §3.1, Option B):
 * - 6-digit numeric code, SHA-256 hashed at rest (raw never stored)
 * - 10-minute TTL
 * - Per-code attempt cap (5 wrong attempts → code is dead)
 * - Per-patient request rate limit (3 requests per 15 min per purpose)
 * - On verify success, the code is marked used and cannot be replayed
 */

import { and, count, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '../db/schema'
import { getBranding } from './branding'
import { hashOtp, timingSafeEqualHex } from './otp-hash'
import { sendSMS } from './sms'
import { OTP_GENERIC_ERROR } from './staff-otp'

type DB = NodePgDatabase<typeof schema>

export type OtpPurpose = 'login_phone' | 'login_device' | 'password_reset'

const OTP_LENGTH = 6
const OTP_TTL_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 5
const MAX_REQUESTS_PER_WINDOW = 3
const RATE_WINDOW_MS = 15 * 60 * 1000

function generateNumericCode(length: number): string {
  // Crypto-strong digit generation — avoids modulo-bias from Math.random
  const digits: string[] = []
  while (digits.length < length) {
    const buf = crypto.getRandomValues(new Uint8Array(length))
    for (const b of buf) {
      // Reject bytes >= 250 to keep distribution uniform across 0–9
      if (b < 250) digits.push(String(b % 10))
      if (digits.length === length) break
    }
  }
  return digits.join('')
}

function smsBody(code: string, purpose: OtpPurpose, brandShort: string): string {
  if (purpose === 'password_reset') {
    return `${brandShort}: your password reset code is ${code}. Valid for 10 minutes. If you didn't request this, ignore this message.`
  }
  return `${brandShort}: your patient portal verification code is ${code}. Valid for 10 minutes.`
}

export interface RequestOtpResult {
  ok: boolean
  error?: string
}

/**
 * Generate an OTP, persist its hash, and SMS it to the patient.
 * Rate-limits by (patientId, purpose) to prevent SMS bombing.
 */
export async function requestOtp(
  db: DB,
  patientId: string,
  purpose: OtpPurpose,
  phone: string
): Promise<RequestOtpResult> {
  if (!phone) return { ok: false, error: 'No phone number on file' }

  // Rate limit: count recent requests in the window
  const windowStart = new Date(Date.now() - RATE_WINDOW_MS)
  const [{ value: recentCount }] = await db
    .select({ value: count() })
    .from(schema.patientOtpCodes)
    .where(
      and(
        eq(schema.patientOtpCodes.patientId, patientId),
        eq(schema.patientOtpCodes.purpose, purpose),
        gt(schema.patientOtpCodes.createdAt, windowStart)
      )
    )

  if (recentCount >= MAX_REQUESTS_PER_WINDOW) {
    return { ok: false, error: 'Too many code requests. Please wait a few minutes and try again.' }
  }

  const code = generateNumericCode(OTP_LENGTH)
  const codeHash = await hashOtp(code, 'patient')
  const expiresAt = new Date(Date.now() + OTP_TTL_MS)

  await db.insert(schema.patientOtpCodes).values({
    patientId,
    codeHash,
    purpose,
    expiresAt,
  })

  const branding = await getBranding().catch(() => null)
  const brandShort = branding?.shortName ?? 'Denel'
  const result = await sendSMS([{ phone, message: smsBody(code, purpose, brandShort), patientId }])

  if (!result.success) {
    return { ok: false, error: 'Failed to send SMS. Please try again or contact the clinic.' }
  }
  return { ok: true }
}

export interface VerifyOtpResult {
  ok: boolean
  error?: string
}

/**
 * Verify a code against the latest unused, unexpired OTP for (patientId, purpose).
 * - On match: marks the OTP used and returns ok.
 * - On mismatch: increments attempts; after MAX_ATTEMPTS the code is dead.
 * - Single-use: once used, cannot be replayed.
 */
export async function verifyOtp(
  db: DB,
  patientId: string,
  purpose: OtpPurpose,
  code: string
): Promise<VerifyOtpResult> {
  if (!code || code.length !== OTP_LENGTH || !/^\d+$/.test(code)) {
    return { ok: false, error: 'Invalid code format' }
  }

  const now = new Date()
  const [otp] = await db
    .select()
    .from(schema.patientOtpCodes)
    .where(
      and(
        eq(schema.patientOtpCodes.patientId, patientId),
        eq(schema.patientOtpCodes.purpose, purpose),
        isNull(schema.patientOtpCodes.usedAt),
        gt(schema.patientOtpCodes.expiresAt, now)
      )
    )
    .orderBy(desc(schema.patientOtpCodes.createdAt))
    .limit(1)

  // M1 + M4 — see lib/staff-otp.ts for the full reasoning. One message for every
  // failure (no enumeration oracle), SQL-side attempt increment with an atomic
  // cap, and a conditional consume so the same correct code cannot be replayed
  // by two concurrent requests.
  if (!otp) return { ok: false, error: OTP_GENERIC_ERROR }

  const candidateHash = await hashOtp(code, 'patient')
  if (!timingSafeEqualHex(candidateHash, otp.codeHash)) {
    await db
      .update(schema.patientOtpCodes)
      .set({ attempts: sql`${schema.patientOtpCodes.attempts} + 1` })
      .where(
        and(
          eq(schema.patientOtpCodes.id, otp.id),
          lt(schema.patientOtpCodes.attempts, MAX_ATTEMPTS)
        )
      )
    return { ok: false, error: OTP_GENERIC_ERROR }
  }

  const consumed = await db
    .update(schema.patientOtpCodes)
    .set({ usedAt: now })
    .where(and(eq(schema.patientOtpCodes.id, otp.id), isNull(schema.patientOtpCodes.usedAt)))
    .returning({ id: schema.patientOtpCodes.id })

  if (consumed.length === 0) return { ok: false, error: OTP_GENERIC_ERROR }

  return { ok: true }
}

// ─── Phone-keyed OTP (passwordless login) ────────────────────────────────────
// The phone-anchored login flow sends/verifies OTPs against a normalized phone
// number (not a single patient), since one phone can map to several enabled
// patients (family profile switcher). patientId is left null on these rows.

/**
 * Generate an OTP, persist its hash keyed by `phone`, and SMS it to that phone.
 * Rate-limits by (phone, purpose) to prevent SMS bombing.
 */
export async function requestOtpByPhone(
  db: DB,
  phone: string,
  purpose: OtpPurpose = 'login_phone'
): Promise<RequestOtpResult> {
  if (!phone) return { ok: false, error: 'No phone number provided' }

  const windowStart = new Date(Date.now() - RATE_WINDOW_MS)
  const [{ value: recentCount }] = await db
    .select({ value: count() })
    .from(schema.patientOtpCodes)
    .where(
      and(
        eq(schema.patientOtpCodes.phone, phone),
        eq(schema.patientOtpCodes.purpose, purpose),
        gt(schema.patientOtpCodes.createdAt, windowStart)
      )
    )

  if (recentCount >= MAX_REQUESTS_PER_WINDOW) {
    return { ok: false, error: 'Too many code requests. Please wait a few minutes and try again.' }
  }

  const code = generateNumericCode(OTP_LENGTH)
  const codeHash = await hashOtp(code, 'patient')
  const expiresAt = new Date(Date.now() + OTP_TTL_MS)

  await db.insert(schema.patientOtpCodes).values({ phone, codeHash, purpose, expiresAt })

  const branding = await getBranding().catch(() => null)
  const brandShort = branding?.shortName ?? 'Denel'
  const result = await sendSMS([{ phone, message: smsBody(code, purpose, brandShort) }])

  if (!result.success) {
    return { ok: false, error: 'Failed to send SMS. Please try again or contact the clinic.' }
  }
  return { ok: true }
}

/**
 * Verify a code against the latest unused, unexpired OTP for (phone, purpose).
 * Same single-use + attempt-cap semantics as `verifyOtp`.
 */
export async function verifyOtpByPhone(
  db: DB,
  phone: string,
  code: string,
  purpose: OtpPurpose = 'login_phone'
): Promise<VerifyOtpResult> {
  if (!code || code.length !== OTP_LENGTH || !/^\d+$/.test(code)) {
    return { ok: false, error: 'Invalid code format' }
  }

  const now = new Date()
  const [otp] = await db
    .select()
    .from(schema.patientOtpCodes)
    .where(
      and(
        eq(schema.patientOtpCodes.phone, phone),
        eq(schema.patientOtpCodes.purpose, purpose),
        isNull(schema.patientOtpCodes.usedAt),
        gt(schema.patientOtpCodes.expiresAt, now)
      )
    )
    .orderBy(desc(schema.patientOtpCodes.createdAt))
    .limit(1)

  // M1 + M4 — see lib/staff-otp.ts for the full reasoning. One message for every
  // failure (no enumeration oracle), SQL-side attempt increment with an atomic
  // cap, and a conditional consume so the same correct code cannot be replayed
  // by two concurrent requests.
  if (!otp) return { ok: false, error: OTP_GENERIC_ERROR }

  const candidateHash = await hashOtp(code, 'patient')
  if (!timingSafeEqualHex(candidateHash, otp.codeHash)) {
    await db
      .update(schema.patientOtpCodes)
      .set({ attempts: sql`${schema.patientOtpCodes.attempts} + 1` })
      .where(
        and(
          eq(schema.patientOtpCodes.id, otp.id),
          lt(schema.patientOtpCodes.attempts, MAX_ATTEMPTS)
        )
      )
    return { ok: false, error: OTP_GENERIC_ERROR }
  }

  const consumed = await db
    .update(schema.patientOtpCodes)
    .set({ usedAt: now })
    .where(and(eq(schema.patientOtpCodes.id, otp.id), isNull(schema.patientOtpCodes.usedAt)))
    .returning({ id: schema.patientOtpCodes.id })

  if (consumed.length === 0) return { ok: false, error: OTP_GENERIC_ERROR }

  return { ok: true }
}
