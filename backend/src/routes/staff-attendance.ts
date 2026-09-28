import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import {
  attendanceEvents,
  attendanceExceptions,
  attendanceTimeOverrides,
  clinicHolidays,
  clinicSettings,
  staff,
  staffAttendanceSubmissions,
  staffLatenessQueries,
  staffOffDays,
  staffRequests,
  user,
} from '../db/schema'
import {
  dailySummaries,
  type AttendanceEvent as LibAttendanceEvent,
  type AttendanceException as LibAttendanceException,
  monthlySummary,
  monthRangeUtc,
  parseAttendanceCsv,
  parseDeviceTimestamp,
} from '../lib/attendance'
import { ATTENDANCE_CONFIG_KEY, getAttendanceConfig } from '../lib/attendance-config'
import { effectiveEventTsSql, toLibEvent } from '../lib/attendance-events'
import { generateAttendancePdf } from '../lib/attendance-pdf'
import { createAuditLog } from '../lib/audit'
import { timingSafeEqual } from '../lib/csrf'
import { getAnvizConfig } from '../lib/integrations'
import { logError, logInfo, logWarn } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { createRateLimiter } from '../lib/rate-limiter'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'
import { uploadProfiles, validateUpload } from '../lib/upload-validation'

// HR-M5: bound auth-brute-force + ingestion volume on the public device webhook.
// Keyed on a single global bucket (device cloud posts batches, not per-request),
// since IP headers on this hop are spoofable. Skipped in development by the
// limiter's env check is not applied here (we call .check directly), so the
// window is generous enough for the real device's batch cadence.
const anvizWebhookLimiter = createRateLimiter({ max: 60, windowMs: 60_000 })
const ANVIZ_WEBHOOK_MAX_RECORDS = 500

const app = new Hono<HonoEnv>()

// ---------------------------------------------------------------------------
// Attendance — CSV upload + monthly views
// ---------------------------------------------------------------------------

export function defaultMonthYYYYMM(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

export function isValidMonth(s: string | undefined): s is string {
  return !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)
}

// ── Local helpers ─────────────────────────────────────────────────────────────

export function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = out.get(k)
    if (list) list.push(item)
    else out.set(k, [item])
  }
  return out
}

export function formatYMD(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * HR clock-time overrides for a set of staff over a month, grouped by staffId.
 *
 * These sit ABOVE the raw-event layer in the clock-time resolution order:
 * `lib/attendance-events.ts` picks the effective time of a *device punch*
 * (ingested `createdAt` for `anviz_webhook` rows, device `eventTimestamp` for
 * CSV rows); `dailySummaries()` then prefers an override over that resolved
 * punch entirely. Read paths that omit this argument silently ignore HR
 * corrections and keep showing the device time — so every path that scores
 * attendance must pass it.
 */
async function fetchOverridesByStaff(
  db: ReturnType<typeof getDb>,
  staffIds: string[],
  fromYmd: string,
  toExclusiveYmd: string
): Promise<Map<string, Array<{ date: string; clockIn: string | null; clockOut: string | null }>>> {
  if (staffIds.length === 0) return new Map()
  const rows = await db
    .select({
      staffId: attendanceTimeOverrides.staffId,
      date: attendanceTimeOverrides.date,
      clockIn: attendanceTimeOverrides.clockIn,
      clockOut: attendanceTimeOverrides.clockOut,
    })
    .from(attendanceTimeOverrides)
    .where(
      and(
        inArray(attendanceTimeOverrides.staffId, staffIds),
        gte(attendanceTimeOverrides.date, fromYmd),
        lt(attendanceTimeOverrides.date, toExclusiveYmd)
      )
    )
  return groupBy(rows, (r) => r.staffId)
}

export function startOfWeekMonUtc(d: Date): Date {
  const day = d.getUTCDay() // 0=Sun..6=Sat
  const diff = (day + 6) % 7 // days back to Monday
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() - diff)
  out.setUTCHours(0, 0, 0, 0)
  return out
}

const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

export function weekLabel(monday: Date, sunday: Date): string {
  const sameMonth = monday.getUTCMonth() === sunday.getUTCMonth()
  if (sameMonth) {
    return `${MONTH_SHORT[monday.getUTCMonth()]} ${monday.getUTCDate()} – ${sunday.getUTCDate()}, ${sunday.getUTCFullYear()}`
  }
  return `${MONTH_SHORT[monday.getUTCMonth()]} ${monday.getUTCDate()} – ${MONTH_SHORT[sunday.getUTCMonth()]} ${sunday.getUTCDate()}, ${sunday.getUTCFullYear()}`
}

export function emptyDayRecord(ymd: string, dow: number) {
  // Mirrors DailyRecord shape from lib/attendance for days that fall outside
  // any month we fetched (shouldn't happen, but keeps types stable).
  return {
    date: ymd,
    dayOfWeek: dow,
    clockIn: null as string | null,
    clockOut: null as string | null,
    clockInStatus: 'no_show' as const,
    clockOutStatus: 'unknown' as const,
    status: 'absent' as 'present' | 'late' | 'absent' | 'excused' | 'off' | 'holiday',
    dailyScore: 0,
    isScoringDay: dow !== 0 && dow !== 6,
    isNoShow: true,
    exceptionReason: null as string | null,
  }
}

/**
 * Fetch daily attendance records covering the last `weeks` weeks for one staff,
 * keyed by YYYY-MM-DD. Pulls each calendar month in range and runs the same
 * `dailySummaries` aggregation used by the monthly endpoint, so weekly and
 * monthly views are guaranteed consistent.
 */
