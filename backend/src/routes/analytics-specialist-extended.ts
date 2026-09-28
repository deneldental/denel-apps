import { and, eq, gte, isNotNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { appointments, doctors, specialists } from '../db/schema'
import { logAnalyticsAccess } from '../lib/analytics-audit'
import { parsePeriod } from '../lib/analytics-period'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const analyticsSpecialistExtendedApp = new Hono<HonoEnv>()

/**
 * Phase 2D — specialist deepening. Returns sessions per specialist,
 * no-show rate by specialist, and patient retention per specialist
 * (patients with ≥2 appointments in window). Operates on the
 * appointments → doctors → specialists join chain.
 */

analyticsSpecialistExtendedApp.get('/specialist-extended', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const allowed = await checkPermission(c, user.id, MODULES.SPECIALISTS, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  await logAnalyticsAccess(c, 'specialist-extended', '')

  const db = getDb(process.env.DATABASE_URL!)
  const period = parsePeriod(c)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)
  const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1)
  const windowStart = period?.from ?? twelveMonthsAgo
  const windowEnd = period?.to ?? startOfTomorrow

  try {
    const [sessionRows, retentionRows] = await Promise.all([
      // Sessions and outcomes per specialist
      db
        .select({
          specialistId: specialists.id,
          name: specialists.name,
          specialty: specialists.specialty,
          isActive: specialists.isActive,
          totalSessions: sql<number>`COUNT(*)::int`,
          completed: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'completed')::int`,
          noShow: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'no_show')::int`,
          cancelled: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'cancelled')::int`,
        })
        .from(appointments)
        .innerJoin(doctors, eq(appointments.doctorId, doctors.id))
        .innerJoin(specialists, eq(doctors.specialistId, specialists.id))
        .where(
          and(
            gte(appointments.date, windowStart),
            sql`${appointments.date} < ${windowEnd}`,
            isNotNull(doctors.specialistId)
          )
        )
        .groupBy(specialists.id, specialists.name, specialists.specialty, specialists.isActive),

      // Patient retention per specialist — patients with >1 completed appt
      db.execute(sql`
        WITH per_specialist_patient AS (
          SELECT s.id AS specialist_id,
                 a."patientId" AS patient_id,
                 COUNT(*) AS visit_count
          FROM appointments a
          INNER JOIN doctors d ON a."doctorId" = d.id
          INNER JOIN specialists s ON d."specialistId" = s.id
          WHERE a.status = 'completed'
            AND a.date >= ${windowStart}
            AND a.date < ${windowEnd}
            AND d."specialistId" IS NOT NULL
          GROUP BY s.id, a."patientId"
        )
        SELECT specialist_id,
               COUNT(*)::int AS patient_count,
               COUNT(*) FILTER (WHERE visit_count >= 2)::int AS returning_count
        FROM per_specialist_patient
        GROUP BY specialist_id
      `),
    ])

    const retentionMap = new Map<string, { patientCount: number; returningCount: number }>()
    for (const row of retentionRows.rows as Array<{
      specialist_id: string
      patient_count: number
      returning_count: number
    }>) {
      retentionMap.set(row.specialist_id, {
        patientCount: Number(row.patient_count),
        returningCount: Number(row.returning_count),
      })
    }

    const perSpecialist = sessionRows
      .map((r) => {
        const ret = retentionMap.get(r.specialistId) ?? { patientCount: 0, returningCount: 0 }
        const noShowRate =
          r.totalSessions > 0 ? Math.round((r.noShow / r.totalSessions) * 1000) / 10 : 0
        const completionRate =
          r.totalSessions > 0 ? Math.round((r.completed / r.totalSessions) * 1000) / 10 : 0
        const retentionRate =
          ret.patientCount > 0 ? Math.round((ret.returningCount / ret.patientCount) * 1000) / 10 : 0
        return {
          specialistId: r.specialistId,
          name: r.name,
          specialty: r.specialty,
          isActive: r.isActive,
          totalSessions: r.totalSessions,
          completed: r.completed,
          noShow: r.noShow,
          cancelled: r.cancelled,
          completionRatePct: completionRate,
          noShowRatePct: noShowRate,
          patientCount: ret.patientCount,
          returningCount: ret.returningCount,
          retentionRatePct: retentionRate,
        }
      })
      .sort((a, b) => b.totalSessions - a.totalSessions)

    const totalSessions = perSpecialist.reduce((s, r) => s + r.totalSessions, 0)
    const totalNoShow = perSpecialist.reduce((s, r) => s + r.noShow, 0)
    const totalPatients = perSpecialist.reduce((s, r) => s + r.patientCount, 0)
    const totalReturning = perSpecialist.reduce((s, r) => s + r.returningCount, 0)
    const overallNoShowPct =
      totalSessions > 0 ? Math.round((totalNoShow / totalSessions) * 1000) / 10 : 0
    const overallRetentionPct =
      totalPatients > 0 ? Math.round((totalReturning / totalPatients) * 1000) / 10 : 0

    return c.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        tiles: {
          totalSessions,
          totalSpecialists: perSpecialist.length,
          overallNoShowPct,
          overallRetentionPct,
          totalReturningPatients: totalReturning,
        },
        perSpecialist,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[analytics/specialist-extended]' })
    return c.json({ error: 'Failed to load specialist extended' }, 500)
  }
})

export default analyticsSpecialistExtendedApp
