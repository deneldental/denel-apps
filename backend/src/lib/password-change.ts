/**
 * "Choose your own password" (F20 / decision D8).
 *
 * A password an admin writes for someone else is known to the admin, so it must not
 * stay the credential: the person has to replace it before doing anything else.
 *
 * The flag lives on the USER row (`user.mustChangePassword`), not on `staff`, because
 * not everyone who is handed a password is staff: a doctor made from the portal's Add
 * Specialist sheet has no `staff` row. `staff.isFirstLogin` is the older, staff-only
 * version of the same idea — it was set in three places and read by nothing — so it is
 * kept in step here rather than left to drift.
 *
 *   requirePasswordChange — an admin wrote this person's credential
 *   clearPasswordChange   — the person chose their own password
 *
 * Enforcement is rbac/middleware/enforcePasswordChange; the portal and the HR app read
 * the flag from the session to send the person to the change-password screen.
 */
import { eq } from 'drizzle-orm'
import { staff, user } from '../db/schema'
import type { DbLike } from './account-sessions'

export async function requirePasswordChange(db: DbLike, userId: string): Promise<void> {
  await db
    .update(user)
    .set({ mustChangePassword: true, updatedAt: new Date() })
    .where(eq(user.id, userId))
}

export async function clearPasswordChange(db: DbLike, userId: string): Promise<void> {
  const now = new Date()
  await db
    .update(user)
    .set({ mustChangePassword: false, updatedAt: now })
    .where(eq(user.id, userId))
  await db
    .update(staff)
    .set({ isFirstLogin: false, updatedAt: now })
    .where(eq(staff.userId, userId))
}
