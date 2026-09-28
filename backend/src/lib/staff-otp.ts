/**
 * Staff OTP — SMS one-time codes for new-device login verification and
 * password resets. Mirrors patient-otp.ts but targets staff_otp_codes.
 *
 * Design:
 * - 6-digit numeric code, SHA-256 hashed at rest (raw never stored)
 * - 10-minute TTL
 * - Per-code attempt cap (5 wrong attempts → code is dead)
 * - Per-staff request rate limit (3 requests per 15 min per purpose)
 */

import { and, count, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '../db/schema'
import { getBranding } from './branding'
import { logError } from './logger'
import { hashOtp, timingSafeEqualHex } from './otp-hash'
import { sendSMS } from './sms'

type DB = NodePgDatabase<typeof schema>

export type StaffOtpPurpose = 'login_phone' | 'login_device' | 'password_reset'

const OTP_LENGTH = 6
const OTP_TTL_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 5
const MAX_REQUESTS_PER_WINDOW = 3
const RATE_WINDOW_MS = 15 * 60 * 1000

function generateNumericCode(length: number): string {
  const digits: string[] = []
  while (digits.length < length) {
    const buf = crypto.getRandomValues(new Uint8Array(length))
    for (const b of buf) {
      if (b < 250) digits.push(String(b % 10))
      if (digits.length === length) break
    }
  }
  return digits.join('')
}

function smsBody(code: string, purpose: StaffOtpPurpose, brandShort: string): string {
  if (purpose === 'password_reset') {
    return `${brandShort}: your password reset code is ${code}. Valid for 10 minutes. If you didn't request this, ignore this message.`
  }
  return `${brandShort}: your staff portal login code is ${code}. Valid for 10 minutes.`
}

export interface RequestStaffOtpResult {
  ok: boolean
  error?: string
}

/**
 * Generate an OTP, persist its hash, and SMS it to the staff member.
 * Rate-limits by (staffId, purpose) to prevent SMS bombing.
 */
export async function requestStaffOtp(
  db: DB,
  staffId: string,
  purpose: StaffOtpPurpose,
  phone: string
): Promise<RequestStaffOtpResult> {
  if (!phone) return { ok: false, error: 'No phone number on file' }

  const windowStart = new Date(Date.now() - RATE_WINDOW_MS)
  const [{ value: recentCount }] = await db
    .select({ value: count() })
    .from(schema.staffOtpCodes)
    .where(
      and(
        eq(schema.staffOtpCodes.staffId, staffId),
        eq(schema.staffOtpCodes.purpose, purpose),
        gt(schema.staffOtpCodes.createdAt, windowStart)
      )
    )

  if (recentCount >= MAX_REQUESTS_PER_WINDOW) {
    return { ok: false, error: 'Too many code requests. Please wait a few minutes and try again.' }
  }

  const code = generateNumericCode(OTP_LENGTH)
  const codeHash = await hashOtp(code, 'staff')
  const expiresAt = new Date(Date.now() + OTP_TTL_MS)

  await db.insert(schema.staffOtpCodes).values({
    staffId,
    codeHash,
    phone,
    purpose,
    expiresAt,
  })

  // M1 (timing half): the SMS is dispatched WITHOUT being awaited.
  //
  // The forgot-password flow returns the same message for a known and an
  // unknown phone, and its comment claimed that hid timing too. It did not: a
  // known number awaited a branding read and an outbound HTTP call to Hubtel —
  // hundreds of milliseconds — while an unknown number returned after a single
  // indexed lookup. The response body was constant and the clock was not.
  //
  // Detaching the send makes both paths return as soon as the row is written.
  // The cost is that a genuine SMS failure no longer reaches the caller — which
  // is inherent to the requirement, because an error the caller can see is an
  // oracle by definition. Failures are logged at error level (and recorded as
  // an auth event) so they stay visible to operators rather than to attackers.
  void (async () => {
    try {
      const branding = await getBranding().catch(() => null)
      const brandShort = branding?.shortName ?? 'Denel'
      const result = await sendSMS([{ phone, message: smsBody(code, purpose, brandShort) }])
      if (!result.success) {
        logError(new Error('OTP SMS dispatch failed'), {
          context: '[staff-otp] sendSMS',
          purpose,
          phoneSuffix: phone.slice(-4),
        })
      }
    } catch (err) {
      logError(err, { context: '[staff-otp] sendSMS threw', purpose })
    }
  })()

  return { ok: true }
}

export interface VerifyStaffOtpResult {
  ok: boolean
  error?: string
  /**
   * Why it failed, for server-side logging only. NEVER put this in a response
   * body — telling them apart is exactly the enumeration oracle M1 describes.
   */
  reason?: 'bad_format' | 'no_code' | 'attempts_exhausted' | 'wrong_code' | 'already_used'
}

/**
 * The single failure message every caller returns, whatever went wrong.
 *
 * M1: step 1 of the flow is carefully enumeration-resistant — one message for
 * every phone number — and step 2 used to undo it by distinguishing "no active
 * code" from "incorrect code, 4 attempts remaining" from "invalid phone". Submit
 * any code and the message told you whether the number was real and whether it
 * had a live OTP. One message closes that.
 *
 * The cost is real: users no longer see an attempts-remaining countdown. The cap
 * is still enforced (5), and codes still expire in 10 minutes.
 */
export const OTP_GENERIC_ERROR = 'Invalid or expired code. Request a new one if you need to.'

/**
 * Verify a code against the latest unused, unexpired OTP for (staffId, purpose).
 * - On match: marks the OTP used and returns ok.
 * - On mismatch: increments attempts; after MAX_ATTEMPTS the code is dead.
 */
export async function verifyStaffOtp(
  db: DB,
  staffId: string,
  purpose: StaffOtpPurpose,
  code: string
): Promise<VerifyStaffOtpResult> {
  if (!code || code.length !== OTP_LENGTH || !/^\d+$/.test(code)) {
    return { ok: false, error: OTP_GENERIC_ERROR, reason: 'bad_format' }
  }

  const now = new Date()
  const [otp] = await db
    .select()
    .from(schema.staffOtpCodes)
    .where(
      and(
        eq(schema.staffOtpCodes.staffId, staffId),
        eq(schema.staffOtpCodes.purpose, purpose),
        isNull(schema.staffOtpCodes.usedAt),
        gt(schema.staffOtpCodes.expiresAt, now)
      )
    )
    .orderBy(desc(schema.staffOtpCodes.createdAt))
    .limit(1)

  if (!otp) return { ok: false, error: OTP_GENERIC_ERROR, reason: 'no_code' }

  const candidateHash = await hashOtp(code, 'staff')
  if (!timingSafeEqualHex(candidateHash, otp.codeHash)) {
    // M4: increment in SQL, not from the value we read. Two concurrent wrong
    // guesses both computed `attempts + 1` from the same base and wrote the
    // same number, so five parallel guesses counted as one. The `lt` guard
    // makes the cap itself atomic: zero rows back means the cap was already
    // reached, so a burst cannot slip past it.
    const bumped = await db
      .update(schema.staffOtpCodes)
      .set({ attempts: sql`${schema.staffOtpCodes.attempts} + 1` })
      .where(
        and(eq(schema.staffOtpCodes.id, otp.id), lt(schema.staffOtpCodes.attempts, MAX_ATTEMPTS))
      )
      .returning({ attempts: schema.staffOtpCodes.attempts })

    return {
      ok: false,
      error: OTP_GENERIC_ERROR,
      reason: bumped.length === 0 ? 'attempts_exhausted' : 'wrong_code',
    }
  }

  // M4: consume atomically. This was a read-modify-write — the SELECT above
  // filtered on `usedAt IS NULL`, but nothing held that true until the UPDATE
  // landed, so two requests carrying the same correct code could both pass the
  // check and both be accepted (OTP replay). `WHERE usedAt IS NULL ... RETURNING`
  // makes exactly one of them win.
  const consumed = await db
    .update(schema.staffOtpCodes)
    .set({ usedAt: now })
    .where(and(eq(schema.staffOtpCodes.id, otp.id), isNull(schema.staffOtpCodes.usedAt)))
    .returning({ id: schema.staffOtpCodes.id })

  if (consumed.length === 0) {
    return { ok: false, error: OTP_GENERIC_ERROR, reason: 'already_used' }
  }

  return { ok: true }
}
