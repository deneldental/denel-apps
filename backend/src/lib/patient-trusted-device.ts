/**
 * Patient trusted-device â€” long-lived cookie marking a device as previously
 * OTP-verified for a specific patient. Pairs with patient-otp.ts.
 *
 * Flow:
 * - On successful OTP verification at login, call `trustDevice()`. This
 *   inserts a row + sets a 30-day HttpOnly cookie holding the raw token.
 * - On every subsequent /login attempt, call `isTrustedDevice()`. If the
 *   cookie matches an unexpired row for this patient, the password alone
 *   is sufficient â€” no OTP required.
 * - On password reset, call `revokeAllDevices()` to force OTP on every
 *   device after the reset.
 *
 * Security note: the raw token is only sent to the client; the DB stores
 * SHA-256 of it. An attacker with read-only DB access cannot forge trust.
 */

import { and, eq, gt } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { Context } from 'hono'
import { isDevEnvironment } from '../config/env'
import * as schema from '../db/schema'
import type { HonoEnv } from './types'

type DB = NodePgDatabase<typeof schema>

const COOKIE_NAME = 'patient_trusted_device'
const TRUST_TTL_DAYS = 30
const TRUST_TTL_MS = TRUST_TTL_DAYS * 24 * 60 * 60 * 1000
function cookieAttrs(): string {
  return isDevEnvironment()
    ? 'Path=/; HttpOnly; SameSite=Lax'
    : 'Path=/; HttpOnly; Secure; SameSite=None'
}

async function sha256Hex(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function generateRawToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function readCookie(c: Context<HonoEnv>): string | null {
  const header = c.req.header('Cookie') ?? ''
  const match = header.match(new RegExp(`${COOKIE_NAME}=([^;]+)`))
  return match ? match[1] : null
}

function trustCookieHeader(rawToken: string, maxAgeSeconds: number): string {
  return `${COOKIE_NAME}=${rawToken}; ${cookieAttrs()}; Max-Age=${maxAgeSeconds}`
}

function clearCookieHeader(): string {
  return `${COOKIE_NAME}=; ${cookieAttrs()}; Max-Age=0`
}

/**
 * Returns true if the request carries a valid, unexpired trust token for
 * this patient. Side-effect: bumps `lastUsedAt` on the matched row.
 */
export async function isTrustedDevice(
  db: DB,
  patientId: string,
  c: Context<HonoEnv>
): Promise<boolean> {
  const raw = readCookie(c)
  if (!raw) return false

  const tokenHash = await sha256Hex(raw)
  const now = new Date()

  const [row] = await db
    .select()
    .from(schema.patientTrustedDevices)
    .where(
      and(
        eq(schema.patientTrustedDevices.patientId, patientId),
        eq(schema.patientTrustedDevices.tokenHash, tokenHash),
        gt(schema.patientTrustedDevices.expiresAt, now)
      )
    )
    .limit(1)

  if (!row) return false

  // Best-effort lastUsedAt bump; ignore failure
  await db
    .update(schema.patientTrustedDevices)
    .set({ lastUsedAt: now })
    .where(eq(schema.patientTrustedDevices.id, row.id))
    .catch(() => {})

  return true
}

/**
 * Issue a new 30-day trust cookie for this device + patient. Inserts a
 * row, sets the cookie via Set-Cookie header on the response.
 */
export async function trustDevice(db: DB, patientId: string, c: Context<HonoEnv>): Promise<void> {
  const raw = generateRawToken()
  const tokenHash = await sha256Hex(raw)
  const expiresAt = new Date(Date.now() + TRUST_TTL_MS)

  await db.insert(schema.patientTrustedDevices).values({
    patientId,
    tokenHash,
    userAgent: c.req.header('User-Agent') ?? null,
    expiresAt,
  })

  c.header('Set-Cookie', trustCookieHeader(raw, TRUST_TTL_DAYS * 24 * 60 * 60), { append: true })
}

/**
 * Revoke every trusted device for this patient. Used on password reset
 * so all sessions go through OTP again.
 */
export async function revokeAllDevices(db: DB, patientId: string): Promise<void> {
  await db
    .delete(schema.patientTrustedDevices)
    .where(eq(schema.patientTrustedDevices.patientId, patientId))
}

/**
 * Clear only the calling device's trust cookie (e.g. on logout).
 * Does not touch other trusted devices for the same patient.
 */
export async function clearCurrentDeviceTrust(db: DB, c: Context<HonoEnv>): Promise<void> {
  const raw = readCookie(c)
  if (raw) {
    const tokenHash = await sha256Hex(raw)
    await db
      .delete(schema.patientTrustedDevices)
      .where(eq(schema.patientTrustedDevices.tokenHash, tokenHash))
  }
  c.header('Set-Cookie', clearCookieHeader(), { append: true })
}

// ─── Phone-anchored trust (passwordless login) ───────────────────────────────
// A trusted device is bound to a normalized PHONE, not a single patient — one
// trust covers every enabled patient on that phone (family profile switcher).

/**
 * Issue a 30-day trust cookie binding this device to a phone number. Inserts a
 * row (patientId null) and sets the cookie. Call after a successful login OTP.
 */
export async function trustDeviceForPhone(
  db: DB,
  phone: string,
  c: Context<HonoEnv>
): Promise<void> {
  const raw = generateRawToken()
  const tokenHash = await sha256Hex(raw)
  const expiresAt = new Date(Date.now() + TRUST_TTL_MS)

  await db.insert(schema.patientTrustedDevices).values({
    phone,
    tokenHash,
    userAgent: c.req.header('User-Agent') ?? null,
    expiresAt,
  })

  c.header('Set-Cookie', trustCookieHeader(raw, TRUST_TTL_DAYS * 24 * 60 * 60), { append: true })
}

/**
 * Resolve the phone this device is currently trusted for (valid, unexpired
 * cookie). Returns null if the device is untrusted. Bumps `lastUsedAt`.
 * This is the phone-auth proof consumed by /profiles and /select-profile.
 */
export async function getTrustedPhone(db: DB, c: Context<HonoEnv>): Promise<string | null> {
  const raw = readCookie(c)
  if (!raw) return null

  const tokenHash = await sha256Hex(raw)
  const now = new Date()

  const [row] = await db
    .select()
    .from(schema.patientTrustedDevices)
    .where(
      and(
        eq(schema.patientTrustedDevices.tokenHash, tokenHash),
        gt(schema.patientTrustedDevices.expiresAt, now)
      )
    )
    .limit(1)

  if (!row?.phone) return null

  await db
    .update(schema.patientTrustedDevices)
    .set({ lastUsedAt: now })
    .where(eq(schema.patientTrustedDevices.id, row.id))
    .catch(() => {})

  return row.phone
}

/** True if this device holds a valid trust token for the given phone. */
export async function isTrustedDeviceForPhone(
  db: DB,
  phone: string,
  c: Context<HonoEnv>
): Promise<boolean> {
  const trusted = await getTrustedPhone(db, c)
  return trusted === phone
}

/**
 * Revoke EVERY trusted device issued to a phone — the portal "reset" action
 * (clears all device dockings so the patient starts fresh, re-OTP next login).
 */
export async function revokeAllDevicesForPhone(db: DB, phone: string): Promise<void> {
  await db.delete(schema.patientTrustedDevices).where(eq(schema.patientTrustedDevices.phone, phone))
}
