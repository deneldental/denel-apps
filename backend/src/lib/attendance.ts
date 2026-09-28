/**
 * Attendance scoring & aggregation — pure functions, no DB.
 *
 * Ports the logic from `F:/2026/DEV PROJECTS/framada-attend/lib/process.js`
 * with these changes:
 *   - TypeScript types throughout.
 *   - Saturday exclusion + time thresholds + score values are in a config
 *     object instead of hardcoded constants, so a clinic can tune them later.
 *   - Exceptions (excused_absence, off_day, holiday) and approved leave
 *     requests override 'absent' to 'excused' / 'off'.
 *   - Designed for Ghana clinic (Africa/Accra = UTC+0). Event timestamps from
 *     the device CSV are treated as already-local; DB stores as timestamptz.
 *     For non-UTC clinics, swap the local-date helpers.
 *
 * Callers are responsible for fetching events / exceptions / leaves from the
 * DB and passing them in. This file only computes.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ClockInStatus = 'on_time' | 'late_mild' | 'late_severe' | 'no_show'
export type ClockOutStatus = 'on_time' | 'early' | 'very_early' | 'unknown'
export type DailyStatus = 'present' | 'late' | 'absent' | 'excused' | 'off' | 'holiday' | 'on_leave'

export interface AttendanceEvent {
  staffId: string | null
  deviceUserId: string
  deviceUserName: string | null
  eventTimestamp: Date
}

export interface AttendanceException {
  staffId: string
  date: string // YYYY-MM-DD
  type: 'excused_absence' | 'off_day' | 'holiday'
  reason?: string | null
}

export interface ApprovedLeave {
  staffId: string
  startDate: Date
  endDate: Date | null
}

export interface DailyRecord {
  date: string // YYYY-MM-DD
  dayOfWeek: number // 0=Sun..6=Sat
  clockIn: string | null // HH:MM
  clockOut: string | null
  clockInStatus: ClockInStatus
  clockOutStatus: ClockOutStatus
  status: DailyStatus
  dailyScore: number // 0..config.baseDailyScore for scoring days; 0 for non-scoring
  isScoringDay: boolean
  isNoShow: boolean
  exceptionReason?: string | null
}

export interface MonthlySummary {
  month: string // YYYY-MM
  daysPresent: number
  daysLate: number
  daysAbsent: number
  daysExcused: number
  scoringDays: number
  attendancePct: number // 0..100, rounded to 1 decimal
  totalScore: number
  maxScore: number
}

export interface AttendanceCsvRow {
  deviceUserId: string
  deviceUserName: string | null
  eventTimestamp: Date
  deviceNo: string | null
  rawStatus: string | null
}

export interface AttendanceConfig {
  saturdayExcluded: boolean
  onTimeBy: number // minutes from midnight
  lateMildBy: number
  veryEarlyBy: number
  earlyBy: number
  baseDailyScore: number
  lateMildScore: number
  lateSevereScore: number
  noShowScore: number
  veryEarlyScore: number
  earlyScore: number
  // ── Weekly lateness policy (Phase I) ──────────────────────────────────────
  /** When true, the weekly cron flags repeated lateness + sends escalating SMS. */
  latenessPolicyEnabled: boolean
  /** Number of late arrivals in a week that triggers the next escalating query. */
  lateFlagsPerWeek: number
}

export const DEFAULT_ATTENDANCE_CONFIG: AttendanceConfig = {
  saturdayExcluded: true,
  onTimeBy: 8 * 60 + 15, // 08:15
  lateMildBy: 8 * 60 + 30, // 08:30
  veryEarlyBy: 16 * 60 + 30, // 16:30
  earlyBy: 16 * 60 + 45, // 16:45
  baseDailyScore: 10,
  lateMildScore: -2,
  lateSevereScore: -5,
  noShowScore: -10,
  veryEarlyScore: -5,
  earlyScore: -2,
  latenessPolicyEnabled: false,
  lateFlagsPerWeek: 3,
}

// ── Time helpers ──────────────────────────────────────────────────────────────

export function dateToYMD(date: Date): string {
  // Treat as UTC date string. Ghana is UTC+0 so this == local date.
  return date.toISOString().slice(0, 10)
}

export function timeToMinutes(date: Date): number {
  return date.getUTCHours() * 60 + date.getUTCMinutes()
}

function fmtHHMM(date: Date): string {
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}

