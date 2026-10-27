// Shared appointment-status vocabulary and rules — kept out of any one route file
// because appointments.ts (PATCH /:id) and appointment-workflow.ts (PATCH
// /:id/transition, POST /:id/check-in and the public confirm link) all need to
// agree on them.

import { zonedStartOfDay } from '@denel/utils'

/**
 * Once an appointment reaches one of these, it's done. Neither the raw
 * PATCH nor the dedicated transition endpoint will move it to a different
 * status from here. Without this, a completed/cancelled/no_show appointment
 * could be freely re-checked-in, re-completed, or reopened in any order —
 * and payment taken again on the reopened visit. See
 * project-docs/patient-records-and-scheduling-audit.md, findings C2/C3.
 */
export const TERMINAL_APPOINTMENT_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'cancelled',
  'no_show',
])

/**
 * The statuses an appointment may be given. `booked` and `unconfirmed` are
 * deliberately absent: older data and the no-show cron still carry them, so they
 * are READ (see PRE_ARRIVAL_APPOINTMENT_STATUSES) but never written.
 */
export const APPOINTMENT_STATUSES = [
  'scheduled',
  'confirmed',
  'rescheduled',
  'checked_in',
  'in_chair',
  'completed',
  'cancelled',
  'no_show',
] as const

export function isKnownAppointmentStatus(status: string): boolean {
  return (APPOINTMENT_STATUSES as readonly string[]).includes(status)
}

/**
 * The only statuses a NEW visit may start in: a booking (`scheduled`), a converted
 * web booking (`confirmed`), or a walk-in who is already here (`checked_in`). A
 * visit created already `completed`, `in_chair` or `no_show` would skip the machine
 * below entirely, and creation used to accept any text at all as a status.
 */
export const CREATABLE_APPOINTMENT_STATUSES: ReadonlySet<string> = new Set([
  'scheduled',
  'confirmed',
  'checked_in',
])

export function isCreatableStatus(status: string): boolean {
  return CREATABLE_APPOINTMENT_STATUSES.has(status)
}

/** The patient has not arrived yet. Includes the two legacy statuses (see above). */
export const PRE_ARRIVAL_APPOINTMENT_STATUSES: ReadonlySet<string> = new Set([
  'scheduled',
  'confirmed',
  'rescheduled',
  'booked',
  'unconfirmed',
])

export function isPreArrivalStatus(status: string): boolean {
  return PRE_ARRIVAL_APPOINTMENT_STATUSES.has(status)
}

/**
 * The only status changes the server allows (F19). Before this, anything but a
 * move out of a terminal status was accepted: `checked_in → checked_in` (which
 * re-stamped the arrival time), `in_chair → checked_in`, `scheduled → completed`
 * (a visit with no arrival), and any text at all as a status. The moves below are
 * the ones the screens drive: check in, seat, complete, no-show, cancel,
 * reschedule and confirm.
 */
const ALLOWED_STATUS_CHANGES: Record<string, readonly string[]> = {
  scheduled: ['confirmed', 'rescheduled', 'checked_in', 'cancelled', 'no_show'],
  confirmed: ['scheduled', 'rescheduled', 'checked_in', 'cancelled', 'no_show'],
  rescheduled: ['scheduled', 'confirmed', 'checked_in', 'cancelled', 'no_show'],
  booked: ['scheduled', 'confirmed', 'rescheduled', 'checked_in', 'cancelled', 'no_show'],
  unconfirmed: ['scheduled', 'confirmed', 'rescheduled', 'checked_in', 'cancelled', 'no_show'],
  checked_in: ['in_chair', 'completed', 'cancelled'],
  in_chair: ['completed'],
  completed: [],
  cancelled: [],
  no_show: [],
}

/** Is moving an appointment from `from` to `to` allowed? A move to the same status is not a move. */
export function canChangeStatus(from: string, to: string): boolean {
  return ALLOWED_STATUS_CHANGES[from]?.includes(to) ?? false
}

export type PastDayDecision = 'allowed' | 'needs_reason' | 'locked'

/**
 * Who may change an appointment whose day has passed (decision D6, 2026-10-26).
 *
 * - Today or later: always allowed.
 * - An admin may change any past visit, with a written reason.
 * - Anyone else may close out YESTERDAY's visit as no-show or completed, and only
 *   as a status-only change; everything else in the past is locked.
 *
 * Days are clinic days (Africa/Accra), not the server's.
 */
export function pastDayDecision(input: {
  appointmentDate: Date
  now: Date
  isAdmin: boolean
  /** The status the change moves to, or null for an edit that does not change status. */
  targetStatus: string | null
  /** True when the request changes nothing but the status. */
  statusOnly: boolean
}): PastDayDecision {
  const startOfToday = zonedStartOfDay(input.now)
  if (input.appointmentDate >= startOfToday) return 'allowed'
  if (input.isAdmin) return 'needs_reason'

  // One minute before today's midnight is always yesterday; its clinic-day start is yesterday's.
  const startOfYesterday = zonedStartOfDay(new Date(startOfToday.getTime() - 60_000))
  const isYesterday = input.appointmentDate >= startOfYesterday
  const closesOut = input.targetStatus === 'no_show' || input.targetStatus === 'completed'
  return isYesterday && closesOut && input.statusOnly ? 'allowed' : 'locked'
}

/**
 * Statuses a NEW payment must not be created against. Deliberately narrower
 * than TERMINAL_APPOINTMENT_STATUSES: a `completed` appointment is exactly
 * when payment normally happens (visit finished → bill it), so it stays
 * payable. `cancelled`/`no_show` mean the visit never properly happened —
 * paying against one of those was previously unguarded anywhere in
 * payment-service.ts. See
 * project-docs/patient-records-and-scheduling-audit.md, finding C2.
 */
export const NON_PAYABLE_APPOINTMENT_STATUSES: ReadonlySet<string> = new Set([
  'cancelled',
  'no_show',
])
