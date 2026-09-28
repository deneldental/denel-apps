import { and, asc, eq, gte, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import {
  performanceScores,
  staff,
  staffCredentials,
  staffRequests,
  staffTrainingProgress,
  trainingMaterials,
} from '../db/schema'
import { logAnalyticsAccess } from '../lib/analytics-audit'
import { parsePeriod } from '../lib/analytics-period'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const analyticsWorkforceExtendedApp = new Hono<HonoEnv>()

/**
 * Phase 2C — workforce deepening. Returns:
 *   • Leave balance summary (per staff: annualEntitlement vs days used in period)
 *   • Credential expiry rolling forward (30/60/90 day windows + already-expired)
 *   • Performance review cadence (last review per staff, % overdue)
 *
 * Lives in its own endpoint so the existing /workforce endpoint stays focused
 * on headcount / attendance / payroll / training.
 */

analyticsWorkforceExtendedApp.get('/workforce-extended', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const allowed = await checkPermission(c, user.id, MODULES.STAFF, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  await logAnalyticsAccess(c, 'workforce-extended', '')

  const db = getDb(process.env.DATABASE_URL!)
  const period = parsePeriod(c)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)
  const startOfThisYear = new Date(now.getFullYear(), 0, 1)
  const thirtyDaysOut = new Date(startOfToday.getTime() + 30 * 24 * 60 * 60 * 1000)
  const sixtyDaysOut = new Date(startOfToday.getTime() + 60 * 24 * 60 * 60 * 1000)
  const ninetyDaysOut = new Date(startOfToday.getTime() + 90 * 24 * 60 * 60 * 1000)
  const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1)
  const leaveWindowStart = period?.from ?? startOfThisYear
  const leaveWindowEnd = period?.to ?? startOfTomorrow
  const perfWindowStart = period?.from ?? twelveMonthsAgo
  const perfWindowEnd = period?.to ?? startOfTomorrow

  try {
    const [
      activeStaffRows,
      approvedLeaveRows,
      pendingLeaveRows,
      credentialsRows,
      lastReviewRows,
      trainingExpiryRows,
    ] = await Promise.all([
      // Active staff for leave-balance denominator
      db
        .select({
          id: staff.id,
          fullName: staff.fullName,
          annualLeaveEntitlement: staff.annualLeaveEntitlement,
        })
        .from(staff)
        .where(and(eq(staff.status, 'active'), isNull(staff.deletedAt))),

      // Approved leave requests in window (numerator for leave used)
      db
        .select({
          staffId: staffRequests.staffId,
          startDate: staffRequests.startDate,
          endDate: staffRequests.endDate,
          subType: staffRequests.subType,
        })
        .from(staffRequests)
        .where(
          and(
            eq(staffRequests.requestType, 'leave'),
            eq(staffRequests.status, 'approved'),
            sql`${staffRequests.startDate} IS NOT NULL`,
            gte(staffRequests.startDate, leaveWindowStart),
            sql`${staffRequests.startDate} < ${leaveWindowEnd}`
          )
        ),

      // Pending leave requests (backlog signal)
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(staffRequests)
        .where(and(eq(staffRequests.requestType, 'leave'), eq(staffRequests.status, 'pending'))),

      // Credentials with expiry — rolling forward bands
      db
        .select({
          id: staffCredentials.id,
          staffId: staffCredentials.staffId,
          credentialType: staffCredentials.credentialType,
          credentialName: staffCredentials.credentialName,
          expiryDate: staffCredentials.expiryDate,
          suspendedDueToLapse: staffCredentials.suspendedDueToLapse,
        })
        .from(staffCredentials)
        .where(sql`${staffCredentials.expiryDate} IS NOT NULL`)
        .orderBy(asc(staffCredentials.expiryDate)),

      // Last performance review per staff
      db
        .select({
          staffId: performanceScores.staffId,
          lastEvaluatedAt: sql<Date>`MAX(${performanceScores.evaluatedAt})`,
          recentScore: sql<number>`(ARRAY_AGG(${performanceScores.score} ORDER BY ${performanceScores.evaluatedAt} DESC))[1]`,
        })
        .from(performanceScores)
        .where(
          and(
            gte(performanceScores.evaluatedAt, perfWindowStart),
            sql`${performanceScores.evaluatedAt} < ${perfWindowEnd}`
          )
        )
        .groupBy(performanceScores.staffId),

      // Mandatory training expiry — materials with deadline approaching
      db
        .select({
          id: trainingMaterials.id,
          title: trainingMaterials.title,
          deadline: trainingMaterials.deadline,
          completedCount: sql<number>`COUNT(${staffTrainingProgress.id}) FILTER (WHERE ${staffTrainingProgress.status} = 'completed')::int`,
          assignedCount: sql<number>`COUNT(${staffTrainingProgress.id})::int`,
        })
        .from(trainingMaterials)
        .leftJoin(staffTrainingProgress, eq(trainingMaterials.id, staffTrainingProgress.trainingId))
        .where(
          and(
            eq(trainingMaterials.isMandatory, true),
            sql`${trainingMaterials.deadline} IS NOT NULL`
          )
        )
        .groupBy(trainingMaterials.id, trainingMaterials.title, trainingMaterials.deadline)
        .orderBy(asc(trainingMaterials.deadline)),
    ])

    // ── Leave balance ──────────────────────────────────────────────────────
    const daysByStaff: Record<string, number> = {}
    for (const row of approvedLeaveRows) {
      if (!row.staffId || !row.startDate || !row.endDate) continue
      const start = new Date(row.startDate as unknown as string)
      const end = new Date(row.endDate as unknown as string)
      const days = Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1)
      daysByStaff[row.staffId] = (daysByStaff[row.staffId] ?? 0) + days
    }
    const leaveBalance = activeStaffRows
      .map((s) => {
        const taken = daysByStaff[s.id] ?? 0
        const entitlement = s.annualLeaveEntitlement ?? 0
        const remaining = Math.max(0, entitlement - taken)
        return {
          staffId: s.id,
          fullName: s.fullName,
          entitlement,
          taken,
          remaining,
          utilisationPct: entitlement > 0 ? Math.round((taken / entitlement) * 1000) / 10 : 0,
        }
      })
      .sort((a, b) => b.taken - a.taken)
    const totalEntitlement = leaveBalance.reduce((s, r) => s + r.entitlement, 0)
    const totalTaken = leaveBalance.reduce((s, r) => s + r.taken, 0)
    const overallLeaveUtilPct =
      totalEntitlement > 0 ? Math.round((totalTaken / totalEntitlement) * 1000) / 10 : 0

    // ── Credential expiry rolling forward ──────────────────────────────────
    let credExpired = 0
    let credExpires30 = 0
    let credExpires60 = 0
    let credExpires90 = 0
    let credSuspended = 0
    const credentialsList: Array<{
      id: string
      staffId: string
      credentialType: string | null
      credentialName: string | null
      expiryDate: string
      daysLeft: number
      bucket: 'expired' | '30' | '60' | '90' | 'beyond'
    }> = []
    for (const row of credentialsRows) {
      if (!row.expiryDate) continue
      if (row.suspendedDueToLapse) credSuspended++
      const expiry = new Date(row.expiryDate as unknown as string)
      const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / 86_400_000)
      let bucket: 'expired' | '30' | '60' | '90' | 'beyond' = 'beyond'
      if (expiry < now) {
        credExpired++
        bucket = 'expired'
      } else if (expiry <= thirtyDaysOut) {
        credExpires30++
        bucket = '30'
      } else if (expiry <= sixtyDaysOut) {
        credExpires60++
        bucket = '60'
      } else if (expiry <= ninetyDaysOut) {
        credExpires90++
        bucket = '90'
      }
      credentialsList.push({
        id: row.id,
        staffId: row.staffId,
        credentialType: row.credentialType,
        credentialName: row.credentialName,
        expiryDate: expiry.toISOString(),
        daysLeft,
        bucket,
      })
    }
    const credentialsRollingForward = credentialsList
      .filter((c) => c.bucket !== 'beyond')
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .slice(0, 30)

    // ── Performance review cadence ────────────────────────────────────────
    const reviewedSet = new Set(lastReviewRows.map((r) => r.staffId))
    const staffWithReview = lastReviewRows.length
    const staffMissingReview = activeStaffRows.filter((s) => !reviewedSet.has(s.id)).length
    const overallReviewCoveragePct =
      activeStaffRows.length > 0
        ? Math.round((staffWithReview / activeStaffRows.length) * 1000) / 10
        : 0

    // ── Mandatory training deadlines ──────────────────────────────────────
    const trainingDeadlines = trainingExpiryRows.map((r) => {
      const deadline = r.deadline ? new Date(r.deadline as unknown as string) : null
      const daysLeft = deadline
        ? Math.ceil((deadline.getTime() - now.getTime()) / 86_400_000)
        : null
      const completionPct =
        r.assignedCount > 0 ? Math.round((r.completedCount / r.assignedCount) * 1000) / 10 : 0
      return {
        id: r.id,
        title: r.title,
        deadline: deadline?.toISOString() ?? null,
        daysLeft,
        completedCount: r.completedCount,
        assignedCount: r.assignedCount,
        completionPct,
      }
    })

    return c.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        tiles: {
          totalEntitlementDays: totalEntitlement,
          totalLeaveTaken: totalTaken,
          overallLeaveUtilPct,
          pendingLeaveRequests: pendingLeaveRows[0]?.count ?? 0,
          credExpired,
          credExpires30,
          credExpires60,
          credExpires90,
          credSuspended,
          staffWithReview,
          staffMissingReview,
          reviewCoveragePct: overallReviewCoveragePct,
        },
        leaveBalance: leaveBalance.slice(0, 25),
        credentialsRollingForward,
        trainingDeadlines,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[analytics/workforce-extended]' })
    return c.json({ error: 'Failed to load workforce extended' }, 500)
  }
})

export default analyticsWorkforceExtendedApp
