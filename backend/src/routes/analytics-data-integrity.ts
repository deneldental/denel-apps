import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import {
  appointments,
  auditLogs,
  patients,
  reportsInjectionConfig,
  syncLog,
  syncRules,
} from '../db/schema'
import { logAnalyticsAccess } from '../lib/analytics-audit'
import { parsePeriod } from '../lib/analytics-period'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const analyticsDataIntegrityApp = new Hono<HonoEnv>()

/**
 * Data Integrity analytics — sync health, data-inject volume, completeness
 * scorecards, reports-injection toggle audit trail.
 *
 * Permission: gates on DATA_SYNC since sync state + data inject + sync
 * audit logs are the surface here, not user-action audit logs (which live
 * on /compliance).
 */

analyticsDataIntegrityApp.get('/data-integrity', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const allowed = await checkPermission(c, user.id, MODULES.DATA_SYNC, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  await logAnalyticsAccess(c, 'data-integrity', '')

  const db = getDb(process.env.DATABASE_URL!)
  const period = parsePeriod(c)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)
  const thirtyDaysAgo = new Date(startOfToday.getTime() - 30 * 24 * 60 * 60 * 1000)
  const syncWindowStart = period?.from ?? thirtyDaysAgo
  const syncWindowEnd = period?.to ?? startOfTomorrow

  try {
    const [
      syncByEntityRows,
      syncDailyRows,
      topFailureRows,
      backlogAgeRows,
      syncRulesRows,
      injectConfigRows,
      injectAuditRows,
      patientCompletenessRow,
      appointmentCompletenessRow,
      lateArrivalsRows,
    ] = await Promise.all([
      // Sync success/failure per entity within window
      db
        .select({
          entityType: syncLog.entityType,
          success: sql<number>`COUNT(*) FILTER (WHERE ${syncLog.success} = true)::int`,
          failed: sql<number>`COUNT(*) FILTER (WHERE ${syncLog.success} = false)::int`,
          total: sql<number>`COUNT(*)::int`,
        })
        .from(syncLog)
        .where(
          and(gte(syncLog.syncedAt, syncWindowStart), sql`${syncLog.syncedAt} < ${syncWindowEnd}`)
        )
        .groupBy(syncLog.entityType),

      // Daily success/failure trend
      db
        .select({
          day: sql<string>`DATE(${syncLog.syncedAt})::text`,
          success: sql<number>`COUNT(*) FILTER (WHERE ${syncLog.success} = true)::int`,
          failed: sql<number>`COUNT(*) FILTER (WHERE ${syncLog.success} = false)::int`,
        })
        .from(syncLog)
        .where(
          and(gte(syncLog.syncedAt, syncWindowStart), sql`${syncLog.syncedAt} < ${syncWindowEnd}`)
        )
        .groupBy(sql`DATE(${syncLog.syncedAt})`)
        .orderBy(sql`DATE(${syncLog.syncedAt})`),

      // Top failing entity types with most recent error
      db
        .select({
          entityType: syncLog.entityType,
          errorMessage: syncLog.errorMessage,
          count: sql<number>`COUNT(*)::int`,
          lastFailedAt: sql<Date>`MAX(${syncLog.syncedAt})`,
        })
        .from(syncLog)
        .where(
          and(
            eq(syncLog.success, false),
            gte(syncLog.syncedAt, syncWindowStart),
            sql`${syncLog.syncedAt} < ${syncWindowEnd}`,
            isNotNull(syncLog.errorMessage)
          )
        )
        .groupBy(syncLog.entityType, syncLog.errorMessage)
        .orderBy(desc(sql`COUNT(*)`))
        .limit(15),

      // Backlog age — failed records and how long ago they failed
      db
        .select({
          syncedAt: syncLog.syncedAt,
        })
        .from(syncLog)
        .where(and(eq(syncLog.success, false)))
        .orderBy(desc(syncLog.syncedAt))
        .limit(500),

      // Sync rules: enabled state per entity + cached lastSyncedAt + recordsSynced
      db
        .select({
          entity: syncRules.entity,
          enabled: syncRules.enabled,
          lastSyncedAt: syncRules.lastSyncedAt,
          recordsSynced: syncRules.recordsSynced,
        })
        .from(syncRules),

      // Reports-injection config snapshot
      db
        .select({
          section: reportsInjectionConfig.section,
          enabled: reportsInjectionConfig.enabled,
          updatedAt: reportsInjectionConfig.updatedAt,
        })
        .from(reportsInjectionConfig),

      // Audit trail of data-inject section toggles
      db
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          entityName: auditLogs.entityName,
          changes: auditLogs.changes,
          userId: auditLogs.userId,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.module, MODULES.DATA_INJECT),
            gte(auditLogs.createdAt, syncWindowStart),
            sql`${auditLogs.createdAt} < ${syncWindowEnd}`
          )
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(25),

      // Patient completeness scorecard
      db
        .select({
          total: sql<number>`COUNT(*)::int`,
          missingPhone: sql<number>`COUNT(*) FILTER (WHERE ${patients.phone} IS NULL OR ${patients.phone} = '')::int`,
          missingEmail: sql<number>`COUNT(*) FILTER (WHERE ${patients.email} IS NULL OR ${patients.email} = '')::int`,
          missingDob: sql<number>`COUNT(*) FILTER (WHERE ${patients.dob} IS NULL)::int`,
          missingGender: sql<number>`COUNT(*) FILTER (WHERE ${patients.gender} IS NULL OR ${patients.gender} = '')::int`,
        })
        .from(patients),

      // Appointment completeness scorecard
      db
        .select({
          total: sql<number>`COUNT(*)::int`,
          missingDoctor: sql<number>`COUNT(*) FILTER (WHERE ${appointments.doctorId} IS NULL)::int`,
          completedMissingTimestamps: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'completed' AND ${appointments.completedAt} IS NULL)::int`,
        })
        .from(appointments),

      // Late-arriving records — patients inserted with createdAt > 7 days
      // before their last update (hints at bulk historical import).
      db
        .select({
          day: sql<string>`DATE(${patients.createdAt})::text`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(patients)
        .where(
          and(
            gte(patients.createdAt, syncWindowStart),
            sql`${patients.createdAt} < ${syncWindowEnd}`,
            sql`(${patients.updatedAt} - ${patients.createdAt}) > INTERVAL '7 days'`
          )
        )
        .groupBy(sql`DATE(${patients.createdAt})`)
        .orderBy(sql`DATE(${patients.createdAt})`),
    ])

    // ── Sync per entity ─────────────────────────────────────────────────────
    const syncByEntity = syncByEntityRows
      .map((r) => ({
        entityType: r.entityType,
        success: r.success,
        failed: r.failed,
        total: r.total,
        successRatePct: r.total > 0 ? Math.round((r.success / r.total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.total - a.total)
    const overallSuccess = syncByEntity.reduce((s, r) => s + r.success, 0)
    const overallTotal = syncByEntity.reduce((s, r) => s + r.total, 0)
    const overallSuccessPct =
      overallTotal > 0 ? Math.round((overallSuccess / overallTotal) * 1000) / 10 : 0

    // ── Daily sync trend (zero-filled) ─────────────────────────────────────
    const eachDay = (start: Date, end: Date): string[] => {
      const out: string[] = []
      const cursor = new Date(start)
      while (cursor < end) {
        out.push(cursor.toISOString().slice(0, 10))
        cursor.setDate(cursor.getDate() + 1)
      }
      return out
    }
    const dayMap = new Map<string, { day: string; success: number; failed: number }>()
    for (const day of eachDay(syncWindowStart, syncWindowEnd))
      dayMap.set(day, { day, success: 0, failed: 0 })
    for (const row of syncDailyRows) {
      dayMap.set(row.day, { day: row.day, success: row.success, failed: row.failed })
    }
    const syncTrend = Array.from(dayMap.values())

    // ── Backlog age buckets ─────────────────────────────────────────────────
    const backlogAge = { under1h: 0, under6h: 0, under24h: 0, over24h: 0 }
    for (const row of backlogAgeRows) {
      if (!row.syncedAt) continue
      const ageMs = now.getTime() - new Date(row.syncedAt).getTime()
      if (ageMs < 3_600_000) backlogAge.under1h++
      else if (ageMs < 21_600_000) backlogAge.under6h++
      else if (ageMs < 86_400_000) backlogAge.under24h++
      else backlogAge.over24h++
    }

    // ── Top failure clusters ───────────────────────────────────────────────
    const topFailures = topFailureRows.map((r) => ({
      entityType: r.entityType,
      errorMessage: (r.errorMessage ?? '').slice(0, 200),
      count: r.count,
      lastFailedAt: r.lastFailedAt ? new Date(r.lastFailedAt).toISOString() : null,
    }))

    // ── Sync rules state ────────────────────────────────────────────────────
    const rules = syncRulesRows
      .map((r) => ({
        entity: r.entity,
        enabled: r.enabled,
        lastSyncedAt: r.lastSyncedAt ? new Date(r.lastSyncedAt).toISOString() : null,
        recordsSynced: r.recordsSynced ?? 0,
      }))
      .sort((a, b) => (b.recordsSynced ?? 0) - (a.recordsSynced ?? 0))
    const totalRecordsSynced = rules.reduce((s, r) => s + (r.recordsSynced ?? 0), 0)
    const enabledRulesCount = rules.filter((r) => r.enabled).length

    // ── Reports-injection state ────────────────────────────────────────────
    const injectSections = injectConfigRows.map((r) => ({
      section: r.section,
      enabled: r.enabled,
      updatedAt: r.updatedAt?.toISOString() ?? null,
    }))
    const injectAudit = injectAuditRows.map((r) => ({
      id: r.id,
      action: r.action,
      entityName: r.entityName,
      changes: r.changes,
      userId: r.userId,
      createdAt: r.createdAt?.toISOString() ?? null,
    }))

    // ── Completeness scorecards ─────────────────────────────────────────────
    const pc = patientCompletenessRow[0] ?? {
      total: 0,
      missingPhone: 0,
      missingEmail: 0,
      missingDob: 0,
      missingGender: 0,
    }
    const ac = appointmentCompletenessRow[0] ?? {
      total: 0,
      missingDoctor: 0,
      completedMissingTimestamps: 0,
    }
    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0)
    const completeness = {
      patients: {
        total: pc.total,
        missingPhonePct: pct(pc.missingPhone, pc.total),
        missingEmailPct: pct(pc.missingEmail, pc.total),
        missingDobPct: pct(pc.missingDob, pc.total),
        missingGenderPct: pct(pc.missingGender, pc.total),
      },
      appointments: {
        total: ac.total,
        missingDoctorPct: pct(ac.missingDoctor, ac.total),
        completedMissingTimestampsPct: pct(ac.completedMissingTimestamps, ac.total),
      },
    }

    return c.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        tiles: {
          totalRecordsSynced,
          enabledRulesCount,
          syncSuccessRatePct: overallSuccessPct,
          failures24h: backlogAge.under24h + backlogAge.under6h + backlogAge.under1h,
          staleFailures: backlogAge.over24h,
          activeInjectSections: injectSections.filter((s) => s.enabled).length,
        },
        syncByEntity,
        syncTrend,
        topFailures,
        backlogAge: [
          { label: '< 1 hr', count: backlogAge.under1h },
          { label: '1–6 hrs', count: backlogAge.under6h },
          { label: '6–24 hrs', count: backlogAge.under24h },
          { label: '> 24 hrs', count: backlogAge.over24h },
        ],
        rules,
        injectSections,
        injectAudit,
        completeness,
        lateArrivals: lateArrivalsRows,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[analytics/data-integrity]' })
    return c.json({ error: 'Failed to load data integrity' }, 500)
  }
})

export default analyticsDataIntegrityApp
