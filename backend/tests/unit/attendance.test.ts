import { describe, expect, it } from 'vitest'
import {
  type ApprovedLeave,
  type AttendanceConfig,
  type AttendanceEvent,
  type AttendanceException,
  DEFAULT_ATTENDANCE_CONFIG,
  dailySummaries,
  monthlySummary,
  parseAttendanceCsv,
  scoreClockIn,
  scoreClockOut,
  workingDaysInMonth,
} from '../../src/lib/attendance'

const cfg: AttendanceConfig = DEFAULT_ATTENDANCE_CONFIG

function utc(ymd: string, hh = 0, mm = 0, ss = 0): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, hh, mm, ss))
}

function ev(deviceUserId: string, ts: Date, staffId: string | null = 'S1'): AttendanceEvent {
  return { staffId, deviceUserId, deviceUserName: null, eventTimestamp: ts }
}

describe('attendance / scoreClockIn', () => {
  it('returns no_show for null', () => {
    expect(scoreClockIn(null, cfg)).toEqual({ score: -10, status: 'no_show' })
  })
  it('on_time at exactly 08:15', () => {
    expect(scoreClockIn(utc('2026-05-04', 8, 15), cfg)).toEqual({ score: 0, status: 'on_time' })
  })
  it('late_mild at 08:16', () => {
    expect(scoreClockIn(utc('2026-05-04', 8, 16), cfg).status).toBe('late_mild')
  })
  it('late_severe at 08:31', () => {
    expect(scoreClockIn(utc('2026-05-04', 8, 31), cfg).status).toBe('late_severe')
  })
})

describe('attendance / scoreClockOut', () => {
  it('unknown for null', () => {
    expect(scoreClockOut(null, cfg)).toEqual({ score: 0, status: 'unknown' })
  })
  it('very_early at 16:00', () => {
    expect(scoreClockOut(utc('2026-05-04', 16, 0), cfg).status).toBe('very_early')
  })
  it('early at 16:31', () => {
    expect(scoreClockOut(utc('2026-05-04', 16, 31), cfg).status).toBe('early')
  })
  it('on_time at 17:00', () => {
    expect(scoreClockOut(utc('2026-05-04', 17, 0), cfg).status).toBe('on_time')
  })
})

describe('attendance / workingDaysInMonth', () => {
  it('excludes Saturdays and Sundays by default (May 2026)', () => {
    const days = workingDaysInMonth('2026-05', cfg)
    expect(days[0]).toBe('2026-05-01') // Friday
    expect(days).not.toContain('2026-05-02') // Saturday
    expect(days).not.toContain('2026-05-03') // Sunday
    expect(days).toContain('2026-05-04') // Monday
    // 21 weekdays in May 2026
    expect(days).toHaveLength(21)
  })
  it('includes Saturdays when saturdayExcluded=false', () => {
    const days = workingDaysInMonth('2026-05', { ...cfg, saturdayExcluded: false })
    expect(days).toContain('2026-05-02')
    expect(days).not.toContain('2026-05-03') // still excluded
  })
})

describe('attendance / dailySummaries — present staff', () => {
  it('on-time clock-in + on-time clock-out yields full daily score', () => {
    const events: AttendanceEvent[] = [
      ev('120', utc('2026-05-04', 8, 10)),
      ev('120', utc('2026-05-04', 17, 5)),
    ]
    const records = dailySummaries({
      month: '2026-05',
      events,
      exceptions: [],
      approvedLeaves: [],
    })
    const day = records.find((r) => r.date === '2026-05-04')
    expect(day).toBeDefined()
    expect(day?.status).toBe('present')
    expect(day?.dailyScore).toBe(10)
    expect(day?.clockIn).toBe('08:10')
    expect(day?.clockOut).toBe('17:05')
  })

  it('late_mild clock-in deducts 2 points', () => {
    const events: AttendanceEvent[] = [
      ev('120', utc('2026-05-04', 8, 25)),
      ev('120', utc('2026-05-04', 17, 0)),
    ]
    const records = dailySummaries({
      month: '2026-05',
      events,
      exceptions: [],
      approvedLeaves: [],
    })
    const day = records.find((r) => r.date === '2026-05-04')
    expect(day?.status).toBe('late')
    expect(day?.dailyScore).toBe(8)
  })

  it('absent on weekday with no events', () => {
    const records = dailySummaries({
      month: '2026-05',
      events: [],
      exceptions: [],
      approvedLeaves: [],
    })
    const monday = records.find((r) => r.date === '2026-05-04')
    expect(monday?.status).toBe('absent')
    expect(monday?.dailyScore).toBe(0)
    expect(monday?.isScoringDay).toBe(true)
  })
})

describe('attendance / dailySummaries — exceptions and leaves', () => {
  it('excused exception flips absent to excused', () => {
    const exceptions: AttendanceException[] = [
      { staffId: 'S1', date: '2026-05-04', type: 'excused_absence', reason: 'medical' },
    ]
    const records = dailySummaries({
      month: '2026-05',
      events: [],
      exceptions,
      approvedLeaves: [],
    })
    const day = records.find((r) => r.date === '2026-05-04')
    expect(day?.status).toBe('excused')
    expect(day?.dailyScore).toBe(10)
    expect(day?.exceptionReason).toBe('medical')
  })

  it('approved leave covering the day is treated as excused', () => {
    const leaves: ApprovedLeave[] = [
      { staffId: 'S1', startDate: utc('2026-05-04'), endDate: utc('2026-05-08') },
    ]
    const records = dailySummaries({
      month: '2026-05',
      events: [],
      exceptions: [],
      approvedLeaves: leaves,
    })
    const wed = records.find((r) => r.date === '2026-05-06')
    expect(wed?.status).toBe('excused')
  })

  it('off_day weekday is excused', () => {
    const exceptions: AttendanceException[] = [
      { staffId: 'S1', date: '2026-05-04', type: 'off_day' },
    ]
    const records = dailySummaries({
      month: '2026-05',
      events: [],
      exceptions,
      approvedLeaves: [],
    })
    expect(records.find((r) => r.date === '2026-05-04')?.status).toBe('excused')
  })
})

