import { describe, expect, it } from 'vitest'
import { zonedStartOfDay } from './date'

/**
 * "No timezone safety net" audit finding (patient-records-and-scheduling-audit.md):
 * scheduling's past-date-lock used `new Date(); setHours(0,0,0,0)`, which is
 * midnight wherever the Node process happens to be running — not midnight in
 * the clinic's timezone. zonedStartOfDay is the fix: it computes midnight of
 * a calendar day in an explicit IANA zone, as an absolute instant.
 */
describe('zonedStartOfDay', () => {
  it('returns clinic (Africa/Accra, UTC+0) midnight for an instant that day', () => {
    const start = zonedStartOfDay(new Date('2026-03-15T14:32:00Z'))
    expect(start.toISOString()).toBe('2026-03-15T00:00:00.000Z')
  })

  it('does not roll over to the next day for a time just before UTC midnight', () => {
    const start = zonedStartOfDay(new Date('2026-03-15T23:59:59Z'))
    expect(start.toISOString()).toBe('2026-03-15T00:00:00.000Z')
  })

  it('rolls over exactly at Accra midnight', () => {
    const start = zonedStartOfDay(new Date('2026-03-16T00:00:00Z'))
    expect(start.toISOString()).toBe('2026-03-16T00:00:00.000Z')
  })

  it('computes midnight in an explicit positive-offset zone (Asia/Tokyo, UTC+9)', () => {
    // 2026-03-15T20:00Z is 2026-03-16T05:00 in Tokyo — already the next
    // calendar day there. Tokyo midnight for that day is 2026-03-15T15:00Z.
    const start = zonedStartOfDay(new Date('2026-03-15T20:00:00Z'), 'Asia/Tokyo')
    expect(start.toISOString()).toBe('2026-03-15T15:00:00.000Z')
  })

  it('computes midnight in an explicit negative-offset zone (Etc/GMT+5, UTC-5)', () => {
    // 2026-03-15T03:00Z is 2026-03-14T22:00 in UTC-5 — still the previous
    // calendar day there. That zone's midnight for that day is 2026-03-14T05:00Z.
    const start = zonedStartOfDay(new Date('2026-03-15T03:00:00Z'), 'Etc/GMT+5')
    expect(start.toISOString()).toBe('2026-03-14T05:00:00.000Z')
  })

  it('defaults to the current instant when no date is passed', () => {
    const before = Date.now()
    const start = zonedStartOfDay()
    expect(start.getTime()).toBeLessThanOrEqual(before)
  })
})
