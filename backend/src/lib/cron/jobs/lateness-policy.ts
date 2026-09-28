/**
 * Weekly lateness policy (Phase I).
 *
 * Runs Monday morning for the PRIOR week (Mon–Sun). For each attendance-tracked
 * active staff, counts late days in that week (respecting holidays/off-days/
 * excuses via the same scoring lib). If the count reaches the configured
 * threshold, issues the next CUMULATIVE query level for that staff:
 *   1 → SMS warning
 *   2 → SMS + an HR admin task to file a written warning
 *   3+ → SMS requiring a management meeting (capped at 3)
 * Idempotent per (staff, week) via the unique constraint.
 */

import { and, eq, gte, inArray, isNull, lt } from 'drizzle-orm'
import { env } from '../../../config/env'
import { getDb } from '../../../db'
import {
  attendanceEvents,
  attendanceExceptions,
  clinicHolidays,
  staff,
  staffLatenessQueries,
  staffOffDays,
  taskAssignments,
  tasks,
  user,
} from '../../../db/schema'
import {
  dailySummaries,
  type AttendanceEvent as LibAttendanceEvent,
  type AttendanceException as LibAttendanceException,
} from '../../attendance'
import { getAttendanceConfig } from '../../attendance-config'
import { effectiveEventTsSql, toLibEvent } from '../../attendance-events'
import { fetchOverridesByStaff } from '../../attendance-overrides'
import { logError } from '../../logger'
import { sendSMS } from '../../sms'
import { renderSms, resolveSmsTemplate } from '../../sms-templates'
import type { JobContext, JobRunResult } from '../types'

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function monthsBetween(startYmd: string, endYmd: string): string[] {
  const out = new Set<string>()
  out.add(startYmd.slice(0, 7))
  out.add(endYmd.slice(0, 7))
  return [...out]
}

// Resolves the per-level lateness SMS from the central store (keys
// `lateness:query_1|2|final`), falling back to the canonical text. Tokens
// {lateCount} and {weekLabel} are substituted at send time.
async function messageForLevel(
  db: ReturnType<typeof getDb>,
  level: number,
  lateCount: number,
  weekLabel: string
): Promise<string> {
  const key =
    level <= 1 ? 'lateness:query_1' : level === 2 ? 'lateness:query_2' : 'lateness:query_final'
  const fallback =
    level <= 1
      ? 'Lateness warning (1st): you were late {lateCount} times the week of {weekLabel}. This is your first warning — please improve your punctuality.'
      : level === 2
        ? 'Lateness query (2nd): you were late {lateCount} times the week of {weekLabel}. A written warning will be issued by HR. Continued lateness leads to a meeting with management.'
        : 'Lateness query (final): you were late {lateCount} times the week of {weekLabel}. You are required to attend a meeting with management.'
  const template = await resolveSmsTemplate(db, key, fallback)
  return renderSms(template, { lateCount, weekLabel })
}