export function dayOfWeek(ymd: string): number {
  // Returns local DOW. Treat YMD as UTC midnight; getUTCDay matches local DOW for UTC+0.
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export function isWorkingDay(ymd: string, config: AttendanceConfig): boolean {
  const dow = dayOfWeek(ymd)
  if (dow === 0) return false // Sunday never scoring
  if (dow === 6 && config.saturdayExcluded) return false
  return true
}

export function workingDaysInMonth(yyyymm: string, config: AttendanceConfig): string[] {
  const [y, m] = yyyymm.split('-').map(Number)
  const days: string[] = []
  // Iterate days 1..28..31 of that month using UTC.
  const firstUtc = Date.UTC(y, m - 1, 1)
  const monthIdx = m - 1
  for (let d = new Date(firstUtc); d.getUTCMonth() === monthIdx; d.setUTCDate(d.getUTCDate() + 1)) {
    const ymd = d.toISOString().slice(0, 10)
    if (isWorkingDay(ymd, config)) days.push(ymd)
  }
  return days
}

export function monthRangeUtc(yyyymm: string): { start: Date; endExclusive: Date } {
  const [y, m] = yyyymm.split('-').map(Number)
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    endExclusive: new Date(Date.UTC(y, m, 1)),
  }
}

// ── Scoring ───────────────────────────────────────────────────────────────────

export function scoreClockIn(
  clockIn: Date | null,
  config: AttendanceConfig
): { score: number; status: ClockInStatus } {
  if (!clockIn) return { score: config.noShowScore, status: 'no_show' }
  const m = timeToMinutes(clockIn)
  if (m <= config.onTimeBy) return { score: 0, status: 'on_time' }
  if (m <= config.lateMildBy) return { score: config.lateMildScore, status: 'late_mild' }
  return { score: config.lateSevereScore, status: 'late_severe' }
}

export function scoreClockOut(
  clockOut: Date | null,
  config: AttendanceConfig
): { score: number; status: ClockOutStatus } {
  if (!clockOut) return { score: 0, status: 'unknown' }
  const m = timeToMinutes(clockOut)
  if (m <= config.veryEarlyBy) return { score: config.veryEarlyScore, status: 'very_early' }
  if (m <= config.earlyBy) return { score: config.earlyScore, status: 'early' }
  return { score: 0, status: 'on_time' }
}

// ── Per-day record derivation ─────────────────────────────────────────────────

interface DayBucket {
  am: Date[]
  pm: Date[]
}

function bucketEventsByDay(events: AttendanceEvent[]): Map<string, DayBucket> {
  const buckets = new Map<string, DayBucket>()
  for (const ev of events) {
    const ymd = dateToYMD(ev.eventTimestamp)
    let bucket = buckets.get(ymd)
    if (!bucket) {
      bucket = { am: [], pm: [] }
      buckets.set(ymd, bucket)
    }
    const hour = ev.eventTimestamp.getUTCHours()
    if (hour < 12) bucket.am.push(ev.eventTimestamp)
    else bucket.pm.push(ev.eventTimestamp)
  }
  return buckets
}

function dayHasException(
  ymd: string,
  exceptions: AttendanceException[]
): AttendanceException | undefined {
  return exceptions.find((e) => e.date === ymd)
}

function dayHasApprovedLeave(ymd: string, leaves: ApprovedLeave[]): boolean {
  const t = new Date(`${ymd}T12:00:00.000Z`).getTime()
  return leaves.some((l) => {
    const s = l.startDate.getTime()
    const e = (l.endDate ?? l.startDate).getTime()
    return t >= s && t <= e
  })
}

/**
 * Build per-day records for a single staff member across the given month.
 * Iterates every working day in the month; emits a record even when there are
 * no events (status: 'absent' or 'excused' depending on overrides).
 *
 * Resolution order for each day (highest priority first):
 *   1. Clinic holiday (date matches clinicHolidays) → status='holiday'
 *   2. Per-staff recurring off-day (DOW in offDays) → status='off' (not scored)
 *   3. Per-staff per-date exception (excused_absence/off_day/holiday) → status varies
 *   4. Approved leave covering the date → status='excused'
 *   5. Global non-scoring day (Sunday, optionally Saturday) → status='off'
 *   6. Has clock events → status='present' or 'late'
 *   7. No events → status='absent'
 */
