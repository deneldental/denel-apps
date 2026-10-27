/**
 * F19 / decision D6 — the appointment status machine and the past-day rule.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (F09, F19).
 *
 * Until now the server only refused to move a TERMINAL appointment. Everything
 * else was accepted in any order: checked_in → checked_in (re-stamping the
 * arrival time), in_chair → checked_in, scheduled → completed (skipping arrival),
 * and any text at all as a status. These are pure rules, so they are tested
 * exhaustively: every from/to pair, not a sample.
 */
import { describe, expect, it } from 'vitest'
import {
  APPOINTMENT_STATUSES,
  canChangeStatus,
  isCreatableStatus,
  isKnownAppointmentStatus,
  isPreArrivalStatus,
  pastDayDecision,
} from '../../src/lib/appointment-status'

/** Statuses that exist in data (the legacy two are still written by older code and read by the no-show cron). */
const ALL = [...APPOINTMENT_STATUSES, 'booked', 'unconfirmed'] as const

const PRE_ARRIVAL = ['scheduled', 'confirmed', 'rescheduled', 'booked', 'unconfirmed']

/** The only moves the server allows, written out so a change here is a deliberate decision. */
const ALLOWED: Record<string, string[]> = {
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

describe('F19 — status vocabulary', () => {
  it('knows exactly the eight statuses the product uses', () => {
    expect([...APPOINTMENT_STATUSES].sort()).toEqual(
      [
        'cancelled',
        'checked_in',
        'completed',
        'confirmed',
        'in_chair',
        'no_show',
        'rescheduled',
        'scheduled',
      ].sort()
    )
  })

  it.each(['scheduled', 'checked_in', 'no_show'])('accepts %s', (s) => {
    expect(isKnownAppointmentStatus(s)).toBe(true)
  })

  it.each([
    '',
    'banana',
    'Checked_In',
    'checked-in',
    'COMPLETED',
    'booked',
    'unconfirmed',
  ])('refuses %j as a NEW status (legacy ones are read, never written)', (s) => {
    expect(isKnownAppointmentStatus(s)).toBe(false)
  })

  it('knows which statuses are before arrival, legacy ones included', () => {
    for (const s of ALL) expect(isPreArrivalStatus(s)).toBe(PRE_ARRIVAL.includes(s))
    expect(isPreArrivalStatus('banana')).toBe(false)
  })
})

describe('F19 — canChangeStatus: every from/to pair', () => {
  const pairs = ALL.flatMap((from) => ALL.map((to) => [from, to] as const))

  it.each(pairs)('%s → %s', (from, to) => {
    const expected = ALLOWED[from].includes(to)
    expect(canChangeStatus(from, to)).toBe(expected)
  })

  it('the pairs table covers every status (a new status forces a decision here)', () => {
    expect(Object.keys(ALLOWED).sort()).toEqual([...ALL].sort())
  })

  it('refuses a move to an unknown status and a move from an unknown status', () => {
    expect(canChangeStatus('scheduled', 'banana')).toBe(false)
    expect(canChangeStatus('banana', 'checked_in')).toBe(false)
    expect(canChangeStatus('', '')).toBe(false)
  })

  it('names the defects the audit listed', () => {
    expect(canChangeStatus('checked_in', 'checked_in')).toBe(false) // re-stamps checkedInAt
    expect(canChangeStatus('in_chair', 'checked_in')).toBe(false)
    expect(canChangeStatus('scheduled', 'completed')).toBe(false) // skips arrival
    expect(canChangeStatus('scheduled', 'in_chair')).toBe(false)
  })
})

describe('D6 — the past-day rule', () => {
  // Clinic time is Africa/Accra (UTC+0, no DST), so UTC midnight is clinic midnight.
  const NOW = new Date('2026-10-26T10:00:00Z')
  const at = (iso: string) => new Date(iso)

  const base = { now: NOW, isAdmin: false, statusOnly: true }

  it('a visit today is never locked, whatever the time or the change', () => {
    for (const target of ['checked_in', 'in_chair', 'completed', 'cancelled', 'no_show']) {
      expect(
        pastDayDecision({
          ...base,
          appointmentDate: at('2026-10-26T08:00:00Z'),
          targetStatus: target,
        })
      ).toBe('allowed')
    }
    // Even a non-status edit, even earlier today.
    expect(
      pastDayDecision({
        ...base,
        statusOnly: false,
        appointmentDate: at('2026-10-26T00:00:00Z'),
        targetStatus: null,
      })
    ).toBe('allowed')
  })

  it('a future visit is never locked', () => {
    expect(
      pastDayDecision({
        ...base,
        appointmentDate: at('2026-11-03T09:00:00Z'),
        targetStatus: 'cancelled',
      })
    ).toBe('allowed')
  })

  describe("yesterday's visit, non-admin", () => {
    const yesterday = at('2026-10-25T15:00:00Z')
    it.each(['no_show', 'completed'])('may be closed out as %s (a status-only change)', (t) => {
      expect(pastDayDecision({ ...base, appointmentDate: yesterday, targetStatus: t })).toBe(
        'allowed'
      )
    })
    it.each([
      'cancelled',
      'checked_in',
      'in_chair',
      'rescheduled',
      'confirmed',
      'scheduled',
    ])('may NOT be moved to %s', (t) => {
      expect(pastDayDecision({ ...base, appointmentDate: yesterday, targetStatus: t })).toBe(
        'locked'
      )
    })
    it('may not be closed out together with other edits (a status-only change is the allowance)', () => {
      expect(
        pastDayDecision({
          ...base,
          statusOnly: false,
          appointmentDate: yesterday,
          targetStatus: 'no_show',
        })
      ).toBe('locked')
    })
    it('may not have a non-status edit at all', () => {
      expect(
        pastDayDecision({
          ...base,
          statusOnly: false,
          appointmentDate: yesterday,
          targetStatus: null,
        })
      ).toBe('locked')
    })
  })

  describe('older than yesterday, non-admin', () => {
    it.each(['no_show', 'completed', 'cancelled', 'checked_in'])('is locked for %s', (t) => {
      expect(
        pastDayDecision({ ...base, appointmentDate: at('2026-10-24T15:00:00Z'), targetStatus: t })
      ).toBe('locked')
    })
  })

  describe('the day boundary is exact', () => {
    it('00:00 yesterday is still yesterday', () => {
      expect(
        pastDayDecision({
          ...base,
          appointmentDate: at('2026-10-25T00:00:00Z'),
          targetStatus: 'no_show',
        })
      ).toBe('allowed')
    })
    it('23:59:59 the day before yesterday is not', () => {
      expect(
        pastDayDecision({
          ...base,
          appointmentDate: at('2026-10-24T23:59:59Z'),
          targetStatus: 'no_show',
        })
      ).toBe('locked')
    })
    it('tracks the clinic day, not the server clock: one second after midnight is a new day', () => {
      const justAfterMidnight = new Date('2026-10-27T00:00:01Z')
      expect(
        pastDayDecision({
          ...base,
          now: justAfterMidnight,
          appointmentDate: at('2026-10-26T15:00:00Z'),
          targetStatus: 'no_show',
        })
      ).toBe('allowed') // it is now "yesterday"
      expect(
        pastDayDecision({
          ...base,
          now: justAfterMidnight,
          appointmentDate: at('2026-10-25T15:00:00Z'),
          targetStatus: 'no_show',
        })
      ).toBe('locked') // two days ago
    })
  })

  describe('an admin', () => {
    it.each([
      ['yesterday', '2026-10-25T15:00:00Z'],
      ['last month', '2026-09-10T09:00:00Z'],
    ])('may change a %s visit, but only with a reason', (_label, iso) => {
      for (const target of ['no_show', 'cancelled', 'checked_in', null]) {
        expect(
          pastDayDecision({
            ...base,
            isAdmin: true,
            appointmentDate: at(iso),
            targetStatus: target,
          })
        ).toBe('needs_reason')
      }
    })
    it("needs no reason for today's visit", () => {
      expect(
        pastDayDecision({
          ...base,
          isAdmin: true,
          appointmentDate: at('2026-10-26T08:00:00Z'),
          targetStatus: 'cancelled',
        })
      ).toBe('allowed')
    })
  })
})

describe('F19 — the statuses a new visit may start in', () => {
  it.each([
    'scheduled',
    'confirmed',
    'checked_in',
  ])('%s: a booking, a converted web booking, a walk-in', (s) => {
    expect(isCreatableStatus(s)).toBe(true)
  })

  it.each([
    'in_chair',
    'completed',
    'cancelled',
    'no_show',
    'rescheduled',
    'booked',
    'unconfirmed',
    'banana',
    '',
  ])('%j: not a starting point', (s) => {
    expect(isCreatableStatus(s)).toBe(false)
  })
})