describe('attendance / monthlySummary', () => {
  it('counts statuses correctly and computes attendancePct excluding excused', () => {
    // 5 working days in a row, 3 present, 1 late, 1 excused
    const events: AttendanceEvent[] = [
      ev('120', utc('2026-05-04', 8, 0)),
      ev('120', utc('2026-05-04', 17, 0)),
      ev('120', utc('2026-05-05', 8, 0)),
      ev('120', utc('2026-05-05', 17, 0)),
      ev('120', utc('2026-05-06', 8, 25)), // late
      ev('120', utc('2026-05-06', 17, 0)),
      ev('120', utc('2026-05-07', 8, 0)),
      ev('120', utc('2026-05-07', 17, 0)),
    ]
    // 2026-05-08 is Friday — excused
    const exceptions: AttendanceException[] = [
      { staffId: 'S1', date: '2026-05-08', type: 'excused_absence' },
    ]
    const daily = dailySummaries({ month: '2026-05', events, exceptions, approvedLeaves: [] })
    const summary = monthlySummary({ month: '2026-05', daily })
    expect(summary.daysPresent).toBe(3)
    expect(summary.daysLate).toBe(1)
    expect(summary.daysExcused).toBe(1)
    // 21 working days in May 2026: 4 covered (3+1), 1 excused, 16 absent
    expect(summary.daysAbsent).toBe(16)
    expect(summary.scoringDays).toBe(21)
    // attendancePct = (3+1) / (21-1) = 4/20 = 20%
    expect(summary.attendancePct).toBe(20)
  })
})

describe('attendance / off-days + holidays', () => {
  it('clinic holiday wins — full credit, status=holiday, not counted as absent', () => {
    const records = dailySummaries({
      month: '2026-05',
      events: [],
      exceptions: [],
      approvedLeaves: [],
      holidays: [{ date: '2026-05-04', name: 'May Day' }],
    })
    const day = records.find((r) => r.date === '2026-05-04')
    expect(day?.status).toBe('holiday')
    expect(day?.exceptionReason).toBe('May Day')
    expect(day?.isScoringDay).toBe(false)
    expect(day?.dailyScore).toBe(0)
  })

  it('per-staff off-day suppresses Wednesday from scoring', () => {
    const records = dailySummaries({
      month: '2026-05',
      events: [],
      exceptions: [],
      approvedLeaves: [],
      offDays: [3], // Wednesday
    })
    // 2026-05-06 is a Wednesday
    const wed = records.find((r) => r.date === '2026-05-06')
    expect(wed?.status).toBe('off')
    expect(wed?.exceptionReason).toBe('recurring off-day')
    expect(wed?.isScoringDay).toBe(false)
    // Non-Wednesday weekdays still scoring
    expect(records.find((r) => r.date === '2026-05-04')?.isScoringDay).toBe(true)
  })

  it('holiday + monthly summary — fewer scoring days, attendancePct unaffected for present-only month', () => {
    // 5 working days; one is a holiday; staff present the other 4.
    const events: AttendanceEvent[] = [
      ev('120', utc('2026-05-04', 8, 0)),
      ev('120', utc('2026-05-04', 17, 0)),
      ev('120', utc('2026-05-05', 8, 0)),
      ev('120', utc('2026-05-05', 17, 0)),
      // 2026-05-06 holiday
      ev('120', utc('2026-05-07', 8, 0)),
      ev('120', utc('2026-05-07', 17, 0)),
      ev('120', utc('2026-05-08', 8, 0)),
      ev('120', utc('2026-05-08', 17, 0)),
    ]
    const daily = dailySummaries({
      month: '2026-05',
      events,
      exceptions: [],
      approvedLeaves: [],
      holidays: [{ date: '2026-05-06', name: 'Holiday' }],
    })
    const summary = monthlySummary({ month: '2026-05', daily })
    // 21 weekdays in May 2026, minus 1 holiday = 20 scoring days
    expect(summary.scoringDays).toBe(20)
    expect(summary.daysPresent).toBe(4)
    expect(summary.daysAbsent).toBe(16)
  })
})

describe('attendance / parseAttendanceCsv', () => {
  it('parses the sample CSV header + rows correctly', () => {
    const csv = [
      'User ID,Name,Date/Time,Device No.,Status',
      '120,beatrice.f,2026-04-03 13:35:33,1,0',
      '120,beatrice.f,2026-04-08 08:16:41,1,0',
    ].join('\n')
    const { rows, errors } = parseAttendanceCsv(csv)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      deviceUserId: '120',
      deviceUserName: 'beatrice.f',
      deviceNo: '1',
      rawStatus: '0',
    })
    expect(rows[0].eventTimestamp.toISOString()).toBe('2026-04-03T13:35:33.000Z')
  })

  it('skips bad lines and reports errors', () => {
    const csv = [
      'User ID,Name,Date/Time',
      '120,beatrice.f,2026-04-03 13:35:33',
      '', // blank — silently skipped
      'tooshort',
      '121,bad,not-a-date',
    ].join('\n')
    const { rows, errors } = parseAttendanceCsv(csv)
    expect(rows).toHaveLength(1)
    expect(errors.length).toBeGreaterThanOrEqual(2)
  })

  it('rejects empty input', () => {
    expect(parseAttendanceCsv('').errors[0]).toMatch(/empty/i)
  })
})
