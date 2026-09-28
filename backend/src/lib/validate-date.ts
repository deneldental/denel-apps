/**
 * Parse a date string from a query param.
 * Throws a typed error if the string is present but invalid.
 * Returns the fallback if the string is absent or empty.
 */
export function parseQueryDate(raw: string | undefined, fallback: Date): Date {
  if (!raw || raw.trim() === '') return fallback
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) {
    throw new DateParamError(`Invalid date: "${raw}"`)
  }
  return d
}

export class DateParamError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DateParamError'
  }
}

/**
 * Guard for appointment dates. Rejects any date that falls **before today**
 * (server-local 00:00). Same-day past times are allowed — a receptionist
 * documenting a 9 AM walk-in at 11 AM is legitimate, but back-dating to
 * yesterday or earlier is not.
 *
 * Returns null when the date is acceptable, or an error tuple suitable for
 * `return c.json(...)` when it isn't.
 */
export function rejectPastAppointmentDate(date: Date): { error: string; code: string } | null {
  if (Number.isNaN(date.getTime())) {
    return { error: 'Invalid appointment date', code: 'INVALID_DATE' }
  }
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  if (date < startOfToday) {
    return {
      error: 'Appointments cannot be booked for past dates',
      code: 'APPOINTMENT_DATE_PAST',
    }
  }
  return null
}
