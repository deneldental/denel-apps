import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import {
  emailMessages,
  patientSessions,
  patients,
  pushSubscriptions,
  recarePlans,
  reminderTemplates,
  scheduledReminders,
  smsMessages,
} from '../db/schema'
import { logAnalyticsAccess } from '../lib/analytics-audit'
import { parsePeriod } from '../lib/analytics-period'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const analyticsCrmApp = new Hono<HonoEnv>()

/**
 * CRM analytics — recare adherence, campaign volume by channel, reminder
 * template effectiveness, PWA activation funnel.
 *
 *   /crm                  — single endpoint returning all CRM panels; CRM
 *                           tables are small enough to fetch in one shot
 */

analyticsCrmApp.get('/crm', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const allowed = await checkPermission(c, user.id, MODULES.RECARE, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  await logAnalyticsAccess(c, 'crm', '')

  const db = getDb(process.env.DATABASE_URL!)
  const period = parsePeriod(c)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)
  const ninetyDaysAgo = new Date(startOfToday.getTime() - 90 * 24 * 60 * 60 * 1000)
  const thirtyDaysAgo = new Date(startOfToday.getTime() - 30 * 24 * 60 * 60 * 1000)
  const msgWindowStart = period?.from ?? ninetyDaysAgo
  const msgWindowEnd = period?.to ?? startOfTomorrow
  const recareWindowStart = period?.from ?? ninetyDaysAgo
  const recareWindowEnd = period?.to ?? startOfTomorrow
  const activeWindowStart = period?.from ?? thirtyDaysAgo
  const activeWindowEnd = period?.to ?? startOfTomorrow

  try {
    const [
      smsByTypeRows,
      smsDeliveryRow,
      emailByTypeRows,
      smsTrendRows,
      recareStatusRows,
      recareDueRow,
      recareCompletedInPeriodRow,
      templateUsageRows,
      remindersByTypeRows,
      remindersByStatusRows,
      pwaEnabledRow,
      pwaActiveRow,
      patientTotalRow,
      pushSubsRow,
    ] = await Promise.all([
      // SMS volume by type within window
      db
        .select({
          type: smsMessages.type,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(smsMessages)
        .where(
          and(gte(smsMessages.sentAt, msgWindowStart), sql`${smsMessages.sentAt} < ${msgWindowEnd}`)
        )
        .groupBy(smsMessages.type),

      // SMS delivery vs send count
      db
        .select({
          totalSent: sql<number>`COUNT(*)::int`,
          delivered: sql<number>`COUNT(${smsMessages.deliveredAt})::int`,
        })
        .from(smsMessages)
        .where(
          and(gte(smsMessages.sentAt, msgWindowStart), sql`${smsMessages.sentAt} < ${msgWindowEnd}`)
        ),

      // Email volume by type
      db
        .select({
          type: emailMessages.type,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(emailMessages)
        .where(
          and(
            gte(emailMessages.sentAt, msgWindowStart),
            sql`${emailMessages.sentAt} < ${msgWindowEnd}`
          )
        )
        .groupBy(emailMessages.type),

      // Daily SMS volume trend
      db
        .select({
          day: sql<string>`DATE(${smsMessages.sentAt})::text`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(smsMessages)
        .where(
          and(gte(smsMessages.sentAt, msgWindowStart), sql`${smsMessages.sentAt} < ${msgWindowEnd}`)
        )
        .groupBy(sql`DATE(${smsMessages.sentAt})`)
        .orderBy(sql`DATE(${smsMessages.sentAt})`),

      // Recare status counts — all-time, all plans
      db
        .select({
          status: recarePlans.status,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(recarePlans)
        .where(eq(recarePlans.isActive, true))
        .groupBy(recarePlans.status),

      // Recare currently due (nextAlertDate <= today, still pending)
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(recarePlans)
        .where(
          and(
            eq(recarePlans.isActive, true),
            eq(recarePlans.status, 'pending'),
            sql`${recarePlans.nextAlertDate} <= ${now}`
          )
        ),

      // Recare completed within the period — adherence numerator
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(recarePlans)
        .where(
          and(
            eq(recarePlans.status, 'completed'),
            sql`${recarePlans.completedAt} >= ${recareWindowStart}`,
            sql`${recarePlans.completedAt} < ${recareWindowEnd}`
          )
        ),

      // Template usage — count of reminders by template, joined for the
      // template name. Top 10.
      db
        .select({
          templateId: scheduledReminders.templateId,
          templateName: reminderTemplates.name,
          sent: sql<number>`COUNT(*) FILTER (WHERE ${scheduledReminders.status} = 'sent')::int`,
          total: sql<number>`COUNT(*)::int`,
        })
        .from(scheduledReminders)
        .leftJoin(reminderTemplates, eq(scheduledReminders.templateId, reminderTemplates.id))
        .where(
          and(
            sql`${scheduledReminders.templateId} IS NOT NULL`,
            gte(scheduledReminders.createdAt, msgWindowStart),
            sql`${scheduledReminders.createdAt} < ${msgWindowEnd}`
          )
        )
        .groupBy(scheduledReminders.templateId, reminderTemplates.name)
        .orderBy(desc(sql`COUNT(*)`))
        .limit(10),

      // Scheduled reminders by type
      db
        .select({
          type: scheduledReminders.type,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(scheduledReminders)
        .where(
          and(
            gte(scheduledReminders.createdAt, msgWindowStart),
            sql`${scheduledReminders.createdAt} < ${msgWindowEnd}`
          )
        )
        .groupBy(scheduledReminders.type),

      // Scheduled reminders by status
      db
        .select({
          status: scheduledReminders.status,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(scheduledReminders)
        .where(
          and(
            gte(scheduledReminders.createdAt, msgWindowStart),
            sql`${scheduledReminders.createdAt} < ${msgWindowEnd}`
          )
        )
        .groupBy(scheduledReminders.status),

      // PWA enabled
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(patients)
        .where(eq(patients.pwaAccessEnabled, true)),

      // PWA active in period (distinct patient sessions with recent activity)
      db
        .select({
          count: sql<number>`COUNT(DISTINCT ${patientSessions.patientId})::int`,
        })
        .from(patientSessions)
        .where(
          and(
            gte(patientSessions.lastUsedAt, activeWindowStart),
            sql`${patientSessions.lastUsedAt} < ${activeWindowEnd}`
          )
        ),

      // Total patients (denominator for PWA enabled%)
      db.select({ count: sql<number>`COUNT(*)::int` }).from(patients),

      // Active staff push subscriptions
      db
        .select({ count: sql<number>`COUNT(DISTINCT ${pushSubscriptions.userId})::int` })
        .from(pushSubscriptions),
    ])

    // ── Channel volumes ─────────────────────────────────────────────────────
    const smsByType: Record<string, number> = {}
    for (const r of smsByTypeRows) smsByType[r.type ?? 'other'] = r.count
    const smsTotal = Object.values(smsByType).reduce((s, v) => s + v, 0)
    const smsDelivered = smsDeliveryRow[0]?.delivered ?? 0
    const smsSent = smsDeliveryRow[0]?.totalSent ?? 0
    const smsDeliveryRate = smsSent > 0 ? Math.round((smsDelivered / smsSent) * 1000) / 10 : 0

    const emailByType: Record<string, number> = {}
    for (const r of emailByTypeRows) emailByType[r.type ?? 'other'] = r.count
    const emailTotal = Object.values(emailByType).reduce((s, v) => s + v, 0)

    // Zero-fill the SMS daily trend
    const eachDay = (start: Date, end: Date): string[] => {
      const out: string[] = []
      const cursor = new Date(start)
      while (cursor < end) {
        out.push(cursor.toISOString().slice(0, 10))
        cursor.setDate(cursor.getDate() + 1)
      }
      return out
    }
    const smsTrendMap = new Map<string, number>()
    for (const day of eachDay(msgWindowStart, msgWindowEnd)) smsTrendMap.set(day, 0)
    for (const row of smsTrendRows) smsTrendMap.set(row.day, row.count)
    const smsTrend = Array.from(smsTrendMap.entries()).map(([day, count]) => ({ day, count }))

    // ── Recare funnel & adherence ───────────────────────────────────────────
    const recareStatus: Record<string, number> = {}
    for (const r of recareStatusRows) recareStatus[r.status ?? 'pending'] = r.count
    const recareTotalActive = Object.values(recareStatus).reduce((s, v) => s + v, 0)
    const recareCompleted = recareStatus.completed ?? 0
    const recareAdherencePct =
      recareTotalActive > 0 ? Math.round((recareCompleted / recareTotalActive) * 1000) / 10 : 0
    const recareDueNow = recareDueRow[0]?.count ?? 0
    const recareCompletedInPeriod = recareCompletedInPeriodRow[0]?.count ?? 0

    // ── Reminder templates ──────────────────────────────────────────────────
    const templateUsage = templateUsageRows.map((r) => ({
      templateId: r.templateId,
      templateName: r.templateName ?? 'Unnamed',
      sent: r.sent,
      total: r.total,
      sendRatePct: r.total > 0 ? Math.round((r.sent / r.total) * 1000) / 10 : 0,
    }))

    // ── Reminder volumes ────────────────────────────────────────────────────
    const remindersByType = remindersByTypeRows
      .map((r) => ({ type: r.type ?? 'other', count: r.count }))
      .sort((a, b) => b.count - a.count)
    const remindersByStatus = remindersByStatusRows
      .map((r) => ({ status: r.status ?? 'pending', count: r.count }))
      .sort((a, b) => b.count - a.count)

    // ── PWA funnel ──────────────────────────────────────────────────────────
    const totalPatients = patientTotalRow[0]?.count ?? 0
    const pwaEnabled = pwaEnabledRow[0]?.count ?? 0
    const pwaActiveInPeriod = pwaActiveRow[0]?.count ?? 0
    const pwaEnableRate =
      totalPatients > 0 ? Math.round((pwaEnabled / totalPatients) * 1000) / 10 : 0
    const pwaActiveRate =
      pwaEnabled > 0 ? Math.round((pwaActiveInPeriod / pwaEnabled) * 1000) / 10 : 0

    return c.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        tiles: {
          smsSent: smsTotal,
          emailSent: emailTotal,
          smsDeliveryRatePct: smsDeliveryRate,
          recareActive: recareTotalActive,
          recareDueNow,
          recareCompletedInPeriod,
          recareAdherencePct,
          pwaEnabled,
          pwaActiveInPeriod,
          pwaEnableRatePct: pwaEnableRate,
          pwaActiveRatePct: pwaActiveRate,
          staffPushSubscribers: pushSubsRow[0]?.count ?? 0,
        },
        smsByType,
        emailByType,
        smsTrend,
        recareStatus,
        templateUsage,
        remindersByType,
        remindersByStatus,
        pwaFunnel: [
          { stage: 'Total patients', count: totalPatients },
          { stage: 'PWA enabled', count: pwaEnabled },
          { stage: 'Active in period', count: pwaActiveInPeriod },
        ],
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[analytics/crm]' })
    return c.json({ error: 'Failed to load CRM analytics' }, 500)
  }
})

export default analyticsCrmApp