export async function runLatenessPolicy(ctx: JobContext): Promise<JobRunResult> {
  const db = getDb(env.DATABASE_URL)
  const config = await getAttendanceConfig(db)
  if (!config.latenessPolicyEnabled) return { summary: 'lateness policy disabled' }

  // Prior week: Monday..Sunday (UTC), relative to the run date.
  const fired = new Date(ctx.firedAt)
  fired.setUTCHours(0, 0, 0, 0)
  const daysFromMon = (fired.getUTCDay() + 6) % 7
  const thisMonday = new Date(fired)
  thisMonday.setUTCDate(thisMonday.getUTCDate() - daysFromMon)
  const weekStart = new Date(thisMonday)
  weekStart.setUTCDate(weekStart.getUTCDate() - 7)
  const weekEnd = new Date(weekStart)
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)
  const weekStartYmd = ymd(weekStart)
  const weekEndYmd = ymd(weekEnd)
  // Event range covers the calendar months the week touches.
  const months = monthsBetween(weekStartYmd, weekEndYmd)
  const rangeStart = new Date(`${months[0]}-01T00:00:00.000Z`)
  const lastMonth = months[months.length - 1].split('-').map(Number)
  const rangeEndExclusive = new Date(Date.UTC(lastMonth[0], lastMonth[1], 1))

  // Tracked, active, non-deleted staff with a phone to notify.
  const staffRows = await db
    .select({ id: staff.id, fullName: staff.fullName, phone: staff.phone, userId: staff.userId })
    .from(staff)
    .where(
      and(eq(staff.status, 'active'), eq(staff.tracksAttendance, true), isNull(staff.deletedAt))
    )
  if (staffRows.length === 0) return { summary: 'no tracked staff' }

  const staffIds = staffRows.map((s) => s.id)

  // Bulk-fetch the inputs for the week's month range, then group by staff.
  const [events, exceptions, offDayRows, holidayRows] = await Promise.all([
    db
      .select({
        staffId: attendanceEvents.staffId,
        deviceUserId: attendanceEvents.deviceUserId,
        deviceUserName: attendanceEvents.deviceUserName,
        eventTimestamp: attendanceEvents.eventTimestamp,
        createdAt: attendanceEvents.createdAt,
        sourceFile: attendanceEvents.sourceFile,
      })
      .from(attendanceEvents)
      .where(
        and(
          inArray(attendanceEvents.staffId, staffIds),
          gte(effectiveEventTsSql, rangeStart),
          lt(effectiveEventTsSql, rangeEndExclusive)
        )
      ),
    db
      .select()
      .from(attendanceExceptions)
      .where(
        and(
          inArray(attendanceExceptions.staffId, staffIds),
          gte(attendanceExceptions.date, weekStartYmd),
          lt(attendanceExceptions.date, ymd(rangeEndExclusive))
        )
      ),
    db
      .select({ staffId: staffOffDays.staffId, dayOfWeek: staffOffDays.dayOfWeek })
      .from(staffOffDays)
      .where(inArray(staffOffDays.staffId, staffIds)),
    db
      .select({ date: clinicHolidays.date, name: clinicHolidays.name, type: clinicHolidays.type })
      .from(clinicHolidays)
      .where(
        and(gte(clinicHolidays.date, weekStartYmd), lt(clinicHolidays.date, ymd(rangeEndExclusive)))
      ),
  ])

  const holidays = holidayRows.map((h) => ({
    date: h.date,
    name: h.name,
    type: h.type as 'full' | 'half',
  }))
  const byStaff = <T extends { staffId: string | null }>(rows: T[]) => {
    const m = new Map<string, T[]>()
    for (const r of rows) {
      if (!r.staffId) continue
      const list = m.get(r.staffId) ?? []
      list.push(r)
      m.set(r.staffId, list)
    }
    return m
  }
  const eventsByStaff = byStaff(events)
  const exceptionsByStaff = byStaff(exceptions)
  const offDaysByStaff = new Map<string, number[]>()
  for (const r of offDayRows) {
    const list = offDaysByStaff.get(r.staffId) ?? []
    list.push(r.dayOfWeek)
    offDaysByStaff.set(r.staffId, list)
  }

  // HR clock-time corrections outrank the raw device punch. Without these the
  // cron counts a corrected clock-in as late and issues a lateness query for a
  // day HR has already fixed.
  const overridesByStaff = await fetchOverridesByStaff(
    db,
    staffRows.map((s) => s.id),
    weekStartYmd,
    ymd(new Date(weekEnd.getTime() + 24 * 60 * 60 * 1000))
  )

  // Resolve the admin users once (for the level-2 written-note task).
  const admins = await db
    .select({ id: user.id })
    .from(user)
    .where(inArray(user.roleId, ['admin', 'hr_admin']))
  const adminIds = admins.map((a) => a.id)

  let flagged = 0
  for (const s of staffRows) {
    const sEvents = (eventsByStaff.get(s.id) ?? []).map<LibAttendanceEvent>(toLibEvent)
    const sExceptions = (exceptionsByStaff.get(s.id) ?? []).map<LibAttendanceException>((e) => ({
      staffId: e.staffId,
      date: e.date,
      type: e.type as LibAttendanceException['type'],
      reason: e.reason,
    }))
    const sOffDays = offDaysByStaff.get(s.id) ?? []

    let lateCount = 0
    for (const month of months) {
      const daily = dailySummaries({
        month,
        events: sEvents,
        exceptions: sExceptions,
        offDays: sOffDays,
        holidays,
        config,
        overrides: overridesByStaff.get(s.id) ?? [],
      })
      for (const rec of daily) {
        if (rec.date >= weekStartYmd && rec.date <= weekEndYmd && rec.status === 'late') lateCount++
      }
    }

    if (lateCount < config.lateFlagsPerWeek) continue

    // Determine the next cumulative level from prior queries (capped at 3).
    const prior = await db
      .select({ id: staffLatenessQueries.id })
      .from(staffLatenessQueries)
      .where(eq(staffLatenessQueries.staffId, s.id))
    const level = Math.min(prior.length + 1, 3)

    // Idempotent: skip if this staff was already flagged for this week.
    const [inserted] = await db
      .insert(staffLatenessQueries)
      .values({ staffId: s.id, weekStart: weekStartYmd, level, lateCount })
      .onConflictDoNothing()
      .returning({ id: staffLatenessQueries.id })
    if (!inserted) continue // already flagged this week
    flagged++

    // Send the alert and stamp the outcome back onto the query row so the HR
    // Lateness Log shows whether the staff was actually told. A send failure
    // never rolls back the escalation — the query stands, flagged unsent.
    if (s.phone) {
      const message = await messageForLevel(db, level, lateCount, weekStartYmd)
      let smsStatus = 'sent'
      let smsError: string | null = null
      try {
        const res = await sendSMS([{ phone: s.phone, message }], undefined, 'attendance')
        if (!res.success) {
          smsStatus = 'failed'
          smsError = res.error ?? 'SMS provider rejected the message'
        }
      } catch (err) {
        smsStatus = 'failed'
        smsError = err instanceof Error ? err.message : 'SMS failed'
        logError(err, { context: '[lateness-policy] sms', staffId: s.id })
      }
      await db
        .update(staffLatenessQueries)
        .set({
          smsStatus,
          smsSentAt: new Date(),
          smsRecipient: s.phone,
          smsMessage: message,
          smsError,
        })
        .where(eq(staffLatenessQueries.id, inserted.id))
    } else {
      await db
        .update(staffLatenessQueries)
        .set({ smsStatus: 'no_phone', smsError: 'No phone number on the staff record' })
        .where(eq(staffLatenessQueries.id, inserted.id))
    }

    // Level 2 → create an HR admin task to file the written warning.
    if (level === 2 && adminIds.length > 0) {
      try {
        const [task] = await db
          .insert(tasks)
          .values({
            title: `Issue written lateness warning to ${s.fullName}`,
            description: `${s.fullName} was late ${lateCount} times the week of ${weekStartYmd} (2nd lateness query). File a written warning.`,
            priority: 'high',
            createdByUserId: adminIds[0],
          })
          .returning({ id: tasks.id })
        await db
          .insert(taskAssignments)
          .values(adminIds.map((uid) => ({ taskId: task.id, userId: uid })))
      } catch (err) {
        logError(err, { context: '[lateness-policy] task', staffId: s.id })
      }
    }
  }

  ctx.log(`lateness policy: flagged ${flagged} staff for week ${weekStartYmd}`)
  return {
    summary: `flagged ${flagged} staff for the week of ${weekStartYmd}`,
    details: { flagged, weekStart: weekStartYmd },
  }
}