export function dailySummaries(opts: {
  month: string // YYYY-MM
  events: AttendanceEvent[]
  exceptions: AttendanceException[]
  /**
   * @deprecated Approved leaves are now materialised into `attendance_exceptions`
   * on approval (single source of truth), so callers pass nothing. Kept optional
   * for back-compat / tests.
   */
  approvedLeaves?: ApprovedLeave[]
  /** Per-staff recurring weekly off-days. Sun=0..Sat=6. */
  offDays?: number[]
  /** Clinic-wide holidays as YYYY-MM-DD strings (any date in the iterated month). */
  holidays?: Array<{ date: string; name?: string | null; type?: 'full' | 'half' }>
  /** Approved manual clock times overriding hardware swipes. */
  overrides?: Array<{ date: string; clockIn: string | null; clockOut: string | null }>
  config?: AttendanceConfig
}): DailyRecord[] {
  const config = opts.config ?? DEFAULT_ATTENDANCE_CONFIG
  const buckets = bucketEventsByDay(opts.events)
  const records: DailyRecord[] = []
  const offDaySet = new Set(opts.offDays ?? [])
  // Full holidays are non-scoring for everyone. Half-day holidays stay scoring
  // days (clock-in still counts) but the early clock-out penalty is waived
  // because the clinic closes early.
  const fullHolidayMap = new Map<string, string | null>(
    (opts.holidays ?? [])
      .filter((h) => (h.type ?? 'full') !== 'half')
      .map((h) => [h.date, h.name ?? null])
  )
  const halfHolidayMap = new Map<string, string | null>(
    (opts.holidays ?? []).filter((h) => h.type === 'half').map((h) => [h.date, h.name ?? null])
  )
  const overrideMap = new Map<string, { clockIn: string | null; clockOut: string | null }>(
    (opts.overrides ?? []).map((o) => [o.date, { clockIn: o.clockIn, clockOut: o.clockOut }])
  )

  const [y, m] = opts.month.split('-').map(Number)
  const monthIdx = m - 1
  const start = new Date(Date.UTC(y, monthIdx, 1))
  for (const d = new Date(start); d.getUTCMonth() === monthIdx; d.setUTCDate(d.getUTCDate() + 1)) {
    const ymd = d.toISOString().slice(0, 10)
    const dow = d.getUTCDay()
    const isHoliday = fullHolidayMap.has(ymd)
    const isHalfDay = halfHolidayMap.has(ymd)
    const isStaffOffDay = offDaySet.has(dow)
    const isGlobalNonScoring = !isWorkingDay(ymd, config)
    // Holiday always wins. Per-staff off-day is the next "not scoring" reason.
    // (A half-day holiday is still a scoring day.)
    const scoring = !isHoliday && !isStaffOffDay && !isGlobalNonScoring
    const bucket = buckets.get(ymd)
    const exception = dayHasException(ymd, opts.exceptions)
    const onLeave = dayHasApprovedLeave(ymd, opts.approvedLeaves ?? [])
    const dayOverride = overrideMap.get(ymd)

    let clockIn: Date | null = null
    if (dayOverride?.clockIn) {
      clockIn = parseDeviceTimestamp(`${ymd} ${dayOverride.clockIn}:00`)
    } else if (bucket?.am.length) {
      clockIn = bucket.am.reduce((a, b) => (a < b ? a : b))
    }

    let clockOut: Date | null = null
    if (dayOverride?.clockOut) {
      clockOut = parseDeviceTimestamp(`${ymd} ${dayOverride.clockOut}:00`)
    } else if (bucket?.pm.length) {
      clockOut = bucket.pm.reduce((a, b) => (a > b ? a : b))
    }

    const ci = scoreClockIn(clockIn, config)
    // Half-day holiday → clinic closes early, so don't penalise the early out.
    const co = isHalfDay
      ? { score: 0, status: 'on_time' as const }
      : scoreClockOut(clockOut, config)

    let status: DailyStatus
    let dailyScore: number
    let exceptionReason: string | null = null

    if (isHoliday) {
      status = 'holiday'
      dailyScore = 0
      exceptionReason = fullHolidayMap.get(ymd) ?? 'holiday'
    } else if (isStaffOffDay) {
      status = 'off'
      dailyScore = 0
      exceptionReason = 'recurring off-day'
    } else if (!scoring) {
      // Falls through here only for global Saturday/Sunday when not already a
      // holiday or per-staff off-day.
      status = 'off'
      dailyScore = 0
    } else if (exception) {
      status = exception.type === 'holiday' ? 'holiday' : 'excused'
      dailyScore = config.baseDailyScore
      exceptionReason = exception.reason ?? exception.type
    } else if (onLeave) {
      status = 'excused'
      dailyScore = config.baseDailyScore
      exceptionReason = 'approved leave'
    } else if (clockIn === null && clockOut === null) {
      status = 'absent'
      dailyScore = 0
    } else if (ci.status === 'on_time') {
      status = 'present'
      dailyScore = Math.max(0, config.baseDailyScore + ci.score + co.score)
    } else {
      status = 'late'
      dailyScore = Math.max(0, config.baseDailyScore + ci.score + co.score)
    }

    // Tag scored days that fall on a half-day holiday so the UI can show why
    // the early clock-out wasn't penalised.
    if (isHalfDay && !exceptionReason && (status === 'present' || status === 'late')) {
      exceptionReason = `Half-day — ${halfHolidayMap.get(ymd) ?? 'early close'}`
    }

    records.push({
      date: ymd,
      dayOfWeek: dow,
      clockIn: clockIn ? fmtHHMM(clockIn) : null,
      clockOut: clockOut ? fmtHHMM(clockOut) : null,
      clockInStatus: ci.status,
      clockOutStatus: co.status,
      status,
      dailyScore,
      isScoringDay: scoring,
      isNoShow: status === 'absent',
      exceptionReason,
    })
  }

  return records
}

