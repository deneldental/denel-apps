/**
 * Staff session — opaque, server-stored session for the passwordless phone+OTP
 * staff-PWA login. Mirrors the patient session model (patient-auth.ts): a random
 * token is set as an HttpOnly cookie and the DB stores only its SHA-256 hash.
 *
 * This is a CUSTOM session layer, deliberately separate from Better Auth (which
 * still powers portal/HR/reports email+password login). `getCurrentUser` is
 * made dual-source (Phase 2): it reads this `staff_session` cookie first, then
 * falls back to Better Auth — so all existing staff routes keep working.
 *
 * Security: the raw token is only ever sent to the client; an attacker with
 * read-only DB access cannot forge a session from the stored hash.
 */

import { and, eq, gt } from 'drizzle-orm'
import type { Context } from 'hono'
import { env, isDevEnvironment } from '../config/env'
import { getDb } from '../db'
import * as schema from '../db/schema'
import { isAccountDisabled } from './account-sessions'
import type { HonoEnv } from './types'

export const STAFF_SESSION_COOKIE = 'staff_session'
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

function readCookie(c: Context<HonoEnv>): string | null {
  const header = c.req.header('Cookie') ?? ''
  // Anchored on a cookie boundary. Unanchored, `staff_session=([^;]+)` also
  // matched a cookie merely ENDING in that name — `x_staff_session=…` — so an
  // attacker who could set any cookie on the domain could steer which value was
  // read as the session token.
  const match = header.match(new RegExp(`(?:^|;\\s*)${STAFF_SESSION_COOKIE}=([^;]+)`))
  return match ? match[1] : null
}

function clearCookieHeader(): string {
  return `${STAFF_SESSION_COOKIE}=; ${cookieAttrs()}; Max-Age=0`
}

// issueStaffSession() was removed. Stage 2 of the auth consolidation moved both
// of its callers (staff phone+OTP login, kiosk operator hand-off) onto
// `issueUserSession`, which creates the session inside the Better Auth kernel.
// It sat here afterwards with zero callers — a function whose only remaining
// purpose was to let someone accidentally mint a session outside the revocation
// contract in lib/account-sessions.ts. This module is now READ-ONLY: it
// validates sessions issued before the switch and clears them, nothing more.

/**
 * Validate the `staff_session` cookie. Returns the linked `user` row + the
 * session id, or null. Bumps `lastUsedAt` in the background.
 */
export async function getSessionStaff(c: Context<HonoEnv>): Promise<{
  user: typeof schema.user.$inferSelect
  sessionId: string
} | null> {
  const raw = readCookie(c)
  if (!raw) return null

  const tokenHash = await sha256Hex(raw)
  const db = getDb(env.DATABASE_URL)

  const [session] = await db
    .select()
    .from(schema.staffSessions)
    .where(
      and(
        eq(schema.staffSessions.tokenHash, tokenHash),
        gt(schema.staffSessions.expiresAt, new Date())
      )
    )
    .limit(1)

  if (!session) return null

  // No `lastUsedAt` bump. It used to run on EVERY authenticated request —
  // one UPDATE against a hot row plus the WAL cost, fire-and-forget so failures
  // were silent (M6). Nothing has issued a row here since stage 2, so the write
  // bought a last-seen timestamp for a table that is only draining. Session
  // recency for live sessions comes from Better Auth's own `session` row.

  const [u] = await db.select().from(schema.user).where(eq(schema.user.id, session.userId)).limit(1)
  if (!u) return null

  // Account status is checked HERE, on every use, not only where a ban is
  // applied. Better Auth enforces bans in a `session.create` hook — i.e. it
  // blocks new sign-ins — and its own /admin/ban-user separately deletes its
  // `session` rows. Neither touches this table, and the offboard path in
  // access-management.ts writes `banned: true` straight to the row without
  // going through Better Auth at all. Checking at point of use covers every
  // one of those paths, including any added later.
  if (isAccountDisabled(u)) {
    // The credential is dead; drop the row so a banned client stops costing a
    // lookup per request. Fire-and-forget — rejecting is what matters.
    db.delete(schema.staffSessions)
      .where(eq(schema.staffSessions.id, session.id))
      .catch(() => {})
    return null
  }

  return { user: u, sessionId: session.id }
}

/** Delete the current device's staff session (logout) and clear the cookie. */
export async function clearStaffSession(c: Context<HonoEnv>): Promise<void> {
  const raw = readCookie(c)
  if (raw) {
    const tokenHash = await sha256Hex(raw)
    const db = getDb(env.DATABASE_URL)
    await db.delete(schema.staffSessions).where(eq(schema.staffSessions.tokenHash, tokenHash))
  }
  c.header('Set-Cookie', clearCookieHeader(), { append: true })
}

// revokeAllStaffSessions() was removed: revoking one session mechanism and not
// the others is exactly the bug it kept causing. Use
// `revokeAllSessionsForUser` from lib/account-sessions.ts instead.
