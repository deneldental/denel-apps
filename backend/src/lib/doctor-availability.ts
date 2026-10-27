// Doctor block-time (unavailability) enforcement.
//
// `doctor_unavailability` rows are created by the portal's "Block Time" sheet.
// Blocking a doctor has to actually stop bookings, so every path that puts an
// appointment on a doctor's calendar runs through `findDoctorBlock` — the
// clients also check client-side, but that's a convenience, not the rule.
//
// This file ALSO holds the doctor/chair double-booking check
// (findConflictingAppointment) — a different kind of conflict (another
// patient's active appointment, not a declared block), but it shares
// `checkDoctorAvailable` as the one place every booking path calls. See
// project-docs/patient-records-and-scheduling-audit.md, finding C1: until
// this, NOTHING — client or server — checked a proposed appointment against
// any other already-scheduled appointment for that doctor.

import { and, asc, eq, gt, lt, ne, notInArray, sql } from 'drizzle-orm'
import type { DB } from '../db'
import { appointments, doctorUnavailability } from '../db/schema'
import { TERMINAL_APPOINTMENT_STATUSES } from './appointment-status'

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

export type AppointmentConflict = {
  id: string
  date: Date
  durationMinutes: number
}

/**
 * The first ACTIVE appointment — for this doctor, or in this chair — that
 * overlaps the proposed window, or null when there's no conflict. "Active"
 * means not terminal: completed/cancelled/no_show appointments don't block,
 * matching TERMINAL_APPOINTMENT_STATUSES everywhere else in the app. Overlap
 * accounts for each existing row's OWN `durationMinutes`, not a fixed slot —
 * a 60-minute appointment blocks a full hour, not just its start minute.
 *
 * `excludeAppointmentId` lets a reschedule check against every OTHER
 * appointment without the row conflicting with itself.
 */
async function findActiveAppointmentConflict(
  db: DB,
  column: typeof appointments.doctorId | typeof appointments.chairId,
  ownerId: string,
  start: Date,
  durationMinutes: number,
  excludeAppointmentId?: string
): Promise<AppointmentConflict | null> {
  if (Number.isNaN(start.getTime())) return null
  const minutes = durationMinutes > 0 ? durationMinutes : DEFAULT_APPOINTMENT_MINUTES
  const end = new Date(start.getTime() + minutes * 60_000)

  const conditions = [
    eq(column, ownerId),
    notInArray(appointments.status, [...TERMINAL_APPOINTMENT_STATUSES]),
    lt(appointments.date, end),
    // existing.date + existing.durationMinutes minutes > proposed start
    sql`(${appointments.date} + (${appointments.durationMinutes} * interval '1 minute')) > ${start}`,
  ]
  if (excludeAppointmentId) conditions.push(ne(appointments.id, excludeAppointmentId))

  const [row] = await db
    .select({
      id: appointments.id,
      date: appointments.date,
      durationMinutes: appointments.durationMinutes,
    })
    .from(appointments)
    .where(and(...conditions))
    .orderBy(asc(appointments.date))
    .limit(1)

  return row ?? null
}

export function findConflictingAppointment(
  db: DB,
  doctorId: string,
  start: Date,
  durationMinutes: number = DEFAULT_APPOINTMENT_MINUTES,
  excludeAppointmentId?: string
): Promise<AppointmentConflict | null> {
  return findActiveAppointmentConflict(
    db,
    appointments.doctorId,
    doctorId,
    start,
    durationMinutes,
    excludeAppointmentId
  )
}

export function findChairConflict(
  db: DB,
  chairId: string,
  start: Date,
  durationMinutes: number = DEFAULT_APPOINTMENT_MINUTES,
  excludeAppointmentId?: string
): Promise<AppointmentConflict | null> {
  return findActiveAppointmentConflict(
    db,
    appointments.chairId,
    chairId,
    start,
    durationMinutes,
    excludeAppointmentId
  )
}

/** The 409 body when the doctor already has another active appointment. */
export function doctorBookedError(conflict: AppointmentConflict) {
  return {
    error: 'Doctor is unavailable during this time',
    code: 'DOCTOR_UNAVAILABLE' as const,
    conflictingAppointmentId: conflict.id,
  }
}

/** The 409 body when the chair is already occupied by another active appointment. */
export function chairBookedError(conflict: AppointmentConflict) {
  return {
    error: 'This chair is already booked during this time',
    code: 'CHAIR_UNAVAILABLE' as const,
    conflictingAppointmentId: conflict.id,
  }
}

/**
 * Convenience wrapper for the booking routes: checks declared block-time,
 * then another active appointment for the same doctor, then (if a chair is
 * given) another active appointment in the same chair. Returns the
 * ready-to-send error body for whichever hits first, or null when the slot
 * is free on every axis.
 */
export async function checkDoctorAvailable(
  db: DB,
  doctorId: string,
  start: Date,
  durationMinutes?: number,
  opts?: { excludeAppointmentId?: string; chairId?: string | null }
): Promise<
  | ReturnType<typeof doctorUnavailableError>
  | ReturnType<typeof doctorBookedError>
  | ReturnType<typeof chairBookedError>
  | null
> {
  const block = await findDoctorBlock(db, doctorId, start, durationMinutes)
  if (block) return doctorUnavailableError(block)

  const doctorConflict = await findConflictingAppointment(
    db,
    doctorId,
    start,
    durationMinutes,
    opts?.excludeAppointmentId
  )
  if (doctorConflict) return doctorBookedError(doctorConflict)

  if (opts?.chairId) {
    const chairConflict = await findChairConflict(
      db,
      opts.chairId,
      start,
      durationMinutes,
      opts?.excludeAppointmentId
    )
    if (chairConflict) return chairBookedError(chairConflict)
  }

  return null
}
