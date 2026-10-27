/**
 * F09 / D6 — which actions a visit offers, decided in one place.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (F09).
 *
 * Before this, three screens each decided for themselves: the detail dialog showed
 * Check in for scheduled/confirmed/rescheduled but its handler accepted only
 * "scheduled"; the Today column showed Check In for every non-terminal status
 * (including a patient already checked in or in the chair, which reopened the
 * payment sheet and allowed a second payment). The rules now live here and mirror
 * the server's status machine (backend/src/lib/appointment-status.ts).
 */
import { describe, expect, it } from 'vitest'
import {
  type AppointmentActions,
  actionsFor,
  canCheckIn,
  isYesterday,
} from '@/features/appointments/appointment-actions'

const NONE: AppointmentActions = {
  checkIn: false,
  reschedule: false,
  sendReminder: false,
  noShow: false,
  cancel: false,
  seat: false,
  complete: false,
}

describe('canCheckIn', () => {
  it.each(['scheduled', 'confirmed', 'rescheduled', 'booked', 'unconfirmed'])('%s → yes', (s) => {
    expect(canCheckIn(s)).toBe(true)
  })

  it.each([
    'checked_in',
    'in_chair',
    'completed',
    'cancelled',
    'no_show',
    'no-show',
    'banana',
    '',
  ])('%j → no', (s) => {
    expect(canCheckIn(s)).toBe(false)
  })

  it('a visit with no status yet is treated as scheduled (the calendar does the same)', () => {
    expect(canCheckIn(undefined)).toBe(true)
    expect(canCheckIn(null)).toBe(true)
  })
})

describe('actionsFor — every status', () => {
  const PRE_ARRIVAL = {
    ...NONE,
    checkIn: true,
    reschedule: true,
    sendReminder: true,
    noShow: true,
    cancel: true,
  }

  it.each([
    'scheduled',
    'confirmed',
    'rescheduled',
    'booked',
    'unconfirmed',
  ])('%s offers check in, reschedule, reminder, no-show and cancel', (s) => {
    expect(actionsFor(s)).toEqual(PRE_ARRIVAL)
  })

  it('checked_in can be seated or cancelled, and nothing else', () => {
    expect(actionsFor('checked_in')).toEqual({ ...NONE, seat: true, cancel: true })
  })

  it('in_chair can only be completed', () => {
    expect(actionsFor('in_chair')).toEqual({ ...NONE, complete: true })
  })

  it.each(['completed', 'cancelled', 'no_show'])('%s offers nothing', (s) => {
    expect(actionsFor(s)).toEqual(NONE)
  })

  it('an unknown status offers nothing rather than guessing', () => {
    expect(actionsFor('banana')).toEqual(NONE)
  })

  it('never offers Check In to a patient who has already arrived (the second-payment trap)', () => {
    for (const s of ['checked_in', 'in_chair', 'completed', 'cancelled', 'no_show']) {
      expect(actionsFor(s).checkIn).toBe(false)
    }
  })
})

describe("actionsFor — closing out yesterday's visit (D6, non-admin)", () => {
  const closeOut = { closeOutOnly: true }

  it.each(['scheduled', 'confirmed', 'rescheduled'])('%s may only be marked no-show', (s) => {
    expect(actionsFor(s, closeOut)).toEqual({ ...NONE, noShow: true })
  })

  it.each(['checked_in', 'in_chair'])('%s may only be completed', (s) => {
    expect(actionsFor(s, closeOut)).toEqual({ ...NONE, complete: true })
  })

  it.each(['completed', 'cancelled', 'no_show'])('%s offers nothing', (s) => {
    expect(actionsFor(s, closeOut)).toEqual(NONE)
  })
})

describe('isYesterday', () => {
  const now = new Date(2026, 9, 26, 10, 0, 0) // 26 Oct 2026, 10:00 local

  it('is true for any time yesterday', () => {
    expect(isYesterday(new Date(2026, 9, 25, 0, 0, 0), now)).toBe(true)
    expect(isYesterday(new Date(2026, 9, 25, 23, 59, 59), now)).toBe(true)
  })

  it.each([
    ['today', new Date(2026, 9, 26, 0, 0, 0)],
    ['the day before yesterday', new Date(2026, 9, 24, 23, 59, 59)],
    ['tomorrow', new Date(2026, 9, 27, 9, 0, 0)],
  ])('is false for %s', (_label, d) => {
    expect(isYesterday(d, now)).toBe(false)
  })
})
