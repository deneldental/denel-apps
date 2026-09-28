// Doctor block-time (unavailability) enforcement.
//
// `doctor_unavailability` rows are created by the portal's "Block Time" sheet.
// Blocking a doctor has to actually stop bookings, so every path that puts an
// appointment on a doctor's calendar runs through `findDoctorBlock` — the
// clients also check client-side, but that's a convenience, not the rule.

import { and, asc, eq, gt, lt } from 'drizzle-orm'
import type { DB } from '../db'
import { doctorUnavailability } from '../db/schema'

/** Fallback slot length when the caller doesn't carry an explicit duration. */
export const DEFAULT_APPOINTMENT_MINUTES = 30

export type DoctorBlock = {
  id: string
  startTime: Date
  endTime: Date
  reason: string | null
}

/**
 * The first block-time window that overlaps the proposed appointment, or null
 * when the doctor is free.
 *
 * Overlap is half-open on both ends (`block.start < apptEnd && block.end >
 * apptStart`) so an appointment that ends exactly when a block starts — or
 * starts exactly when one ends — is allowed. Mirrors `rangesOverlap()` in
 * `portals/src/features/appointments/conflicts.ts`.
 */
export async function findDoctorBlock(
  db: DB,
  doctorId: string,
  start: Date,
  durationMinutes: number = DEFAULT_APPOINTMENT_MINUTES
): Promise<DoctorBlock | null> {
  if (Number.isNaN(start.getTime())) return null
  const minutes = durationMinutes > 0 ? durationMinutes : DEFAULT_APPOINTMENT_MINUTES
  const end = new Date(start.getTime() + minutes * 60_000)

  const [block] = await db
    .select({
      id: doctorUnavailability.id,
      startTime: doctorUnavailability.startTime,
      endTime: doctorUnavailability.endTime,
      reason: doctorUnavailability.reason,
    })
    .from(doctorUnavailability)
    .where(
      and(
        eq(doctorUnavailability.doctorId, doctorId),
        lt(doctorUnavailability.startTime, end),
        gt(doctorUnavailability.endTime, start)
      )
    )
    .orderBy(asc(doctorUnavailability.startTime))
    .limit(1)

  return block ?? null
}

/**
 * The 409 body every booking path returns when a block is hit. `code` is stable
 * so clients can branch on it; `error` is already human-readable because the
 * portal surfaces `res.error` straight into a toast.
 */
export function doctorUnavailableError(block: DoctorBlock) {
  const when = `${block.startTime.toISOString()} – ${block.endTime.toISOString()}`
  return {
    error: block.reason
      ? `Doctor is unavailable during this time (${block.reason})`
      : 'Doctor is unavailable during this time',
    code: 'DOCTOR_UNAVAILABLE' as const,
    block: { id: block.id, startTime: block.startTime, endTime: block.endTime, when },
  }
}

/**
 * Convenience wrapper for the booking routes: returns the ready-to-send error
 * body, or null when the slot is free.
 */
export async function checkDoctorAvailable(
  db: DB,
  doctorId: string,
  start: Date,
  durationMinutes?: number
): Promise<ReturnType<typeof doctorUnavailableError> | null> {
  const block = await findDoctorBlock(db, doctorId, start, durationMinutes)
  return block ? doctorUnavailableError(block) : null
}
