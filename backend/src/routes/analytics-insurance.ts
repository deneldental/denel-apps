import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import {
  insuranceClaims,
  insuranceCompanies,
  insurancePricingDocuments,
  insuranceReconciliation,
  payments,
} from '../db/schema'
import { logAnalyticsAccess } from '../lib/analytics-audit'
import { parsePeriod } from '../lib/analytics-period'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const analyticsInsuranceApp = new Hono<HonoEnv>()

/**
 * Insurance analytics — payer mix trend, reconciliation backlog by company,
 * pricing-document drift.
 *
 * Claim lifecycle metrics (denial rate, days-to-approval) are deferred to
 * Phase 3 — they need a dedicated `insurance_claims` table.
 */

analyticsInsuranceApp.get('/insurance', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const allowed = await checkPermission(c, user.id, MODULES.INSURANCE, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  await logAnalyticsAccess(c, 'insurance', '')

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
      methodMixRows,
      methodTrendRows,
      reconciliationByCompanyRows,
      reconciliationBacklogRow,
      pricingDocsRows,
      companyCountRow,
    ] = await Promise.all([
      // Payer mix: revenue grouped by payment method within window
      db
        .select({
          method: payments.method,
          amount: sql<number>`COALESCE(SUM(${payments.amount}), 0)::float`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(payments)
        .where(
          and(
            eq(payments.status, 'posted'),
            gte(payments.createdAt, windowStart),
            sql`${payments.createdAt} < ${windowEnd}`
          )
        )
        .groupBy(payments.method),

      // Monthly trend: insurance vs OOP
      db
        .select({
          month: sql<string>`TO_CHAR(DATE_TRUNC('month', ${payments.createdAt}), 'YYYY-MM')`,
          method: payments.method,
          amount: sql<number>`COALESCE(SUM(${payments.amount}), 0)::float`,
        })
        .from(payments)
        .where(
          and(
            eq(payments.status, 'posted'),
            gte(payments.createdAt, windowStart),
            sql`${payments.createdAt} < ${windowEnd}`
          )
        )
        .groupBy(sql`DATE_TRUNC('month', ${payments.createdAt})`, payments.method)
        .orderBy(sql`DATE_TRUNC('month', ${payments.createdAt})`),

      // Reconciliation per company — charged vs paid
      db
        .select({
          companyId: insuranceReconciliation.companyId,
          companyName: insuranceCompanies.name,
          charged: sql<number>`COALESCE(SUM(${insuranceReconciliation.chargedAmount}), 0)::float`,
          paid: sql<number>`COALESCE(SUM(${insuranceReconciliation.insurerPaidAmount}), 0)::float`,
          reconciledCount: sql<number>`COUNT(${insuranceReconciliation.reconciledAt})::int`,
          totalCount: sql<number>`COUNT(*)::int`,
        })
        .from(insuranceReconciliation)
        .leftJoin(insuranceCompanies, eq(insuranceReconciliation.companyId, insuranceCompanies.id))
        .where(
          and(
            gte(insuranceReconciliation.recordedAt, windowStart),
            sql`${insuranceReconciliation.recordedAt} < ${windowEnd}`
          )
        )
        .groupBy(insuranceReconciliation.companyId, insuranceCompanies.name)
        .orderBy(desc(sql`COALESCE(SUM(${insuranceReconciliation.chargedAmount}), 0)`)),

      // Outstanding reconciliations (not yet reconciled)
      db
        .select({
          charged: sql<number>`COALESCE(SUM(${insuranceReconciliation.chargedAmount}), 0)::float`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(insuranceReconciliation)
        .where(sql`${insuranceReconciliation.reconciledAt} IS NULL`),

      // Pricing documents — latest per company so we can see drift
      db
        .select({
          companyId: insurancePricingDocuments.companyId,
          companyName: insuranceCompanies.name,
          fileName: insurancePricingDocuments.fileName,
          version: insurancePricingDocuments.version,
          effectiveFrom: insurancePricingDocuments.effectiveFrom,
          uploadedAt: insurancePricingDocuments.uploadedAt,
          isCurrent: insurancePricingDocuments.isCurrent,
        })
        .from(insurancePricingDocuments)
        .leftJoin(
          insuranceCompanies,
          eq(insurancePricingDocuments.companyId, insuranceCompanies.id)
        )
        .orderBy(desc(insurancePricingDocuments.uploadedAt))
        .limit(50),

      // Active insurance company count
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(insuranceCompanies)
        .where(eq(insuranceCompanies.active, true)),
    ])

    // ── Payer mix ───────────────────────────────────────────────────────────
    const methodTotals: Record<string, { amount: number; count: number }> = {}
    let grandTotal = 0
    for (const r of methodMixRows) {
      const m = r.method ?? 'other'
      methodTotals[m] = { amount: r.amount, count: r.count }
      grandTotal += r.amount
    }
    const methodMix = Object.entries(methodTotals)
      .map(([method, m]) => ({
        method,
        amount: Math.round(m.amount * 100) / 100,
        count: m.count,
        sharePct: grandTotal > 0 ? Math.round((m.amount / grandTotal) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.amount - a.amount)
    const insuranceAmount = methodTotals.insurance?.amount ?? 0
    const oopAmount = grandTotal - insuranceAmount
    const insuranceSharePct =
      grandTotal > 0 ? Math.round((insuranceAmount / grandTotal) * 1000) / 10 : 0

    // ── Monthly mix trend ──────────────────────────────────────────────────
    const trendMap = new Map<
      string,
      { month: string; insurance: number; oop: number; total: number }
    >()
    for (const r of methodTrendRows) {
      const m = trendMap.get(r.month) ?? {
        month: r.month,
        insurance: 0,
        oop: 0,
        total: 0,
      }
      if (r.method === 'insurance') m.insurance += r.amount
      else m.oop += r.amount
      m.total += r.amount
      trendMap.set(r.month, m)
    }
    const monthlyMix = Array.from(trendMap.values())
      .map((m) => ({
        month: m.month,
        insurance: Math.round(m.insurance * 100) / 100,
        oop: Math.round(m.oop * 100) / 100,
        insurancePct: m.total > 0 ? Math.round((m.insurance / m.total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => (a.month < b.month ? -1 : 1))

    // ── Reconciliation summary by company ──────────────────────────────────
    const reconciliation = reconciliationByCompanyRows.map((r) => ({
      companyId: r.companyId,
      companyName: r.companyName ?? 'Unknown',
      charged: Math.round(r.charged * 100) / 100,
      paid: Math.round(r.paid * 100) / 100,
      outstanding: Math.round((r.charged - r.paid) * 100) / 100,
      reconciledCount: r.reconciledCount,
      totalCount: r.totalCount,
      reconciliationRatePct:
        r.totalCount > 0 ? Math.round((r.reconciledCount / r.totalCount) * 1000) / 10 : 0,
    }))
    const totalCharged = reconciliation.reduce((s, r) => s + r.charged, 0)
    const totalPaid = reconciliation.reduce((s, r) => s + r.paid, 0)
    const outstandingReconciliation = reconciliationBacklogRow[0]?.charged ?? 0
    const outstandingCount = reconciliationBacklogRow[0]?.count ?? 0

    // ── Pricing documents ──────────────────────────────────────────────────
    const pricingDocs = pricingDocsRows.map((r) => ({
      companyId: r.companyId,
      companyName: r.companyName ?? 'Unknown',
      fileName: r.fileName,
      version: r.version,
      effectiveFrom: r.effectiveFrom?.toISOString() ?? null,
      uploadedAt: r.uploadedAt?.toISOString() ?? null,
      isCurrent: r.isCurrent,
    }))

    return c.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        tiles: {
          insuranceSharePct,
          insuranceAmount: Math.round(insuranceAmount * 100) / 100,
          oopAmount: Math.round(oopAmount * 100) / 100,
          activeCompanies: companyCountRow[0]?.count ?? 0,
          outstandingReconciliation: Math.round(outstandingReconciliation * 100) / 100,
          outstandingReconciliationCount: outstandingCount,
          totalCharged: Math.round(totalCharged * 100) / 100,
          totalPaid: Math.round(totalPaid * 100) / 100,
        },
        methodMix,
        monthlyMix,
        reconciliation,
        pricingDocs,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[analytics/insurance]' })
    return c.json({ error: 'Failed to load insurance analytics' }, 500)
  }
})

/**
 * Claim pipeline — denial rate, avg days-to-approval, status funnel.
 * Requires the insurance_claims table from migration 0085.
 */
analyticsInsuranceApp.get('/insurance/claim-pipeline', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const allowed = await checkPermission(c, user.id, MODULES.INSURANCE, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  await logAnalyticsAccess(c, 'insurance', 'claim-pipeline')

  const db = getDb(process.env.DATABASE_URL!)
  const period = parsePeriod(c)
  const now = new Date()
  const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1)
  const windowStart = period?.from ?? twelveMonthsAgo
  const windowEnd = period?.to ?? now

  try {
    const [statusFunnelRows, byCompanyRows, monthlyTrendRows, agingRows, pendingTotalRow] =
      await Promise.all([
        // Status funnel: count per status
        db
          .select({
            status: insuranceClaims.status,
            count: sql<number>`COUNT(*)::int`,
            totalCharged: sql<number>`COALESCE(SUM(${insuranceClaims.chargedAmount}), 0)::float`,
          })
          .from(insuranceClaims)
          .where(
            and(
              gte(insuranceClaims.createdAt, windowStart),
              sql`${insuranceClaims.createdAt} < ${windowEnd}`
            )
          )
          .groupBy(insuranceClaims.status),

        // Per-company breakdown: denial rate, avg days-to-approval
        db
          .select({
            companyId: insuranceClaims.companyId,
            companyName: insuranceCompanies.name,
            totalClaims: sql<number>`COUNT(*)::int`,
            deniedClaims: sql<number>`COUNT(*) FILTER (WHERE ${insuranceClaims.status} = 'denied')::int`,
            approvedClaims: sql<number>`COUNT(*) FILTER (WHERE ${insuranceClaims.status} IN ('approved', 'paid'))::int`,
            avgDaysToApproval: sql<number>`
              ROUND(AVG(
                EXTRACT(EPOCH FROM (${insuranceClaims.approvedAt} - ${insuranceClaims.submittedAt})) / 86400
              ) FILTER (WHERE ${insuranceClaims.approvedAt} IS NOT NULL AND ${insuranceClaims.submittedAt} IS NOT NULL),
              1)::float`,
            totalCharged: sql<number>`COALESCE(SUM(${insuranceClaims.chargedAmount}), 0)::float`,
            totalApproved: sql<number>`COALESCE(SUM(${insuranceClaims.approvedAmount}), 0)::float`,
          })
          .from(insuranceClaims)
          .leftJoin(insuranceCompanies, eq(insuranceClaims.companyId, insuranceCompanies.id))
          .where(
            and(
              gte(insuranceClaims.createdAt, windowStart),
              sql`${insuranceClaims.createdAt} < ${windowEnd}`
            )
          )
          .groupBy(insuranceClaims.companyId, insuranceCompanies.name)
          .orderBy(desc(sql`COUNT(*)`)),

        // Monthly submission trend
        db
          .select({
            month: sql<string>`TO_CHAR(DATE_TRUNC('month', ${insuranceClaims.createdAt}), 'YYYY-MM')`,
            submitted: sql<number>`COUNT(*)::int`,
            approved: sql<number>`COUNT(*) FILTER (WHERE ${insuranceClaims.status} IN ('approved', 'paid'))::int`,
            denied: sql<number>`COUNT(*) FILTER (WHERE ${insuranceClaims.status} = 'denied')::int`,
          })
          .from(insuranceClaims)
          .where(
            and(
              gte(insuranceClaims.createdAt, windowStart),
              sql`${insuranceClaims.createdAt} < ${windowEnd}`
            )
          )
          .groupBy(sql`DATE_TRUNC('month', ${insuranceClaims.createdAt})`)
          .orderBy(sql`DATE_TRUNC('month', ${insuranceClaims.createdAt})`),

        // Claim aging: open claims grouped by how long they've been pending
        db.execute(sql`
          SELECT
            CASE
              WHEN AGE(NOW(), "submittedAt") < INTERVAL '30 days' THEN '0–30 days'
              WHEN AGE(NOW(), "submittedAt") < INTERVAL '60 days' THEN '30–60 days'
              WHEN AGE(NOW(), "submittedAt") < INTERVAL '90 days' THEN '60–90 days'
              ELSE '90+ days'
            END AS bucket,
            COUNT(*)::int AS count,
            COALESCE(SUM("chargedAmount"), 0)::float AS amount
          FROM insurance_claims
          WHERE status IN ('submitted', 'pending')
            AND "submittedAt" IS NOT NULL
          GROUP BY 1
          ORDER BY MIN("submittedAt")
        `),

        // Total pending
        db
          .select({
            count: sql<number>`COUNT(*)::int`,
            amount: sql<number>`COALESCE(SUM(${insuranceClaims.chargedAmount}), 0)::float`,
          })
          .from(insuranceClaims)
          .where(isNull(insuranceClaims.paidAt)),
      ])

    // Status funnel map
    const funnelMap: Record<string, { count: number; amount: number }> = {}
    let totalClaims = 0
    let totalCharged = 0
    for (const r of statusFunnelRows) {
      funnelMap[r.status] = { count: r.count, amount: r.totalCharged }
      totalClaims += r.count
      totalCharged += r.totalCharged
    }
    const deniedCount = funnelMap.denied?.count ?? 0
    const approvedCount = (funnelMap.approved?.count ?? 0) + (funnelMap.paid?.count ?? 0)
    const denialRatePct = totalClaims > 0 ? Math.round((deniedCount / totalClaims) * 1000) / 10 : 0
    const approvalRatePct =
      totalClaims > 0 ? Math.round((approvedCount / totalClaims) * 1000) / 10 : 0

    const byCompany = byCompanyRows.map((r) => ({
      companyId: r.companyId,
      companyName: r.companyName ?? 'Unknown',
      totalClaims: r.totalClaims,
      deniedClaims: r.deniedClaims,
      approvedClaims: r.approvedClaims,
      denialRatePct:
        r.totalClaims > 0 ? Math.round((r.deniedClaims / r.totalClaims) * 1000) / 10 : 0,
      avgDaysToApproval: r.avgDaysToApproval ?? null,
      totalCharged: Math.round(r.totalCharged * 100) / 100,
      totalApproved: Math.round(r.totalApproved * 100) / 100,
    }))

    const monthlyTrend = monthlyTrendRows.map((r) => ({
      month: r.month,
      submitted: r.submitted,
      approved: r.approved,
      denied: r.denied,
    }))

    type AgingRow = { bucket: string; count: number; amount: number }
    const claimAging = (agingRows.rows as AgingRow[]).map((r) => ({
      bucket: r.bucket,
      count: r.count,
      amount: Math.round(r.amount * 100) / 100,
    }))

    return c.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        tiles: {
          totalClaims,
          totalCharged: Math.round(totalCharged * 100) / 100,
          denialRatePct,
          approvalRatePct,
          pendingCount: pendingTotalRow[0]?.count ?? 0,
          pendingAmount: Math.round((pendingTotalRow[0]?.amount ?? 0) * 100) / 100,
        },
        funnel: Object.entries(funnelMap).map(([status, m]) => ({
          status,
          count: m.count,
          amount: Math.round(m.amount * 100) / 100,
        })),
        byCompany,
        monthlyTrend,
        claimAging,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[analytics/insurance/claim-pipeline]' })
    return c.json({ error: 'Failed to load claim pipeline analytics' }, 500)
  }
})

export default analyticsInsuranceApp
