import { describe, expect, it } from 'vitest'
import {
  type AppointmentLike,
  appointmentRange,
  findAppointmentsInBlockTime,
  findBlockTimeForAppointment,
  rangesOverlap,
} from '@/features/appointments/conflicts'

// `GET /api/appointments` returns `date` + `durationMinutes`, NOT start/end.
// The conflict helpers used to read `startTime`/`endTime` off these rows, which
// produced NaN comparisons — every overlap silently evaluated to false and
// blocking a doctor's day flagged no conflicts at all.
function apiRow(over: Partial<AppointmentLike> = {}): AppointmentLike {
  return {
    id: 'a1',
    doctorId: 'doc-1',
    status: 'scheduled',
    date: '2026-09-01T10:00:00.000Z',
    durationMinutes: 30,
    ...over,
  }
}

describe('appointmentRange', () => {
  it('derives the end from date + durationMinutes', () => {
    const range = appointmentRange(apiRow())
    expect(range).not.toBeNull()
    expect(new Date(range?.end).toISOString()).toBe('2026-09-01T10:30:00.000Z')
  })

  it('falls back to 30 minutes when duration is missing or zero', () => {
    for (const durationMinutes of [null, undefined, 0]) {
      const range = appointmentRange(apiRow({ durationMinutes }))
      expect(range?.end - range?.start).toBe(30 * 60_000)
    }
  })

  it('prefers explicit startTime/endTime when present', () => {
    const range = appointmentRange({
      id: 'a1',
      doctorId: 'doc-1',
      status: 'scheduled',
      startTime: '2026-09-01T08:00:00.000Z',
      endTime: '2026-09-01T09:00:00.000Z',
    })
    expect(range?.end - range?.start).toBe(60 * 60_000)
  })

  it('returns null for a row with no usable start', () => {
    expect(appointmentRange({ id: 'a1', doctorId: 'doc-1', status: 'scheduled' })).toBeNull()
    expect(appointmentRange(apiRow({ date: 'not-a-date' }))).toBeNull()
  })
})

describe('findAppointmentsInBlockTime', () => {
  const block = { start: '2026-09-01T09:00:00.000Z', end: '2026-09-01T17:00:00.000Z' }

  it('finds an API-shaped appointment inside the blocked window', () => {
    const hits = findAppointmentsInBlockTime('doc-1', block.start, block.end, [apiRow()])
    expect(hits).toHaveLength(1)
    expect(hits[0].appointment.id).toBe('a1')
  })

  it('ignores appointments belonging to another doctor', () => {
    const hits = findAppointmentsInBlockTime('doc-2', block.start, block.end, [apiRow()])
    expect(hits).toHaveLength(0)
  })

  it('ignores completed / cancelled / no-show appointments', () => {
    for (const status of ['completed', 'cancelled', 'no_show']) {
      const hits = findAppointmentsInBlockTime('doc-1', block.start, block.end, [
        apiRow({ status }),
      ])
      expect(hits, `status ${status} should not block`).toHaveLength(0)
    }
  })

  it('treats a touching boundary as non-overlapping', () => {
    // Appointment 08:30–09:00 ends exactly when the block opens.
    const touching = apiRow({ date: '2026-09-01T08:30:00.000Z', durationMinutes: 30 })
    expect(findAppointmentsInBlockTime('doc-1', block.start, block.end, [touching])).toHaveLength(0)

    // …and one that runs a minute over does overlap.
    const overlapping = apiRow({ date: '2026-09-01T08:30:00.000Z', durationMinutes: 31 })
    expect(
      findAppointmentsInBlockTime('doc-1', block.start, block.end, [overlapping])
    ).toHaveLength(1)
  })

  it('returns nothing for an unparseable block range', () => {
    expect(findAppointmentsInBlockTime('doc-1', 'nope', block.end, [apiRow()])).toHaveLength(0)
  })
})

describe('findBlockTimeForAppointment', () => {
  const blocks = [
    {
      id: 'b1',
      doctorId: 'doc-1',
      startTime: '2026-09-01T09:00:00.000Z',
      endTime: '2026-09-01T17:00:00.000Z',
      reason: 'Vacation',
    },
  ]

  it('returns the block covering a proposed slot', () => {
    const hit = findBlockTimeForAppointment(
      'doc-1',
      '2026-09-01T10:00:00.000Z',
      '2026-09-01T10:30:00.000Z',
      blocks
    )
    expect(hit?.id).toBe('b1')
  })

  it('returns null when the slot is outside every block', () => {
    const hit = findBlockTimeForAppointment(
      'doc-1',
      '2026-09-01T17:00:00.000Z',
      '2026-09-01T17:30:00.000Z',
      blocks
    )
    expect(hit).toBeNull()
  })

  it('never matches another doctor’s block', () => {
    const hit = findBlockTimeForAppointment(
      'doc-2',
      '2026-09-01T10:00:00.000Z',
      '2026-09-01T10:30:00.000Z',
      blocks
    )
    expect(hit).toBeNull()
  })
})

describe('rangesOverlap', () => {
  it('is half-open — touching ranges do not overlap', () => {
    expect(
      rangesOverlap(
        '2026-09-01T09:00Z',
        '2026-09-01T10:00Z',
        '2026-09-01T10:00Z',
        '2026-09-01T11:00Z'
      )
    ).toBe(false)
    expect(
      rangesOverlap(
        '2026-09-01T09:00Z',
        '2026-09-01T10:01Z',
        '2026-09-01T10:00Z',
        '2026-09-01T11:00Z'
      )
    ).toBe(true)
  })
})
