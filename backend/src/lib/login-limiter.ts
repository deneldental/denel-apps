/**
 * Login attempt limiting — DB-backed, two independent layers.
 *
 * Both persist to `login_attempts`, so they survive restarts and agree across
 * horizontally-scaled instances (unlike the in-memory `lib/rate-limiter.ts`,
 * which is per-process).
 *
 *   1. Per (identifier + ip), rolling window — `checkLoginAllowed`.
 *      Stops one host hammering one account.
 *
 *   2. Per identifier, IP-INDEPENDENT, exponential backoff —
 *      `checkIdentifierThrottle`. This is the layer that matters against a
 *      distributed attempt: every request there carries a genuine, different
 *      address, so layer 1 and Better Auth's own IP-keyed limit both see a
 *      fresh bucket each time and never trigger.
 *
 * Keyed on the submitted identifier, never a resolved user id: the check has to
 * run before the account is known, and resolving first would leak existence
 * through timing.
 *
 * NOTE: this module was previously `patient-login-limiter.ts` and had zero
 * importers — the code was written but never wired to any route. Layer 2 and
 * the staff sign-in wiring in `app.ts` were added when that was found.
 */

import { and, count, eq, gt, max, min, sql } from 'drizzle-orm'
import { env, isDevEnvironment } from '../config/env'
import { getDb } from '../db'
import { loginAttempts } from '../db/schema'

const MAX_FAILURES = 5
const WINDOW_MS = 15 * 60 * 1000 // 15 minutes

/** Backoff once MAX_FAILURES is passed: 1m, 2m, 4m, 8m, 16m, then capped. */
const BASE_LOCK_MS = 60 * 1000
const MAX_LOCK_MS = 30 * 60 * 1000

/** Normalise so `Admin@X.com` and `admin@x.com ` share one bucket. */
export function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase()
}

export async function checkLoginAllowed(
  identifier: string,
  ip: string
): Promise<{ allowed: boolean; retryAfterMs?: number }> {
  if (isDevEnvironment()) return { allowed: true }

  const db = getDb(env.DATABASE_URL)
  const windowStart = new Date(Date.now() - WINDOW_MS)

  const [row] = await db
    .select({ failCount: count(), oldestAt: min(loginAttempts.attemptedAt) })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.identifier, identifier),
        eq(loginAttempts.ip, ip),
        eq(loginAttempts.success, false),
        gt(loginAttempts.attemptedAt, windowStart)
      )
    )

  const failCount = row?.failCount ?? 0
  if (failCount < MAX_FAILURES) return { allowed: true }

  const oldestAt = row?.oldestAt ? new Date(row.oldestAt).getTime() : Date.now() - WINDOW_MS
  const retryAfterMs = Math.max(0, WINDOW_MS - (Date.now() - oldestAt))
  return { allowed: false, retryAfterMs }
}

/**
 * Layer 2 — per identifier, regardless of source address.
 *
 * Counts failures for this identifier inside the window and, past the
 * threshold, requires a quiet period that doubles with each further failure.
 * The clock runs from the LAST failure, so continued guessing keeps extending
 * the lock rather than waiting it out.
 */
export async function checkIdentifierThrottle(
  identifier: string
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  if (isDevEnvironment()) return { allowed: true, retryAfterMs: 0 }

  const db = getDb(env.DATABASE_URL)
  const key = normalizeIdentifier(identifier)
  const windowStart = new Date(Date.now() - WINDOW_MS)

  const [row] = await db
    .select({ failCount: count(), lastAt: max(loginAttempts.attemptedAt) })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.identifier, key),
        eq(loginAttempts.success, false),
        gt(loginAttempts.attemptedAt, windowStart)
      )
    )

  const failCount = row?.failCount ?? 0
  if (failCount < MAX_FAILURES) return { allowed: true, retryAfterMs: 0 }

  const lockMs = Math.min(BASE_LOCK_MS * 2 ** (failCount - MAX_FAILURES), MAX_LOCK_MS)
  const lastAt = row?.lastAt ? new Date(row.lastAt).getTime() : Date.now()
  const elapsed = Date.now() - lastAt
  if (elapsed >= lockMs) return { allowed: true, retryAfterMs: 0 }

  return { allowed: false, retryAfterMs: lockMs - elapsed }
}

export async function recordFailure(identifier: string, ip: string): Promise<void> {
  if (isDevEnvironment()) return
  const db = getDb(env.DATABASE_URL)
  await db
    .insert(loginAttempts)
    .values({ identifier: normalizeIdentifier(identifier), ip, success: false })
}

/**
 * Record a success and clear the identifier's recent failures, so someone who
 * mistyped their password a few times then got it right starts clean rather
 * than sitting one slip away from a lock.
 */
export async function recordSuccess(identifier: string, ip: string): Promise<void> {
  if (isDevEnvironment()) return
  const db = getDb(env.DATABASE_URL)
  const key = normalizeIdentifier(identifier)
  await db.insert(loginAttempts).values({ identifier: key, ip, success: true })
  await db
    .delete(loginAttempts)
    .where(and(eq(loginAttempts.identifier, key), eq(loginAttempts.success, false)))
}

// Prune rows older than 24 hours — call from a scheduled job, not setInterval.
export async function pruneExpired(): Promise<void> {
  const db = getDb(env.DATABASE_URL)
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
  await db.delete(loginAttempts).where(sql`${loginAttempts.attemptedAt} < ${cutoff}`)
}