// ── Monthly aggregate ─────────────────────────────────────────────────────────

export function monthlySummary(opts: {
  month: string
  daily: DailyRecord[]
  config?: AttendanceConfig
}): MonthlySummary {
  const config = opts.config ?? DEFAULT_ATTENDANCE_CONFIG
  let daysPresent = 0
  let daysLate = 0
  let daysAbsent = 0
  let daysExcused = 0
  let scoringDays = 0
  let totalScore = 0

  for (const r of opts.daily) {
    if (!r.isScoringDay) continue
    scoringDays++
    totalScore += r.dailyScore
    if (r.status === 'present') daysPresent++
    else if (r.status === 'late') daysLate++
    else if (r.status === 'absent') daysAbsent++
    else if (r.status === 'excused' || r.status === 'holiday') daysExcused++
  }

  const maxScore = scoringDays * config.baseDailyScore
  // Attendance % counts present + late + excused as "covered" (i.e. not absent).
  // Excused days don't penalize attendance.
  const denom = scoringDays - daysExcused
  const numer = daysPresent + daysLate
  const attendancePct = denom === 0 ? 100 : Math.round((numer / denom) * 1000) / 10

  return {
    month: opts.month,
    daysPresent,
    daysLate,
    daysAbsent,
    daysExcused,
    scoringDays,
    attendancePct,
    totalScore,
    maxScore,
  }
}

// ── CSV parsing ───────────────────────────────────────────────────────────────

/**
 * Parses the hardware reader's CSV. Expected header (case-insensitive):
 *   User ID, Name, Date/Time, Device No., Status
 *
 * Returns rows + a list of human-readable error strings for bad lines.
 * Bad lines are skipped, not fatal.
 */
export function parseAttendanceCsv(content: string): {
  rows: AttendanceCsvRow[]
  errors: string[]
} {
  const errors: string[] = []
  const rows: AttendanceCsvRow[] = []
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  if (lines.length < 2) return { rows, errors: ['CSV is empty or header-only'] }

  // Validate header presence (best-effort — first line should contain "User ID" and "Date/Time").
  const header = lines[0].toLowerCase()
  if (!header.includes('user id') || !header.includes('date/time')) {
    errors.push(
      `CSV header missing expected columns "User ID" / "Date/Time" — got: ${lines[0].slice(0, 80)}`
    )
  }

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw.trim()) continue
    const parts = raw.split(',').map((s) => s.trim())
    if (parts.length < 3) {
      errors.push(`Line ${i + 1}: too few columns`)
      continue
    }
    const [deviceUserId, deviceUserName, dtStr, deviceNo = null, rawStatus = null] = parts
    if (!deviceUserId) {
      errors.push(`Line ${i + 1}: empty User ID`)
      continue
    }
    const eventTimestamp = parseDeviceTimestamp(dtStr)
    if (!eventTimestamp) {
      errors.push(`Line ${i + 1}: unparseable Date/Time "${dtStr}"`)
      continue
    }
    rows.push({
      deviceUserId,
      deviceUserName: deviceUserName || null,
      eventTimestamp,
      deviceNo: deviceNo || null,
      rawStatus: rawStatus || null,
    })
  }

  return { rows, errors }
}

export function parseDeviceTimestamp(s: string): Date | null {
  // Format: "2026-04-03 13:35:33"
  if (!s?.includes(' ')) return null
  const [datePart, timePart] = s.split(' ')
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mm, ss = 0] = (timePart || '00:00:00').split(':').map(Number)
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d) ||
    !Number.isFinite(hh) ||
    !Number.isFinite(mm)
  ) {
    return null
  }
  // Treat as UTC (Ghana is UTC+0). Truncate to seconds for idempotency.
  return new Date(Date.UTC(y, m - 1, d, hh, mm, ss))
}
