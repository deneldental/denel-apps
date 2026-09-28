// Appointment ↔ block-time conflict helpers.

/**
 * An appointment as the API returns it: `date` is the start and the slot runs
 * `durationMinutes` from there. Pre-resolved `startTime`/`endTime` are still
 * accepted so callers that already normalised a row don't have to un-normalise
 * it.
 */
export interface AppointmentLike {
  id: string
  doctorId: string
  status: string
  date?: string | Date
  durationMinutes?: number | null
  startTime?: string | Date
  endTime?: string | Date
  patientName?: string | null
  appointmentTypeName?: string | null
}

export interface BlockTimeLike {
  id: string
  doctorId: string
  startTime: string | Date
  endTime: string | Date
  reason?: string | null
}

export interface BlockTimeConflict {
  appointment: AppointmentLike
}

const BLOCKING_STATUSES: ReadonlySet<string> = new Set(['scheduled', 'rescheduled', 'checked_in'])

/** Slot length assumed when an appointment row carries no `durationMinutes`. */
export const DEFAULT_APPOINTMENT_MINUTES = 30

/**
 * Resolve an appointment row to a concrete [start, end) millisecond range.
 * Returns null when the row has no usable start — a NaN range would silently
 * compare false against everything and make conflicts disappear.
 */
export function appointmentRange(a: AppointmentLike): { start: number; end: number } | null {
  const rawStart = a.startTime ?? a.date
  if (rawStart == null) return null
  const start = new Date(rawStart).getTime()
  if (Number.isNaN(start)) return null

  if (a.endTime != null) {
    const end = new Date(a.endTime).getTime()
    if (!Number.isNaN(end)) return { start, end }
  }
  const minutes =
    typeof a.durationMinutes === 'number' && a.durationMinutes > 0
      ? a.durationMinutes
      : DEFAULT_APPOINTMENT_MINUTES
  return { start, end: start + minutes * 60_000 }
}

/**
 * True if two time ranges overlap (half-open on the right — a range that
 * ends exactly when another starts is treated as non-overlapping).
 */
export function rangesOverlap(
  aStart: string | Date,
  aEnd: string | Date,
  bStart: string | Date,
  bEnd: string | Date
): boolean {
  const a0 = new Date(aStart).getTime()
  const a1 = new Date(aEnd).getTime()
  const b0 = new Date(bStart).getTime()
  const b1 = new Date(bEnd).getTime()
  return a0 < b1 && b0 < a1
}

/**
 * Returns appointments for the same doctor that would conflict with a
 * proposed block-time range. Only active statuses count — completed /
 * cancelled / no_show don't block.
 */
export function findAppointmentsInBlockTime(
  doctorId: string,
  startISO: string,
  endISO: string,
  appointments: AppointmentLike[]
): BlockTimeConflict[] {
  const blockStart = new Date(startISO).getTime()
  const blockEnd = new Date(endISO).getTime()
  if (Number.isNaN(blockStart) || Number.isNaN(blockEnd)) return []

  return appointments
    .filter((a) => a.doctorId === doctorId && BLOCKING_STATUSES.has(a.status))
    .filter((a) => {
      const range = appointmentRange(a)
      return range !== null && range.start < blockEnd && blockStart < range.end
    })
    .map((appointment) => ({ appointment }))
}

/**
 * Returns the block time that overlaps a proposed appointment (if any),
 * for the same doctor. Used by the add-appointment sheet to disable
 * unavailable time slots.
 */
export function findBlockTimeForAppointment<T extends BlockTimeLike>(
  doctorId: string,
  startISO: string,
  endISO: string,
  blockTimes: T[]
): T | null {
  for (const bt of blockTimes) {
    if (bt.doctorId !== doctorId) continue
    if (rangesOverlap(bt.startTime, bt.endTime, startISO, endISO)) return bt
  }
  return null
}
