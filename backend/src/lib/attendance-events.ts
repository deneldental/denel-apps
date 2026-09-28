import { sql } from 'drizzle-orm'
import { attendanceEvents } from '../db/schema'
import type { AttendanceEvent as LibAttendanceEvent } from './attendance'

/**
 * Effective clock time for a raw attendance event.
 *
 * Some hardware readers' clocks drift or reset (notably every time the device
 * time resets), so the device-reported `eventTimestamp` can be wrong. For
 * punches delivered live via the Anviz webhook, the server receive time
 * (`createdAt`) is the reliable instant of the punch, so we treat it as the
 * effective clock time — the scorer's AM→clock-in / PM→clock-out bucketing and
 * every status then derive from the ingested time.
 *
 * CSV-imported rows keep their device `eventTimestamp`: a CSV batch is uploaded
 * after the fact, so its `createdAt` is the upload moment, not the punch time.
 * The raw `eventTimestamp` is always retained on the row for audit and remains
 * the ingestion dedup key.
 */
export const WEBHOOK_SOURCE = 'anviz_webhook'

type RawEventTimes = {
  sourceFile: string | null
  eventTimestamp: Date
  createdAt: Date
}

/** Resolve the effective clock time for one row (JS side). */
export function effectiveEventTs(row: RawEventTimes): Date {
  return row.sourceFile === WEBHOOK_SOURCE ? row.createdAt : row.eventTimestamp
}

/**
 * SQL form of {@link effectiveEventTs} — use it in WHERE range filters and
 * ORDER BY so fetched rows agree with how they're later bucketed. Without this,
 * a webhook punch whose device clock reset to a wildly wrong instant would be
 * excluded by an `eventTimestamp` range filter even though its ingested time is
 * in range — i.e. the exact malfunction this override fixes.
 */
// `createdAt` is `timestamp` (no tz) while `eventTimestamp` is `timestamptz`;
// a CASE can't mix the two types, so anchor createdAt as UTC (the whole
// attendance system treats stored clock values as Africa/Accra = UTC+0) to make
// both branches `timestamptz`.
export const effectiveEventTsSql = sql<Date>`CASE WHEN ${attendanceEvents.sourceFile} = ${WEBHOOK_SOURCE} THEN (${attendanceEvents.createdAt} AT TIME ZONE 'UTC') ELSE ${attendanceEvents.eventTimestamp} END`

/** Map a raw `attendance_events` row to the scorer's event shape using the effective clock time. */
export function toLibEvent(
  row: RawEventTimes & {
    staffId: string | null
    deviceUserId: string
    deviceUserName: string | null
  }
): LibAttendanceEvent {
  return {
    staffId: row.staffId,
    deviceUserId: row.deviceUserId,
    deviceUserName: row.deviceUserName,
    eventTimestamp: effectiveEventTs(row),
  }
}
