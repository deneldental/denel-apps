/**
 * HR clock-time overrides — shared fetch helper.
 *
 * `attendance_time_overrides` (migration 0182) is the top tier of attendance
 * time resolution:
 *
 *   1. HR override for the day        ← this table
 *   2. Effective device punch          (see `attendance-events.ts`)
 *   3. No clock time → absent
 *
 * `dailySummaries()` already honours tier 1 when it is handed `overrides`, but
 * every caller must actually FETCH them. Callers that forget silently score
 * staff against uncorrected device punches — which is how the lateness cron and
 * the performance scorer ended up issuing warnings for clock-ins HR had already
 * corrected.
 *
 * This lives in `lib/` rather than in a route module so cron jobs and route
 * handlers can share it without a route importing a job or vice versa.
 */

import { and, gte, inArray, lt } from 'drizzle-orm'
import type { getDb } from '../db'
import { attendanceTimeOverrides } from '../db/schema'

export type AttendanceOverride = {
  date: string
  clockIn: string | null
  clockOut: string | null
}

/**
 * Fetch overrides for the given staff over `[fromYmd, toExclusiveYmd)`,
 * grouped by staff id. Returns an empty map for an empty staff list.
 */
export async function fetchOverridesByStaff(
  db: ReturnType<typeof getDb>,
  staffIds: string[],
  fromYmd: string,
  toExclusiveYmd: string
): Promise<Map<string, AttendanceOverride[]>> {
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

  const out = new Map<string, AttendanceOverride[]>()
  for (const r of rows) {
    const list = out.get(r.staffId)
    const entry = { date: r.date, clockIn: r.clockIn, clockOut: r.clockOut }
    if (list) list.push(entry)
    else out.set(r.staffId, [entry])
  }
  return out
}
