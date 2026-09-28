import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import {
  appointments,
  doctors,
  patientPerioEntries,
  prescriptions,
  treatmentPlanItems,
  treatmentPlans,
  user,
} from '../db/schema'
import { logAnalyticsAccess } from '../lib/analytics-audit'
import { parsePeriod } from '../lib/analytics-period'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const analyticsClinicalExtendedApp = new Hono<HonoEnv>()

/**
 * Phase 2D — clinical deepening. Returns procedure completion rate by doctor,
 * perio score average over time, prescription volume trend, and medical-record
 * completeness proxy (completed appointments with at least one treatment plan
 * item linked).
 */

analyticsClinicalExtendedApp.get('/clinical-extended', async (c) => {
  const u = await getCurrentUser(c)
  if (!u) return c.json({ error: 'Not authenticated' }, 401)

  const allowed = await checkPermission(c, u.id, MODULES.MEDICAL_RECORDS, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  await logAnalyticsAccess(c, 'clinical-extended', '')

  const db = getDb(process.env.DATABASE_URL!)
  const period = parsePeriod(c)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)
  const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1)
  const windowStart = period?.from ?? twelveMonthsAgo
  const windowEnd = period?.to ?? startOfTomorrow

  try {
    const [
      procedureByDoctorRows,
      perioMonthlyRows,
      prescriptionMonthlyRows,
      prescriptionTopRows,
      appointmentCompletenessRow,
    ] = await Promise.all([
      // Procedure completion by doctor — items linked via appointment.doctorId.
      // We use the appointment's doctor as the proxy for who'll do the procedure.
      db
        .select({
          doctorUserId: user.id,
          doctorName: user.name,
          totalItems: sql<number>`COUNT(${treatmentPlanItems.id})::int`,
          completed: sql<number>`COUNT(${treatmentPlanItems.id}) FILTER (WHERE ${treatmentPlanItems.status} = 'completed')::int`,
          totalEstimated: sql<number>`COALESCE(SUM(${treatmentPlanItems.estimatedCost}), 0)::float`,
        })
        .from(treatmentPlanItems)
        .innerJoin(treatmentPlans, eq(treatmentPlanItems.planId, treatmentPlans.id))
        .leftJoin(user, eq(treatmentPlans.createdById, user.id))
        .where(
          and(
            gte(treatmentPlanItems.createdAt, windowStart),
            sql`${treatmentPlanItems.createdAt} < ${windowEnd}`,
            isNotNull(user.id)
          )
        )
        .groupBy(user.id, user.name)
        .orderBy(desc(sql`COUNT(${treatmentPlanItems.id})`))
        .limit(20),

      // Perio pocket depth average per month
      db
        .select({
          month: sql<string>`TO_CHAR(DATE_TRUNC('month', ${patientPerioEntries.recordedAt}), 'YYYY-MM')`,
          avgDepth: sql<number>`COALESCE(AVG(${patientPerioEntries.pocketDepth}), 0)::float`,
          patientCount: sql<number>`COUNT(DISTINCT ${patientPerioEntries.patientId})::int`,
          measurementCount: sql<number>`COUNT(*)::int`,
        })
        .from(patientPerioEntries)
        .where(
          and(
            gte(patientPerioEntries.recordedAt, windowStart),
            sql`${patientPerioEntries.recordedAt} < ${windowEnd}`
          )
        )
        .groupBy(sql`DATE_TRUNC('month', ${patientPerioEntries.recordedAt})`)
        .orderBy(sql`DATE_TRUNC('month', ${patientPerioEntries.recordedAt})`),

      // Prescription volume by month
      db
        .select({
          month: sql<string>`TO_CHAR(DATE_TRUNC('month', ${prescriptions.createdAt}), 'YYYY-MM')`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(prescriptions)
        .where(
          and(
            gte(prescriptions.createdAt, windowStart),
            sql`${prescriptions.createdAt} < ${windowEnd}`
          )
        )
        .groupBy(sql`DATE_TRUNC('month', ${prescriptions.createdAt})`)
        .orderBy(sql`DATE_TRUNC('month', ${prescriptions.createdAt})`),

      // Top prescribed medications
      db
        .select({
          medication: prescriptions.medication,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(prescriptions)
        .where(
          and(
            gte(prescriptions.createdAt, windowStart),
            sql`${prescriptions.createdAt} < ${windowEnd}`
          )
        )
        .groupBy(prescriptions.medication)
        .orderBy(desc(sql`COUNT(*)`))
        .limit(10),

      // Medical-record completeness proxy: completed appointments that have at
      // least one treatment plan item linked via appointmentId
      db.execute(sql`
        SELECT
          COUNT(*)::int AS completed_appts,
          COUNT(DISTINCT a.id) FILTER (WHERE tpi.id IS NOT NULL)::int AS appts_with_items
        FROM appointments a
        LEFT JOIN ${treatmentPlanItems} tpi ON tpi."appointmentId" = a.id
        WHERE a.status = 'completed'
          AND a.date >= ${windowStart}
          AND a.date < ${windowEnd}
      `),
    ])

    const procedureByDoctor = procedureByDoctorRows.map((r) => ({
      doctorUserId: r.doctorUserId,
      doctorName: r.doctorName,
      totalItems: r.totalItems,
      completed: r.completed,
      totalEstimated: Math.round(r.totalEstimated * 100) / 100,
      completionRatePct:
        r.totalItems > 0 ? Math.round((r.completed / r.totalItems) * 1000) / 10 : 0,
    }))

    const perioMonthly = perioMonthlyRows.map((r) => ({
      month: r.month,
      avgPocketDepth: Math.round(r.avgDepth * 10) / 10,
      patientCount: r.patientCount,
      measurementCount: r.measurementCount,
    }))

    const prescriptionMonthly = prescriptionMonthlyRows.map((r) => ({
      month: r.month,
      count: r.count,
    }))
    const prescriptionTop = prescriptionTopRows.map((r) => ({
      medication: r.medication,
      count: r.count,
    }))

    const completeness = (appointmentCompletenessRow.rows[0] ?? {
      completed_appts: 0,
      appts_with_items: 0,
    }) as { completed_appts: number; appts_with_items: number }
    const completenessRatePct =
      completeness.completed_appts > 0
        ? Math.round((completeness.appts_with_items / completeness.completed_appts) * 1000) / 10
        : 0

    const totalProcedureItems = procedureByDoctor.reduce((s, r) => s + r.totalItems, 0)
    const totalProcedureCompleted = procedureByDoctor.reduce((s, r) => s + r.completed, 0)
    const overallProcedureCompletionPct =
      totalProcedureItems > 0
        ? Math.round((totalProcedureCompleted / totalProcedureItems) * 1000) / 10
        : 0

    // Avg perio across whole window
    const overallAvgPocket =
      perioMonthly.length > 0
        ? Math.round(
            (perioMonthly.reduce((s, m) => s + m.avgPocketDepth * m.measurementCount, 0) /
              Math.max(
                perioMonthly.reduce((s, m) => s + m.measurementCount, 0),
                1
              )) *
              10
          ) / 10
        : 0

    void doctors

    return c.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        tiles: {
          totalProcedureItems,
          totalProcedureCompleted,
          overallProcedureCompletionPct,
          overallAvgPocketDepth: overallAvgPocket,
          prescriptionCount: prescriptionMonthly.reduce((s, m) => s + m.count, 0),
          medicalRecordCompletenessPct: completenessRatePct,
          completedAppts: Number(completeness.completed_appts),
          completedApptsWithRecord: Number(completeness.appts_with_items),
        },
        procedureByDoctor,
        perioMonthly,
        prescriptionMonthly,
        prescriptionTop,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[analytics/clinical-extended]' })
    return c.json({ error: 'Failed to load clinical extended' }, 500)
  }
})

void appointments

export default analyticsClinicalExtendedApp
