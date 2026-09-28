/**
 * Staff trusted-device — long-lived cookie marking a device as previously
 * OTP-verified for a specific staff member. Mirrors patient-trusted-device.ts.
 *
 * Flow:
 * - On successful OTP verification at login, call `trustStaffDevice()`.
 * - On every subsequent /sign-in attempt, call `isTrustedStaffDevice()`.
 * - On password reset, call `revokeAllStaffDevices()` to force OTP everywhere.
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

const COOKIE_NAME = 'staff_trusted_device'
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
 * this staff member. Side-effect: bumps `lastUsedAt` on the matched row.
 */
export async function isTrustedStaffDevice(
  db: DB,
  staffId: string,
  c: Context<HonoEnv>
): Promise<boolean> {
  const raw = readCookie(c)
  if (!raw) return false

  const tokenHash = await sha256Hex(raw)
  const now = new Date()

  const [row] = await db
    .select()
    .from(schema.staffTrustedDevices)
    .where(
      and(
        eq(schema.staffTrustedDevices.staffId, staffId),
        eq(schema.staffTrustedDevices.tokenHash, tokenHash),
        gt(schema.staffTrustedDevices.expiresAt, now)
      )
    )
    .limit(1)

  if (!row) return false

  await db
    .update(schema.staffTrustedDevices)
    .set({ lastUsedAt: now })
    .where(eq(schema.staffTrustedDevices.id, row.id))
    .catch(() => {})

  return true
}

/**
 * Issue a new 30-day trust cookie for this device + staff member.
 */
export async function trustStaffDevice(
  db: DB,
  staffId: string,
  c: Context<HonoEnv>
): Promise<void> {
  const raw = generateRawToken()
  const tokenHash = await sha256Hex(raw)
  const now = new Date()
  const expiresAt = new Date(Date.now() + TRUST_TTL_MS)

  await db.insert(schema.staffTrustedDevices).values({
    staffId,
    tokenHash,
    userAgent: c.req.header('User-Agent') ?? null,
    lastUsedAt: now,
    expiresAt,
  })

  c.header('Set-Cookie', trustCookieHeader(raw, TRUST_TTL_DAYS * 24 * 60 * 60), { append: true })
}

/**
 * Revoke every trusted device for this staff member. Used on password reset.
 */
export async function revokeAllStaffDevices(db: DB, staffId: string): Promise<void> {
  await db.delete(schema.staffTrustedDevices).where(eq(schema.staffTrustedDevices.staffId, staffId))
}

/**
 * Clear only the calling device's trust cookie (e.g. on logout).
 */
export async function clearCurrentStaffDeviceTrust(db: DB, c: Context<HonoEnv>): Promise<void> {
  const raw = readCookie(c)
  if (raw) {
    const tokenHash = await sha256Hex(raw)
    await db
      .delete(schema.staffTrustedDevices)
      .where(eq(schema.staffTrustedDevices.tokenHash, tokenHash))
  }
  c.header('Set-Cookie', clearCookieHeader(), { append: true })
}