export async function fetchDailySummariesForStaffRange(
  db: ReturnType<typeof getDb>,
  staffId: string,
  weeks: number
): Promise<{
  daysByYmd: Map<string, ReturnType<typeof emptyDayRecord>>
  staffRow: { id: string; fullName: string; staffId: string } | null
}> {
  const staffRow = await db.query.staff.findFirst({ where: eq(staff.id, staffId) })
  if (!staffRow) return { daysByYmd: new Map(), staffRow: null }

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const earliestMonday = new Date(startOfWeekMonUtc(today))
  earliestMonday.setUTCDate(earliestMonday.getUTCDate() - (weeks - 1) * 7)

  // Months touched by the range.
  const months: string[] = []
  const cursor = new Date(
    Date.UTC(earliestMonday.getUTCFullYear(), earliestMonday.getUTCMonth(), 1)
  )
  const endCursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
  while (cursor <= endCursor) {
    months.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`)
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }

  // Range queries (one bulk fetch per table, scoped to the months covered).
  const rangeStart = new Date(
    Date.UTC(earliestMonday.getUTCFullYear(), earliestMonday.getUTCMonth(), 1)
  )
  const lastMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
  const rangeEndExclusive = new Date(
    Date.UTC(lastMonthStart.getUTCFullYear(), lastMonthStart.getUTCMonth() + 1, 1)
  )

  const events = await db
    .select()
    .from(attendanceEvents)
    .where(
      and(
        eq(attendanceEvents.staffId, staffId),
        // Filter on the effective clock time (ingested time for webhook punches)
        // so a device whose clock drifted out of range is still fetched by its
        // accurate ingested instant.
        gte(effectiveEventTsSql, rangeStart),
        lt(effectiveEventTsSql, rangeEndExclusive)
      )
    )
  const exceptions = await db
    .select()
    .from(attendanceExceptions)
    .where(
      and(
        eq(attendanceExceptions.staffId, staffId),
        gte(attendanceExceptions.date, formatYMD(rangeStart)),
        lt(attendanceExceptions.date, formatYMD(rangeEndExclusive))
      )
    )
  const offDayRows = await db
    .select({ dayOfWeek: staffOffDays.dayOfWeek })
    .from(staffOffDays)
    .where(eq(staffOffDays.staffId, staffId))
  const holidayRows = await db
    .select({ date: clinicHolidays.date, name: clinicHolidays.name, type: clinicHolidays.type })
    .from(clinicHolidays)
    .where(
      and(
        gte(clinicHolidays.date, formatYMD(rangeStart)),
        lt(clinicHolidays.date, formatYMD(rangeEndExclusive))
      )
    )

  const overrideRows = await db
    .select({
      date: attendanceTimeOverrides.date,
      clockIn: attendanceTimeOverrides.clockIn,
      clockOut: attendanceTimeOverrides.clockOut,
    })
    .from(attendanceTimeOverrides)
    .where(
      and(
        eq(attendanceTimeOverrides.staffId, staffId),
        gte(attendanceTimeOverrides.date, formatYMD(rangeStart)),
        lt(attendanceTimeOverrides.date, formatYMD(rangeEndExclusive))
      )
    )

  const libEvents = events.map<LibAttendanceEvent>(toLibEvent)
  const libExceptions = exceptions.map<LibAttendanceException>((e) => ({
    staffId: e.staffId,
    date: e.date,
    type: e.type as LibAttendanceException['type'],
    reason: e.reason,
  }))
  const offDays = offDayRows.map((r) => r.dayOfWeek)
  const holidays = holidayRows.map((h) => ({
    date: h.date,
    name: h.name,
    type: h.type as 'full' | 'half',
  }))

  const config = await getAttendanceConfig(db)
  const daysByYmd = new Map<string, ReturnType<typeof emptyDayRecord>>()
  for (const month of months) {
    const daily = dailySummaries({
      month,
      events: libEvents,
      exceptions: libExceptions,
      offDays,
      holidays,
      overrides: overrideRows,
      config,
    })
    for (const rec of daily) {
      // dailySummaries returns records with the same shape as emptyDayRecord;
      // cast through unknown because the lib uses string-literal unions for
      // status/etc. that match what we store here.
      daysByYmd.set(rec.date, rec as unknown as ReturnType<typeof emptyDayRecord>)
    }
  }

  return {
    daysByYmd,
    staffRow: { id: staffRow.id, fullName: staffRow.fullName, staffId: staffRow.staffId },
  }
}

// ── Annual leave helpers ──────────────────────────────────────────────────────

const ANNUAL_LEAVE_DEFAULT_KEY = 'hr:annual_leave_default_days'
const ANNUAL_LEAVE_FALLBACK_DAYS = 20
// The Annual Leave (single-block) portion of the Total Leave. Casual Leave is
// the remainder. `null` = split the total in half (the default 50/50 behaviour).
const ANNUAL_LEAVE_BLOCK_KEY = 'hr:annual_leave_block_days'

async function getAnnualLeaveDefault(db: ReturnType<typeof getDb>): Promise<number> {
  const [row] = await db
    .select({ value: clinicSettings.value })
    .from(clinicSettings)
    .where(eq(clinicSettings.key, ANNUAL_LEAVE_DEFAULT_KEY))
    .limit(1)
  return typeof row?.value === 'number' && row.value >= 0 ? row.value : ANNUAL_LEAVE_FALLBACK_DAYS
}

/** Configured Annual-block size, or null to fall back to a 50/50 split. */
async function getAnnualLeaveBlock(db: ReturnType<typeof getDb>): Promise<number | null> {
  const [row] = await db
    .select({ value: clinicSettings.value })
    .from(clinicSettings)
    .where(eq(clinicSettings.key, ANNUAL_LEAVE_BLOCK_KEY))
    .limit(1)
  return typeof row?.value === 'number' && row.value >= 0 ? row.value : null
}

function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Count working days in [start, end] inclusive, skipping global Sundays,
 * per-staff weekly off-days (offDays: Sun=0..Sat=6), and clinic holidays
 * (holidaysYmd contains YYYY-MM-DD strings).
 *
 * Iterates day-by-day — leave windows are short (single-digit days, rarely
 * 30+), so the cost is negligible and the logic stays trivially auditable.
 */
export function computeLeaveWorkingDays(
  start: Date,
  end: Date,
  offDays: Set<number>,
  holidaysYmd: Set<string>
): number {
  if (end < start) return 0
  let count = 0
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()))
  const stop = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())
  while (cursor.getTime() <= stop) {
    const dow = cursor.getUTCDay()
    const ymd = ymdUtc(cursor)
    const isSunday = dow === 0
    if (!isSunday && !offDays.has(dow) && !holidaysYmd.has(ymd)) {
      count++
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return count
}

// ── Unpaid-leave → payroll deduction (§14.6) ──────────────────────────────────

/**
 * Leave sub-types that are explicitly UNPAID. Approved leave of these
 * sub-types deducts pay for the working days it covers; everything else
 * (annual / sick / casual / compassionate / …) is paid and never deducts.
 *
 * Kept as a set so payroll's deduction calc and any future "is this paid?"
 * check share one source of truth.
 */
export const UNPAID_LEAVE_SUBTYPES = new Set(['unpaid_leave'])

export type LeaveDeductionBreakdown = {
  requestId: string
  subType: string | null
  startDate: string | null
  endDate: string | null
  /** Working days inside the pay period this request covers. */
  days: number
}

export type LeaveDeductionResult = {
  staffId: string
  periodStart: string
  periodEnd: string
  /** Total unpaid-leave working days inside [periodStart, periodEnd]. */
  unpaidLeaveDays: number
  /**
   * Monetary deduction = dailyRate × unpaidLeaveDays, where the daily rate is
   * `monthlyGross / workingDaysInPeriod`. 0 when no gross / no working days /
   * no unpaid leave. Rounded to 2dp.
   */
  amount: number
  /** Working days in the pay period (the divisor used for the daily rate). */
  workingDaysInPeriod: number
  breakdown: LeaveDeductionBreakdown[]
}

/**
 * Compute the unpaid-leave payroll deduction for one staff over a pay period.
 *
 * Pulls approved leave requests whose sub-type is unpaid and clips each to the
 * [periodStart, periodEnd] window, counting only true working days (skips
 * Sundays, the staff's recurring off-days, and clinic holidays — the same
 * rubric the attendance grader uses, via `computeLeaveWorkingDays`). Paid
 * leave is ignored.
 *
 * The monetary `amount` is `(monthlyGross / workingDaysInPeriod) × unpaidDays`.
 * Pass the staff's gross for the period; omit it (or pass 0) to get just the
 * day count with a zero amount. Dates are treated in UTC, matching the rest of
 * the attendance/leave pipeline.
 */
export async function computeLeaveDeductions(
  db: ReturnType<typeof getDb>,
  params: { staffId: string; periodStart: Date; periodEnd: Date; monthlyGross?: number }
): Promise<LeaveDeductionResult> {
  const { staffId, periodStart, periodEnd } = params
  const monthlyGross = Number.isFinite(params.monthlyGross) ? (params.monthlyGross as number) : 0

  const emptyResult: LeaveDeductionResult = {
    staffId,
    periodStart: ymdUtc(periodStart),
    periodEnd: ymdUtc(periodEnd),
    unpaidLeaveDays: 0,
    amount: 0,
    workingDaysInPeriod: 0,
    breakdown: [],
  }
  if (periodEnd < periodStart) return emptyResult

  // Per-staff off-days + clinic holidays touching the period. computeLeaveWorkingDays
  // only inspects each candidate date, so the holiday window just needs to span
  // the pay period.
  const offDayRows = await db
    .select({ dayOfWeek: staffOffDays.dayOfWeek })
    .from(staffOffDays)
    .where(eq(staffOffDays.staffId, staffId))
  const offDaysSet = new Set(offDayRows.map((r) => r.dayOfWeek))

  const holidayRows = await db
    .select({ date: clinicHolidays.date })
    .from(clinicHolidays)
    .where(
      and(
        gte(clinicHolidays.date, ymdUtc(periodStart)),
        lte(clinicHolidays.date, ymdUtc(periodEnd))
      )
    )
  const holidaysSet = new Set(holidayRows.map((r) => r.date))

  // Working days in the pay period itself — the daily-rate divisor.
  const workingDaysInPeriod = computeLeaveWorkingDays(
    periodStart,
    periodEnd,
    offDaysSet,
    holidaysSet
  )

  // Approved leave for this staff whose window overlaps the period. We filter
  // unpaid sub-types in JS so the UNPAID_LEAVE_SUBTYPES set stays the single
  // source of truth (rather than duplicating it in a SQL IN-list).
  const requests = await db
    .select({
      id: staffRequests.id,
      subType: staffRequests.subType,
      startDate: staffRequests.startDate,
      endDate: staffRequests.endDate,
    })
    .from(staffRequests)
    .where(
      and(
        eq(staffRequests.staffId, staffId),
        eq(staffRequests.requestType, 'leave'),
        eq(staffRequests.status, 'approved'),
        sql`${staffRequests.startDate} is not null`,
        // Overlap: request.start <= periodEnd AND (request.end ?? start) >= periodStart
        lte(staffRequests.startDate, periodEnd)
      )
    )

  // Collect each unpaid request's clipped window (+ a per-request day count for
  // the breakdown).
  const windows: { start: Date; end: Date }[] = []
  const breakdown: LeaveDeductionBreakdown[] = []
  for (const r of requests) {
    if (!r.startDate) continue
    if (!UNPAID_LEAVE_SUBTYPES.has(r.subType ?? '')) continue
    const reqStart = r.startDate
    const reqEnd = r.endDate ?? r.startDate
    if (reqEnd < periodStart) continue // ends before the period — no overlap

    // Clip the leave window to the pay period before counting working days.
    const clipStart = reqStart > periodStart ? reqStart : periodStart
    const clipEnd = reqEnd < periodEnd ? reqEnd : periodEnd
    const days = computeLeaveWorkingDays(clipStart, clipEnd, offDaysSet, holidaysSet)
    if (days <= 0) continue
    windows.push({ start: clipStart, end: clipEnd })
    breakdown.push({
      requestId: r.id,
      subType: r.subType,
      startDate: ymdUtc(reqStart),
      endDate: ymdUtc(reqEnd),
      days,
    })
  }

  // Dedup overlapping windows before counting: two approved unpaid requests that
  // cover the same calendar days (e.g. a duplicate/corrected entry both left
  // 'approved') must NOT double-count. Merge into disjoint intervals, then sum
  // working days per interval. (The per-request `breakdown.days` above may sum to
  // more than this total when windows overlap — that's expected; the total is the
  // deduped union.)
  windows.sort((a, b) => a.start.getTime() - b.start.getTime())
  let unpaidLeaveDays = 0
  let cur: { start: Date; end: Date } | null = null
  for (const w of windows) {
    if (cur && w.start.getTime() <= cur.end.getTime()) {
      if (w.end.getTime() > cur.end.getTime()) cur.end = w.end
    } else {
      if (cur)
        unpaidLeaveDays += computeLeaveWorkingDays(cur.start, cur.end, offDaysSet, holidaysSet)
      cur = { start: w.start, end: w.end }
    }
  }
  if (cur) unpaidLeaveDays += computeLeaveWorkingDays(cur.start, cur.end, offDaysSet, holidaysSet)
  // Belt-and-braces: the union of windows is within the period, so it can never
  // exceed the period's own working days.
  unpaidLeaveDays = Math.min(unpaidLeaveDays, workingDaysInPeriod)

  const dailyRate =
    workingDaysInPeriod > 0 && monthlyGross > 0 ? monthlyGross / workingDaysInPeriod : 0
  const amount = Math.round(dailyRate * unpaidLeaveDays * 100) / 100

  return {
    staffId,
    periodStart: ymdUtc(periodStart),
    periodEnd: ymdUtc(periodEnd),
    unpaidLeaveDays,
    amount,
    workingDaysInPeriod,
    breakdown,
  }
}

/**
 * Split-leave allocation (Phase 5). The staff member's Total Leave for the year
 * is halved into:
 *   • Annual Leave — the single bulk block, taken ideally as one request.
 *   • Casual Leave — the remainder, taken in bits.
 * Annual + Casual == Total. Annual taken beyond its own half spills into — and
 * can zero — the casual allowance; casual taken beyond its half is only
 * approvable with a management override.
 */
export type LeaveSplit = {
  /** Total Leave for the year (annualQuota + casualQuota). */
  totalQuota: number
  /** Annual Leave — the single bulk block. */
  annualQuota: number
  annualUsed: number
  annualRemaining: number
  /** Casual Leave — taken in bits. */
  casualQuota: number
  casualUsed: number
  casualRemaining: number
  /** Casual allowance is used up — further casual leave needs a management override. */
  casualExhausted: boolean
}

export function computeLeaveSplit(
  entitlement: number,
  annualUsed: number,
  casualUsed: number,
  /** Configured Annual-block size; omit/null to split the total 50/50. */
  annualBlock?: number | null
): LeaveSplit {
  const annualQuota =
    annualBlock == null
      ? Math.ceil(entitlement / 2)
      : Math.min(Math.max(0, Math.round(annualBlock)), entitlement)
  const casualQuota = entitlement - annualQuota
  const annualRemaining = Math.max(0, annualQuota - annualUsed)
  // Annual leave beyond its own quota eats into the casual allowance — a single
  // full-total block zeroes casual.
  const annualOverflow = Math.max(0, annualUsed - annualQuota)
  const casualRemaining = Math.max(0, casualQuota - casualUsed - annualOverflow)
  return {
    totalQuota: entitlement,
    annualQuota,
    annualUsed,
    annualRemaining,
    casualQuota,
    casualUsed,
    casualRemaining,
    casualExhausted: casualRemaining <= 0,
  }
}

type LeaveBalanceBreakdown = {
  staffId: string
  year: number
  entitlement: number
  used: number
  remaining: number
  source: 'override' | 'clinic_default'
  /** Bulk-annual vs casual split of the entitlement + usage. */
  split: LeaveSplit
  breakdown: Array<{
    requestId: string
    subType: string
    startDate: string | null
    endDate: string | null
    days: number
  }>
}

/**
 * Internal-detail flavour of the breakdown. PR-27 — the approval guard
 * needs the working-day count for a candidate range and was previously
 * re-fetching `staff_off_days` + `clinic_holidays` to compute it. We now
 * surface the sets so the caller can pass them straight into
 * `computeLeaveWorkingDays` without another round-trip.
 */
type LeaveBalanceInternal = LeaveBalanceBreakdown & {
  offDaysSet: Set<number>
  holidaysSet: Set<string>
}

export async function computeLeaveBalanceInternal(
  db: ReturnType<typeof getDb>,
  staffId: string,
  year: number
): Promise<LeaveBalanceInternal> {
  const [staffRow] = await db
    .select({
      id: staff.id,
      annualLeaveEntitlement: staff.annualLeaveEntitlement,
    })
    .from(staff)
    .where(eq(staff.id, staffId))
    .limit(1)
  if (!staffRow) {
    throw new Error('Staff not found')
  }

  const clinicDefault = await getAnnualLeaveDefault(db)
  const annualBlock = await getAnnualLeaveBlock(db)
  const entitlement =
    typeof staffRow.annualLeaveEntitlement === 'number' && staffRow.annualLeaveEntitlement >= 0
      ? staffRow.annualLeaveEntitlement
      : clinicDefault

  const yearStart = new Date(Date.UTC(year, 0, 1))
  const yearEnd = new Date(Date.UTC(year, 11, 31))

  // Approved leave requests (bulk annual + casual) for this staff this year.
  // End-of-year edge is inclusive; partial overlap is handled by
  // computeLeaveWorkingDays. Both subtypes draw down the same entitlement.
  const requests = await db
    .select({
      id: staffRequests.id,
      subType: staffRequests.subType,
      startDate: staffRequests.startDate,
      endDate: staffRequests.endDate,
    })
    .from(staffRequests)
    .where(
      and(
        eq(staffRequests.staffId, staffId),
        eq(staffRequests.requestType, 'leave'),
        inArray(staffRequests.subType, ['annual_leave', 'casual_leave']),
        eq(staffRequests.status, 'approved'),
        sql`${staffRequests.startDate} is not null`,
        gte(staffRequests.startDate, yearStart),
        lte(staffRequests.startDate, yearEnd)
      )
    )

  // Pull per-staff off-days + clinic holidays once; computeLeaveWorkingDays
  // doesn't care about the year boundary, only the start/end of each row.
  const offDayRows = await db
    .select({ dayOfWeek: staffOffDays.dayOfWeek })
    .from(staffOffDays)
    .where(eq(staffOffDays.staffId, staffId))
  const offDaysSet = new Set(offDayRows.map((r) => r.dayOfWeek))

  const holidayRows = await db
    .select({ date: clinicHolidays.date })
    .from(clinicHolidays)
    .where(
      and(gte(clinicHolidays.date, `${year}-01-01`), lte(clinicHolidays.date, `${year}-12-31`))
    )
  const holidaysSet = new Set(holidayRows.map((r) => r.date))

  let annualUsed = 0
  let casualUsed = 0
  const breakdown: LeaveBalanceBreakdown['breakdown'] = []
  for (const r of requests) {
    if (!r.startDate) continue
    const start = r.startDate
    const end = r.endDate ?? r.startDate
    const days = computeLeaveWorkingDays(start, end, offDaysSet, holidaysSet)
    if (r.subType === 'casual_leave') casualUsed += days
    else annualUsed += days
    breakdown.push({
      requestId: r.id,
      subType: r.subType ?? 'annual_leave',
      startDate: ymdUtc(start),
      endDate: ymdUtc(end),
      days,
    })
  }
  const used = annualUsed + casualUsed

  return {
    staffId,
    year,
    entitlement,
    used,
    remaining: Math.max(0, entitlement - used),
    source:
      typeof staffRow.annualLeaveEntitlement === 'number' && staffRow.annualLeaveEntitlement >= 0
        ? 'override'
        : 'clinic_default',
    split: computeLeaveSplit(entitlement, annualUsed, casualUsed, annualBlock),
    breakdown,
    offDaysSet,
    holidaysSet,
  }
}

/**
 * HR-H6 — shared annual-leave entitlement guard. Returns whether APPROVING the
 * given leave request would stay within the staff member's remaining balance.
 * Used by BOTH the single-step review (staff-core) and the multi-step approval
 * chain (hr-phase2) so the two paths cannot diverge. Only `annual_leave` with a
 * start date is bounded by entitlement; everything else is unbounded (ok:true).
 */
export interface LeaveBalanceCheck {
  ok: boolean
  requested?: number
  remaining?: number
  entitlement?: number
  /** Which pool the request draws from (annual bulk vs casual). */
  kind?: 'annual' | 'casual'
  /**
   * The overage is approvable with a management override (casual beyond its
   * quota). Annual overages are hard-blocked (overridable is undefined/false).
   */
  overridable?: boolean
}

export async function checkLeaveWithinBalance(
  db: ReturnType<typeof getDb>,
  requestId: string
): Promise<LeaveBalanceCheck> {
  const detail = await db.query.staffRequests.findFirst({
    where: eq(staffRequests.id, requestId),
    columns: {
      staffId: true,
      requestType: true,
      subType: true,
      startDate: true,
      endDate: true,
    },
  })
  const isAnnual = detail?.subType === 'annual_leave'
  const isCasual = detail?.subType === 'casual_leave'
  // Only bulk-annual + casual draw down entitlement; sick/other are unbounded.
  if (!detail || detail.requestType !== 'leave' || (!isAnnual && !isCasual) || !detail.startDate) {
    return { ok: true }
  }
  const year = detail.startDate.getUTCFullYear()
  const balance = await computeLeaveBalanceInternal(db, detail.staffId, year)
  const requested = computeLeaveWorkingDays(
    detail.startDate,
    detail.endDate ?? detail.startDate,
    balance.offDaysSet,
    balance.holidaysSet
  )
  if (isCasual) {
    // Casual is capped at its own remaining allowance; beyond that it's a
    // management-discretion call (approvable with an override), not a hard stop.
    return requested > balance.split.casualRemaining
      ? {
          ok: false,
          kind: 'casual',
          overridable: true,
          requested,
          remaining: balance.split.casualRemaining,
          entitlement: balance.split.casualQuota,
        }
      : { ok: true }
  }
  // Bulk annual may consume the whole entitlement (spilling into casual), so
  // it's bounded by the TOTAL remaining and hard-blocked past it.
  return requested > balance.remaining
    ? {
        ok: false,
        kind: 'annual',
        requested,
        remaining: balance.remaining,
        entitlement: balance.entitlement,
      }
    : { ok: true }
}

async function computeLeaveBalance(
  db: ReturnType<typeof getDb>,
  staffId: string,
  year: number
): Promise<LeaveBalanceBreakdown> {
  const {
    offDaysSet: _o,
    holidaysSet: _h,
    ...rest
  } = await computeLeaveBalanceInternal(db, staffId, year)
  // `void` flags satisfy "no-unused-vars" without importing a stripper.
  void _o
  void _h
  return rest
}

/** POST /attendance/upload — multipart CSV from the hardware reader. Idempotent. */
app.post('/attendance/upload', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.CREATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const form = await c.req.formData()
    const file = form.get('file') as File | null
    if (!file) return c.json({ error: 'CSV file is required (form field: file)' }, 400)

    // Validate file shape / size / extension before reading it into memory.
    // Without this an attacker could submit a 200 MB "CSV" and OOM the worker.
    const validation = await validateUpload(file, uploadProfiles.csv)
    if (!validation.ok) {
      return c.json({ error: validation.error }, 400)
    }

    const content = await file.text()
    const { rows, errors } = parseAttendanceCsv(content)
    if (rows.length === 0) {
      return c.json({ error: 'No valid rows in CSV', parseErrors: errors }, 400)
    }

    const db = getDb(process.env.DATABASE_URL!)

    // Map device user IDs → staff IDs once.
    const distinctIds = Array.from(new Set(rows.map((r) => r.deviceUserId)))
    const staffByDevice = await db
      .select({ id: staff.id, deviceUserId: staff.deviceUserId })
      .from(staff)
      .where(inArray(staff.deviceUserId, distinctIds))
    const staffMap = new Map<string, string>()
    for (const s of staffByDevice) {
      if (s.deviceUserId) staffMap.set(s.deviceUserId, s.id)
    }
    const unmappedSet = new Set<string>()

    const inserts = rows.map((r) => {
      const sid = staffMap.get(r.deviceUserId) ?? null
      if (!sid) unmappedSet.add(r.deviceUserId)
      return {
        staffId: sid,
        deviceUserId: r.deviceUserId,
        deviceUserName: r.deviceUserName,
        eventTimestamp: r.eventTimestamp,
        deviceNo: r.deviceNo,
        rawStatus: r.rawStatus,
        sourceFile: file.name,
        uploadedById: authUser.id,
      }
    })

    const result = await db
      .insert(attendanceEvents)
      .values(inserts)
      .onConflictDoNothing({
        target: [
          attendanceEvents.deviceUserId,
          attendanceEvents.eventTimestamp,
          attendanceEvents.deviceNo,
          attendanceEvents.rawStatus,
        ],
      })
      .returning({ id: attendanceEvents.id })

    await createAuditLog(db, {
      userId: authUser.id,
      action: 'attendance_upload',
      module: 'staff',
      changes: {
        sourceFile: file.name,
        submitted: inserts.length,
        inserted: result.length,
        skippedDuplicate: inserts.length - result.length,
        unmappedCount: unmappedSet.size,
      },
    })

    return c.json({
      success: true,
      submitted: inserts.length,
      inserted: result.length,
      skippedDuplicate: inserts.length - result.length,
      unmappedDeviceUserIds: Array.from(unmappedSet),
      parseErrors: errors,
    })
  } catch (err: unknown) {
    logError(err, { context: '[attendance/upload]' })
    return c.json({ error: 'Failed to process CSV' }, 500)
  }
})

/** GET /attendance — monthly datatable. Query: ?month=YYYY-MM&staffType=internal|external|all */
app.get('/attendance', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.READ as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const month = c.req.query('month')
  const target = isValidMonth(month) ? month : defaultMonthYYYYMM()
  const staffTypeFilter = c.req.query('staffType') ?? 'all'
  const { start, endExclusive } = monthRangeUtc(target)

  try {
    const db = getDb(process.env.DATABASE_URL!)

    // Staff in scope. Role comes from the linked auth user.
    const staffWhere =
      staffTypeFilter === 'internal' || staffTypeFilter === 'external'
        ? eq(staff.staffType, staffTypeFilter)
        : undefined
    const staffRows = await db
      .select({
        id: staff.id,
        userId: staff.userId,
        fullName: staff.fullName,
        role: user.role,
        staffType: staff.staffType,
        deviceUserId: staff.deviceUserId,
        // PR-20 — surfaced so the attendance grid can render an admin
        // show/hide toggle that flips this flag inline.
        tracksAttendance: staff.tracksAttendance,
      })
      .from(staff)
      .leftJoin(user, eq(user.id, staff.userId))
      .where(staffWhere)

    if (staffRows.length === 0) {
      return c.json({ success: true, month: target, data: [] })
    }
    const staffIds = staffRows.map((s) => s.id)

    // Pull all month events for these staff in one query
    const events = await db
      .select({
        staffId: attendanceEvents.staffId,
        eventTimestamp: attendanceEvents.eventTimestamp,
        createdAt: attendanceEvents.createdAt,
        sourceFile: attendanceEvents.sourceFile,
        deviceUserId: attendanceEvents.deviceUserId,
        deviceUserName: attendanceEvents.deviceUserName,
      })
      .from(attendanceEvents)
      .where(
        and(
          inArray(attendanceEvents.staffId, staffIds),
          gte(effectiveEventTsSql, start),
          lt(effectiveEventTsSql, endExclusive)
        )
      )

    // Pull exceptions + approved leaves for the month
    const exceptions = await db
      .select()
      .from(attendanceExceptions)
      .where(
        and(
          inArray(attendanceExceptions.staffId, staffIds),
          gte(attendanceExceptions.date, target.concat('-01')),
          lt(attendanceExceptions.date, formatYMD(endExclusive))
        )
      )
    // Pull this clinic's holidays + each staff's recurring off-days for the month.
    const monthHolidays = await db
      .select({ date: clinicHolidays.date, name: clinicHolidays.name, type: clinicHolidays.type })
      .from(clinicHolidays)
      .where(
        and(
          gte(clinicHolidays.date, target.concat('-01')),
          lt(clinicHolidays.date, formatYMD(endExclusive))
        )
      )
    const offDayRows = await db
      .select({ staffId: staffOffDays.staffId, dayOfWeek: staffOffDays.dayOfWeek })
      .from(staffOffDays)
      .where(inArray(staffOffDays.staffId, staffIds))

    const eventsByStaff = groupBy(events, (e) => e.staffId ?? '__unknown__')
    const exceptionsByStaff = groupBy(exceptions, (e) => e.staffId)
    const offDaysByStaff = groupBy(offDayRows, (r) => r.staffId)
    const overridesByStaff = await fetchOverridesByStaff(
      db,
      staffIds,
      target.concat('-01'),
      formatYMD(endExclusive)
    )

    const config = await getAttendanceConfig(db)

    const data = staffRows.map((s) => {
      // Honour the capability flag: staff who aren't attendance-tracked are
      // returned without a score rather than a misleading computed one.
      if (!s.tracksAttendance) {
        return {
          staffId: s.id,
          userId: s.userId,
          fullName: s.fullName,
          role: s.role,
          staffType: s.staffType,
          deviceUserId: s.deviceUserId,
          tracksAttendance: false,
          month: target,
          daysPresent: 0,
          daysLate: 0,
          daysAbsent: 0,
          daysExcused: 0,
          scoringDays: 0,
          attendancePct: 0,
          totalScore: 0,
          maxScore: 0,
        }
      }
      const staffEvents = (eventsByStaff.get(s.id) ?? []).map<LibAttendanceEvent>(toLibEvent)
      const staffExceptions = (exceptionsByStaff.get(s.id) ?? []).map<LibAttendanceException>(
        (e) => ({
          staffId: e.staffId,
          date: e.date,
          type: e.type as LibAttendanceException['type'],
          reason: e.reason,
        })
      )
      const staffOffDaysList = (offDaysByStaff.get(s.id) ?? []).map((r) => r.dayOfWeek)

      const daily = dailySummaries({
        month: target,
        events: staffEvents,
        exceptions: staffExceptions,
        offDays: staffOffDaysList,
        overrides: overridesByStaff.get(s.id) ?? [],
        holidays: monthHolidays.map((h) => ({
          date: h.date,
          name: h.name,
          type: h.type as 'full' | 'half',
        })),
        config,
      })
      const summary = monthlySummary({ month: target, daily, config })

      return {
        staffId: s.id,
        userId: s.userId,
        fullName: s.fullName,
        role: s.role,
        staffType: s.staffType,
        deviceUserId: s.deviceUserId,
        tracksAttendance: s.tracksAttendance,
        ...summary,
      }
    })

    return c.json({ success: true, month: target, data })
  } catch (err: unknown) {
    logError(err, { context: '[attendance]' })
    return c.json({ error: 'Failed to fetch attendance' }, 500)
  }
})

/**
 * GET /attendance/daily — per-day clock-in/out for ALL staff across a month.
 * Feeds the Records calendar + single-day views. Only emits days a staffer
 * actually clocked (clockIn or clockOut present), using the same effective
 * clock time + scoring lib as the monthly grid. Query: ?month=YYYY-MM
 */
app.get('/attendance/daily', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.READ as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const month = c.req.query('month')
  const target = isValidMonth(month) ? month : defaultMonthYYYYMM()
  const { start, endExclusive } = monthRangeUtc(target)

  try {
    const db = getDb(process.env.DATABASE_URL!)

    // Attendance-tracked, non-deleted staff only.
    const staffRows = await db
      .select({ id: staff.id, fullName: staff.fullName, staffId: staff.staffId })
      .from(staff)
      .where(and(isNull(staff.deletedAt), eq(staff.tracksAttendance, true)))
    if (staffRows.length === 0) {
      return c.json({ success: true, month: target, data: [] })
    }
    const staffIds = staffRows.map((s) => s.id)
    const nameById = new Map(staffRows.map((s) => [s.id, s]))

    const [events, exceptions, monthHolidays, offDayRows] = await Promise.all([
      db
        .select({
          staffId: attendanceEvents.staffId,
          eventTimestamp: attendanceEvents.eventTimestamp,
          createdAt: attendanceEvents.createdAt,
          sourceFile: attendanceEvents.sourceFile,
          deviceUserId: attendanceEvents.deviceUserId,
          deviceUserName: attendanceEvents.deviceUserName,
        })
        .from(attendanceEvents)
        .where(
          and(
            inArray(attendanceEvents.staffId, staffIds),
            gte(effectiveEventTsSql, start),
            lt(effectiveEventTsSql, endExclusive)
          )
        ),
      db
        .select()
        .from(attendanceExceptions)
        .where(
          and(
            inArray(attendanceExceptions.staffId, staffIds),
            gte(attendanceExceptions.date, target.concat('-01')),
            lt(attendanceExceptions.date, formatYMD(endExclusive))
          )
        ),
      db
        .select({ date: clinicHolidays.date, name: clinicHolidays.name, type: clinicHolidays.type })
        .from(clinicHolidays)
        .where(
          and(
            gte(clinicHolidays.date, target.concat('-01')),
            lt(clinicHolidays.date, formatYMD(endExclusive))
          )
        ),
      db
        .select({ staffId: staffOffDays.staffId, dayOfWeek: staffOffDays.dayOfWeek })
        .from(staffOffDays)
        .where(inArray(staffOffDays.staffId, staffIds)),
    ])

    const eventsByStaff = groupBy(events, (e) => e.staffId ?? '__unknown__')
    const exceptionsByStaff = groupBy(exceptions, (e) => e.staffId)
    const offDaysByStaff = groupBy(offDayRows, (r) => r.staffId)
    const overridesByStaff = await fetchOverridesByStaff(
      db,
      staffIds,
      target.concat('-01'),
      formatYMD(endExclusive)
    )
    const config = await getAttendanceConfig(db)
    const holidays = monthHolidays.map((h) => ({
      date: h.date,
      name: h.name,
      type: h.type as 'full' | 'half',
    }))

    const data: Array<{
      staffId: string
      staffName: string
      staffCode: string
      date: string
      clockIn: string | null
      clockOut: string | null
      clockInStatus: string
      clockOutStatus: string
      status: string
    }> = []

    for (const s of staffRows) {
      const daily = dailySummaries({
        month: target,
        events: (eventsByStaff.get(s.id) ?? []).map<LibAttendanceEvent>(toLibEvent),
        exceptions: (exceptionsByStaff.get(s.id) ?? []).map<LibAttendanceException>((e) => ({
          staffId: e.staffId,
          date: e.date,
          type: e.type as LibAttendanceException['type'],
          reason: e.reason,
        })),
        offDays: (offDaysByStaff.get(s.id) ?? []).map((r) => r.dayOfWeek),
        holidays,
        overrides: overridesByStaff.get(s.id) ?? [],
        config,
      })
      for (const d of daily) {
        // Only days the staffer actually clocked.
        if (!d.clockIn && !d.clockOut) continue
        data.push({
          staffId: s.id,
          staffName: nameById.get(s.id)?.fullName ?? 'Unknown',
          staffCode: nameById.get(s.id)?.staffId ?? '—',
          date: d.date,
          clockIn: d.clockIn,
          clockOut: d.clockOut,
          clockInStatus: d.clockInStatus,
          clockOutStatus: d.clockOutStatus,
          status: d.status,
        })
      }
    }

    return c.json({ success: true, month: target, data })
  } catch (err: unknown) {
    logError(err, { context: '[attendance/daily]' })
    return c.json({ error: 'Failed to fetch daily attendance' }, 500)
  }
})

/**
 * GET /attendance/lateness-log — feeds the Attendance › Lateness Log tab.
 *
 * Two halves:
 *   • rows    — one per attendance-tracked staff: how many days they were late
 *               in ?month=YYYY-MM (same scoring the Records grid uses) alongside
 *               their standing under the weekly lateness policy — queries
 *               issued, current escalation level, and whether the alert SMS
 *               actually went out.
 *   • entries — the individual queries the weekly cron issued, each with its
 *               SMS outcome. Scoped to weeks overlapping the month by default;
 *               ?history=all returns the full trail (capped).
 *
 * Late *days* are month-scoped, but "weeks breached" is deliberately NOT
 * recomputed here — a Mon–Sun week can straddle two months, so the cron's own
 * query rows stay the single authority on what was actually flagged.
 */
app.get('/attendance/lateness-log', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.READ as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const month = c.req.query('month')
  const target = isValidMonth(month) ? month : defaultMonthYYYYMM()
  const allHistory = c.req.query('history') === 'all'
  const { start, endExclusive } = monthRangeUtc(target)
  const monthStartYmd = `${target}-01`
  const monthEndYmd = formatYMD(endExclusive) // exclusive

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const config = await getAttendanceConfig(db)

    // Policy scope: exactly who the weekly cron considers.
    const staffRows = await db
      .select({
        id: staff.id,
        fullName: staff.fullName,
        phone: staff.phone,
        role: user.role,
      })
      .from(staff)
      .leftJoin(user, eq(user.id, staff.userId))
      .where(
        and(eq(staff.status, 'active'), eq(staff.tracksAttendance, true), isNull(staff.deletedAt))
      )
    const staffIds = staffRows.map((s) => s.id)

    // A week counts as "in this month" when any of its Mon–Sun days fall in it,
    // so the log doesn't drop the week a month opens or closes mid-stride.
    const windowStart = new Date(start)
    windowStart.setUTCDate(windowStart.getUTCDate() - 6)
    const windowStartYmd = formatYMD(windowStart)
    const entryRows = await db
      .select({
        id: staffLatenessQueries.id,
        staffId: staffLatenessQueries.staffId,
        fullName: staff.fullName,
        weekStart: staffLatenessQueries.weekStart,
        level: staffLatenessQueries.level,
        lateCount: staffLatenessQueries.lateCount,
        createdAt: staffLatenessQueries.createdAt,
        smsStatus: staffLatenessQueries.smsStatus,
        smsSentAt: staffLatenessQueries.smsSentAt,
        smsRecipient: staffLatenessQueries.smsRecipient,
        smsMessage: staffLatenessQueries.smsMessage,
        smsError: staffLatenessQueries.smsError,
      })
      .from(staffLatenessQueries)
      .leftJoin(staff, eq(staff.id, staffLatenessQueries.staffId))
      .where(
        allHistory
          ? undefined
          : and(
              gte(staffLatenessQueries.weekStart, windowStartYmd),
              lt(staffLatenessQueries.weekStart, monthEndYmd)
            )
      )
      .orderBy(desc(staffLatenessQueries.weekStart), desc(staffLatenessQueries.createdAt))
      .limit(500)

    // All-time standing per staff — the escalation ladder is cumulative, so the
    // month view still has to show where each person currently sits on it.
    const standingRows =
      staffIds.length > 0
        ? await db
            .select({
              staffId: staffLatenessQueries.staffId,
              totalQueries: sql<number>`count(*)::int`,
              currentLevel: sql<number>`max(${staffLatenessQueries.level})::int`,
              lastQueryWeek: sql<string>`max(${staffLatenessQueries.weekStart})::text`,
              smsSent: sql<number>`(count(*) filter (where ${staffLatenessQueries.smsStatus} = 'sent'))::int`,
              smsFailed: sql<number>`(count(*) filter (where ${staffLatenessQueries.smsStatus} in ('failed', 'no_phone')))::int`,
            })
            .from(staffLatenessQueries)
            .where(inArray(staffLatenessQueries.staffId, staffIds))
            .groupBy(staffLatenessQueries.staffId)
        : []
    const standingByStaff = new Map(standingRows.map((r) => [r.staffId, r]))

    // Month-scoped counts come off the entries already in hand (an "all" fetch
    // is a superset of the month window, so the same filter serves both).
    const inMonth = entryRows.filter(
      (e) => e.weekStart >= windowStartYmd && e.weekStart < monthEndYmd
    )
    const monthByStaff = new Map<string, { queries: number; smsSent: number }>()
    for (const e of inMonth) {
      const agg = monthByStaff.get(e.staffId) ?? { queries: 0, smsSent: 0 }
      agg.queries++
      if (e.smsStatus === 'sent') agg.smsSent++
      monthByStaff.set(e.staffId, agg)
    }

    // Late days for the month, scored exactly as the Records grid scores them.
    const [events, exceptions, monthHolidays, offDayRows] =
      staffIds.length > 0
        ? await Promise.all([
            db
              .select({
                staffId: attendanceEvents.staffId,
                eventTimestamp: attendanceEvents.eventTimestamp,
                createdAt: attendanceEvents.createdAt,
                sourceFile: attendanceEvents.sourceFile,
                deviceUserId: attendanceEvents.deviceUserId,
                deviceUserName: attendanceEvents.deviceUserName,
              })
              .from(attendanceEvents)
              .where(
                and(
                  inArray(attendanceEvents.staffId, staffIds),
                  gte(effectiveEventTsSql, start),
                  lt(effectiveEventTsSql, endExclusive)
                )
              ),
            db
              .select()
              .from(attendanceExceptions)
              .where(
                and(
                  inArray(attendanceExceptions.staffId, staffIds),
                  gte(attendanceExceptions.date, monthStartYmd),
                  lt(attendanceExceptions.date, monthEndYmd)
                )
              ),
            db
              .select({
                date: clinicHolidays.date,
                name: clinicHolidays.name,
                type: clinicHolidays.type,
              })
              .from(clinicHolidays)
              .where(
                and(gte(clinicHolidays.date, monthStartYmd), lt(clinicHolidays.date, monthEndYmd))
              ),
            db
              .select({ staffId: staffOffDays.staffId, dayOfWeek: staffOffDays.dayOfWeek })
              .from(staffOffDays)
              .where(inArray(staffOffDays.staffId, staffIds)),
          ])
        : [[], [], [], []]

    const eventsByStaff = groupBy(events, (e) => e.staffId ?? '__unknown__')
    const exceptionsByStaff = groupBy(exceptions, (e) => e.staffId)
    const offDaysByStaff = groupBy(offDayRows, (r) => r.staffId)
    const overridesByStaff = await fetchOverridesByStaff(db, staffIds, monthStartYmd, monthEndYmd)
    const holidays = monthHolidays.map((h) => ({
      date: h.date,
      name: h.name,
      type: h.type as 'full' | 'half',
    }))

    const rows = staffRows.map((s) => {
      const daily = dailySummaries({
        month: target,
        events: (eventsByStaff.get(s.id) ?? []).map<LibAttendanceEvent>(toLibEvent),
        exceptions: (exceptionsByStaff.get(s.id) ?? []).map<LibAttendanceException>((e) => ({
          staffId: e.staffId,
          date: e.date,
          type: e.type as LibAttendanceException['type'],
          reason: e.reason,
        })),
        offDays: (offDaysByStaff.get(s.id) ?? []).map((r) => r.dayOfWeek),
        holidays,
        overrides: overridesByStaff.get(s.id) ?? [],
        config,
      })
      const lateDates = daily
        .filter((d) => d.status === 'late')
        .map((d) => ({ date: d.date, clockIn: d.clockIn, severity: d.clockInStatus }))
      const standing = standingByStaff.get(s.id)
      const monthAgg = monthByStaff.get(s.id)

      return {
        staffId: s.id,
        fullName: s.fullName,
        role: s.role,
        phone: s.phone,
        lateDays: lateDates.length,
        lateDates,
        queriesInMonth: monthAgg?.queries ?? 0,
        smsSentInMonth: monthAgg?.smsSent ?? 0,
        totalQueries: standing?.totalQueries ?? 0,
        currentLevel: standing?.currentLevel ?? 0,
        lastQueryWeek: standing?.lastQueryWeek ?? null,
        smsSentTotal: standing?.smsSent ?? 0,
        smsFailedTotal: standing?.smsFailed ?? 0,
      }
    })

    return c.json({
      success: true,
      data: {
        month: target,
        history: allHistory ? 'all' : 'month',
        config: {
          latenessPolicyEnabled: config.latenessPolicyEnabled,
          lateFlagsPerWeek: config.lateFlagsPerWeek,
        },
        rows,
        entries: entryRows.map((e) => ({
          ...e,
          fullName: e.fullName ?? 'Unknown',
          createdAt: e.createdAt.toISOString(),
          smsSentAt: e.smsSentAt ? e.smsSentAt.toISOString() : null,
        })),
      },
    })
  } catch (err: unknown) {
    logError(err, { context: '[attendance/lateness-log]' })
    return c.json({ error: 'Failed to fetch lateness log' }, 500)
  }
})

/** GET /attendance/config — effective clinic-wide attendance scoring config. */
app.get('/attendance/config', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.READ as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)
  const db = getDb(process.env.DATABASE_URL!)
  return c.json({ success: true, data: await getAttendanceConfig(db) })
})

/** PUT /attendance/config — update the clinic-wide scoring config (HR settings). */
app.put('/attendance/config', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.UPDATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const next = { ...(await getAttendanceConfig(db)) }
    if (typeof body.saturdayExcluded === 'boolean') next.saturdayExcluded = body.saturdayExcluded
    if (typeof body.latenessPolicyEnabled === 'boolean')
      next.latenessPolicyEnabled = body.latenessPolicyEnabled
    const numericKeys = [
      'onTimeBy',
      'lateMildBy',
      'veryEarlyBy',
      'earlyBy',
      'baseDailyScore',
      'lateMildScore',
      'lateSevereScore',
      'noShowScore',
      'veryEarlyScore',
      'earlyScore',
      'lateFlagsPerWeek',
    ] as const
    for (const k of numericKeys) {
      if (body[k] !== undefined) {
        const n = Number(body[k])
        if (!Number.isFinite(n)) return c.json({ error: `${k} must be a number` }, 400)
        next[k] = n
      }
    }

    await db
      .insert(clinicSettings)
      .values({ key: ATTENDANCE_CONFIG_KEY, value: next, updatedById: authUser.id })
      .onConflictDoUpdate({
        target: clinicSettings.key,
        set: { value: next, updatedById: authUser.id, updatedAt: new Date() },
      })

    await createAuditLog(db, {
      userId: authUser.id,
      action: 'update',
      module: 'staff',
      entityName: 'Attendance scoring config',
      changes: next,
    })
    return c.json({ success: true, data: next })
  } catch (err: unknown) {
    logError(err, { context: '[attendance/config PUT]' })
    return c.json({ error: 'Failed to save attendance config' }, 500)
  }
})

/**
 * Normalise an override clock time to a Postgres `time` literal (HH:MM:SS).
 * Accepts "HH:MM" (what an <input type="time"> submits) and "HH:MM:SS".
 * Returns `null` for an absent/blank value and `undefined` for a malformed one.
 */
function normalizeOverrideTime(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw !== 'string') return undefined
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(raw.trim())
  if (!m) return undefined
  return `${m[1]}:${m[2]}:${m[3] ?? '00'}`
}

/**
 * POST /attendance/overrides — HR correction of one staff-day's clock times.
 * body: { staffId, date: YYYY-MM-DD, clockIn?: "HH:MM", clockOut?: "HH:MM" }
 *
 * Where this sits in the clock-time resolution order
 * --------------------------------------------------
 * `lib/attendance-events.ts` decides the *effective* time of a RAW DEVICE
 * PUNCH: webhook punches score on the ingested `createdAt` (device clocks
 * drift/reset), CSV punches keep their device `eventTimestamp`. That choice is
 * applied by `toLibEvent()` / `effectiveEventTsSql` and is NOT bypassed here —
 * an override is a strictly higher tier that sits *above* the whole raw-event
 * layer:
 *
 *   1. HR override for the day (this table)   ← highest
 *   2. Effective device punch (per attendance-events.ts: createdAt for
 *      `anviz_webhook` rows, eventTimestamp otherwise)
 *   3. No clock time → absent
 *
 * `dailySummaries()` implements exactly that: it takes `clockIn` from
 * `overrides` when present and only otherwise falls back to the day's AM/PM
 * event bucket, which was itself built from effective times. So an override
 * wins over BOTH punch flavours without the route needing to know which flavour
 * produced the row.
 *
 * Payload semantics: the HR dialog prefills both fields from the day's
 * currently-resolved times, so the body is the COMPLETE desired override for
 * that day. Both columns are written every time — an omitted field clears that
 * half of the override and lets the device punch show through again.
 */
app.post('/attendance/overrides', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.UPDATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const body = await c.req.json()
    if (!body.staffId || !body.date) return c.json({ error: 'staffId and date are required' }, 400)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date))
      return c.json({ error: 'date must be YYYY-MM-DD' }, 400)

    const clockIn = normalizeOverrideTime(body.clockIn)
    const clockOut = normalizeOverrideTime(body.clockOut)
    if (clockIn === undefined || clockOut === undefined)
      return c.json({ error: 'clockIn/clockOut must be HH:MM or HH:MM:SS' }, 400)
    if (clockIn === null && clockOut === null)
      return c.json({ error: 'At least one of clockIn or clockOut is required' }, 400)
    if (clockIn && clockOut && clockOut < clockIn)
      return c.json({ error: 'clockOut must not be earlier than clockIn' }, 400)

    const db = getDb(process.env.DATABASE_URL!)

    const targetStaff = await db.query.staff.findFirst({
      where: eq(staff.id, body.staffId),
      columns: { id: true, fullName: true },
    })
    if (!targetStaff) return c.json({ error: 'Staff not found' }, 404)

    // Self-approve guard (mirrors /attendance-exceptions): overrides are
    // payroll-affecting, so a non-admin must not be able to rewrite their own
    // clock-ins. Admins are exempt — they manage HR.
    if (authUser.role !== 'admin' && authUser.roleId !== 'admin') {
      const ownStaff = await db.query.staff.findFirst({
        where: eq(staff.userId, authUser.id),
        columns: { id: true },
      })
      if (ownStaff?.id && ownStaff.id === body.staffId) {
        return c.json({ error: 'You cannot override your own attendance times.' }, 403)
      }
    }

    // One override per (staffId, date) — honour the existing unique index.
    const [row] = await db
      .insert(attendanceTimeOverrides)
      .values({
        staffId: body.staffId,
        date: body.date,
        clockIn,
        clockOut,
        createdById: authUser.id,
      })
      .onConflictDoUpdate({
        target: [attendanceTimeOverrides.staffId, attendanceTimeOverrides.date],
        set: { clockIn, clockOut, createdById: authUser.id },
      })
      .returning()

    await createAuditLog(db, {
      userId: authUser.id,
      action: 'attendance_override_upsert',
      module: 'staff',
      entityId: body.staffId,
      entityName: targetStaff.fullName ?? undefined,
      changes: { date: body.date, clockIn, clockOut },
    })

    return c.json({ success: true, data: row })
  } catch (err: unknown) {
    logError(err, { context: '[attendance/overrides POST]' })
    return c.json({ error: 'Failed to save attendance override' }, 500)
  }
})

/** GET /attendance/:staffId — daily breakdown for one staff. ?month=YYYY-MM */
app.get('/attendance/:staffId{[0-9a-fA-F-]{36}}', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.READ as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const sid = c.req.param('staffId')
  const month = c.req.query('month')
  const target = isValidMonth(month) ? month : defaultMonthYYYYMM()
  const { start, endExclusive } = monthRangeUtc(target)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const staffRow = await db.query.staff.findFirst({ where: eq(staff.id, sid) })
    if (!staffRow) return c.json({ error: 'Staff not found' }, 404)
    const config = await getAttendanceConfig(db)

    const events = await db
      .select()
      .from(attendanceEvents)
      .where(
        and(
          eq(attendanceEvents.staffId, sid),
          gte(effectiveEventTsSql, start),
          lt(effectiveEventTsSql, endExclusive)
        )
      )
    const exceptions = await db
      .select()
      .from(attendanceExceptions)
      .where(
        and(
          eq(attendanceExceptions.staffId, sid),
          gte(attendanceExceptions.date, target.concat('-01')),
          lt(attendanceExceptions.date, formatYMD(endExclusive))
        )
      )
    const offDayRows = await db
      .select({ dayOfWeek: staffOffDays.dayOfWeek })
      .from(staffOffDays)
      .where(eq(staffOffDays.staffId, sid))
    const monthHolidays = await db
      .select({ date: clinicHolidays.date, name: clinicHolidays.name, type: clinicHolidays.type })
      .from(clinicHolidays)
      .where(
        and(
          gte(clinicHolidays.date, target.concat('-01')),
          lt(clinicHolidays.date, formatYMD(endExclusive))
        )
      )
    const overrideRows =
      (await fetchOverridesByStaff(db, [sid], target.concat('-01'), formatYMD(endExclusive))).get(
        sid
      ) ?? []

    const daily = dailySummaries({
      month: target,
      events: events.map<LibAttendanceEvent>(toLibEvent),
      exceptions: exceptions.map<LibAttendanceException>((e) => ({
        staffId: e.staffId,
        date: e.date,
        type: e.type as LibAttendanceException['type'],
        reason: e.reason,
      })),
      offDays: offDayRows.map((r) => r.dayOfWeek),
      holidays: monthHolidays.map((h) => ({
        date: h.date,
        name: h.name,
        type: h.type as 'full' | 'half',
      })),
      overrides: overrideRows,
      config,
    })
    const summary = monthlySummary({ month: target, daily, config })

    // Distinguish "On Leave" from a generic "Excused"/"Absent" for the calendar.
    // Scoring is left untouched (summary is already computed above; approved
    // leaves are materialized into attendanceExceptions as excused, so they
    // already count as excused) — this only relabels the display status of days
    // that fall inside an approved leave window.
    const approvedLeaves = await db
      .select({ startDate: staffRequests.startDate, endDate: staffRequests.endDate })
      .from(staffRequests)
      .where(
        and(
          eq(staffRequests.staffId, sid),
          eq(staffRequests.requestType, 'leave'),
          eq(staffRequests.status, 'approved'),
          sql`${staffRequests.startDate} is not null`,
          lte(staffRequests.startDate, endExclusive)
        )
      )
    const leaveDates = new Set<string>()
    for (const lv of approvedLeaves) {
      if (!lv.startDate) continue
      const from = lv.startDate < start ? start : lv.startDate
      const to = lv.endDate ?? lv.startDate
      for (let d = new Date(from); d < endExclusive && d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
        leaveDates.add(formatYMD(d))
      }
    }
    const dailyWithLeave = leaveDates.size
      ? daily.map((r) =>
          leaveDates.has(r.date) && (r.status === 'excused' || r.status === 'absent')
            ? { ...r, status: 'on_leave' as const }
            : r
        )
      : daily

    // Attach the id of any admin off-day exclusion on each date so the HR detail
    // grid can offer a per-date Remove (create) / Restore (delete) toggle.
    const offDayExceptionByDate = new Map<string, string>()
    for (const e of exceptions) {
      if (e.type === 'off_day') offDayExceptionByDate.set(e.date, e.id)
    }
    const dailyWithExceptions = dailyWithLeave.map((r) => ({
      ...r,
      exceptionId: offDayExceptionByDate.get(r.date) ?? null,
    }))

    // Wrap in `data` to match the response shape the frontend's API client
    // expects (it reads `res.data` for the body payload).
    return c.json({
      success: true,
      month: target,
      data: { staff: staffRow, summary, daily: dailyWithExceptions },
    })
  } catch (err: unknown) {
    logError(err, { context: '[attendance/:staffId]' })
    return c.json({ error: 'Failed to fetch staff attendance' }, 500)
  }
})

/**
 * GET /attendance/:staffId/weekly?weeks=N — weekly rollup for the per-staff
 * Attendance tab. Returns N most recent ISO weeks (Mon-Sun) with day-level
 * breakdown plus per-week totals. Default weeks=8.
 *
 * Each week shape:
 *   { weekStart, weekEnd, label, totalPoints, maxPoints, days: DailyRecord[] }
 */
app.get('/attendance/:staffId{[0-9a-fA-F-]{36}}/weekly', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.READ as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const sid = c.req.param('staffId')
  const weeksParam = Number(c.req.query('weeks') ?? 8)
  const weeks =
    Number.isFinite(weeksParam) && weeksParam > 0 && weeksParam <= 26 ? Math.floor(weeksParam) : 8

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const { daysByYmd, staffRow } = await fetchDailySummariesForStaffRange(db, sid, weeks)
    if (!staffRow) return c.json({ error: 'Staff not found' }, 404)

    // Build week buckets, most-recent first.
    const todayUtc = new Date()
    todayUtc.setUTCHours(0, 0, 0, 0)
    const thisMonday = startOfWeekMonUtc(todayUtc)

    const weekBuckets: Array<{
      weekStart: string
      weekEnd: string
      label: string
      totalPoints: number
      maxPoints: number
      daysPresent: number
      daysLate: number
      daysAbsent: number
      days: ReturnType<typeof emptyDayRecord>[]
    }> = []

    for (let i = 0; i < weeks; i++) {
      const monday = new Date(thisMonday)
      monday.setUTCDate(monday.getUTCDate() - i * 7)
      const sunday = new Date(monday)
      sunday.setUTCDate(sunday.getUTCDate() + 6)

      const days: ReturnType<typeof emptyDayRecord>[] = []
      let totalPoints = 0
      let maxPoints = 0
      let daysPresent = 0
      let daysLate = 0
      let daysAbsent = 0

      for (let d = 0; d < 7; d++) {
        const cursor = new Date(monday)
        cursor.setUTCDate(cursor.getUTCDate() + d)
        const ymd = formatYMD(cursor)
        const rec = daysByYmd.get(ymd) ?? emptyDayRecord(ymd, cursor.getUTCDay())
        days.push(rec)
        if (rec.isScoringDay) {
          totalPoints += rec.dailyScore
          maxPoints += 10 // baseDailyScore in DEFAULT_ATTENDANCE_CONFIG
          if (rec.status === 'present') daysPresent++
          else if (rec.status === 'late') daysLate++
          else if (rec.status === 'absent') daysAbsent++
        }
      }

      weekBuckets.push({
        weekStart: formatYMD(monday),
        weekEnd: formatYMD(sunday),
        label: weekLabel(monday, sunday),
        totalPoints,
        maxPoints,
        daysPresent,
        daysLate,
        daysAbsent,
        days,
      })
    }

    return c.json({
      success: true,
      data: {
        staff: staffRow,
        weeks: weekBuckets,
      },
    })
  } catch (err: unknown) {
    logError(err, { context: '[attendance/:staffId/weekly]' })
    return c.json({ error: 'Failed to fetch weekly attendance' }, 500)
  }
})

/**
 * GET /attendance/:staffId/pdf?weeks=N — printable PDF of the same weekly view.
 * Streams an attachment back to the client.
 */
app.get('/attendance/:staffId{[0-9a-fA-F-]{36}}/pdf', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.READ as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const sid = c.req.param('staffId')
  const weeksParam = Number(c.req.query('weeks') ?? 8)
  const weeks =
    Number.isFinite(weeksParam) && weeksParam > 0 && weeksParam <= 26 ? Math.floor(weeksParam) : 8

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const { daysByYmd, staffRow } = await fetchDailySummariesForStaffRange(db, sid, weeks)
    if (!staffRow) return c.json({ error: 'Staff not found' }, 404)

    const todayUtc = new Date()
    todayUtc.setUTCHours(0, 0, 0, 0)
    const thisMonday = startOfWeekMonUtc(todayUtc)

    const weeksOut: Parameters<typeof generateAttendancePdf>[0]['weeks'] = []
    // Render oldest → newest in the PDF for natural reading order.
    for (let i = weeks - 1; i >= 0; i--) {
      const monday = new Date(thisMonday)
      monday.setUTCDate(monday.getUTCDate() - i * 7)
      const sunday = new Date(monday)
      sunday.setUTCDate(sunday.getUTCDate() + 6)

      const days: ReturnType<typeof emptyDayRecord>[] = []
      let totalPoints = 0
      let maxPoints = 0
      let daysPresent = 0
      let daysLate = 0
      let daysAbsent = 0

      for (let d = 0; d < 7; d++) {
        const cursor = new Date(monday)
        cursor.setUTCDate(cursor.getUTCDate() + d)
        const ymd = formatYMD(cursor)
        const rec = daysByYmd.get(ymd) ?? emptyDayRecord(ymd, cursor.getUTCDay())
        days.push(rec)
        if (rec.isScoringDay) {
          totalPoints += rec.dailyScore
          maxPoints += 10
          if (rec.status === 'present') daysPresent++
          else if (rec.status === 'late') daysLate++
          else if (rec.status === 'absent') daysAbsent++
        }
      }

      weeksOut.push({
        weekStart: formatYMD(monday),
        weekEnd: formatYMD(sunday),
        label: weekLabel(monday, sunday),
        totalPoints,
        maxPoints,
        daysPresent,
        daysLate,
        daysAbsent,
        days: days.map((d) => ({
          date: d.date,
          dayOfWeek: d.dayOfWeek,
          clockIn: d.clockIn,
          clockOut: d.clockOut,
          status: d.status,
          dailyScore: d.dailyScore,
          isScoringDay: d.isScoringDay,
        })),
      })
    }

    const earliestMonday = new Date(thisMonday)
    earliestMonday.setUTCDate(earliestMonday.getUTCDate() - (weeks - 1) * 7)
    const periodLabel = `${weeks} weeks · ${weekLabel(earliestMonday, thisMonday)}`

    const pdfBytes = await generateAttendancePdf({
      clinicName: 'Denel Dental Clinic',
      staffName: staffRow.fullName,
      staffIdDisplay: staffRow.staffId,
      periodLabel,
      weeks: weeksOut,
      generatedAt: new Date(),
      generatedByName: authUser.name ?? authUser.email ?? 'Admin',
    })

    const safeName = staffRow.fullName.replace(/[^\w-]+/g, '_')
    const filename = `attendance-${safeName}-${formatYMD(new Date())}.pdf`
    return new Response(new Uint8Array(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err: unknown) {
    logError(err, { context: '[attendance/:staffId/pdf]' })
    return c.json({ error: 'Failed to generate attendance PDF' }, 500)
  }
})

// ---------------------------------------------------------------------------
// Attendance admin — off-days, holidays, ad-hoc excuses
// ---------------------------------------------------------------------------

const VALID_EXCEPTION_TYPES = new Set(['excused_absence', 'off_day', 'holiday'])

/** GET /off-days — list all off-day rows across staff (for the admin overview). */
app.get('/off-days', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.READ as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db
    .select({
      id: staffOffDays.id,
      staffId: staffOffDays.staffId,
      dayOfWeek: staffOffDays.dayOfWeek,
      reason: staffOffDays.reason,
      createdAt: staffOffDays.createdAt,
      staffName: staff.fullName,
    })
    .from(staffOffDays)
    .leftJoin(staff, eq(staff.id, staffOffDays.staffId))
    .orderBy(asc(staff.fullName), asc(staffOffDays.dayOfWeek))
  return c.json({ success: true, data: rows })
})

/** GET /off-days/:staffId — list a staff's recurring weekly off-days */
app.get('/off-days/:staffId{[0-9a-fA-F-]{36}}', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.READ as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const sid = c.req.param('staffId')
  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db
    .select()
    .from(staffOffDays)
    .where(eq(staffOffDays.staffId, sid))
    .orderBy(asc(staffOffDays.dayOfWeek))
  return c.json({ success: true, data: rows })
})

/** POST /off-days — set a staff's off DOW. Body: { staffId, dayOfWeek, reason? } */
app.post('/off-days', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.UPDATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const body = await c.req.json()
    if (!body.staffId || typeof body.dayOfWeek !== 'number')
      return c.json({ error: 'staffId and dayOfWeek (0-6) are required' }, 400)
    if (body.dayOfWeek < 0 || body.dayOfWeek > 6)
      return c.json({ error: 'dayOfWeek must be 0..6 (Sun..Sat)' }, 400)

    const db = getDb(process.env.DATABASE_URL!)
    const [row] = await db
      .insert(staffOffDays)
      .values({
        staffId: body.staffId,
        dayOfWeek: body.dayOfWeek,
        reason: body.reason ?? null,
        createdById: authUser.id,
      })
      .onConflictDoNothing({ target: [staffOffDays.staffId, staffOffDays.dayOfWeek] })
      .returning()
    await createAuditLog(db, {
      userId: authUser.id,
      action: 'off_day_set',
      module: 'staff',
      entityId: body.staffId,
      changes: { dayOfWeek: body.dayOfWeek, reason: body.reason ?? null },
    })
    return c.json({ success: true, data: row ?? null })
  } catch (err: unknown) {
    logError(err, { context: '[off-days POST]' })
    return c.json({ error: 'Failed to add off-day' }, 500)
  }
})

/** DELETE /off-days/:staffId/:dayOfWeek — clear one off-day */
app.delete('/off-days/:staffId{[0-9a-fA-F-]{36}}/:dayOfWeek', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.UPDATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const sid = c.req.param('staffId')
  const dow = Number(c.req.param('dayOfWeek'))
  if (!Number.isFinite(dow) || dow < 0 || dow > 6)
    return c.json({ error: 'dayOfWeek must be 0..6' }, 400)
  const db = getDb(process.env.DATABASE_URL!)
  await db
    .delete(staffOffDays)
    .where(and(eq(staffOffDays.staffId, sid), eq(staffOffDays.dayOfWeek, dow)))
  await createAuditLog(db, {
    userId: authUser.id,
    action: 'off_day_remove',
    module: 'staff',
    entityId: sid,
    changes: { dayOfWeek: dow },
  })
  return c.json({ success: true })
})

/** GET /holidays — list clinic holidays (optional ?from=YYYY-MM-DD&to=YYYY-MM-DD) */
app.get('/holidays', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.READ as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const from = c.req.query('from')
  const to = c.req.query('to')
  const db = getDb(process.env.DATABASE_URL!)
  const conds = [] as any[]
  if (from) conds.push(gte(clinicHolidays.date, from))
  if (to) conds.push(lt(clinicHolidays.date, to))
  const rows = await db
    .select()
    .from(clinicHolidays)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(asc(clinicHolidays.date))
  return c.json({ success: true, data: rows })
})

/** POST /holidays — body: { date: YYYY-MM-DD, name } */
app.post('/holidays', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.UPDATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const body = await c.req.json()
    if (!body.date || !body.name) return c.json({ error: 'date and name are required' }, 400)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date))
      return c.json({ error: 'date must be YYYY-MM-DD' }, 400)
    const type = body.type === 'half' ? 'half' : 'full'
    const db = getDb(process.env.DATABASE_URL!)
    const [row] = await db
      .insert(clinicHolidays)
      .values({ date: body.date, name: body.name, type, createdById: authUser.id })
      .onConflictDoUpdate({
        target: clinicHolidays.date,
        set: { name: body.name, type, createdById: authUser.id },
      })
      .returning()
    await createAuditLog(db, {
      userId: authUser.id,
      action: 'holiday_upsert',
      module: 'staff',
      entityId: row?.id,
      entityName: body.name,
      changes: { date: body.date, name: body.name },
    })
    return c.json({ success: true, data: row })
  } catch (err: unknown) {
    logError(err, { context: '[holidays POST]' })
    return c.json({ error: 'Failed to save holiday' }, 500)
  }
})

/** DELETE /holidays/:id */
app.delete('/holidays/:id{[0-9a-fA-F-]{36}}', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.UPDATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  await db.delete(clinicHolidays).where(eq(clinicHolidays.id, id))
  await createAuditLog(db, {
    userId: authUser.id,
    action: 'holiday_delete',
    module: 'staff',
    entityId: id,
  })
  return c.json({ success: true })
})

/** GET /attendance/exceptions — list ad-hoc excuses (optional ?staffId=&from=&to=) */
app.get('/attendance-exceptions', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.READ as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const sid = c.req.query('staffId')
  const from = c.req.query('from')
  const to = c.req.query('to')
  const db = getDb(process.env.DATABASE_URL!)
  const conds: any[] = []
  if (sid) conds.push(eq(attendanceExceptions.staffId, sid))
  if (from) conds.push(gte(attendanceExceptions.date, from))
  if (to) conds.push(lt(attendanceExceptions.date, to))
  const rows = await db
    .select({
      id: attendanceExceptions.id,
      staffId: attendanceExceptions.staffId,
      date: attendanceExceptions.date,
      type: attendanceExceptions.type,
      reason: attendanceExceptions.reason,
      createdAt: attendanceExceptions.createdAt,
      staffName: staff.fullName,
    })
    .from(attendanceExceptions)
    .leftJoin(staff, eq(staff.id, attendanceExceptions.staffId))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(attendanceExceptions.date))
  return c.json({ success: true, data: rows })
})

/** POST /attendance/exceptions — body: { staffId, date, type, reason? } */
app.post('/attendance-exceptions', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.UPDATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const body = await c.req.json()
    if (!body.staffId || !body.date || !body.type)
      return c.json({ error: 'staffId, date, and type are required' }, 400)
    if (!VALID_EXCEPTION_TYPES.has(body.type))
      return c.json({ error: `type must be one of: ${[...VALID_EXCEPTION_TYPES].join(', ')}` }, 400)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date))
      return c.json({ error: 'date must be YYYY-MM-DD' }, 400)
    const db = getDb(process.env.DATABASE_URL!)

    // Self-approve guard: a staff member cannot record their own attendance
    // exception (would let anyone with STAFF_PERFORMANCE update silently
    // excuse their own absences). Admins are exempt — they manage HR.
    if (authUser.role !== 'admin' && authUser.roleId !== 'admin') {
      const ownStaff = await db.query.staff.findFirst({
        where: eq(staff.userId, authUser.id),
        columns: { id: true },
      })
      if (ownStaff?.id && ownStaff.id === body.staffId) {
        return c.json({ error: 'You cannot record an attendance exception for yourself.' }, 403)
      }
    }

    const [row] = await db
      .insert(attendanceExceptions)
      .values({
        staffId: body.staffId,
        date: body.date,
        type: body.type,
        reason: body.reason ?? null,
        createdById: authUser.id,
      })
      .onConflictDoUpdate({
        target: [
          attendanceExceptions.staffId,
          attendanceExceptions.date,
          attendanceExceptions.type,
        ],
        set: { reason: body.reason ?? null, createdById: authUser.id },
      })
      .returning()
    await createAuditLog(db, {
      userId: authUser.id,
      action: 'attendance_exception_upsert',
      module: 'staff',
      entityId: body.staffId,
      changes: { date: body.date, type: body.type, reason: body.reason ?? null },
    })
    return c.json({ success: true, data: row })
  } catch (err: unknown) {
    logError(err, { context: '[attendance-exceptions POST]' })
    return c.json({ error: 'Failed to save exception' }, 500)
  }
})

/**
 * POST /attendance-exceptions/range — bulk-exclude a date span for one staff.
 * body: { staffId, from, to, type, reason? } (from/to inclusive, YYYY-MM-DD).
 * Inserts one exception per day in the range; used by HR to remove dates that
 * should not have attendance records (e.g. pre-hire days, extended leave).
 */
app.post('/attendance-exceptions/range', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.UPDATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const body = await c.req.json()
    if (!body.staffId || !body.from || !body.to || !body.type)
      return c.json({ error: 'staffId, from, to, and type are required' }, 400)
    if (!VALID_EXCEPTION_TYPES.has(body.type))
      return c.json({ error: `type must be one of: ${[...VALID_EXCEPTION_TYPES].join(', ')}` }, 400)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.from) || !/^\d{4}-\d{2}-\d{2}$/.test(body.to))
      return c.json({ error: 'from and to must be YYYY-MM-DD' }, 400)

    const start = new Date(`${body.from}T00:00:00Z`)
    const end = new Date(`${body.to}T00:00:00Z`)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
      return c.json({ error: 'Invalid from/to date' }, 400)
    if (end < start) return c.json({ error: 'to must be on or after from' }, 400)
    const spanDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
    if (spanDays > 366) return c.json({ error: 'Range cannot exceed 366 days' }, 400)

    const db = getDb(process.env.DATABASE_URL!)

    // Self-approve guard, mirroring the single-date POST: a non-admin cannot
    // record attendance exceptions for their own staff row.
    if (authUser.role !== 'admin' && authUser.roleId !== 'admin') {
      const ownStaff = await db.query.staff.findFirst({
        where: eq(staff.userId, authUser.id),
        columns: { id: true },
      })
      if (ownStaff?.id && ownStaff.id === body.staffId) {
        return c.json({ error: 'You cannot record an attendance exception for yourself.' }, 403)
      }
    }

    const values: Array<{
      staffId: string
      date: string
      type: string
      reason: string | null
      createdById: string
    }> = []
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      values.push({
        staffId: body.staffId,
        date: formatYMD(d),
        type: body.type,
        reason: body.reason ?? null,
        createdById: authUser.id,
      })
    }

    const inserted = await db
      .insert(attendanceExceptions)
      .values(values)
      .onConflictDoUpdate({
        target: [
          attendanceExceptions.staffId,
          attendanceExceptions.date,
          attendanceExceptions.type,
        ],
        set: { reason: body.reason ?? null, createdById: authUser.id },
      })
      .returning({ id: attendanceExceptions.id })

    await createAuditLog(db, {
      userId: authUser.id,
      action: 'attendance_exception_range_upsert',
      module: 'staff',
      entityId: body.staffId,
      changes: { from: body.from, to: body.to, type: body.type, days: values.length },
    })
    return c.json({ success: true, count: inserted.length })
  } catch (err: unknown) {
    logError(err, { context: '[attendance-exceptions/range POST]' })
    return c.json({ error: 'Failed to save exception range' }, 500)
  }
})

/** DELETE /attendance-exceptions/:id */
app.delete('/attendance-exceptions/:id{[0-9a-fA-F-]{36}}', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.UPDATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  await db.delete(attendanceExceptions).where(eq(attendanceExceptions.id, id))
  await createAuditLog(db, {
    userId: authUser.id,
    action: 'attendance_exception_delete',
    module: 'staff',
    entityId: id,
  })
  return c.json({ success: true })
})

// ─── Annual leave (PR-21) ───────────────────────────────────────────────────

/** GET /leave-balance/:staffId?year=YYYY — annual leave entitlement + usage. */
app.get('/leave-balance/:staffId{[0-9a-fA-F-]{36}}', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, authUser.id, MODULES.STAFF as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const staffId = c.req.param('staffId')
  const yearStr = c.req.query('year')
  const parsedYear = yearStr ? Number(yearStr) : Number.NaN
  const year =
    Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100
      ? parsedYear
      : new Date().getUTCFullYear()

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const balance = await computeLeaveBalance(db, staffId, year)
    return c.json({ success: true, data: balance })
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'Staff not found')
      return c.json({ error: 'Staff not found' }, 404)
    logError(err, { context: '[leave-balance]' })
    return c.json({ error: 'Failed to compute leave balance' }, 500)
  }
})

/** POST /leave-requests — HR-side submit on behalf of any staff. */
app.post('/leave-requests', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_REQUESTS as string,
      ACTIONS.CREATE as string
    ))
  )
    return c.json({ error: 'Unauthorized' }, 403)

  const body = (await c.req.json().catch(() => ({}))) as {
    staffId?: unknown
    requestType?: unknown
    subType?: unknown
    startDate?: unknown
    endDate?: unknown
    reason?: unknown
    description?: unknown
    amount?: unknown
    urgencyLevel?: unknown
  }
  const targetStaffId = typeof body.staffId === 'string' ? body.staffId : ''
  if (!targetStaffId) return c.json({ error: 'staffId required' }, 400)

  const validTypes = new Set(['leave', 'permit', 'emergency', 'official_support'])
  const requestType =
    typeof body.requestType === 'string' && validTypes.has(body.requestType)
      ? body.requestType
      : 'leave'
  // Dates are required for leave/permit (a date window); emergency / official
  // support are point requests that don't need a range.
  const needsDates = requestType === 'leave' || requestType === 'permit'
  const startDateStr = typeof body.startDate === 'string' ? body.startDate : ''
  const endDateStr = typeof body.endDate === 'string' ? body.endDate : ''
  if (needsDates && (!startDateStr || !endDateStr)) {
    return c.json({ error: 'startDate and endDate required for leave/permit' }, 400)
  }
  const startDate = startDateStr ? new Date(startDateStr) : null
  const endDate = endDateStr ? new Date(endDateStr) : null
  if (startDate && Number.isNaN(startDate.getTime()))
    return c.json({ error: 'startDate must be a valid date' }, 400)
  if (endDate && Number.isNaN(endDate.getTime()))
    return c.json({ error: 'endDate must be a valid date' }, 400)
  if (startDate && endDate && endDate < startDate) {
    return c.json({ error: 'endDate must be on or after startDate' }, 400)
  }

  const validUrgency = new Set(['low', 'normal', 'high', 'urgent'])
  const urgencyLevel =
    typeof body.urgencyLevel === 'string' && validUrgency.has(body.urgencyLevel)
      ? body.urgencyLevel
      : 'normal'
  const amount =
    requestType === 'emergency' && body.amount != null && Number.isFinite(Number(body.amount))
      ? Number(body.amount)
      : null

  const db = getDb(process.env.DATABASE_URL!)
  const [staffRow] = await db
    .select({ id: staff.id, fullName: staff.fullName })
    .from(staff)
    .where(eq(staff.id, targetStaffId))
    .limit(1)
  if (!staffRow) return c.json({ error: 'Staff not found' }, 404)

  const [created] = await db
    .insert(staffRequests)
    .values({
      staffId: targetStaffId,
      requestType,
      subType:
        typeof body.subType === 'string' && body.subType
          ? body.subType
          : requestType === 'leave'
            ? 'annual_leave'
            : null,
      reason: typeof body.reason === 'string' ? body.reason : null,
      description: typeof body.description === 'string' ? body.description : null,
      startDate,
      endDate,
      amount,
      urgencyLevel,
      attachments: [],
    })
    .returning()

  await createAuditLog(db, {
    userId: authUser.id,
    action: 'leave_request_created_by_hr',
    module: 'staff_requests',
    entityId: created.id,
    entityName: `Leave for ${staffRow.fullName}`,
  })

  return c.json({ success: true, data: created })
})

// ── Anviz Attendance Webhook ──────────────────────────────────────────────────

app.post('/attendance/webhook', async (c) => {
  // HR-M5: throttle before doing any work so the static-password gate can't be
  // brute-forced at full speed.
  const rl = anvizWebhookLimiter.check('anviz-webhook')
  if (!rl.allowed) {
    return c.json({ error: 'Too many requests' }, 429, { 'Retry-After': String(rl.retryAfterSec) })
  }

  // HR-C4: accept the shared secret from headers first, then the `?password=`
  // query parameter as a fallback for devices that cannot set custom headers.
  // Note: query strings may leak into access logs / proxies, so prefer headers
  // (`authorize-sign`, `X-Anviz-Password`, or `Authorization: Bearer`) when the
  // device supports them.
  const reqPassword =
    c.req.header('authorize-sign') ||
    c.req.header('X-Anviz-Password') ||
    c.req.header('Authorization')?.replace('Bearer ', '') ||
    c.req.query('password') ||
    ''

  const internalSecret = c.req.header('X-Internal-Secret')
  const isInternalTest = internalSecret && internalSecret === process.env.BETTER_AUTH_SECRET

  let expectedPassword = ''
  if (isInternalTest) {
    expectedPassword = c.req.header('X-Expected-Webhook-Password') || ''
  } else {
    const cfg = await getAnvizConfig()
    expectedPassword = cfg?.webhookPassword || ''
  }

  // HR-C4: never log the secret or the raw headers (they carried the credential
  // to the log aggregator). Compare in constant time to close the timing oracle.
  if (!expectedPassword || !timingSafeEqual(reqPassword, expectedPassword)) {
    logError(new Error('Anviz webhook password validation failed'), {
      route: 'staff/attendance/webhook',
    })
    return c.json({ error: 'Unauthorized' }, 401)
  }

  try {
    const body = (await c.req.json().catch(() => ({}))) as {
      records?: Array<{
        uuid: string
        check_time: string
        check_type: string
        employee?: {
          workno?: string
          first_name?: string
          last_name?: string
        }
        device?: {
          serial_number?: string
          name?: string
        }
      }>
    }

    const records = Array.isArray(body?.records) ? body.records : []
    // HR-M5: cap the batch so one authenticated call can't loop unbounded.
    if (records.length > ANVIZ_WEBHOOK_MAX_RECORDS) {
      return c.json({ error: `Too many records (max ${ANVIZ_WEBHOOK_MAX_RECORDS} per batch)` }, 413)
    }
    const db = getDb(process.env.DATABASE_URL!)

    // HR-M5: resolve every device user in ONE query instead of a findFirst per
    // record (the previous N round-trips were an amplification vector).
    const distinctDeviceIds = Array.from(
      new Set(records.map((r) => r?.employee?.workno).filter((v): v is string => !!v))
    )
    const staffByDevice = new Map<string, string>()
    if (distinctDeviceIds.length > 0) {
      const staffRows = await db
        .select({ id: staff.id, deviceUserId: staff.deviceUserId })
        .from(staff)
        .where(and(inArray(staff.deviceUserId, distinctDeviceIds), isNull(staff.deletedAt)))
      for (const s of staffRows) {
        if (s.deviceUserId) staffByDevice.set(s.deviceUserId, s.id)
      }
    }

    const results = []
    const unmappedDeviceIds = new Set<string>()

    for (const record of records) {
      const deviceUserId = record?.employee?.workno
      const checkTime = record?.check_time
      const checkType = record?.check_type
      const serialNumber = record?.device?.serial_number
      const _deviceName = record?.device?.name

      if (!deviceUserId || !checkTime) continue

      // 1. Resolve staffId from the batch-loaded map.
      const resolvedStaffId = staffByDevice.get(deviceUserId) ?? null
      if (!resolvedStaffId) unmappedDeviceIds.add(deviceUserId)

      // 2. Insert swipe event, ignoring duplicates.
      // HR-H10: normalize the device timestamp the SAME way the CSV path does.
      // parseDeviceTimestamp anchors naive "YYYY-MM-DD HH:MM:SS" strings to UTC
      // (matching the UTC-based scorer and the CSV ingestion), so the stored
      // instant — and the dedup tuple — agree across both paths. Fall back to
      // Date() for ISO-8601 strings that already carry an explicit offset.
      const eventTimestamp = parseDeviceTimestamp(checkTime) ?? new Date(checkTime)
      const [inserted] = await db
        .insert(attendanceEvents)
        .values({
          staffId: resolvedStaffId,
          deviceUserId,
          deviceUserName:
            record?.employee?.first_name || record?.employee?.last_name
              ? `${record.employee.first_name || ''} ${record.employee.last_name || ''}`.trim()
              : null,
          eventTimestamp,
          deviceNo: serialNumber ?? null,
          rawStatus: checkType ?? null,
          sourceFile: 'anviz_webhook',
        })
        .onConflictDoNothing({
          target: [
            attendanceEvents.deviceUserId,
            attendanceEvents.eventTimestamp,
            attendanceEvents.deviceNo,
            attendanceEvents.rawStatus,
          ],
        })
        .returning({ id: attendanceEvents.id })

      results.push({
        uuid: record.uuid,
        success: true,
        resolvedStaff: !!resolvedStaffId,
        inserted: !!inserted,
      })
    }

    // HR-M3: the webhook is unauthenticated (no user), so we can't write an
    // audit_logs row (userId is a NOT-NULL FK). Surface unmapped device users —
    // a spoofed/misconfigured device, or a real staffer whose deviceUserId
    // mapping is wrong (their punches would silently never score) — via the
    // structured logger so operators get a signal instead of a silent success.
    const insertedCount = results.filter((r) => r.inserted).length
    if (unmappedDeviceIds.size > 0) {
      logWarn('Anviz webhook: punches for unmapped device users', {
        unmappedCount: unmappedDeviceIds.size,
        unmappedDeviceIds: Array.from(unmappedDeviceIds),
        received: results.length,
        inserted: insertedCount,
      })
    } else {
      logInfo('Anviz webhook ingest', { received: results.length, inserted: insertedCount })
    }
    return c.json({
      code: '200',
      msg: 'success',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

// ── GET Raw Attendance Events ──────────────────────────────────────────────

app.get('/attendance/raw-events', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.READ as string
    ))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const events = await db
      .select({
        id: attendanceEvents.id,
        staffId: attendanceEvents.staffId,
        staffName: staff.fullName,
        deviceUserId: attendanceEvents.deviceUserId,
        deviceUserName: attendanceEvents.deviceUserName,
        eventTimestamp: attendanceEvents.eventTimestamp,
        // Effective clock time actually used for scoring — ingested time for
        // webhook punches (device clock drifts on reset), device time for CSV.
        effectiveTimestamp: effectiveEventTsSql,
        deviceNo: attendanceEvents.deviceNo,
        rawStatus: attendanceEvents.rawStatus,
        sourceFile: attendanceEvents.sourceFile,
        createdAt: attendanceEvents.createdAt,
      })
      .from(attendanceEvents)
      .leftJoin(staff, eq(staff.id, attendanceEvents.staffId))
      .orderBy(desc(effectiveEventTsSql))
      .limit(200)

    return c.json({ success: true, data: events })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

// ── Submissions (HR Views & Approvals) ──────────────────────────────────────

app.get('/attendance/submissions', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.READ as string
    ))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const submissions = await db
      .select({
        id: staffAttendanceSubmissions.id,
        staffId: staffAttendanceSubmissions.staffId,
        staffName: staff.fullName,
        date: staffAttendanceSubmissions.date,
        punchType: staffAttendanceSubmissions.punchType,
        time: staffAttendanceSubmissions.time,
        reason: staffAttendanceSubmissions.reason,
        status: staffAttendanceSubmissions.status,
        createdAt: staffAttendanceSubmissions.createdAt,
      })
      .from(staffAttendanceSubmissions)
      .leftJoin(staff, eq(staff.id, staffAttendanceSubmissions.staffId))
      .orderBy(desc(staffAttendanceSubmissions.createdAt))

    return c.json({ success: true, data: submissions })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

app.post('/attendance/submissions/:id/approve', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.UPDATE as string
    ))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const id = c.req.param('id')

    const [sub] = await db
      .update(staffAttendanceSubmissions)
      .set({ status: 'approved', reviewedById: authUser.id, reviewedAt: new Date() })
      .where(eq(staffAttendanceSubmissions.id, id))
      .returning()

    if (sub) {
      // Create or update time override
      const existing = await db.query.attendanceTimeOverrides.findFirst({
        where: and(
          eq(attendanceTimeOverrides.staffId, sub.staffId),
          eq(attendanceTimeOverrides.date, sub.date)
        ),
      })

      if (existing) {
        await db
          .update(attendanceTimeOverrides)
          .set({
            ...(sub.punchType === 'clock_in' ? { clockIn: sub.time } : { clockOut: sub.time }),
          })
          .where(eq(attendanceTimeOverrides.id, existing.id))
      } else {
        await db.insert(attendanceTimeOverrides).values({
          staffId: sub.staffId,
          date: sub.date,
          createdById: authUser.id,
          ...(sub.punchType === 'clock_in' ? { clockIn: sub.time } : { clockOut: sub.time }),
        })
      }
    }

    return c.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

app.post('/attendance/submissions/:id/reject', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_PERFORMANCE as string,
      ACTIONS.UPDATE as string
    ))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const id = c.req.param('id')

    await db
      .update(staffAttendanceSubmissions)
      .set({ status: 'rejected', reviewedById: authUser.id, reviewedAt: new Date() })
      .where(eq(staffAttendanceSubmissions.id, id))

    return c.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

export { app as staffAttendanceApp }
