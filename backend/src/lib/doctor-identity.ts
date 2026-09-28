/**
 * "Which doctor is this logged-in user?"
 *
 * A login account reaches a `doctors` row by one of TWO shapes, and both are
 * live in production data:
 *
 *   1. direct       — doctors.userId = user.id
 *                     How the seed and the legacy path provision doctors.
 *   2. via specialist — doctors.specialistId → specialists.userId = user.id
 *                     How the portal's add-specialist flow provisions them, and
 *                     therefore how every doctor created through the UI looks.
 *
 * Only `GET /api/doctors/me` checked both. The worklist day-sheet, the weekly
 * view and the pending-medical-records list each checked shape 1 alone, so a
 * doctor created the normal way — specialist-sourced, `doctors.userId` null —
 * was told "Your account isn't linked to a doctor profile" on the Activity page
 * while `/me` resolved them perfectly well. The message was a false negative
 * describing correctly-linked data.
 *
 * Everything that needs to answer this question calls here, so the two shapes
 * cannot drift apart again.
 */

import { eq } from 'drizzle-orm'
import type { DB } from '../db'
import { doctors, specialists } from '../db/schema'

export type ResolvedDoctor = {
  id: string
  specialty: string | null
  /** Which linkage shape matched — useful when diagnosing setup problems. */
  via: 'direct' | 'specialist'
}

/**
 * Resolve the caller's own doctor profile, or null when the account genuinely
 * has none (reception, admin without a clinical profile, an unlinked doctor).
 */
export async function resolveDoctorForUser(db: DB, userId: string): Promise<ResolvedDoctor | null> {
  const direct = await db.query.doctors.findFirst({
    where: eq(doctors.userId, userId),
    columns: { id: true, specialty: true },
  })
  if (direct) return { id: direct.id, specialty: direct.specialty ?? null, via: 'direct' }

  const specialist = await db.query.specialists.findFirst({
    where: eq(specialists.userId, userId),
    columns: { id: true },
  })
  if (!specialist) return null

  const viaSpecialist = await db.query.doctors.findFirst({
    where: eq(doctors.specialistId, specialist.id),
    columns: { id: true, specialty: true },
  })
  if (!viaSpecialist) return null

  return { id: viaSpecialist.id, specialty: viaSpecialist.specialty ?? null, via: 'specialist' }
}

/** Convenience wrapper for callers that only need the id. */
export async function resolveDoctorIdForUser(db: DB, userId: string): Promise<string | null> {
  return (await resolveDoctorForUser(db, userId))?.id ?? null
}
