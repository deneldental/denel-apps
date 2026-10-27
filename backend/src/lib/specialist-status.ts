/**
 * Deactivating and reactivating a specialist.
 *
 * `specialists.isActive` only controls scheduling and the kiosk: it hides a
 * doctor from the appointment dropdown. Nothing on the sign-in path reads it,
 * so flipping the flag alone leaves a "deactivated" doctor able to sign in with
 * full access to patient records. lib/account-sessions.ts documents that exact
 * failure (H5: "a deactivated doctor kept their portal session"), so
 * deactivation here also suspends the linked login and ends its sessions —
 * through that module's primitives, not a reimplementation.
 *
 * Reactivation undoes only what deactivation did. A login that was suspended
 * for some other reason (an admin banned it in Access Management) stays
 * suspended: we recognise our own suspension by its reason string and never
 * overwrite someone else's.
 */

import { eq } from 'drizzle-orm'
import type { DB } from '../db'
import { specialists, user } from '../db/schema'
import { revokeAllSessionsForUser } from './account-sessions'

/** Stored in `user.banReason`; how reactivation knows the suspension is ours. */
export const SPECIALIST_DEACTIVATED_BAN_REASON = 'Specialist deactivated'

export interface SpecialistStatusResult {
  specialistId: string
  isActive: boolean
  /** The login was suspended / restored by this call (false when there is none). */
  loginChanged: boolean
}

/**
 * Set a specialist active or inactive, and keep their login in step.
 * Returns null when the specialist doesn't exist. Idempotent.
 *
 * `db` may already be a transaction (drizzle nests as a SAVEPOINT).
 */
export async function setSpecialistActive(
  db: DB,
  specialistId: string,
  active: boolean
): Promise<SpecialistStatusResult | null> {
  return db.transaction(async (tx) => {
    const [spec] = await tx
      .select({ id: specialists.id, userId: specialists.userId })
      .from(specialists)
      .where(eq(specialists.id, specialistId))
      .for('update')
    if (!spec) return null

    await tx
      .update(specialists)
      .set({ isActive: active, updatedAt: new Date() })
      .where(eq(specialists.id, specialistId))

    let loginChanged = false
    if (spec.userId) {
      const [login] = await tx
        .select({ banned: user.banned, banReason: user.banReason })
        .from(user)
        .where(eq(user.id, spec.userId))

      if (login && !active && !login.banned) {
        await tx
          .update(user)
          .set({
            banned: true,
            banReason: SPECIALIST_DEACTIVATED_BAN_REASON,
            banExpires: null,
            updatedAt: new Date(),
          })
          .where(eq(user.id, spec.userId))
        loginChanged = true
      }
      // Sessions end on every deactivation, even if an admin had already banned
      // the login — a ban alone doesn't close sessions that were open before it.
      if (!active) await revokeAllSessionsForUser(tx, spec.userId)

      if (
        login &&
        active &&
        login.banned &&
        login.banReason === SPECIALIST_DEACTIVATED_BAN_REASON
      ) {
        await tx
          .update(user)
          .set({ banned: false, banReason: null, banExpires: null, updatedAt: new Date() })
          .where(eq(user.id, spec.userId))
        loginChanged = true
      }
    }

    return { specialistId, isActive: active, loginChanged }
  })
}
