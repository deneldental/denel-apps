/**
 * setSpecialistActive — deactivating/reactivating a specialist.
 *
 * `specialists.isActive` only hides a doctor from scheduling; nothing on the
 * sign-in path reads it. A deactivation that flips the flag and nothing else
 * leaves the doctor able to sign in to patient records (lib/account-sessions.ts
 * calls this H5). These assert on the LOGIN and its SESSIONS, because the flag
 * alone looks identical in either implementation.
 *
 * Each case runs in `withRollback`, so the database is never mutated.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import { session, specialists, user } from '../../src/db/schema'
import { grantDoctorLogin } from '../../src/lib/doctor-onboarding'
import {
  SPECIALIST_DEACTIVATED_BAN_REASON,
  setSpecialistActive,
} from '../../src/lib/specialist-status'
import { anyUserId } from './_fixtures'
import { noDb, withRollback } from './_setup'

async function makeSpecialist(tx: DB) {
  const [row] = await tx
    .insert(specialists)
    .values({ name: 'IT Dr Status', specialistType: 'external' })
    .returning()
  return row
}

/** A specialist with a working login, as the grant flow leaves them. */
async function makeDoctorWithLogin(tx: DB) {
  const spec = await makeSpecialist(tx)
  const { userId } = await grantDoctorLogin(tx, {
    specialistId: spec.id,
    email: `status-${randomUUID().slice(0, 8)}@it.local`,
    password: 'a-long-enough-password',
    grantedById: await anyUserId(tx),
  })
  return { specId: spec.id, userId }
}

async function openSession(tx: DB, userId: string) {
  const now = new Date()
  await tx.insert(session).values({
    id: randomUUID(),
    token: randomUUID(),
    userId,
    expiresAt: new Date(now.getTime() + 3_600_000),
    createdAt: now,
    updatedAt: now,
  })
}

const sessionsOf = (tx: DB, userId: string) =>
  tx.select().from(session).where(eq(session.userId, userId))
const loginOf = (tx: DB, userId: string) => tx.query.user.findFirst({ where: eq(user.id, userId) })

describe.skipIf(noDb)('setSpecialistActive', () => {
  it('deactivates a specialist who has no login', async () => {
    await withRollback(async (tx) => {
      const spec = await makeSpecialist(tx)
      const result = await setSpecialistActive(tx, spec.id, false)

      expect(result).toEqual({ specialistId: spec.id, isActive: false, loginChanged: false })
      const after = await tx.query.specialists.findFirst({ where: eq(specialists.id, spec.id) })
      expect(after?.isActive).toBe(false)
    })
  })

  it('suspends the login and ends every open session on deactivation', async () => {
    await withRollback(async (tx) => {
      const { specId, userId } = await makeDoctorWithLogin(tx)
      await openSession(tx, userId)
      await openSession(tx, userId)
      expect(await sessionsOf(tx, userId)).toHaveLength(2)

      const result = await setSpecialistActive(tx, specId, false)

      expect(result?.loginChanged).toBe(true)
      const login = await loginOf(tx, userId)
      expect(login?.banned).toBe(true)
      expect(login?.banReason).toBe(SPECIALIST_DEACTIVATED_BAN_REASON)
      // A ban stops new sign-ins; it does not close sessions already open.
      expect(await sessionsOf(tx, userId)).toHaveLength(0)
    })
  })

  it('restores the login on reactivation when the suspension was its own', async () => {
    await withRollback(async (tx) => {
      const { specId, userId } = await makeDoctorWithLogin(tx)
      await setSpecialistActive(tx, specId, false)

      const result = await setSpecialistActive(tx, specId, true)

      expect(result).toEqual({ specialistId: specId, isActive: true, loginChanged: true })
      const login = await loginOf(tx, userId)
      expect(login?.banned).toBe(false)
      expect(login?.banReason).toBeNull()
      const spec = await tx.query.specialists.findFirst({ where: eq(specialists.id, specId) })
      expect(spec?.isActive).toBe(true)
    })
  })

  // Someone else's ban is not ours to lift. Reactivating a doctor must not undo
  // an admin's separate decision to suspend their login.
  it('leaves an independent ban in place — through deactivation and reactivation', async () => {
    await withRollback(async (tx) => {
      const { specId, userId } = await makeDoctorWithLogin(tx)
      await tx
        .update(user)
        .set({ banned: true, banReason: 'Access suspended pending investigation' })
        .where(eq(user.id, userId))
      await openSession(tx, userId)

      const down = await setSpecialistActive(tx, specId, false)
      // We didn't ban them, so we report no login change and keep their reason…
      expect(down?.loginChanged).toBe(false)
      expect((await loginOf(tx, userId))?.banReason).toBe('Access suspended pending investigation')
      // …but the session that predates the ban is still ended.
      expect(await sessionsOf(tx, userId)).toHaveLength(0)

      const up = await setSpecialistActive(tx, specId, true)
      expect(up?.loginChanged).toBe(false)
      const login = await loginOf(tx, userId)
      expect(login?.banned).toBe(true)
      expect(login?.banReason).toBe('Access suspended pending investigation')
    })
  })

  it('is idempotent in both directions', async () => {
    await withRollback(async (tx) => {
      const { specId, userId } = await makeDoctorWithLogin(tx)

      await setSpecialistActive(tx, specId, false)
      const again = await setSpecialistActive(tx, specId, false)
      expect(again?.loginChanged).toBe(false) // already suspended — nothing to do
      expect((await loginOf(tx, userId))?.banReason).toBe(SPECIALIST_DEACTIVATED_BAN_REASON)

      await setSpecialistActive(tx, specId, true)
      const noop = await setSpecialistActive(tx, specId, true)
      expect(noop?.loginChanged).toBe(false)
      expect((await loginOf(tx, userId))?.banned).toBe(false)
    })
  })

  it('returns null for an unknown specialist', async () => {
    await withRollback(async (tx) => {
      expect(await setSpecialistActive(tx, randomUUID(), false)).toBeNull()
    })
  })
})
