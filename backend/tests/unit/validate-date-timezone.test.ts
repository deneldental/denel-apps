import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isPastAppointmentDate, rejectPastAppointmentDate } from '../../src/lib/validate-date'

/**
 * "No timezone safety net" audit finding (patient-records-and-scheduling-audit.md,
 * targeted-fix pass): the past-date guard used to compute "start of today" from
 * `new Date(); setHours(0,0,0,0)`, i.e. midnight in whatever timezone the Node
 * process happens to be running in — not midnight in the clinic's timezone
 * (Africa/Accra, UTC+0). This proves the fix by running the guard under a
 * server TZ that disagrees with Accra about which calendar day "now" is,
 * across a date that only one of the two would reject as past.
 */
describe('past-appointment guard is anchored to clinic time, not server time', () => {
  const originalTZ = process.env.TZ

  beforeEach(() => {
    // Etc/GMT+12 = UTC-12, chosen because it's a fixed-offset zone (no DST)
    // that disagrees with Accra (UTC+0) about the calendar day for the whole
    // 12-hour test window below.
    process.env.TZ = 'Etc/GMT+12'
  })

  afterEach(() => {
    process.env.TZ = originalTZ
    vi.useRealTimers()
  })

  it('rejects a date that is yesterday in Accra even though it is still "today" server-local', () => {
    // "Now" = 2026-09-30T02:00:00Z = 02:00 on Sept 30 in Accra (UTC+0), but
    // only 14:00 on Sept 29 in Etc/GMT+12 (UTC-12) — the server-local day
    // hasn't rolled over to the 30th yet.
    const now = new Date('2026-09-30T02:00:00Z')
    // An appointment dated 23:00 on Sept 29 UTC/Accra — squarely in the past
    // relative to Accra's "today" (which started at 2026-09-30T00:00Z), but
    // still *after* server-local "start of today" (2026-09-29T12:00Z in
    // Etc/GMT+12), so the old server-local logic would have accepted it.
    const appointmentDate = new Date('2026-09-29T23:00:00Z')

    expect(isPastAppointmentDate(appointmentDate, now)).toBe(true)

    vi.useFakeTimers()
    vi.setSystemTime(now)
    expect(rejectPastAppointmentDate(appointmentDate)).toEqual({
      error: 'Appointments cannot be booked for past dates',
      code: 'APPOINTMENT_DATE_PAST',
    })
  })

  it('accepts a same-Accra-day date even when the server-local clock has already rolled to the next day', () => {
    // Mirror case: "now" still reads as Sept 30 server-local (Etc/GMT+12),
    // and the appointment is later the same Accra day.
    const now = new Date('2026-09-30T02:00:00Z')
    const appointmentDate = new Date('2026-09-30T18:00:00Z')

    expect(isPastAppointmentDate(appointmentDate, now)).toBe(false)

    vi.useFakeTimers()
    vi.setSystemTime(now)
    expect(rejectPastAppointmentDate(appointmentDate)).toBeNull()
  })
})
