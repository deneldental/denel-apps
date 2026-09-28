/**
 * The one contract every session-bearing surface obeys.
 *
 * This system has several session mechanisms — Better Auth's `session` table
 * (now portal, HR, reports, the Team PWA and the kiosk operator hand-off, after
 * stages 2–3 of the consolidation), the legacy `staff_sessions` (no longer
 * written by any flow, only read until the rows expire), `patient_sessions`,
 * and the kiosk's own stateless operator tokens. What they must share is the
 * *contract*, because every bug in this area so far has been one mechanism not
 * knowing what another does:
 *
 *   - Banning a user deleted Better Auth's sessions but not `staff_sessions`,
 *     so a banned staffer kept working for up to 30 days (H5).
 *   - Offboarding wrote `banned = true` straight to the column and revoked
 *     nothing at all, in either table (H5).
 *   - Deactivating or deleting a staff member revoked `staff_sessions` only,
 *     so a deactivated doctor kept their portal session — despite the comment
 *     claiming they were "signed out everywhere immediately".
 *   - The custom password reset wrote `account.password` directly, so no
 *     Better Auth hook fired and no session anywhere was revoked (H4).
 *   - Nothing checked `banned` when a Better Auth session was READ — Better
 *     Auth only enforces it at session creation — so a ban left every live
 *     session working until it expired. Now applied in `lib/rbac.ts`.
 *   - Revocation never reached kiosk operator tokens, so a banned staffer
 *     could still unlock a paired station with their PIN.
 *
 * Three primitives, used everywhere rather than reimplemented:
 *   isAccountDisabled()        — may this account hold a session at all
 *   revokeAllSessionsForUser() — end every session this user has, everywhere:
 *                                Better Auth rows, staff_sessions rows, and the
 *                                stateless kiosk operator tokens (epoch bump)
 *   setUserPassword()          — write a password AND revoke, as one operation
 *
 * `patient_sessions` is deliberately not covered: those are keyed on a patient
 * id, not a `user` id, and patients are not staff accounts. Revoking them
 * belongs with the patient auth flow.
 */

import { and, eq, inArray, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '../db/schema'
import { CacheManager } from '../rbac/engine/CacheManager'
import { invalidateSessionCache } from '../rbac/session-cache'
import { hashPassword } from './password'

type Db = NodePgDatabase<typeof schema>
/** The transaction handle `db.transaction()` hands its callback. */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
/** Accepts either, so callers inside a transaction stay atomic. */
export type DbLike = Db | Tx

/**
 * Whether the account is barred from holding a session.
 *
 * Mirrors Better Auth's admin-plugin semantics exactly
 * (`plugins/admin/admin.mjs`): a ban whose `banExpires` is in the past has
 * lapsed. Every session reader must use THIS function — one stack accepting a
 * credential the other rejects is the bug class this module exists to close.
 */
export function isAccountDisabled(u: {
  banned?: boolean | null
  banExpires?: Date | null
}): boolean {
  if (!u.banned) return false
  if (u.banExpires && u.banExpires.getTime() < Date.now()) return false
  return true
}

/**
 * End every session this user holds, across every mechanism.
 *
 * Call this from anywhere that disables an account — ban, offboard,
 * deactivate, delete, password change. Revoking one mechanism and not the
 * others is how H5 happened, twice.
 *
 * The cache clear matters as much as the deletes: `rbac/session-cache.ts`
 * answers from memory for up to its TTL, so without it a revoked credential
 * keeps working for a few seconds more. (Process-local — see that file's note
 * on multi-instance deployments.)
 */
export async function revokeAllSessionsForUser(db: DbLike, userId: string): Promise<void> {
  await db.delete(schema.session).where(eq(schema.session.userId, userId))
  await db.delete(schema.staffSessions).where(eq(schema.staffSessions.userId, userId))

  // Kiosk operator sessions are stateless signed tokens, so there is no row to
  // delete: they are invalidated by bumping the operator's `sessionEpoch`,
  // which the token carries and `kiosk.ts` compares on every verify.
  //
  // Omitting this left a real hole. The kiosk checks `staff.status`/`deletedAt`
  // on unlock, so deactivating or offboarding someone did lock them out — but
  // banning a user or resetting their password (routes/users.ts,
  // staff-core.ts) touches neither, so a banned staffer could still unlock a
  // paired station with their PIN and keep working. That is the same H5 class
  // this module exists to close, in the one surface it had not reached.
  const operatorStaff = db
    .select({ id: schema.staff.id })
    .from(schema.staff)
    .where(eq(schema.staff.userId, userId))
  await db
    .update(schema.kioskOperators)
    .set({
      sessionEpoch: sql`${schema.kioskOperators.sessionEpoch} + 1`,
      updatedAt: new Date(),
    })
    .where(inArray(schema.kioskOperators.staffId, operatorStaff))

  invalidateSessionCache()

  // Also drop this user's RESOLVED PERMISSIONS, not just their sessions.
  //
  // These are two different caches with two different lifetimes, and only
  // `access-management.ts` was clearing the second one — so offboarding cleared
  // it while a ban, a deactivation and a password reset did not. Doing it here
  // means every revocation path gets both, which is the entire point of this
  // module. CacheManager's invalidate also writes a distributed eviction key
  // when Upstash is configured, so unlike the session cache this part does
  // propagate to other instances (M5).
  //
  // Best-effort by design: failing to clear a cache must never fail the
  // revocation that has already been committed to the database.
  try {
    await new CacheManager().invalidate(userId)
  } catch {
    // Bounded by the cache's own 10s TTL.
  }
}

/**
 * Set a credential password and revoke every session, as one operation.
 *
 * Password changes and session revocation are not separable: leaving old
 * sessions alive after a reset means an attacker who already has one keeps it,
 * and the victim's reset accomplishes nothing. Better Auth couples the two in
 * its own flow; any path that writes `account.password` directly has to do the
 * same, which is why this exists rather than callers doing the update inline.
 */
export async function setUserPassword(
  db: DbLike,
  userId: string,
  plaintextPassword: string
): Promise<void> {
  const hashed = await hashPassword(plaintextPassword)
  await db
    .update(schema.account)
    .set({ password: hashed, updatedAt: new Date() })
    .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, 'credential')))
  await revokeAllSessionsForUser(db, userId)
}

/**
 * The current credential hash, or null. Used to bind a reset token to the
 * password it was issued against, so the token dies the moment it is spent.
 */
export async function getCredentialHash(db: DbLike, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ password: schema.account.password })
    .from(schema.account)
    .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, 'credential')))
    .limit(1)
  return row?.password ?? null
}
