import { and, asc, desc, eq, gt, gte, isNull, lte, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import {
  appointments,
  auditLogs,
  complianceDocuments,
  expenses,
  items,
  labCases,
  labVendors,
  loginAttempts,
  patientBalances,
  patientOdontogram,
  patientPerioEntries,
  patientSessions,
  patients,
  payments,
  payrollRuns,
  pendingMedicalRecords,
  performanceScores,
  recarePlans,
  signedConsentForms,
  specialistBalances as specialistBalancesTable,
  specialistCommissions,
  specialistPayouts,
  specialists,
  staff,
  staffAttendance,
  staffCredentials,
  staffDocuments,
  staffTrainingProgress,
  supplierBalances,
  syncLog,
  trainingMaterials,
  treatmentPlanItems,
  treatmentPlans,
  user,
  xrayRecords,
  xrayTypes,
} from '../db/schema'
import { logAnalyticsAccess } from '../lib/analytics-audit'
import { parsePeriod } from '../lib/analytics-period'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { hasOrthoTag } from '../lib/patient-tags-query'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const analyticsApp = new Hono<HonoEnv>()

const QUARTERS = {
  Q1: { months: [1, 2, 3], label: ['Jan', 'Feb', 'Mar'] },
  Q2: { months: [4, 5, 6], label: ['Apr', 'May', 'Jun'] },
  Q3: { months: [7, 8, 9], label: ['Jul', 'Aug', 'Sep'] },
  Q4: { months: [10, 11, 12], label: ['Oct', 'Nov', 'Dec'] },
} as const

function _quarterDateRange(year: number, q: 1 | 2 | 3 | 4): { start: Date; end: Date } {
  const startMonth = (q - 1) * 3 + 1
  const endMonth = q * 3
  const start = new Date(year, startMonth - 1, 1)
  const end = new Date(year, endMonth, 0, 23, 59, 59, 999) // last day of last month
  return { start, end }
}

function growth(prev: number, curr: number): number | null {
  if (prev === 0) return null
  return Math.round(((curr - prev) / prev) * 1000) / 10 // one decimal
}

analyticsApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const yearParam = c.req.query('year')
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear()

  if (Number.isNaN(year) || year < 2000 || year > 2100) {
    return c.json({ error: 'Invalid year' }, 400)
  }

  await logAnalyticsAccess(c, 'quarterly-breakdown', `year=${year}`)

  const db = getDb(process.env.DATABASE_URL!)

  try {
    // ── 1. Patients: monthly counts for the whole year ──────────────────────
    const patientRows = await db
      .select({
        month: sql<number>`EXTRACT(MONTH FROM "createdAt")::int`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(patients)
      .where(
        and(
          gte(patients.createdAt, new Date(year, 0, 1)),
          lte(patients.createdAt, new Date(year, 11, 31, 23, 59, 59, 999))
        )
      )
      .groupBy(sql`EXTRACT(MONTH FROM "createdAt")`)

    const patientsByMonth: Record<number, number> = {}
    for (const row of patientRows) {
      patientsByMonth[row.month] = row.count
    }

    // ── 2. Revenue: by treatment (from JSONB) per quarter ───────────────────
    // We unnest the treatments JSONB array to get per-treatment amounts
    const revenueRows = await db.execute(sql`
      SELECT
        EXTRACT(MONTH FROM p."createdAt")::int AS month,
        elem->>'name' AS treatment_name,
        SUM((elem->>'amount')::numeric)::float AS amount,
        COUNT(*)::int AS count
      FROM ${payments} p,
           jsonb_array_elements(
             CASE
               WHEN p.treatments IS NULL OR p.treatments::text = 'null' THEN '[]'::jsonb
               ELSE p.treatments
             END
           ) AS elem
      WHERE EXTRACT(YEAR FROM p."createdAt") = ${year}
        AND p.status = 'posted'
        AND jsonb_array_length(
              CASE
                WHEN p.treatments IS NULL OR p.treatments::text = 'null' THEN '[]'::jsonb
                ELSE p.treatments
              END
            ) > 0
      GROUP BY month, treatment_name
      ORDER BY month, amount DESC
    `)

    // ── 3. Total revenue per month (including payments with no treatments) ──
    const totalRevenueRows = await db
      .select({
        month: sql<number>`EXTRACT(MONTH FROM "createdAt")::int`,
        total: sql<number>`COALESCE(SUM(amount), 0)::float`,
      })
      .from(payments)
      .where(
        and(
          gte(payments.createdAt, new Date(year, 0, 1)),
          lte(payments.createdAt, new Date(year, 11, 31, 23, 59, 59, 999)),
          eq(payments.status, 'posted')
        )
      )
      .groupBy(sql`EXTRACT(MONTH FROM "createdAt")`)

    const revenueByMonth: Record<number, number> = {}
    for (const row of totalRevenueRows) {
      revenueByMonth[row.month] = row.total
    }

    // ── 4. Expenses: by category per month ──────────────────────────────────
    const expenseRows = await db
      .select({
        month: sql<number>`EXTRACT(MONTH FROM date)::int`,
        category: expenses.category,
        total: sql<number>`COALESCE(SUM(amount), 0)::float`,
      })
      .from(expenses)
      .where(
        and(
          gte(expenses.date, new Date(year, 0, 1)),
          lte(expenses.date, new Date(year, 11, 31, 23, 59, 59, 999))
        )
      )
      .groupBy(sql`EXTRACT(MONTH FROM date)`, expenses.category)

    // ── 5. Payment methods per month ─────────────────────────────────────────
    const methodRows = await db
      .select({
        month: sql<number>`EXTRACT(MONTH FROM "createdAt")::int`,
        method: payments.method,
        count: sql<number>`COUNT(*)::int`,
        total: sql<number>`COALESCE(SUM(amount), 0)::float`,
      })
      .from(payments)
      .where(
        and(
          gte(payments.createdAt, new Date(year, 0, 1)),
          lte(payments.createdAt, new Date(year, 11, 31, 23, 59, 59, 999)),
          eq(payments.status, 'posted')
        )
      )
      .groupBy(sql`EXTRACT(MONTH FROM "createdAt")`, payments.method)

    // ── Build quarter summaries ───────────────────────────────────────────────
    const result: Record<string, any> = {}

    for (const [qKey, qDef] of Object.entries(QUARTERS)) {
      // Cast readonly tuple to number[] so .includes() accepts generic number values
      const qMonths: readonly number[] = qDef.months
      const monthLabels = qDef.label

      // Patients
      const monthCounts = qMonths.map((m) => patientsByMonth[m] ?? 0)
      const patientTotal = monthCounts.reduce((a, b) => a + b, 0)
      const patientMonthly = monthLabels.map((label, i) => ({
        month: label,
        count: monthCounts[i],
        growth: i === 0 ? null : growth(monthCounts[i - 1], monthCounts[i]),
      }))

      // Revenue total for quarter
      const qRevenueTotal = qMonths.reduce((sum, m) => sum + (revenueByMonth[m] ?? 0), 0)

      // Revenue by treatment for quarter
      const treatmentMap: Record<string, { amount: number; count: number }> = {}
      for (const row of revenueRows.rows as any[]) {
        if (!qMonths.includes(row.month)) continue
        const name = row.treatment_name || 'Other'
        if (!treatmentMap[name]) treatmentMap[name] = { amount: 0, count: 0 }
        treatmentMap[name].amount += parseFloat(row.amount) || 0
        treatmentMap[name].count += parseInt(row.count, 10) || 0
      }
      const totalTreatmentAmount = Object.values(treatmentMap).reduce((s, t) => s + t.amount, 0)
      const revenueByTreatment = Object.entries(treatmentMap)
        .map(([name, t]) => ({
          name,
          amount: Math.round(t.amount * 100) / 100,
          percentage:
            totalTreatmentAmount > 0
              ? Math.round((t.amount / totalTreatmentAmount) * 1000) / 10
              : 0,
        }))
        .sort((a, b) => b.amount - a.amount)

      // Expenses by category for quarter
      const catMap: Record<string, number> = {}
      for (const row of expenseRows) {
        if (!qMonths.includes(row.month)) continue
        if (!catMap[row.category]) catMap[row.category] = 0
        catMap[row.category] += row.total
      }
      const qExpenseTotal = Object.values(catMap).reduce((a, b) => a + b, 0)
      const expenseByCategory = Object.entries(catMap)
        .map(([category, total]) => ({
          category,
          amount: Math.round(total * 100) / 100,
          percentage: qExpenseTotal > 0 ? Math.round((total / qExpenseTotal) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.amount - a.amount)

      // Payment methods for quarter
      const methodMap: Record<string, { count: number; amount: number }> = {}
      for (const row of methodRows) {
        if (!qMonths.includes(row.month)) continue
        if (!methodMap[row.method]) methodMap[row.method] = { count: 0, amount: 0 }
        methodMap[row.method].count += row.count
        methodMap[row.method].amount += row.total
      }
      const totalMethodCount = Object.values(methodMap).reduce((s, m) => s + m.count, 0)
      const paymentMethodBreakdown = Object.entries(methodMap)
        .map(([method, m]) => ({
          method,
          count: m.count,
          amount: Math.round(m.amount * 100) / 100,
          percentage:
            totalMethodCount > 0 ? Math.round((m.count / totalMethodCount) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.count - a.count)

      // Treatment count breakdown for quarter (by frequency, not revenue)
      const treatmentCountMap: Record<string, number> = {}
      for (const row of revenueRows.rows as any[]) {
        if (!qMonths.includes(row.month)) continue
        const name = row.treatment_name || 'Other'
        if (!treatmentCountMap[name]) treatmentCountMap[name] = 0
        treatmentCountMap[name] += parseInt(row.count, 10) || 0
      }
      const totalTreatmentCount = Object.values(treatmentCountMap).reduce((a, b) => a + b, 0)
      const treatmentBreakdown = Object.entries(treatmentCountMap)
        .map(([name, count]) => ({
          name,
          count,
          percentage:
            totalTreatmentCount > 0 ? Math.round((count / totalTreatmentCount) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.count - a.count)

      result[qKey] = {
        patients: {
          total: patientTotal,
          monthly: patientMonthly,
        },
        revenue: {
          total: Math.round(qRevenueTotal * 100) / 100,
          byTreatment: revenueByTreatment,
        },
        expenses: {
          total: Math.round(qExpenseTotal * 100) / 100,
          byCategory: expenseByCategory,
        },
        paymentMethods: paymentMethodBreakdown,
        treatments: treatmentBreakdown,
      }
    }

    return c.json({ success: true, data: { year, ...result } })
  } catch (error: unknown) {
    logError(error, { context: '[analytics]' })
    return c.json({ error: 'Failed to fetch analytics' }, 500)
  }
})

// ─── GET /executive-overview ──────────────────────────────────────────────────
// Single-call payload for the Executive Overview landing surface: 8 KPI tiles
// + a 60-day revenue trend (stacked by method) + 30-day booked vs completed
// appointment series.
//
// Tile semantics:
//   todayRevenue           SUM(payments.amount WHERE status='completed' AND
//                          createdAt = today)  +  yesterday delta
//   patientsSeenToday      COUNT(appointments WHERE status='completed' AND
//                          date = today)  + 7-day avg
//   mtdCashPosition        MTD payments − MTD expenses  + same window last
//                          month delta
//   openAR                 SUM(patientBalances.arBalance) WHERE > 0
//   openAP                 SUM(supplierBalances.apBalance) WHERE > 0
//   noShowRate7d           no_show / scheduled-or-completed-or-no_show over
//                          last 7 days
//   stockAtRisk            COUNT(inventory WHERE stockQuantity ≤ reorderLevel)
//   credentialsExpiring30d COUNT(staffCredentials WHERE expiryDate within 30d)
//
// All queries are issued in parallel; the endpoint targets sub-500ms response.
analyticsApp.get('/executive-overview', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const allowed = await checkPermission(c, user.id, MODULES.FINANCIAL_RECORDS, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  await logAnalyticsAccess(c, 'executive-overview', '')

  const db = getDb(process.env.DATABASE_URL!)

  const period = parsePeriod(c)
  // All time boundaries computed in server local time to match how the rest of
  // the system writes timestamps (the legacy analytics route uses the same).
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000)
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)
  const sevenDaysAgo = new Date(startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000) // 7-day window includes today
  const thirtyDaysAgo = new Date(startOfToday.getTime() - 29 * 24 * 60 * 60 * 1000)
  const sixtyDaysAgo = new Date(startOfToday.getTime() - 59 * 24 * 60 * 60 * 1000)
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const expiry30d = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  // Period override drives the appt-status + revenue/appointment trend
  // windows. Tile snapshots (today, MTD, open AR/AP, stock, credentials)
  // remain point-in-time by design — "today's revenue" doesn't change when
  // the user toggles to "Yearly".
  const apptWindowStart = period?.from ?? sevenDaysAgo
  const apptWindowEnd = period?.to ?? startOfTomorrow
  const revTrendStart = period?.from ?? sixtyDaysAgo
  const revTrendEnd = period?.to ?? startOfTomorrow
  const apptTrendStart = period?.from ?? thirtyDaysAgo
  const apptTrendEnd = period?.to ?? startOfTomorrow

  try {
    const [
      todayRevRow,
      yesterdayRevRow,
      todayPatientsRow,
      avg7dPatientsRow,
      mtdPaymentsRow,
      mtdExpensesRow,
      lastMonthMtdPaymentsRow,
      lastMonthMtdExpensesRow,
      openARRow,
      openAPRow,
      apptStatus7dRows,
      stockAtRiskRow,
      credentialsRow,
      revenueTrendRows,
      apptTrendRows,
      insuranceBacklogRow,
      syncErrors24hRow,
      completenessRow,
    ] = await Promise.all([
      // Today's revenue
      db
        .select({ total: sql<number>`COALESCE(SUM(amount), 0)::float` })
        .from(payments)
        .where(
          and(
            eq(payments.status, 'posted'),
            gte(payments.createdAt, startOfToday),
            lte(payments.createdAt, now)
          )
        ),

      // Yesterday's revenue (for delta tile)
      db
        .select({ total: sql<number>`COALESCE(SUM(amount), 0)::float` })
        .from(payments)
        .where(
          and(
            eq(payments.status, 'posted'),
            gte(payments.createdAt, startOfYesterday),
            sql`${payments.createdAt} < ${startOfToday}`
          )
        ),

      // Today's completed appointments
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(appointments)
        .where(
          and(
            eq(appointments.status, 'completed'),
            gte(appointments.date, startOfToday),
            sql`${appointments.date} < ${startOfTomorrow}`
          )
        ),

      // 7-day average completed appointments per day
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(appointments)
        .where(
          and(
            eq(appointments.status, 'completed'),
            gte(appointments.date, sevenDaysAgo),
            sql`${appointments.date} < ${startOfTomorrow}`
          )
        ),

      // MTD payments
      db
        .select({ total: sql<number>`COALESCE(SUM(amount), 0)::float` })
        .from(payments)
        .where(
          and(
            eq(payments.status, 'posted'),
            gte(payments.createdAt, startOfMonth),
            lte(payments.createdAt, now)
          )
        ),

      // MTD expenses
      db
        .select({ total: sql<number>`COALESCE(SUM(amount), 0)::float` })
        .from(expenses)
        .where(and(gte(expenses.date, startOfMonth), lte(expenses.date, now))),

      // Same window last month — payments (for delta)
      db
        .select({ total: sql<number>`COALESCE(SUM(amount), 0)::float` })
        .from(payments)
        .where(
          and(
            eq(payments.status, 'posted'),
            gte(payments.createdAt, startOfLastMonth),
            sql`${payments.createdAt} < ${startOfMonth}`,
            // Cap at same day-of-month — month-to-date apples-to-apples
            sql`EXTRACT(DAY FROM ${payments.createdAt}) <= ${now.getDate()}`
          )
        ),

      // Same window last month — expenses
      db
        .select({ total: sql<number>`COALESCE(SUM(amount), 0)::float` })
        .from(expenses)
        .where(
          and(
            gte(expenses.date, startOfLastMonth),
            sql`${expenses.date} < ${startOfMonth}`,
            sql`EXTRACT(DAY FROM ${expenses.date}) <= ${now.getDate()}`
          )
        ),

      // Open AR (positive balances only)
      db
        .select({ total: sql<number>`COALESCE(SUM(${patientBalances.arBalance}), 0)::float` })
        .from(patientBalances)
        .where(sql`${patientBalances.arBalance} > 0`),

      // Open AP
      db
        .select({ total: sql<number>`COALESCE(SUM(${supplierBalances.apBalance}), 0)::float` })
        .from(supplierBalances)
        .where(sql`${supplierBalances.apBalance} > 0`),

      // 7-day appointment status breakdown — used for no-show rate AND a quick
      // confirmation/cancellation peek if the frontend wants it later.
      db
        .select({
          status: appointments.status,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(appointments)
        .where(
          and(gte(appointments.date, apptWindowStart), sql`${appointments.date} < ${apptWindowEnd}`)
        )
        .groupBy(appointments.status),

      // Stock at risk
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(items)
        .where(
          and(
            eq(items.consumable, true),
            sql`${items.stockQuantity} <= COALESCE(${items.reorderLevel}, 10)`
          )
        ),

      // Credentials expiring within 30 days (and still in the future — already-
      // expired ones surface separately on the Compliance dashboard)
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(staffCredentials)
        .where(
          and(gt(staffCredentials.expiryDate, now), lte(staffCredentials.expiryDate, expiry30d))
        ),

      // 60-day revenue trend stacked by method
      db
        .select({
          day: sql<string>`DATE(${payments.createdAt})::text`,
          method: payments.method,
          total: sql<number>`COALESCE(SUM(amount), 0)::float`,
        })
        .from(payments)
        .where(
          and(
            eq(payments.status, 'posted'),
            gte(payments.createdAt, revTrendStart),
            sql`${payments.createdAt} < ${revTrendEnd}`
          )
        )
        .groupBy(sql`DATE(${payments.createdAt})`, payments.method)
        .orderBy(sql`DATE(${payments.createdAt})`),

      // Appointment trend booked vs completed
      db
        .select({
          day: sql<string>`DATE(${appointments.date})::text`,
          status: appointments.status,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(appointments)
        .where(
          and(gte(appointments.date, apptTrendStart), sql`${appointments.date} < ${apptTrendEnd}`)
        )
        .groupBy(sql`DATE(${appointments.date})`, appointments.status)
        .orderBy(sql`DATE(${appointments.date})`),

      // Open insurance reconciliation — unreconciled charged amount
      db.execute(sql`
        SELECT COALESCE(SUM("chargedAmount"), 0)::float AS amount,
               COUNT(*)::int AS records
        FROM insurance_reconciliation_entries
        WHERE "reconciledAt" IS NULL
      `),

      // Sync errors in last 24h
      db.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM sync_log
        WHERE success = false
          AND "syncedAt" >= NOW() - INTERVAL '24 hours'
      `),

      // Data completeness — proportion of patients with phone + email
      db.execute(sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE phone IS NOT NULL AND phone <> '')::int AS with_phone,
          COUNT(*) FILTER (WHERE email IS NOT NULL AND email <> '')::int AS with_email
        FROM patients
      `),
    ])

    // ── Tile math ───────────────────────────────────────────────────────────
    const todayRevenue = todayRevRow[0]?.total ?? 0
    const yesterdayRevenue = yesterdayRevRow[0]?.total ?? 0
    const revenueDelta =
      yesterdayRevenue > 0
        ? Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 1000) / 10
        : null

    const patientsToday = todayPatientsRow[0]?.count ?? 0
    const sevenDayPatientTotal = avg7dPatientsRow[0]?.count ?? 0
    const sevenDayAvgPatients = Math.round((sevenDayPatientTotal / 7) * 10) / 10

    const mtdPayments = mtdPaymentsRow[0]?.total ?? 0
    const mtdExpenses = mtdExpensesRow[0]?.total ?? 0
    const mtdCashPosition = Math.round((mtdPayments - mtdExpenses) * 100) / 100

    const lastMtdPayments = lastMonthMtdPaymentsRow[0]?.total ?? 0
    const lastMtdExpenses = lastMonthMtdExpensesRow[0]?.total ?? 0
    const lastMtdCash = lastMtdPayments - lastMtdExpenses
    const cashDelta =
      lastMtdCash !== 0
        ? Math.round(((mtdCashPosition - lastMtdCash) / Math.abs(lastMtdCash)) * 1000) / 10
        : null

    const openAR = Math.round((openARRow[0]?.total ?? 0) * 100) / 100
    const openAP = Math.round((openAPRow[0]?.total ?? 0) * 100) / 100

    // No-show rate: no_show / (scheduled + completed + no_show + cancelled)
    const apptStatusMap: Record<string, number> = {}
    for (const row of apptStatus7dRows) apptStatusMap[row.status] = row.count
    const totalAppt7d =
      (apptStatusMap.scheduled ?? 0) +
      (apptStatusMap.confirmed ?? 0) +
      (apptStatusMap.checked_in ?? 0) +
      (apptStatusMap.in_chair ?? 0) +
      (apptStatusMap.completed ?? 0) +
      (apptStatusMap.no_show ?? 0) +
      (apptStatusMap.cancelled ?? 0)
    const noShows7d = apptStatusMap.no_show ?? 0
    const noShowRate7d = totalAppt7d > 0 ? Math.round((noShows7d / totalAppt7d) * 1000) / 10 : 0

    const stockAtRisk = stockAtRiskRow[0]?.count ?? 0
    const credentialsExpiring = credentialsRow[0]?.count ?? 0

    // ── Revenue trend: pivot rows into per-day records with one column per
    // method, plus a daily total. Fill missing days with zeros so the chart
    // x-axis is continuous.
    const trendDayMap = new Map<
      string,
      {
        day: string
        cash: number
        card: number
        momo: number
        insurance: number
        transfer: number
        other: number
        total: number
      }
    >()
    const eachDay = (start: Date, end: Date): string[] => {
      const out: string[] = []
      const cursor = new Date(start)
      while (cursor < end) {
        out.push(cursor.toISOString().slice(0, 10))
        cursor.setDate(cursor.getDate() + 1)
      }
      return out
    }
    for (const day of eachDay(revTrendStart, revTrendEnd)) {
      trendDayMap.set(day, {
        day,
        cash: 0,
        card: 0,
        momo: 0,
        insurance: 0,
        transfer: 0,
        other: 0,
        total: 0,
      })
    }
    for (const row of revenueTrendRows) {
      const day = trendDayMap.get(row.day)
      if (!day) continue
      const amount = row.total ?? 0
      const method = (row.method ?? 'other').toLowerCase()
      if (method.includes('cash')) day.cash += amount
      else if (method.includes('card')) day.card += amount
      else if (method.includes('momo') || method.includes('mobile')) day.momo += amount
      else if (method.includes('insurance')) day.insurance += amount
      else if (method.includes('transfer') || method.includes('bank')) day.transfer += amount
      else day.other += amount
      day.total += amount
    }
    const revenueTrend = Array.from(trendDayMap.values())

    // ── Appointment trend: pivot booked (scheduled or completed) vs completed
    // vs no-show, daily.
    const apptDayMap = new Map<
      string,
      { day: string; booked: number; completed: number; noShow: number; cancelled: number }
    >()
    for (const day of eachDay(apptTrendStart, apptTrendEnd)) {
      apptDayMap.set(day, { day, booked: 0, completed: 0, noShow: 0, cancelled: 0 })
    }
    for (const row of apptTrendRows) {
      const day = apptDayMap.get(row.day)
      if (!day) continue
      day.booked += row.count // booked = anything scheduled regardless of outcome
      if (row.status === 'completed') day.completed += row.count
      else if (row.status === 'no_show') day.noShow += row.count
      else if (row.status === 'cancelled') day.cancelled += row.count
    }
    const appointmentTrend = Array.from(apptDayMap.values())

    return c.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        tiles: {
          todayRevenue: { value: todayRevenue, deltaPct: revenueDelta, vs: 'yesterday' },
          patientsSeenToday: {
            value: patientsToday,
            sevenDayAverage: sevenDayAvgPatients,
          },
          mtdCashPosition: { value: mtdCashPosition, deltaPct: cashDelta, vs: 'last month MTD' },
          openAR: { value: openAR },
          openAP: { value: openAP },
          noShowRate7d: {
            value: noShowRate7d,
            totalAppointments: totalAppt7d,
            noShows: noShows7d,
          },
          stockAtRisk: { value: stockAtRisk },
          credentialsExpiring30d: { value: credentialsExpiring },
          insuranceBacklog: {
            value:
              Math.round(
                Number(
                  (insuranceBacklogRow.rows[0] as { amount?: number } | undefined)?.amount ?? 0
                ) * 100
              ) / 100,
            records: Number(
              (insuranceBacklogRow.rows[0] as { records?: number } | undefined)?.records ?? 0
            ),
          },
          syncErrors24h: {
            value: Number((syncErrors24hRow.rows[0] as { count?: number } | undefined)?.count ?? 0),
          },
          patientCompletenessPct: (() => {
            const row = completenessRow.rows[0] as
              | { total?: number; with_phone?: number; with_email?: number }
              | undefined
            const total = Number(row?.total ?? 0)
            const withPhone = Number(row?.with_phone ?? 0)
            const withEmail = Number(row?.with_email ?? 0)
            return {
              total,
              withPhonePct: total > 0 ? Math.round((withPhone / total) * 1000) / 10 : 0,
              withEmailPct: total > 0 ? Math.round((withEmail / total) * 1000) / 10 : 0,
            }
          })(),
        },
        revenueTrend,
        appointmentTrend,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[analytics/executive-overview]' })
    return c.json({ error: 'Failed to fetch overview' }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// Operational analytics — Sprint 2
// Surfaces the receptionist / ops lead's daily-ops dashboards:
//   /operational/appointments   appointment funnel + DoW heat + lead time
//   /operational/lab            lab pipeline + turnaround + delays
//   /operational/inventory      stock health + categories + expiring
// Each endpoint scopes to a fixed rolling window so the UI can read it without
// passing date params — opinionated by design, "last 30 days" is the right
// receptionist horizon.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /operational/appointments ────────────────────────────────────────────
analyticsApp.get('/operational/appointments', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  // Use APPOINTMENTS:READ since this is appointment-scoped operations data, not
  // financial.
  const allowed = await checkPermission(c, user.id, MODULES.APPOINTMENTS, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  await logAnalyticsAccess(c, 'operational-appointments', '')

  const db = getDb(process.env.DATABASE_URL!)

  const period = parsePeriod(c)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)
  const thirtyDaysAgo = new Date(startOfToday.getTime() - 29 * 24 * 60 * 60 * 1000)
  const windowStart = period?.from ?? thirtyDaysAgo
  const windowEnd = period?.to ?? startOfTomorrow
  const windowDays = Math.max(
    1,
    Math.round((windowEnd.getTime() - windowStart.getTime()) / (24 * 60 * 60 * 1000))
  )

  try {
    const [
      statusRows,
      dowHourRows,
      typeStatusRows,
      leadTimeRows,
      utilizationRow,
      doctorUtilizationRows,
      confirmationRow,
    ] = await Promise.all([
      // Status funnel — period window
      db
        .select({
          status: appointments.status,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(appointments)
        .where(and(gte(appointments.date, windowStart), sql`${appointments.date} < ${windowEnd}`))
        .groupBy(appointments.status),

      // Day-of-week × hour-of-day density
      // DOW: 0 = Sunday, 6 = Saturday (Postgres convention)
      db
        .select({
          dow: sql<number>`EXTRACT(DOW FROM ${appointments.date})::int`,
          hour: sql<number>`EXTRACT(HOUR FROM ${appointments.date})::int`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(appointments)
        .where(and(gte(appointments.date, windowStart), sql`${appointments.date} < ${windowEnd}`))
        .groupBy(
          sql`EXTRACT(DOW FROM ${appointments.date})`,
          sql`EXTRACT(HOUR FROM ${appointments.date})`
        ),

      // No-show / cancellation by appointment type
      db
        .select({
          type: appointments.type,
          status: appointments.status,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(appointments)
        .where(and(gte(appointments.date, windowStart), sql`${appointments.date} < ${windowEnd}`))
        .groupBy(appointments.type, appointments.status),

      // Lead time: appointment.date − createdAt in days
      db
        .select({
          leadDays: sql<number>`EXTRACT(EPOCH FROM (${appointments.date} - ${appointments.createdAt})) / 86400`,
        })
        .from(appointments)
        .where(and(gte(appointments.date, windowStart), sql`${appointments.date} < ${windowEnd}`)),

      // Chair utilization — avg actual vs scheduled duration on completed
      // appointments where we have inChairAt + completedAt.
      db
        .select({
          actualMinAvg: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (${appointments.completedAt} - ${appointments.inChairAt})) / 60), 0)::float`,
          scheduledMinAvg: sql<number>`COALESCE(AVG(${appointments.durationMinutes}), 0)::float`,
          completedCount: sql<number>`COUNT(*)::int`,
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.status, 'completed'),
            gte(appointments.date, windowStart),
            sql`${appointments.date} < ${windowEnd}`,
            sql`${appointments.inChairAt} IS NOT NULL`,
            sql`${appointments.completedAt} IS NOT NULL`
          )
        ),

      // Per-doctor utilisation
      db
        .select({
          doctorId: appointments.doctorId,
          appts: sql<number>`COUNT(*)::int`,
          completed: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'completed')::int`,
          noShow: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'no_show')::int`,
          totalChairMin: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (${appointments.completedAt} - ${appointments.inChairAt})) / 60) FILTER (WHERE ${appointments.status} = 'completed' AND ${appointments.inChairAt} IS NOT NULL AND ${appointments.completedAt} IS NOT NULL), 0)::float`,
        })
        .from(appointments)
        .where(and(gte(appointments.date, windowStart), sql`${appointments.date} < ${windowEnd}`))
        .groupBy(appointments.doctorId),

      // Confirmation response funnel — sent vs responded yes/no
      db
        .select({
          sent: sql<number>`COUNT(*) FILTER (WHERE ${appointments.confirmationSentAt} IS NOT NULL)::int`,
          respondedYes: sql<number>`COUNT(*) FILTER (WHERE ${appointments.confirmationResponse} = 'yes')::int`,
          respondedNo: sql<number>`COUNT(*) FILTER (WHERE ${appointments.confirmationResponse} = 'no')::int`,
          total: sql<number>`COUNT(*)::int`,
        })
        .from(appointments)
        .where(and(gte(appointments.date, windowStart), sql`${appointments.date} < ${windowEnd}`)),
    ])

    // ── Status funnel ──
    // Order matters for the funnel — scheduled → confirmed → checked_in →
    // in_chair → completed. Anything that fell out (no_show, cancelled) lives
    // off-funnel as separate counts.
    const statusMap: Record<string, number> = {}
    for (const row of statusRows) statusMap[row.status] = row.count
    const funnel = [
      { stage: 'scheduled', count: statusMap.scheduled ?? 0 },
      { stage: 'confirmed', count: statusMap.confirmed ?? 0 },
      { stage: 'checked_in', count: statusMap.checked_in ?? 0 },
      { stage: 'in_chair', count: statusMap.in_chair ?? 0 },
      { stage: 'completed', count: statusMap.completed ?? 0 },
    ]
    const lost = {
      noShow: statusMap.no_show ?? 0,
      cancelled: statusMap.cancelled ?? 0,
    }

    // ── DoW × Hour heat map ──
    // Build the full 7×14 grid (8am–9pm typical clinic hours) so the chart
    // axis is continuous even if some slots have zero bookings.
    const HOURS = Array.from({ length: 14 }, (_, i) => i + 8) // 8, 9, …, 21
    const dowHeat: Array<{ dow: number; hour: number; count: number }> = []
    const heatMap = new Map<string, number>()
    for (const row of dowHourRows) {
      heatMap.set(`${row.dow}_${row.hour}`, row.count)
    }
    for (let d = 0; d < 7; d++) {
      for (const h of HOURS) {
        dowHeat.push({ dow: d, hour: h, count: heatMap.get(`${d}_${h}`) ?? 0 })
      }
    }
    let maxHeat = 0
    for (const cell of dowHeat) if (cell.count > maxHeat) maxHeat = cell.count

    // ── No-show by type ──
    // For each type, compute no-show / total. Includes counts for table readout.
    const typeMap: Record<
      string,
      { total: number; noShow: number; cancelled: number; completed: number }
    > = {}
    for (const row of typeStatusRows) {
      if (!typeMap[row.type]) {
        typeMap[row.type] = { total: 0, noShow: 0, cancelled: 0, completed: 0 }
      }
      const bucket = typeMap[row.type]
      bucket.total += row.count
      if (row.status === 'no_show') bucket.noShow += row.count
      else if (row.status === 'cancelled') bucket.cancelled += row.count
      else if (row.status === 'completed') bucket.completed += row.count
    }
    const noShowByType = Object.entries(typeMap)
      .map(([type, m]) => ({
        type,
        total: m.total,
        completed: m.completed,
        noShow: m.noShow,
        cancelled: m.cancelled,
        noShowRate: m.total > 0 ? Math.round((m.noShow / m.total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.total - a.total)

    // ── Lead time histogram ──
    // Buckets: same-day, 1–2d, 3–7d, 8–14d, 15–30d, 30+d. Negative leads (rare
    // — manual back-dated bookings) collapse into same-day.
    const LEAD_BUCKETS = [
      { label: 'Same day', min: 0, max: 1 },
      { label: '1–2 days', min: 1, max: 3 },
      { label: '3–7 days', min: 3, max: 8 },
      { label: '8–14 days', min: 8, max: 15 },
      { label: '15–30 days', min: 15, max: 31 },
      { label: '30+ days', min: 31, max: Infinity },
    ]
    const leadHistogram = LEAD_BUCKETS.map((b) => ({ label: b.label, count: 0 }))
    let leadSum = 0
    let leadCount = 0
    for (const row of leadTimeRows) {
      const raw = Number(row.leadDays ?? 0)
      const days = raw < 0 ? 0 : raw
      leadSum += days
      leadCount++
      for (let i = 0; i < LEAD_BUCKETS.length; i++) {
        if (days >= LEAD_BUCKETS[i].min && days < LEAD_BUCKETS[i].max) {
          leadHistogram[i].count++
          break
        }
      }
    }
    const avgLeadDays = leadCount > 0 ? Math.round((leadSum / leadCount) * 10) / 10 : 0

    const totalAppt = funnel.reduce((s, f) => s + f.count, 0) + lost.noShow + lost.cancelled
    const noShowRate = totalAppt > 0 ? Math.round((lost.noShow / totalAppt) * 1000) / 10 : 0
    const cancellationRate =
      totalAppt > 0 ? Math.round((lost.cancelled / totalAppt) * 1000) / 10 : 0

    // ── Utilization ──
    const util = utilizationRow[0] ?? {
      actualMinAvg: 0,
      scheduledMinAvg: 0,
      completedCount: 0,
    }
    const utilRatioPct =
      util.scheduledMinAvg > 0
        ? Math.round((util.actualMinAvg / util.scheduledMinAvg) * 1000) / 10
        : 0

    const doctorUtilization = doctorUtilizationRows
      .map((r) => ({
        doctorId: r.doctorId,
        appts: r.appts,
        completed: r.completed,
        noShow: r.noShow,
        completionRatePct: r.appts > 0 ? Math.round((r.completed / r.appts) * 1000) / 10 : 0,
        chairHours: Math.round((r.totalChairMin / 60) * 10) / 10,
      }))
      .sort((a, b) => b.appts - a.appts)

    // ── Confirmation funnel ──
    const conf = confirmationRow[0] ?? { sent: 0, respondedYes: 0, respondedNo: 0, total: 0 }
    const confirmationFunnel = {
      total: conf.total,
      sent: conf.sent,
      respondedYes: conf.respondedYes,
      respondedNo: conf.respondedNo,
      responseRatePct:
        conf.sent > 0
          ? Math.round(((conf.respondedYes + conf.respondedNo) / conf.sent) * 1000) / 10
          : 0,
      yesRatePct:
        conf.respondedYes + conf.respondedNo > 0
          ? Math.round((conf.respondedYes / (conf.respondedYes + conf.respondedNo)) * 1000) / 10
          : 0,
    }

    return c.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        window: { days: windowDays, from: windowStart.toISOString(), to: windowEnd.toISOString() },
        tiles: {
          totalAppointments: totalAppt,
          completed: statusMap.completed ?? 0,
          noShow: lost.noShow,
          cancelled: lost.cancelled,
          noShowRate,
          cancellationRate,
          avgLeadDays,
          avgActualMinutes: Math.round(util.actualMinAvg * 10) / 10,
          avgScheduledMinutes: Math.round(util.scheduledMinAvg * 10) / 10,
          utilizationRatioPct: utilRatioPct,
          confirmationResponseRatePct: confirmationFunnel.responseRatePct,
          confirmationYesRatePct: confirmationFunnel.yesRatePct,
        },
        funnel,
        lost,
        dowHeat,
        maxHeat,
        noShowByType,
        leadHistogram,
        doctorUtilization,
        confirmationFunnel,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[analytics/operational-appointments]' })
    return c.json({ error: 'Failed to fetch appointment operations' }, 500)
  }
})

// ─── GET /operational/lab ─────────────────────────────────────────────────────
analyticsApp.get('/operational/lab', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const allowed = await checkPermission(c, user.id, MODULES.LABS, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  await logAnalyticsAccess(c, 'operational-lab', '')

  const db = getDb(process.env.DATABASE_URL!)

  const period = parsePeriod(c)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const ninetyDaysAgo = new Date(startOfToday.getTime() - 89 * 24 * 60 * 60 * 1000)
  const completedWindowStart = period?.from ?? ninetyDaysAgo
  const completedWindowEnd = period?.to ?? new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)

  try {
    const [
      statusRows,
      vendorPerfRows,
      delayedRows,
      domainMixRows,
      economicsRow,
      monthlyEconomicsRows,
    ] = await Promise.all([
      // Current-snapshot status funnel (NOT windowed — these are the live
      // pipeline counts the lab coordinator watches)
      db
        .select({
          status: labCases.status,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(labCases)
        .groupBy(labCases.status),

      // Vendor performance — last 90 days of completed (inserted) cases
      // avg turnaround = AVG(insertedAt - sentAt) in days
      // SLA % = (inserted on/before expectedReturn) / total inserted
      db
        .select({
          vendorId: labCases.vendorId,
          vendorName: labVendors.name,
          totalCompleted: sql<number>`COUNT(*)::int`,
          avgTurnaroundDays: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (${labCases.insertedAt} - ${labCases.sentAt})) / 86400), 0)::float`,
          onTimeCount: sql<number>`COUNT(*) FILTER (WHERE ${labCases.expectedReturn} IS NOT NULL AND ${labCases.insertedAt} <= ${labCases.expectedReturn})::int`,
          withDeadlineCount: sql<number>`COUNT(*) FILTER (WHERE ${labCases.expectedReturn} IS NOT NULL)::int`,
        })
        .from(labCases)
        .leftJoin(labVendors, eq(labCases.vendorId, labVendors.id))
        .where(
          and(
            eq(labCases.status, 'inserted'),
            sql`${labCases.insertedAt} IS NOT NULL`,
            sql`${labCases.sentAt} IS NOT NULL`,
            gte(labCases.insertedAt, completedWindowStart),
            sql`${labCases.insertedAt} < ${completedWindowEnd}`
          )
        )
        .groupBy(labCases.vendorId, labVendors.name),

      // Delayed cases with reason (current snapshot)
      db
        .select({
          delayReason: labCases.delayReason,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(labCases)
        .where(and(eq(labCases.status, 'delayed'), sql`${labCases.delayReason} IS NOT NULL`))
        .groupBy(labCases.delayReason),

      // Internal vs external mix (current snapshot of pipeline)
      db
        .select({
          domain: labCases.domain,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(labCases)
        .where(sql`${labCases.status} NOT IN ('inserted', 'cancelled')`)
        .groupBy(labCases.domain),

      // Economics — labCost and patientCharge totals per domain over window
      db
        .select({
          domain: labCases.domain,
          totalLabCost: sql<number>`COALESCE(SUM(${labCases.labCost}), 0)::float`,
          totalPatientCharge: sql<number>`COALESCE(SUM(${labCases.patientCharge}), 0)::float`,
          caseCount: sql<number>`COUNT(*)::int`,
        })
        .from(labCases)
        .where(
          and(
            gte(labCases.createdAt, completedWindowStart),
            sql`${labCases.createdAt} < ${completedWindowEnd}`,
            sql`${labCases.status} <> 'cancelled'`
          )
        )
        .groupBy(labCases.domain),

      // Monthly cost-per-case + margin trend
      db
        .select({
          month: sql<string>`TO_CHAR(DATE_TRUNC('month', ${labCases.createdAt}), 'YYYY-MM')`,
          totalLabCost: sql<number>`COALESCE(SUM(${labCases.labCost}), 0)::float`,
          totalPatientCharge: sql<number>`COALESCE(SUM(${labCases.patientCharge}), 0)::float`,
          caseCount: sql<number>`COUNT(*)::int`,
        })
        .from(labCases)
        .where(
          and(
            gte(labCases.createdAt, completedWindowStart),
            sql`${labCases.createdAt} < ${completedWindowEnd}`,
            sql`${labCases.status} <> 'cancelled'`
          )
        )
        .groupBy(sql`DATE_TRUNC('month', ${labCases.createdAt})`)
        .orderBy(sql`DATE_TRUNC('month', ${labCases.createdAt})`),
    ])

    // Status funnel: draft → sent → received → inserted, plus delayed and
    // cancelled off-funnel for the readout.
    const statusMap: Record<string, number> = {}
    for (const row of statusRows) statusMap[row.status] = row.count
    const funnel = [
      { stage: 'draft', count: statusMap.draft ?? 0 },
      { stage: 'sent', count: statusMap.sent ?? 0 },
      { stage: 'received', count: statusMap.received ?? 0 },
      { stage: 'inserted', count: statusMap.inserted ?? 0 },
    ]
    const sideline = {
      delayed: statusMap.delayed ?? 0,
      cancelled: statusMap.cancelled ?? 0,
    }
    const activeCount =
      (statusMap.draft ?? 0) +
      (statusMap.sent ?? 0) +
      (statusMap.received ?? 0) +
      (statusMap.delayed ?? 0)

    const vendorPerformance = vendorPerfRows
      .map((r) => ({
        vendorId: r.vendorId,
        vendorName: r.vendorName ?? 'Unknown',
        completed: r.totalCompleted,
        avgTurnaroundDays: Math.round((r.avgTurnaroundDays ?? 0) * 10) / 10,
        onTimeRate:
          r.withDeadlineCount > 0
            ? Math.round((r.onTimeCount / r.withDeadlineCount) * 1000) / 10
            : null,
        casesWithDeadline: r.withDeadlineCount,
      }))
      .sort((a, b) => b.completed - a.completed)

    const delayReasons = delayedRows
      .map((r) => ({ reason: r.delayReason ?? 'Unspecified', count: r.count }))
      .sort((a, b) => b.count - a.count)

    const domainMixMap: Record<string, number> = {}
    for (const row of domainMixRows) domainMixMap[row.domain] = row.count

    // ── Economics by domain ──
    const economicsByDomain = economicsRow.map((r) => {
      const margin = r.totalPatientCharge - r.totalLabCost
      return {
        domain: r.domain,
        caseCount: r.caseCount,
        totalLabCost: Math.round(r.totalLabCost * 100) / 100,
        totalPatientCharge: Math.round(r.totalPatientCharge * 100) / 100,
        margin: Math.round(margin * 100) / 100,
        avgLabCost: r.caseCount > 0 ? Math.round((r.totalLabCost / r.caseCount) * 100) / 100 : 0,
        avgPatientCharge:
          r.caseCount > 0 ? Math.round((r.totalPatientCharge / r.caseCount) * 100) / 100 : 0,
        marginPct:
          r.totalPatientCharge > 0 ? Math.round((margin / r.totalPatientCharge) * 1000) / 10 : 0,
      }
    })
    const totalLabCost = economicsByDomain.reduce((s, d) => s + d.totalLabCost, 0)
    const totalPatientCharge = economicsByDomain.reduce((s, d) => s + d.totalPatientCharge, 0)
    const totalCaseCount = economicsByDomain.reduce((s, d) => s + d.caseCount, 0)
    const overallMargin = totalPatientCharge - totalLabCost
    const overallMarginPct =
      totalPatientCharge > 0 ? Math.round((overallMargin / totalPatientCharge) * 1000) / 10 : 0

    const economicsMonthly = monthlyEconomicsRows.map((r) => ({
      month: r.month,
      caseCount: r.caseCount,
      avgLabCost: r.caseCount > 0 ? Math.round((r.totalLabCost / r.caseCount) * 100) / 100 : 0,
      avgPatientCharge:
        r.caseCount > 0 ? Math.round((r.totalPatientCharge / r.caseCount) * 100) / 100 : 0,
      marginPct:
        r.totalPatientCharge > 0
          ? Math.round(((r.totalPatientCharge - r.totalLabCost) / r.totalPatientCharge) * 1000) / 10
          : 0,
    }))

    return c.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        tiles: {
          activeCases: activeCount,
          completed90d: vendorPerformance.reduce((s, v) => s + v.completed, 0),
          delayed: sideline.delayed,
          avgTurnaroundDays:
            vendorPerformance.length > 0
              ? Math.round(
                  (vendorPerformance.reduce((s, v) => s + v.avgTurnaroundDays * v.completed, 0) /
                    Math.max(
                      vendorPerformance.reduce((s, v) => s + v.completed, 0),
                      1
                    )) *
                    10
                ) / 10
              : 0,
          totalLabCost: Math.round(totalLabCost * 100) / 100,
          totalPatientCharge: Math.round(totalPatientCharge * 100) / 100,
          overallMargin: Math.round(overallMargin * 100) / 100,
          overallMarginPct,
          avgCostPerCase:
            totalCaseCount > 0 ? Math.round((totalLabCost / totalCaseCount) * 100) / 100 : 0,
        },
        funnel,
        sideline,
        vendorPerformance,
        delayReasons,
        domainMix: {
          internal: domainMixMap.internal ?? 0,
          external: domainMixMap.external ?? 0,
        },
        economicsByDomain,
        economicsMonthly,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[analytics/operational-lab]' })
    return c.json({ error: 'Failed to fetch lab operations' }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// Patient analytics — Sprint 3
// Cohort retention lives under Financial; this endpoint covers the rest of the
// patient-base health view: acquisition trend, demographics, LTV distribution,
// PWA adoption, and the inactive-patient action list.
// ═══════════════════════════════════════════════════════════════════════════════

analyticsApp.get('/patient', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const allowed = await checkPermission(c, user.id, MODULES.PATIENTS, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  await logAnalyticsAccess(c, 'patient', '')

  const db = getDb(process.env.DATABASE_URL!)

  const period = parsePeriod(c)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const thirtyDaysAgo = new Date(startOfToday.getTime() - 29 * 24 * 60 * 60 * 1000)
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1)
  const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
  const newWindowStart = period?.from ?? startOfMonth
  const newWindowEnd = period?.to ?? new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)
  const activityWindowStart = period?.from ?? thirtyDaysAgo
  const activityWindowEnd = period?.to ?? new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)
  const trendWindowStart = period?.from ?? twelveMonthsAgo
  const trendWindowEnd = period?.to ?? new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)

  try {
    const [
      totalPatientsRow,
      newThisMonthRow,
      acquisitionRows,
      ltvRows,
      ageRows,
      genderRows,
      categoryRows,
      orthoCountRow,
      childCountRow,
      orthoChildCountRow,
      pwaCountRow,
      pwaActiveRow,
      activeAppointmentRow,
      inactivePatients,
      lastVisitMap,
    ] = await Promise.all([
      db.select({ count: sql<number>`COUNT(*)::int` }).from(patients),

      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(patients)
        .where(
          and(gte(patients.createdAt, newWindowStart), sql`${patients.createdAt} < ${newWindowEnd}`)
        ),

      // Acquisition trend over period (or trailing 12 months default)
      db
        .select({
          month: sql<string>`TO_CHAR(DATE_TRUNC('month', "createdAt"), 'YYYY-MM')`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(patients)
        .where(
          and(
            gte(patients.createdAt, trendWindowStart),
            sql`${patients.createdAt} < ${trendWindowEnd}`
          )
        )
        .groupBy(sql`DATE_TRUNC('month', "createdAt")`)
        .orderBy(sql`DATE_TRUNC('month', "createdAt")`),

      // LTV = SUM(payments.amount) per patient. We compute distribution + key
      // percentiles in JS rather than relying on Postgres percentile_cont so
      // the same code can fall back if the cluster doesn't have the function
      // permitted.
      db
        .select({
          patientId: payments.patientId,
          total: sql<number>`COALESCE(SUM(amount), 0)::float`,
        })
        .from(payments)
        .where(eq(payments.status, 'posted'))
        .groupBy(payments.patientId),

      // Age in whole years for every patient with a dob
      db
        .select({
          age: sql<number>`EXTRACT(YEAR FROM AGE(${patients.dob}))::int`,
        })
        .from(patients),

      db
        .select({
          gender: patients.gender,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(patients)
        .groupBy(patients.gender),

      db
        .select({
          category: patients.category,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(patients)
        .groupBy(patients.category),

      // §2.7: ortho membership is derived from the 'Ortho' patient tag (EXISTS on
      // the patient_tags junction) rather than the legacy isOrtho column. isChild
      // stays a real column. The EXISTS subquery composes into WHERE cleanly but
      // NOT into GROUP BY (Drizzle qualifies patients.id differently in SELECT vs
      // GROUP BY, so Postgres rejects the grouped form) — so we issue three
      // point counts instead.
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(patients)
        .where(hasOrthoTag(patients.id)),

      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(patients)
        .where(eq(patients.isChild, true)),

      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(patients)
        .where(and(hasOrthoTag(patients.id), eq(patients.isChild, true))),

      // PWA: patients who have access enabled
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(patients)
        .where(eq(patients.pwaAccessEnabled, true)),

      // PWA active in period (or trailing 30d default)
      db
        .select({
          count: sql<number>`COUNT(DISTINCT ${patientSessions.patientId})::int`,
        })
        .from(patientSessions)
        .where(
          and(
            gte(patientSessions.lastUsedAt, activityWindowStart),
            sql`${patientSessions.lastUsedAt} < ${activityWindowEnd}`
          )
        ),

      // Active patient definition: any completed appointment within the active
      // window. Captures the operating definition of "currently engaged".
      db
        .select({
          count: sql<number>`COUNT(DISTINCT ${appointments.patientId})::int`,
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.status, 'completed'),
            gte(appointments.date, activityWindowStart),
            sql`${appointments.date} < ${activityWindowEnd}`
          )
        ),

      // Inactive list: patients with no completed appointment in the last 12
      // months. Limit to 25 for the UI; the full list can be exported via the
      // Data Inject CSV path later.
      db.execute(sql`
        SELECT
          p.id,
          p."patientId",
          p.name,
          p.email,
          p.phone,
          p."createdAt",
          MAX(a.date) AS last_visit
        FROM ${patients} p
        LEFT JOIN ${appointments} a ON a."patientId" = p.id AND a.status = 'completed'
        GROUP BY p.id, p."patientId", p.name, p.email, p.phone, p."createdAt"
        HAVING MAX(a.date) IS NULL OR MAX(a.date) < ${oneYearAgo}
        ORDER BY MAX(a.date) ASC NULLS LAST
        LIMIT 25
      `),

      // Sum of last_visit timestamps (full count of inactive patients) so we
      // can show "showing 25 of N" without paginating.
      db.execute(sql`
        SELECT COUNT(*)::int AS total
        FROM (
          SELECT p.id
          FROM ${patients} p
          LEFT JOIN ${appointments} a ON a."patientId" = p.id AND a.status = 'completed'
          GROUP BY p.id
          HAVING MAX(a.date) IS NULL OR MAX(a.date) < ${oneYearAgo}
        ) sub
      `),
    ])

    // ── Tiles ────────────────────────────────────────────────────────────────
    const totalPatients = totalPatientsRow[0]?.count ?? 0
    const newThisMonth = newThisMonthRow[0]?.count ?? 0
    const pwaEnabled = pwaCountRow[0]?.count ?? 0
    const pwaActive30d = pwaActiveRow[0]?.count ?? 0
    const activeNow = activeAppointmentRow[0]?.count ?? 0
    const inactiveTotal = (lastVisitMap.rows[0] as { total: number } | undefined)?.total ?? 0

    // ── Acquisition trend ─────────────────────────────────────────────────────
    // Zero-fill the 12-month axis so a sparse run of months still renders a
    // continuous line.
    const monthLabels: string[] = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      monthLabels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    const acqMap: Record<string, number> = {}
    for (const row of acquisitionRows) acqMap[row.month] = row.count
    const acquisition = monthLabels.map((m) => ({
      month: m,
      count: acqMap[m] ?? 0,
    }))

    // ── LTV distribution ─────────────────────────────────────────────────────
    const LTV_BUCKETS = [
      { label: '0', min: 0, max: 1 },
      { label: '1–100', min: 1, max: 100 },
      { label: '100–500', min: 100, max: 500 },
      { label: '500–1K', min: 500, max: 1_000 },
      { label: '1K–2.5K', min: 1_000, max: 2_500 },
      { label: '2.5K–5K', min: 2_500, max: 5_000 },
      { label: '5K–10K', min: 5_000, max: 10_000 },
      { label: '10K+', min: 10_000, max: Infinity },
    ]
    const ltvHistogram = LTV_BUCKETS.map((b) => ({ label: b.label, count: 0 }))
    const ltvValues: number[] = []
    for (const row of ltvRows) {
      const v = row.total ?? 0
      ltvValues.push(v)
      for (let i = 0; i < LTV_BUCKETS.length; i++) {
        if (v >= LTV_BUCKETS[i].min && v < LTV_BUCKETS[i].max) {
          ltvHistogram[i].count++
          break
        }
      }
    }
    ltvValues.sort((a, b) => a - b)
    const ltvMedian = ltvValues.length > 0 ? ltvValues[Math.floor(ltvValues.length / 2)] : 0
    const ltvP90 = ltvValues.length > 0 ? ltvValues[Math.floor(ltvValues.length * 0.9)] : 0
    const ltvMean =
      ltvValues.length > 0 ? ltvValues.reduce((s, v) => s + v, 0) / ltvValues.length : 0
    // Top-decile share: contribution of the top 10% of patients to total LTV
    const top10Start = Math.floor(ltvValues.length * 0.9)
    const totalLtv = ltvValues.reduce((s, v) => s + v, 0)
    const top10Sum = ltvValues.slice(top10Start).reduce((s, v) => s + v, 0)
    const top10Share = totalLtv > 0 ? Math.round((top10Sum / totalLtv) * 1000) / 10 : 0

    // ── Age distribution ─────────────────────────────────────────────────────
    const AGE_BUCKETS = [
      { label: '0–9', min: 0, max: 10 },
      { label: '10–19', min: 10, max: 20 },
      { label: '20–29', min: 20, max: 30 },
      { label: '30–39', min: 30, max: 40 },
      { label: '40–49', min: 40, max: 50 },
      { label: '50–59', min: 50, max: 60 },
      { label: '60–69', min: 60, max: 70 },
      { label: '70+', min: 70, max: 200 },
    ]
    const ageHistogram = AGE_BUCKETS.map((b) => ({ label: b.label, count: 0 }))
    let ageSum = 0
    let ageCount = 0
    for (const row of ageRows) {
      const age = Number(row.age ?? -1)
      if (age < 0) continue
      ageSum += age
      ageCount++
      for (let i = 0; i < AGE_BUCKETS.length; i++) {
        if (age >= AGE_BUCKETS[i].min && age < AGE_BUCKETS[i].max) {
          ageHistogram[i].count++
          break
        }
      }
    }
    const avgAge = ageCount > 0 ? Math.round((ageSum / ageCount) * 10) / 10 : 0

    // ── Gender + Category mix ────────────────────────────────────────────────
    const genderMix = genderRows.map((r) => ({
      gender: r.gender || 'Unspecified',
      count: r.count,
    }))
    const categoryMix = categoryRows.map((r) => ({
      category: r.category || 'Uncategorised',
      count: r.count,
    }))

    const orthoCount = orthoCountRow[0]?.count ?? 0
    const childCount = childCountRow[0]?.count ?? 0
    const orthoChildCount = orthoChildCountRow[0]?.count ?? 0

    // ── Inactive list ────────────────────────────────────────────────────────
    const inactiveList = (inactivePatients.rows as any[]).map((row) => ({
      id: row.id as string,
      patientId: row.patientId as string,
      name: row.name as string,
      email: (row.email as string | null) ?? null,
      phone: (row.phone as string | null) ?? null,
      createdAt: new Date(row.createdAt as string).toISOString(),
      lastVisit: row.last_visit ? new Date(row.last_visit as string).toISOString() : null,
      daysSinceLastVisit: row.last_visit
        ? Math.floor((now.getTime() - new Date(row.last_visit as string).getTime()) / 86_400_000)
        : null,
    }))

    return c.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        tiles: {
          totalPatients,
          newThisMonth,
          activeLast30d: activeNow,
          inactive12mo: inactiveTotal,
          pwaEnabled,
          pwaActive30d,
          orthoCount,
          childCount,
        },
        acquisition,
        ltv: {
          histogram: ltvHistogram,
          median: Math.round(ltvMedian * 100) / 100,
          mean: Math.round(ltvMean * 100) / 100,
          p90: Math.round(ltvP90 * 100) / 100,
          top10ShareOfRevenuePct: top10Share,
          payerCount: ltvValues.length,
        },
        demographics: {
          ageHistogram,
          avgAge,
          genderMix,
        },
        mix: {
          category: categoryMix,
          orthoCount,
          childCount,
          orthoChildCount,
        },
        inactiveList,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[analytics/patient]' })
    return c.json({ error: 'Failed to fetch patient analytics' }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// Compliance & Risk — Sprint 7
// The admin/CISO view. Three lenses:
//   1) Expiring controls — staff credentials, staff docs, clinic compliance
//      docs that will lapse soon. The "things that need attention now" list.
//   2) System activity — audit log volume by module, top audited entities,
//      soft-delete activity. Shows who/what is being changed at scale.
//   3) Security signals — failed login trend, recent sync errors. Watch for
//      anomaly spikes.
// ═══════════════════════════════════════════════════════════════════════════════

analyticsApp.get('/compliance', async (c) => {
  const u = await getCurrentUser(c)
  if (!u) return c.json({ error: 'Not authenticated' }, 401)

  // Audit logs + login attempts are higher-sensitivity than staff data, so we
  // gate on AUDIT_LOGS:READ. Admins (with the all-modules role) bypass.
  const allowed = await checkPermission(c, u.id, MODULES.AUDIT_LOGS, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  await logAnalyticsAccess(c, 'compliance', '')

  const db = getDb(process.env.DATABASE_URL!)

  const period = parsePeriod(c)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const sevenDaysAgo = new Date(startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000)
  const thirtyDaysAgo = new Date(startOfToday.getTime() - 29 * 24 * 60 * 60 * 1000)
  const ninetyDaysFromNow = new Date(startOfToday.getTime() + 90 * 24 * 60 * 60 * 1000)
  // Audit/login activity is the only period-bound surface here; expiring controls
  // are forward-looking snapshots and stay anchored to "today".
  const auditWindowStart = period?.from ?? thirtyDaysAgo
  const auditWindowEnd = period?.to ?? new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)
  const syncWindowStart = period?.from ?? sevenDaysAgo
  const syncWindowEnd = period?.to ?? new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)

  try {
    const [
      credentialsExpiringRows,
      credentialsExpiredRows,
      credentialsSuspendedRow,
      staffDocsExpiringRows,
      complianceDocsExpiringRows,
      complianceDocsExpiredRow,
      auditVolume30dRows,
      auditModuleMixRow,
      topEntitiesRows,
      softDeleteRows,
      failedLoginTrendRows,
      failedLogin24hRow,
      syncErrors7dRows,
      syncErrorTotalRow,
      auditTotalRow,
    ] = await Promise.all([
      // Staff credentials expiring in next 90 days (forward-looking)
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
        .where(
          and(
            sql`${staffCredentials.expiryDate} IS NOT NULL`,
            sql`${staffCredentials.expiryDate} >= ${now}`,
            sql`${staffCredentials.expiryDate} <= ${ninetyDaysFromNow}`
          )
        )
        .orderBy(asc(staffCredentials.expiryDate)),

      // Credentials that already lapsed
      db
        .select({
          id: staffCredentials.id,
          staffId: staffCredentials.staffId,
          credentialName: staffCredentials.credentialName,
          credentialType: staffCredentials.credentialType,
          expiryDate: staffCredentials.expiryDate,
        })
        .from(staffCredentials)
        .where(
          and(
            sql`${staffCredentials.expiryDate} IS NOT NULL`,
            sql`${staffCredentials.expiryDate} < ${now}`
          )
        )
        .orderBy(desc(staffCredentials.expiryDate)),

      // Currently suspended credentials (lapse-driven)
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(staffCredentials)
        .where(eq(staffCredentials.suspendedDueToLapse, true)),

      // Staff documents (uploads with expiry) expiring next 90 days
      db
        .select({
          id: staffDocuments.id,
          staffId: staffDocuments.staffId,
          title: staffDocuments.title,
          documentType: staffDocuments.documentType,
          expiryDate: staffDocuments.expiryDate,
        })
        .from(staffDocuments)
        .where(
          and(
            sql`${staffDocuments.expiryDate} IS NOT NULL`,
            sql`${staffDocuments.expiryDate} >= ${now}`,
            sql`${staffDocuments.expiryDate} <= ${ninetyDaysFromNow}`
          )
        )
        .orderBy(asc(staffDocuments.expiryDate)),

      // Clinic-wide compliance docs expiring soon
      db
        .select({
          id: complianceDocuments.id,
          documentName: complianceDocuments.documentName,
          category: complianceDocuments.category,
          dateExpired: complianceDocuments.dateExpired,
        })
        .from(complianceDocuments)
        .where(
          and(
            sql`${complianceDocuments.dateExpired} IS NOT NULL`,
            sql`${complianceDocuments.dateExpired} >= ${now}`,
            sql`${complianceDocuments.dateExpired} <= ${ninetyDaysFromNow}`
          )
        )
        .orderBy(asc(complianceDocuments.dateExpired)),

      // Compliance docs already past expiry — the urgent backlog
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(complianceDocuments)
        .where(
          and(
            sql`${complianceDocuments.dateExpired} IS NOT NULL`,
            sql`${complianceDocuments.dateExpired} < ${now}`
          )
        ),

      // Audit log volume per day per module
      db
        .select({
          day: sql<string>`DATE(${auditLogs.createdAt})::text`,
          module: auditLogs.module,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(auditLogs)
        .where(
          and(
            gte(auditLogs.createdAt, auditWindowStart),
            sql`${auditLogs.createdAt} < ${auditWindowEnd}`
          )
        )
        .groupBy(sql`DATE(${auditLogs.createdAt})`, auditLogs.module)
        .orderBy(sql`DATE(${auditLogs.createdAt})`),

      // Total by module — for the ranked list
      db
        .select({
          module: auditLogs.module,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(auditLogs)
        .where(
          and(
            gte(auditLogs.createdAt, auditWindowStart),
            sql`${auditLogs.createdAt} < ${auditWindowEnd}`
          )
        )
        .groupBy(auditLogs.module)
        .orderBy(desc(sql`COUNT(*)`)),

      // Top audited entities, top 20
      db
        .select({
          module: auditLogs.module,
          entityId: auditLogs.entityId,
          entityName: auditLogs.entityName,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(auditLogs)
        .where(
          and(
            gte(auditLogs.createdAt, auditWindowStart),
            sql`${auditLogs.createdAt} < ${auditWindowEnd}`,
            sql`${auditLogs.entityId} IS NOT NULL`
          )
        )
        .groupBy(auditLogs.module, auditLogs.entityId, auditLogs.entityName)
        .orderBy(desc(sql`COUNT(*)`))
        .limit(20),

      // Soft-delete activity grouped by module
      db
        .select({
          module: auditLogs.module,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(auditLogs)
        .where(
          and(
            gte(auditLogs.createdAt, auditWindowStart),
            sql`${auditLogs.createdAt} < ${auditWindowEnd}`,
            eq(auditLogs.action, 'delete')
          )
        )
        .groupBy(auditLogs.module)
        .orderBy(desc(sql`COUNT(*)`)),

      // Failed login attempts — daily trend over period
      db
        .select({
          day: sql<string>`DATE(${loginAttempts.attemptedAt})::text`,
          failed: sql<number>`COUNT(*) FILTER (WHERE ${loginAttempts.success} = false)::int`,
          success: sql<number>`COUNT(*) FILTER (WHERE ${loginAttempts.success} = true)::int`,
        })
        .from(loginAttempts)
        .where(
          and(
            gte(loginAttempts.attemptedAt, auditWindowStart),
            sql`${loginAttempts.attemptedAt} < ${auditWindowEnd}`
          )
        )
        .groupBy(sql`DATE(${loginAttempts.attemptedAt})`)
        .orderBy(sql`DATE(${loginAttempts.attemptedAt})`),

      // Failed login count last 24h
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(loginAttempts)
        .where(and(eq(loginAttempts.success, false), gte(loginAttempts.attemptedAt, oneDayAgo))),

      // Recent sync errors over period (defaults to last 7 days)
      db
        .select({
          id: syncLog.id,
          entityType: syncLog.entityType,
          entityId: syncLog.entityId,
          destination: syncLog.destination,
          errorMessage: syncLog.errorMessage,
          syncedAt: syncLog.syncedAt,
        })
        .from(syncLog)
        .where(
          and(
            eq(syncLog.success, false),
            gte(syncLog.syncedAt, syncWindowStart),
            sql`${syncLog.syncedAt} < ${syncWindowEnd}`
          )
        )
        .orderBy(desc(syncLog.syncedAt))
        .limit(20),

      // Sync error total over period
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(syncLog)
        .where(
          and(
            eq(syncLog.success, false),
            gte(syncLog.syncedAt, syncWindowStart),
            sql`${syncLog.syncedAt} < ${syncWindowEnd}`
          )
        ),

      // Audit total (24h)
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(auditLogs)
        .where(gte(auditLogs.createdAt, oneDayAgo)),
    ])

    // ── Severity bucketing for credentials list ─────────────────────────────
    const credentialsExpiring = credentialsExpiringRows.map((r) => {
      const expiry = r.expiryDate as Date
      const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / 86_400_000)
      const severity = daysLeft < 14 ? 'danger' : daysLeft < 30 ? 'warning' : 'default'
      return {
        id: r.id,
        staffId: r.staffId,
        credentialType: r.credentialType,
        credentialName: r.credentialName,
        expiryDate: expiry.toISOString(),
        daysLeft,
        severity,
      }
    })

    const expiringCredsNext30 = credentialsExpiring.filter((c) => c.daysLeft < 30).length

    const credentialsExpired = credentialsExpiredRows.map((r) => {
      const expiry = r.expiryDate as Date
      const daysAgo = Math.ceil((now.getTime() - expiry.getTime()) / 86_400_000)
      return {
        id: r.id,
        staffId: r.staffId,
        credentialType: r.credentialType,
        credentialName: r.credentialName,
        expiryDate: expiry.toISOString(),
        daysAgo,
      }
    })

    const staffDocsExpiring = staffDocsExpiringRows.map((r) => {
      const expiry = r.expiryDate as Date
      const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / 86_400_000)
      return {
        id: r.id,
        staffId: r.staffId,
        title: r.title,
        documentType: r.documentType,
        expiryDate: expiry.toISOString(),
        daysLeft,
      }
    })

    const complianceDocsExpiring = complianceDocsExpiringRows.map((r) => {
      const expiry = r.dateExpired as Date
      const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / 86_400_000)
      return {
        id: r.id,
        documentName: r.documentName,
        category: r.category,
        dateExpired: expiry.toISOString(),
        daysLeft,
      }
    })

    // ── Audit activity ─────────────────────────────────────────────────────
    // Pivot daily counts: top 5 modules get their own series, everything else
    // folds into "other" so the stacked chart stays readable.
    const moduleTotals = auditModuleMixRow.map((r) => ({
      module: r.module,
      count: r.count,
    }))
    const topModules = moduleTotals.slice(0, 5).map((m) => m.module)
    const topModuleSet = new Set(topModules)

    const auditDayMap = new Map<string, Record<string, number>>()
    const fillDay = (day: string): Record<string, number> => {
      const existing = auditDayMap.get(day)
      if (existing) return existing
      const fresh: Record<string, number> = { other: 0 }
      for (const m of topModules) fresh[m] = 0
      auditDayMap.set(day, fresh)
      return fresh
    }

    for (let d = 29; d >= 0; d--) {
      const date = new Date(startOfToday.getTime() - d * 86_400_000)
      const dayStr = date.toISOString().slice(0, 10)
      fillDay(dayStr)
    }

    for (const row of auditVolume30dRows) {
      const day = fillDay(row.day)
      if (topModuleSet.has(row.module)) {
        day[row.module] = (day[row.module] ?? 0) + row.count
      } else {
        day.other = (day.other ?? 0) + row.count
      }
    }

    const auditTrend = Array.from(auditDayMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, counts]) => ({ day, ...counts }))

    const topEntities = topEntitiesRows.map((r) => ({
      module: r.module,
      entityId: r.entityId,
      entityName: r.entityName,
      count: r.count,
    }))

    const softDeleteByModule = softDeleteRows.map((r) => ({
      module: r.module,
      count: r.count,
    }))

    // ── Login activity ─────────────────────────────────────────────────────
    const loginDayMap = new Map<string, { day: string; failed: number; success: number }>()
    for (let d = 29; d >= 0; d--) {
      const date = new Date(startOfToday.getTime() - d * 86_400_000)
      const dayStr = date.toISOString().slice(0, 10)
      loginDayMap.set(dayStr, { day: dayStr, failed: 0, success: 0 })
    }
    for (const row of failedLoginTrendRows) {
      const existing = loginDayMap.get(row.day)
      if (existing) {
        existing.failed = row.failed
        existing.success = row.success
      }
    }
    const loginTrend = Array.from(loginDayMap.values())

    let totalFailed30d = 0
    let totalSuccess30d = 0
    for (const d of loginTrend) {
      totalFailed30d += d.failed
      totalSuccess30d += d.success
    }

    const failedLogin24h = failedLogin24hRow[0]?.count ?? 0

    // ── Sync errors ─────────────────────────────────────────────────────────
    const syncErrors = syncErrors7dRows.map((r) => ({
      id: r.id,
      entityType: r.entityType,
      entityId: r.entityId,
      destination: r.destination,
      errorMessage: r.errorMessage,
      syncedAt: r.syncedAt.toISOString(),
    }))
    const syncErrorTotal7d = syncErrorTotalRow[0]?.count ?? 0

    return c.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        tiles: {
          credentialsExpiring90d: credentialsExpiring.length,
          credentialsExpiring30d: expiringCredsNext30,
          credentialsExpired: credentialsExpired.length,
          credentialsSuspended: credentialsSuspendedRow[0]?.count ?? 0,
          staffDocsExpiring90d: staffDocsExpiring.length,
          complianceDocsExpiring90d: complianceDocsExpiring.length,
          complianceDocsExpired: complianceDocsExpiredRow[0]?.count ?? 0,
          auditEvents24h: auditTotalRow[0]?.count ?? 0,
          failedLogins24h: failedLogin24h,
          failedLogins30d: totalFailed30d,
          successLogins30d: totalSuccess30d,
          syncErrors7d: syncErrorTotal7d,
        },
        credentialsExpiring,
        credentialsExpired,
        staffDocsExpiring,
        complianceDocsExpiring,
        auditTrend,
        auditModules: topModules,
        moduleTotals,
        topEntities,
        softDeleteByModule,
        loginTrend,
        syncErrors,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[analytics/compliance]' })
    return c.json({ error: 'Failed to fetch compliance analytics' }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// Clinical analytics — Sprint 6
// The doctor / clinical lead's view. Treatment-plan pipeline, tooth-map heat
// (FDI 11–48), x-ray volume + source mix, consent + medical-record latency,
// recare compliance. The two FDI heat maps are the dental-specific signature
// of this dashboard — same tooth grid, two different lenses.
// ═══════════════════════════════════════════════════════════════════════════════

analyticsApp.get('/clinical', async (c) => {
  const u = await getCurrentUser(c)
  if (!u) return c.json({ error: 'Not authenticated' }, 401)

  const allowed = await checkPermission(c, u.id, MODULES.MEDICAL_RECORDS, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  await logAnalyticsAccess(c, 'clinical', '')

  const db = getDb(process.env.DATABASE_URL!)

  const period = parsePeriod(c)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1)
  const ninetyDaysAgo = new Date(startOfToday.getTime() - 89 * 24 * 60 * 60 * 1000)
  const clinicalWindowStart = period?.from ?? twelveMonthsAgo
  const clinicalWindowEnd = period?.to ?? new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)
  const consentWindowStart = period?.from ?? ninetyDaysAgo
  const consentWindowEnd = period?.to ?? new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)

  try {
    const [
      planStatusRows,
      planAcceptanceByDoctorRows,
      planValueRows,
      planItemToothRows,
      odontogramRows,
      perioRows,
      xrayTrendRows,
      xrayBySourceRow,
      xrayByTypeRows,
      pendingRecordsRow,
      pendingRecordsLagRows,
      consentSignedRows,
      consentCount30dRow,
      recareCountRow,
      recareOverdueRow,
    ] = await Promise.all([
      // Treatment plan status counts — all-time, used for funnel
      db
        .select({
          status: treatmentPlans.status,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(treatmentPlans)
        .groupBy(treatmentPlans.status),

      // Acceptance rate by doctor (creator) — last 12 months
      db
        .select({
          doctorId: treatmentPlans.createdById,
          doctorName: user.name,
          status: treatmentPlans.status,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(treatmentPlans)
        .leftJoin(user, eq(treatmentPlans.createdById, user.id))
        .where(
          and(
            sql`${treatmentPlans.createdAt} >= ${clinicalWindowStart}`,
            sql`${treatmentPlans.createdAt} < ${clinicalWindowEnd}`
          )
        )
        .groupBy(treatmentPlans.createdById, user.name, treatmentPlans.status),

      // Plan value distribution — totalEstimated per plan
      db
        .select({
          totalEstimated: treatmentPlans.totalEstimated,
          status: treatmentPlans.status,
        })
        .from(treatmentPlans),

      // Tooth procedure heat — count treatmentPlanItems per FDI toothNumber
      db
        .select({
          toothNumber: treatmentPlanItems.toothNumber,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(treatmentPlanItems)
        .where(sql`${treatmentPlanItems.toothNumber} IS NOT NULL`)
        .groupBy(treatmentPlanItems.toothNumber),

      // Caries by tooth — patientOdontogram with caries-family condition
      db
        .select({
          toothNumber: patientOdontogram.toothNumber,
          condition: patientOdontogram.condition,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(patientOdontogram)
        .groupBy(patientOdontogram.toothNumber, patientOdontogram.condition),

      // Perio: average pocket depth per tooth (last 12 months only — recent
      // measurements only)
      db
        .select({
          toothNumber: patientPerioEntries.toothNumber,
          avgDepth: sql<number>`AVG(${patientPerioEntries.pocketDepth})::float`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(patientPerioEntries)
        .where(
          and(
            sql`${patientPerioEntries.recordedAt} >= ${clinicalWindowStart}`,
            sql`${patientPerioEntries.recordedAt} < ${clinicalWindowEnd}`
          )
        )
        .groupBy(patientPerioEntries.toothNumber),

      // X-ray volume by month (last 12 months) — uses uploadedAt as the
      // chart anchor since externalCapturedDate is sparse for internal records
      db
        .select({
          month: sql<string>`TO_CHAR(DATE_TRUNC('month', ${xrayRecords.uploadedAt}), 'YYYY-MM')`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(xrayRecords)
        .where(
          and(
            sql`${xrayRecords.uploadedAt} >= ${clinicalWindowStart}`,
            sql`${xrayRecords.uploadedAt} < ${clinicalWindowEnd}`
          )
        )
        .groupBy(sql`DATE_TRUNC('month', ${xrayRecords.uploadedAt})`)
        .orderBy(sql`DATE_TRUNC('month', ${xrayRecords.uploadedAt})`),

      // Internal vs external mix (all-time)
      db
        .select({
          origin: xrayRecords.origin,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(xrayRecords)
        .groupBy(xrayRecords.origin),

      // X-ray volume by type — last 12 months only
      db
        .select({
          typeId: xrayRecords.xrayTypeId,
          typeName: xrayTypes.displayName,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(xrayRecords)
        .leftJoin(xrayTypes, eq(xrayRecords.xrayTypeId, xrayTypes.id))
        .where(
          and(
            sql`${xrayRecords.uploadedAt} >= ${clinicalWindowStart}`,
            sql`${xrayRecords.uploadedAt} < ${clinicalWindowEnd}`
          )
        )
        .groupBy(xrayRecords.xrayTypeId, xrayTypes.displayName)
        .orderBy(desc(sql`COUNT(*)`)),

      // Pending medical records right now
      db
        .select({
          count: sql<number>`COUNT(*)::int`,
        })
        .from(pendingMedicalRecords)
        .where(eq(pendingMedicalRecords.status, 'pending')),

      // Pending record latency: avg hours from check-in → still-pending (or
      // just the age of currently-pending rows)
      db
        .select({
          avgHoursPending: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - ${pendingMedicalRecords.checkedInAt})) / 3600), 0)::float`,
          maxHoursPending: sql<number>`COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - ${pendingMedicalRecords.checkedInAt})) / 3600), 0)::float`,
        })
        .from(pendingMedicalRecords)
        .where(eq(pendingMedicalRecords.status, 'pending')),

      // Signed consent forms — every row is signed by definition (no status
      // column; the table only exists for collected signatures).
      db
        .select({
          count: sql<number>`COUNT(*)::int`,
        })
        .from(signedConsentForms),

      // Signed consents within period (defaults to last 90 days)
      db
        .select({
          count: sql<number>`COUNT(*)::int`,
        })
        .from(signedConsentForms)
        .where(
          and(
            sql`${signedConsentForms.signedAt} >= ${consentWindowStart}`,
            sql`${signedConsentForms.signedAt} < ${consentWindowEnd}`
          )
        ),

      // Recare plans: active count
      db
        .select({
          count: sql<number>`COUNT(*)::int`,
        })
        .from(recarePlans)
        .where(eq(recarePlans.isActive, true)),

      // Recare overdue: nextAlertDate in the past, status still pending
      db
        .select({
          count: sql<number>`COUNT(*)::int`,
        })
        .from(recarePlans)
        .where(
          and(
            eq(recarePlans.isActive, true),
            eq(recarePlans.status, 'pending'),
            sql`${recarePlans.nextAlertDate} < ${now}`
          )
        ),
    ])

    // ── Treatment plan funnel ─────────────────────────────────────────────────
    const planStatusMap: Record<string, number> = {}
    for (const row of planStatusRows) planStatusMap[row.status] = row.count
    const funnel = [
      { stage: 'draft', count: planStatusMap.draft ?? 0 },
      { stage: 'presented', count: planStatusMap.presented ?? 0 },
      { stage: 'accepted', count: planStatusMap.accepted ?? 0 },
      { stage: 'in_progress', count: planStatusMap.in_progress ?? 0 },
      { stage: 'completed', count: planStatusMap.completed ?? 0 },
    ]
    const declined = planStatusMap.declined ?? 0
    const totalPlans = Object.values(planStatusMap).reduce((s, n) => s + n, 0)
    const presented = funnel.find((f) => f.stage === 'presented')?.count ?? 0
    const accepted = funnel.find((f) => f.stage === 'accepted')?.count ?? 0
    const completed = funnel.find((f) => f.stage === 'completed')?.count ?? 0
    // Acceptance rate uses "decisions made" as the denominator (accepted +
    // declined). Plans still in 'presented' haven't been decided yet.
    const decisionTotal = accepted + declined + (planStatusMap.in_progress ?? 0) + completed
    const acceptanceRatePct =
      decisionTotal > 0
        ? Math.round(
            ((accepted + (planStatusMap.in_progress ?? 0) + completed) / decisionTotal) * 1000
          ) / 10
        : 0

    // ── Acceptance by doctor ──────────────────────────────────────────────────
    const doctorMap: Record<
      string,
      { name: string; presented: number; accepted: number; declined: number; total: number }
    > = {}
    for (const row of planAcceptanceByDoctorRows) {
      if (!row.doctorId) continue
      if (!doctorMap[row.doctorId]) {
        doctorMap[row.doctorId] = {
          name: row.doctorName ?? 'Unknown',
          presented: 0,
          accepted: 0,
          declined: 0,
          total: 0,
        }
      }
      const d = doctorMap[row.doctorId]
      d.total += row.count
      if (
        row.status === 'presented' ||
        row.status === 'accepted' ||
        row.status === 'in_progress' ||
        row.status === 'completed'
      ) {
        d.presented += row.count
      }
      if (row.status === 'accepted' || row.status === 'in_progress' || row.status === 'completed') {
        d.accepted += row.count
      }
      if (row.status === 'declined') d.declined += row.count
    }
    const byDoctor = Object.entries(doctorMap)
      .map(([id, d]) => {
        const decisions = d.accepted + d.declined
        const acceptanceRate = decisions > 0 ? Math.round((d.accepted / decisions) * 1000) / 10 : 0
        return {
          doctorId: id,
          name: d.name,
          presented: d.presented,
          accepted: d.accepted,
          declined: d.declined,
          total: d.total,
          acceptanceRate,
        }
      })
      .sort((a, b) => b.total - a.total)

    // ── Plan value histogram ──────────────────────────────────────────────────
    const VALUE_BUCKETS = [
      { label: '0', min: 0, max: 1 },
      { label: '1–500', min: 1, max: 500 },
      { label: '500–1K', min: 500, max: 1_000 },
      { label: '1K–2.5K', min: 1_000, max: 2_500 },
      { label: '2.5K–5K', min: 2_500, max: 5_000 },
      { label: '5K–10K', min: 5_000, max: 10_000 },
      { label: '10K+', min: 10_000, max: Infinity },
    ]
    const planValueHistogram = VALUE_BUCKETS.map((b) => ({ label: b.label, count: 0 }))
    let valueSum = 0
    let valueCount = 0
    const planValues: number[] = []
    for (const row of planValueRows) {
      const v = Number(row.totalEstimated ?? 0)
      planValues.push(v)
      valueSum += v
      valueCount++
      for (let i = 0; i < VALUE_BUCKETS.length; i++) {
        if (v >= VALUE_BUCKETS[i].min && v < VALUE_BUCKETS[i].max) {
          planValueHistogram[i].count++
          break
        }
      }
    }
    planValues.sort((a, b) => a - b)
    const avgPlanValue = valueCount > 0 ? Math.round((valueSum / valueCount) * 100) / 100 : 0
    const medianPlanValue =
      planValues.length > 0 ? planValues[Math.floor(planValues.length / 2)] : 0

    // ── Tooth procedure heat (FDI grid) ───────────────────────────────────────
    const toothProcedureMap: Record<number, number> = {}
    let toothProcedureMax = 0
    for (const row of planItemToothRows) {
      if (row.toothNumber == null) continue
      toothProcedureMap[row.toothNumber] = row.count
      if (row.count > toothProcedureMax) toothProcedureMax = row.count
    }

    // ── Caries by tooth heat ──────────────────────────────────────────────────
    // The odontogram condition vocabulary is open-ended; we treat any of the
    // common caries-family conditions as a caries instance. Whitelist keeps
    // the count tight even if the schema grows new condition values.
    const CARIES_CONDITIONS = new Set([
      'caries',
      'decay',
      'cavity',
      'enamel_caries',
      'dentine_caries',
    ])
    const cariesByToothMap: Record<number, number> = {}
    let cariesMax = 0
    for (const row of odontogramRows) {
      if (row.toothNumber == null) continue
      if (!CARIES_CONDITIONS.has(row.condition.toLowerCase())) continue
      const next = (cariesByToothMap[row.toothNumber] ?? 0) + row.count
      cariesByToothMap[row.toothNumber] = next
      if (next > cariesMax) cariesMax = next
    }
    // Surface distribution of caries (donut)
    const SURFACE_KEYS = ['O', 'M', 'D', 'B', 'L', 'whole'] as const
    const _cariesBySurface: Record<string, number> = {}
    // Need a separate query, OR re-shape from odontogramRows? The current
    // query only groups by toothNumber+condition; surface was dropped. Skip
    // for v1 — surface is in the row table; we'd need to re-query. Returning
    // empty array signals "feature not loaded" to the frontend so it can
    // gracefully hide the section.
    void SURFACE_KEYS

    // ── Perio: avg pocket depth per tooth ─────────────────────────────────────
    const pocketDepthMap: Record<number, { avg: number; count: number }> = {}
    let pocketDepthMax = 0
    for (const row of perioRows) {
      const avg = Math.round((Number(row.avgDepth) ?? 0) * 10) / 10
      pocketDepthMap[row.toothNumber] = { avg, count: row.count }
      if (avg > pocketDepthMax) pocketDepthMax = avg
    }

    // ── X-ray trend ───────────────────────────────────────────────────────────
    const monthLabels: string[] = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      monthLabels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    const xrayMap: Record<string, number> = {}
    for (const row of xrayTrendRows) xrayMap[row.month] = row.count
    const xrayTrend = monthLabels.map((m) => ({ month: m, count: xrayMap[m] ?? 0 }))

    // ── X-ray source mix ──────────────────────────────────────────────────────
    const xraySourceMap: Record<string, number> = {}
    for (const row of xrayBySourceRow) xraySourceMap[row.origin] = row.count

    const xrayByType = xrayByTypeRows.map((r) => ({
      type: r.typeName ?? 'Unknown / untyped',
      count: r.count,
    }))

    // ── Tiles ─────────────────────────────────────────────────────────────────
    const pendingRecords = pendingRecordsRow[0]?.count ?? 0
    const pendingLag = pendingRecordsLagRows[0] ?? { avgHoursPending: 0, maxHoursPending: 0 }
    const consentsTotal = consentSignedRows[0]?.count ?? 0
    const consents90d = consentCount30dRow[0]?.count ?? 0
    const recareActive = recareCountRow[0]?.count ?? 0
    const recareOverdue = recareOverdueRow[0]?.count ?? 0

    return c.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        tiles: {
          totalPlans,
          presented,
          accepted,
          completed,
          declined,
          acceptanceRatePct,
          avgPlanValue,
          medianPlanValue,
          pendingRecords,
          avgHoursPending: Math.round(pendingLag.avgHoursPending * 10) / 10,
          maxHoursPending: Math.round(pendingLag.maxHoursPending * 10) / 10,
          xrayTotal: xrayTrend.reduce((s, r) => s + r.count, 0),
          internalXrays: xraySourceMap.internal ?? 0,
          externalXrays: xraySourceMap.external ?? 0,
          consentsTotal,
          consents90d,
          recareActive,
          recareOverdue,
        },
        funnel,
        decided: { accepted, declined, inProgress: planStatusMap.in_progress ?? 0, completed },
        byDoctor,
        planValueHistogram,
        toothProcedureHeat: toothProcedureMap,
        toothProcedureMax,
        cariesByToothHeat: cariesByToothMap,
        cariesMax,
        pocketDepthHeat: pocketDepthMap,
        pocketDepthMax,
        xrayTrend,
        xrayBySource: xraySourceMap,
        xrayByType,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[analytics/clinical]' })
    return c.json({ error: 'Failed to fetch clinical analytics' }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// Commission analytics — Sprint 5
// Specialist commission pipeline (accrued → payable → paid), per-specialist
// breakdown, realization trend, and payout cycle metrics. Closes the loop
// between invoiceLines and the specialist sub-ledger so the clinic can see
// commission liability at a glance.
// ═══════════════════════════════════════════════════════════════════════════════

analyticsApp.get('/commission', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const allowed = await checkPermission(c, user.id, MODULES.FINANCIAL_RECORDS, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  await logAnalyticsAccess(c, 'commission', '')

  const db = getDb(process.env.DATABASE_URL!)

  const period = parsePeriod(c)
  const now = new Date()
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1)
  const ninetyDaysAgo = new Date(startOfThisMonth.getTime() - 89 * 24 * 60 * 60 * 1000)
  const commissionWindowStart = period?.from ?? twelveMonthsAgo
  const commissionWindowEnd = period?.to ?? new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const cycleWindowStart = period?.from ?? ninetyDaysAgo
  const cycleWindowEnd = period?.to ?? new Date(now.getTime() + 24 * 60 * 60 * 1000)

  try {
    const [
      balanceRows,
      monthlyCommissionRows,
      monthlyPaidRows,
      payoutAggRow,
      payoutCycleRow,
      topEarnersRows,
    ] = await Promise.all([
      // Per-specialist sub-ledger snapshot. specialistBalances is materialized
      // so this is a small, fast read.
      db
        .select({
          specialistId: specialistBalancesTable.specialistId,
          accrued: specialistBalancesTable.accruedAmount,
          payable: specialistBalancesTable.payableAmount,
          paid: specialistBalancesTable.paidAmount,
          name: specialists.name,
          specialty: specialists.specialty,
          isActive: specialists.isActive,
        })
        .from(specialistBalancesTable)
        .leftJoin(specialists, eq(specialistBalancesTable.specialistId, specialists.id))
        .orderBy(desc(specialistBalancesTable.payableAmount)),

      // Monthly accrual: sum of commission_amount accrued each month for the
      // last 12 months. Drives the realization trend.
      db
        .select({
          month: sql<string>`TO_CHAR(DATE_TRUNC('month', ${specialistCommissions.accruedAt}), 'YYYY-MM')`,
          accrued: sql<number>`COALESCE(SUM(${specialistCommissions.commissionAmount}), 0)::float`,
        })
        .from(specialistCommissions)
        .where(
          and(
            sql`${specialistCommissions.accruedAt} >= ${commissionWindowStart}`,
            sql`${specialistCommissions.accruedAt} < ${commissionWindowEnd}`
          )
        )
        .groupBy(sql`DATE_TRUNC('month', ${specialistCommissions.accruedAt})`)
        .orderBy(sql`DATE_TRUNC('month', ${specialistCommissions.accruedAt})`),

      // Monthly paid: same months, but bucketed by paidAt. The ratio of paid
      // vs accrued is the realization rate.
      db
        .select({
          month: sql<string>`TO_CHAR(DATE_TRUNC('month', ${specialistCommissions.paidAt}), 'YYYY-MM')`,
          paid: sql<number>`COALESCE(SUM(${specialistCommissions.commissionAmount}), 0)::float`,
        })
        .from(specialistCommissions)
        .where(
          and(
            sql`${specialistCommissions.paidAt} IS NOT NULL`,
            sql`${specialistCommissions.paidAt} >= ${commissionWindowStart}`,
            sql`${specialistCommissions.paidAt} < ${commissionWindowEnd}`
          )
        )
        .groupBy(sql`DATE_TRUNC('month', ${specialistCommissions.paidAt})`)
        .orderBy(sql`DATE_TRUNC('month', ${specialistCommissions.paidAt})`),

      // Payout aggregates last 12 months — withholding total, count of
      // posted/paid payouts, total net distributed.
      db
        .select({
          totalGross: sql<number>`COALESCE(SUM(${specialistPayouts.grossAmount}), 0)::float`,
          totalNet: sql<number>`COALESCE(SUM(${specialistPayouts.netAmount}), 0)::float`,
          totalWithholding: sql<number>`COALESCE(SUM(${specialistPayouts.withholdingTaxAmount}), 0)::float`,
          payoutCount: sql<number>`COUNT(*)::int`,
        })
        .from(specialistPayouts)
        .where(
          and(
            sql`${specialistPayouts.status} IN ('posted','paid')`,
            sql`${specialistPayouts.createdAt} >= ${commissionWindowStart}`,
            sql`${specialistPayouts.createdAt} < ${commissionWindowEnd}`
          )
        ),

      // Avg payout cycle = avg(paidAt - accruedAt) days across paid
      // specialistCommissions in last 90 days. Window keeps the metric
      // responsive to recent behaviour.
      db
        .select({
          avgDays: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (${specialistCommissions.paidAt} - ${specialistCommissions.accruedAt})) / 86400), 0)::float`,
          medianDays: sql<number>`COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (${specialistCommissions.paidAt} - ${specialistCommissions.accruedAt})) / 86400), 0)::float`,
          paidCount: sql<number>`COUNT(*)::int`,
        })
        .from(specialistCommissions)
        .where(
          and(
            sql`${specialistCommissions.paidAt} IS NOT NULL`,
            sql`${specialistCommissions.paidAt} >= ${cycleWindowStart}`,
            sql`${specialistCommissions.paidAt} < ${cycleWindowEnd}`
          )
        ),

      // Top earners over period — sum of commissionAmount per specialist
      // for paid commissions
      db
        .select({
          specialistId: specialistCommissions.specialistId,
          name: specialists.name,
          specialty: specialists.specialty,
          paidTotal: sql<number>`COALESCE(SUM(${specialistCommissions.commissionAmount}), 0)::float`,
          paidCount: sql<number>`COUNT(*)::int`,
        })
        .from(specialistCommissions)
        .leftJoin(specialists, eq(specialistCommissions.specialistId, specialists.id))
        .where(
          and(
            sql`${specialistCommissions.paidAt} IS NOT NULL`,
            sql`${specialistCommissions.paidAt} >= ${commissionWindowStart}`,
            sql`${specialistCommissions.paidAt} < ${commissionWindowEnd}`
          )
        )
        .groupBy(specialistCommissions.specialistId, specialists.name, specialists.specialty)
        .orderBy(desc(sql`SUM(${specialistCommissions.commissionAmount})`))
        .limit(10),
    ])

    // ── Funnel ────────────────────────────────────────────────────────────────
    // specialistBalances stores cumulative-to-date totals, so the funnel is
    // "stacked" — accrued ≥ payable ≥ paid is the natural invariant.
    let totalAccrued = 0
    let totalPayable = 0
    let totalPaid = 0
    for (const row of balanceRows) {
      totalAccrued += Number(row.accrued ?? 0)
      totalPayable += Number(row.payable ?? 0)
      totalPaid += Number(row.paid ?? 0)
    }
    const funnel = [
      { stage: 'Accrued', amount: Math.round(totalAccrued * 100) / 100 },
      { stage: 'Payable', amount: Math.round(totalPayable * 100) / 100 },
      { stage: 'Paid', amount: Math.round(totalPaid * 100) / 100 },
    ]

    const outstanding = Math.round((totalAccrued - totalPaid) * 100) / 100
    const realizationLifetimePct =
      totalAccrued > 0 ? Math.round((totalPaid / totalAccrued) * 1000) / 10 : 0

    const perSpecialist = balanceRows
      .filter((r) => Number(r.accrued ?? 0) > 0 || Number(r.paid ?? 0) > 0)
      .map((row) => {
        const accrued = Number(row.accrued ?? 0)
        const payable = Number(row.payable ?? 0)
        const paid = Number(row.paid ?? 0)
        const outstanding = Math.round((accrued - paid) * 100) / 100
        const realization = accrued > 0 ? Math.round((paid / accrued) * 1000) / 10 : 0
        return {
          specialistId: row.specialistId,
          name: row.name ?? 'Unknown',
          specialty: row.specialty,
          isActive: row.isActive ?? true,
          accrued: Math.round(accrued * 100) / 100,
          payable: Math.round(payable * 100) / 100,
          paid: Math.round(paid * 100) / 100,
          outstanding,
          realizationPct: realization,
        }
      })

    // ── Realization trend (last 12 months) ───────────────────────────────────
    const monthLabels: string[] = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      monthLabels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    const accruedMap: Record<string, number> = {}
    for (const row of monthlyCommissionRows) accruedMap[row.month] = row.accrued
    const paidMap: Record<string, number> = {}
    for (const row of monthlyPaidRows) paidMap[row.month] = row.paid

    const trend = monthLabels.map((m) => {
      const accrued = Math.round((accruedMap[m] ?? 0) * 100) / 100
      const paid = Math.round((paidMap[m] ?? 0) * 100) / 100
      const realizationPct = accrued > 0 ? Math.round((paid / accrued) * 1000) / 10 : 0
      return { month: m, accrued, paid, realizationPct }
    })

    const payoutAgg = payoutAggRow[0] ?? {
      totalGross: 0,
      totalNet: 0,
      totalWithholding: 0,
      payoutCount: 0,
    }
    const withholdingTaxPct =
      payoutAgg.totalGross > 0
        ? Math.round((payoutAgg.totalWithholding / payoutAgg.totalGross) * 1000) / 10
        : 0

    const cycle = payoutCycleRow[0] ?? { avgDays: 0, medianDays: 0, paidCount: 0 }

    const topEarners = topEarnersRows.map((row) => ({
      specialistId: row.specialistId,
      name: row.name ?? 'Unknown',
      specialty: row.specialty,
      paidTotal: Math.round((row.paidTotal ?? 0) * 100) / 100,
      paidCount: row.paidCount ?? 0,
    }))

    return c.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        tiles: {
          totalAccrued: Math.round(totalAccrued * 100) / 100,
          totalPayable: Math.round(totalPayable * 100) / 100,
          totalPaid: Math.round(totalPaid * 100) / 100,
          outstanding,
          realizationLifetimePct,
          payoutCount12mo: payoutAgg.payoutCount,
          totalWithholding12mo: Math.round(payoutAgg.totalWithholding * 100) / 100,
          withholdingTaxPct,
          avgPayoutCycleDays: Math.round(cycle.avgDays * 10) / 10,
          medianPayoutCycleDays: Math.round(cycle.medianDays * 10) / 10,
          activeSpecialistCount: balanceRows.filter((r) => r.isActive ?? true).length,
        },
        funnel,
        perSpecialist,
        trend,
        topEarners,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[analytics/commission]' })
    return c.json({ error: 'Failed to fetch commission analytics' }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// Workforce analytics — Sprint 4
// HR's view of the clinic. Four sub-dashboards in one payload:
//   Headcount        active staff count, dept/position/tenure breakdown,
//                    turnover, action lists (probation/contract/credentials)
//   Attendance       last-30-day daily attendance rate + lateness
//   Payroll          last-12-month payroll totals + gross/net/paye/ssnit split
//   Training         completion rate, mandatory compliance, avg quiz score,
//                    performance score distribution
// ═══════════════════════════════════════════════════════════════════════════════

analyticsApp.get('/workforce', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const allowed = await checkPermission(c, user.id, MODULES.STAFF, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  await logAnalyticsAccess(c, 'workforce', '')

  const db = getDb(process.env.DATABASE_URL!)

  const period = parsePeriod(c)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)
  const thirtyDaysAgo = new Date(startOfToday.getTime() - 29 * 24 * 60 * 60 * 1000)
  const _ninetyDaysAgo = new Date(startOfToday.getTime() - 89 * 24 * 60 * 60 * 1000)
  const ninetyDaysFromNow = new Date(startOfToday.getTime() + 90 * 24 * 60 * 60 * 1000)
  const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1)
  const startOfThisYear = new Date(now.getFullYear(), 0, 1)
  const attendanceWindowStart = period?.from ?? thirtyDaysAgo
  const attendanceWindowEnd = period?.to ?? startOfTomorrow
  const payrollWindowStart = period?.from ?? twelveMonthsAgo
  const payrollWindowEnd = period?.to ?? startOfTomorrow
  const turnoverWindowStart = period?.from ?? twelveMonthsAgo
  const turnoverWindowEnd = period?.to ?? startOfTomorrow

  try {
    const [
      activeStaffRows,
      newHires12moRow,
      leavers12moRow,
      tenureRows,
      attendance30dRows,
      payrollRows,
      trainingMaterialsRows,
      trainingProgressRows,
      performanceRows,
      probationEndingRows,
      contractEndingRows,
      credentialsExpiringRows,
    ] = await Promise.all([
      // All currently active (non-deleted, status='active') staff with their
      // dept/position so we can do the breakdowns in JS without re-querying.
      db
        .select({
          id: staff.id,
          fullName: staff.fullName,
          position: staff.position,
          dateOfJoining: staff.dateOfJoining,
          status: staff.status,
        })
        .from(staff)
        .where(and(eq(staff.status, 'active'), isNull(staff.deletedAt))),

      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(staff)
        .where(
          and(
            isNull(staff.deletedAt),
            sql`${staff.dateOfJoining} >= ${turnoverWindowStart}`,
            sql`${staff.dateOfJoining} < ${turnoverWindowEnd}`
          )
        ),

      // Leavers = soft-deleted within window. (Alternative: status='inactive'
      // — both happen in practice; deletedAt is the more reliable signal.)
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(staff)
        .where(
          and(
            sql`${staff.deletedAt} >= ${turnoverWindowStart}`,
            sql`${staff.deletedAt} < ${turnoverWindowEnd}`
          )
        ),

      // Tenure in months for everyone currently on the team
      db
        .select({
          tenureMonths: sql<number>`EXTRACT(YEAR FROM AGE(NOW(), ${staff.dateOfJoining}))::int * 12 + EXTRACT(MONTH FROM AGE(NOW(), ${staff.dateOfJoining}))::int`,
        })
        .from(staff)
        .where(
          and(
            eq(staff.status, 'active'),
            isNull(staff.deletedAt),
            sql`${staff.dateOfJoining} IS NOT NULL`
          )
        ),

      // 30-day attendance — per-day status counts so we can compute the daily
      // rate and lateness frequency. The unique (staff,date) index means at
      // most one row per staff per day.
      db
        .select({
          day: sql<string>`${staffAttendance.date}::text`,
          status: staffAttendance.status,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(staffAttendance)
        .where(
          and(
            sql`${staffAttendance.date} >= ${attendanceWindowStart}::date`,
            sql`${staffAttendance.date} < ${attendanceWindowEnd}::date`
          )
        )
        .groupBy(staffAttendance.date, staffAttendance.status)
        .orderBy(staffAttendance.date),

      // Last 12 months of published payroll runs. We use payPeriodEnd so the
      // chart x-axis aligns with the month the period ended in.
      db
        .select({
          id: payrollRuns.id,
          name: payrollRuns.name,
          payPeriodEnd: payrollRuns.payPeriodEnd,
          totalGross: payrollRuns.totalGross,
          totalNet: payrollRuns.totalNet,
          totalPaye: payrollRuns.totalPaye,
          totalSsnit: payrollRuns.totalSsnit,
          staffCount: payrollRuns.staffCount,
          status: payrollRuns.status,
        })
        .from(payrollRuns)
        .where(
          and(
            sql`${payrollRuns.payPeriodEnd} >= ${payrollWindowStart}`,
            sql`${payrollRuns.payPeriodEnd} < ${payrollWindowEnd}`,
            // HR-M12: 'locked' is dead vocabulary no write path sets; only
            // 'published' is a real terminal state.
            sql`${payrollRuns.status} = 'published'`
          )
        )
        .orderBy(asc(payrollRuns.payPeriodEnd)),

      // Training materials with mandatory flag — denominators for compliance
      db
        .select({
          id: trainingMaterials.id,
          title: trainingMaterials.title,
          isMandatory: trainingMaterials.isMandatory,
        })
        .from(trainingMaterials),

      // Aggregate progress per material — completion count + total assigned
      db
        .select({
          trainingId: staffTrainingProgress.trainingId,
          status: staffTrainingProgress.status,
          count: sql<number>`COUNT(*)::int`,
          avgScore: sql<number | null>`AVG(${staffTrainingProgress.score})`,
        })
        .from(staffTrainingProgress)
        .groupBy(staffTrainingProgress.trainingId, staffTrainingProgress.status),

      // Performance scores in the last 12 months
      db
        .select({
          score: performanceScores.score,
          category: performanceScores.category,
        })
        .from(performanceScores)
        .where(
          and(
            sql`${performanceScores.evaluatedAt} >= ${turnoverWindowStart}`,
            sql`${performanceScores.evaluatedAt} < ${turnoverWindowEnd}`
          )
        ),

      // Probation ending in next 90 days
      db
        .select({
          id: staff.id,
          fullName: staff.fullName,
          probationEndDate: staff.probationEndDate,
        })
        .from(staff)
        .where(
          and(
            eq(staff.status, 'active'),
            isNull(staff.deletedAt),
            sql`${staff.probationEndDate} >= ${now}`,
            sql`${staff.probationEndDate} <= ${ninetyDaysFromNow}`
          )
        )
        .orderBy(asc(staff.probationEndDate)),

      // Contracts ending in next 90 days
      db
        .select({
          id: staff.id,
          fullName: staff.fullName,
          contractEndDate: staff.contractEndDate,
        })
        .from(staff)
        .where(
          and(
            eq(staff.status, 'active'),
            isNull(staff.deletedAt),
            sql`${staff.contractEndDate} >= ${now}`,
            sql`${staff.contractEndDate} <= ${ninetyDaysFromNow}`
          )
        )
        .orderBy(asc(staff.contractEndDate)),

      // Credentials expiring in next 90 days (uses already-imported
      // staffCredentials table from the executive-overview build)
      db
        .select({
          id: staffCredentials.id,
          staffId: staffCredentials.staffId,
          credentialType: staffCredentials.credentialType,
          credentialName: staffCredentials.credentialName,
          expiryDate: staffCredentials.expiryDate,
        })
        .from(staffCredentials)
        .where(
          and(
            sql`${staffCredentials.expiryDate} >= ${now}`,
            sql`${staffCredentials.expiryDate} <= ${ninetyDaysFromNow}`
          )
        )
        .orderBy(asc(staffCredentials.expiryDate)),
    ])

    // ── Headcount section ───────────────────────────────────────────────────
    const headcountTotal = activeStaffRows.length

    const positionMap: Record<string, number> = {}
    for (const s of activeStaffRows) {
      const pos = s.position || 'Unassigned'
      positionMap[pos] = (positionMap[pos] ?? 0) + 1
    }
    const byPosition = Object.entries(positionMap)
      .map(([position, count]) => ({ position, count }))
      .sort((a, b) => b.count - a.count)

    // Tenure histogram — 0-6mo, 6-12mo, 1-2y, 2-5y, 5y+
    const TENURE_BUCKETS = [
      { label: '<6 mo', min: 0, max: 6 },
      { label: '6–12 mo', min: 6, max: 12 },
      { label: '1–2 yr', min: 12, max: 24 },
      { label: '2–5 yr', min: 24, max: 60 },
      { label: '5 yr+', min: 60, max: Infinity },
    ]
    const tenureHistogram = TENURE_BUCKETS.map((b) => ({ label: b.label, count: 0 }))
    for (const row of tenureRows) {
      const months = Number(row.tenureMonths ?? 0)
      for (let i = 0; i < TENURE_BUCKETS.length; i++) {
        if (months >= TENURE_BUCKETS[i].min && months < TENURE_BUCKETS[i].max) {
          tenureHistogram[i].count++
          break
        }
      }
    }

    const newHires12mo = newHires12moRow[0]?.count ?? 0
    const leavers12mo = leavers12moRow[0]?.count ?? 0
    // Turnover % = leavers / average headcount in window. Approximation: use
    // current headcount as the denominator; a precise rolling avg needs
    // historical snapshots we don't have.
    const turnoverPct =
      headcountTotal > 0 ? Math.round((leavers12mo / headcountTotal) * 1000) / 10 : 0

    // ── Attendance section ──────────────────────────────────────────────────
    // Build a per-day map: { day, present, absent, late, halfDay, leave }
    const attendanceDayMap = new Map<
      string,
      { day: string; present: number; absent: number; late: number; halfDay: number; leave: number }
    >()
    const eachDay = (start: Date, end: Date): string[] => {
      const out: string[] = []
      const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate())
      while (cursor <= end) {
        out.push(cursor.toISOString().slice(0, 10))
        cursor.setDate(cursor.getDate() + 1)
      }
      return out
    }
    for (const day of eachDay(attendanceWindowStart, attendanceWindowEnd)) {
      attendanceDayMap.set(day, { day, present: 0, absent: 0, late: 0, halfDay: 0, leave: 0 })
    }
    for (const row of attendance30dRows) {
      const day = attendanceDayMap.get(row.day)
      if (!day) continue
      switch (row.status) {
        case 'present':
          day.present += row.count
          break
        case 'absent':
          day.absent += row.count
          break
        case 'late':
          day.late += row.count
          break
        case 'half_day':
          day.halfDay += row.count
          break
        case 'leave':
          day.leave += row.count
          break
      }
    }
    const attendanceTrend = Array.from(attendanceDayMap.values())

    let attTotalDays = 0
    let attPresent = 0
    let attLate = 0
    let attAbsent = 0
    for (const day of attendanceTrend) {
      const dayTotal = day.present + day.absent + day.late + day.halfDay + day.leave
      attTotalDays += dayTotal
      attPresent += day.present
      attLate += day.late
      attAbsent += day.absent
    }
    const attendanceRate =
      attTotalDays > 0 ? Math.round(((attPresent + attLate) / attTotalDays) * 1000) / 10 : 0
    const latenessRate = attTotalDays > 0 ? Math.round((attLate / attTotalDays) * 1000) / 10 : 0

    // ── Payroll section ─────────────────────────────────────────────────────
    const payrollTrend = payrollRows.map((r) => ({
      id: r.id,
      name: r.name,
      payPeriodEnd: r.payPeriodEnd.toISOString(),
      totalGross: Number(r.totalGross ?? 0),
      totalNet: Number(r.totalNet ?? 0),
      totalPaye: Number(r.totalPaye ?? 0),
      totalSsnit: Number(r.totalSsnit ?? 0),
      staffCount: r.staffCount,
    }))
    const totalNetYtd = payrollRows
      .filter((r) => new Date(r.payPeriodEnd) >= startOfThisYear)
      .reduce((s, r) => s + Number(r.totalNet ?? 0), 0)
    const latestPayroll = payrollRows.length > 0 ? payrollRows[payrollRows.length - 1] : null
    const latestPayrollNet = latestPayroll ? Number(latestPayroll.totalNet ?? 0) : 0
    const latestPayrollGross = latestPayroll ? Number(latestPayroll.totalGross ?? 0) : 0
    const grossToNetRatio =
      latestPayrollGross > 0 ? Math.round((latestPayrollNet / latestPayrollGross) * 1000) / 10 : 0

    // ── Training section ────────────────────────────────────────────────────
    // Pivot progress by material: counts + avg score
    const progressByMaterial: Record<
      string,
      { completed: number; inProgress: number; notStarted: number; avgScore: number | null }
    > = {}
    for (const row of trainingProgressRows) {
      if (!progressByMaterial[row.trainingId]) {
        progressByMaterial[row.trainingId] = {
          completed: 0,
          inProgress: 0,
          notStarted: 0,
          avgScore: null,
        }
      }
      const bucket = progressByMaterial[row.trainingId]
      if (row.status === 'completed') {
        bucket.completed = row.count
        if (row.avgScore !== null) bucket.avgScore = Number(row.avgScore)
      } else if (row.status === 'in_progress') bucket.inProgress = row.count
      else if (row.status === 'not_started') bucket.notStarted = row.count
    }

    const trainingMaterialsOut = trainingMaterialsRows
      .map((m) => {
        const prog = progressByMaterial[m.id] ?? {
          completed: 0,
          inProgress: 0,
          notStarted: 0,
          avgScore: null,
        }
        const assigned = prog.completed + prog.inProgress + prog.notStarted
        const completionRate =
          assigned > 0 ? Math.round((prog.completed / assigned) * 1000) / 10 : 0
        return {
          id: m.id,
          title: m.title,
          isMandatory: m.isMandatory,
          assigned,
          completed: prog.completed,
          inProgress: prog.inProgress,
          notStarted: prog.notStarted,
          completionRate,
          avgScore: prog.avgScore !== null ? Math.round(prog.avgScore * 10) / 10 : null,
        }
      })
      .sort((a, b) => {
        // Mandatory first, then by completion rate ascending so the worst-
        // performing required trainings float up.
        if (a.isMandatory !== b.isMandatory) return a.isMandatory ? -1 : 1
        return a.completionRate - b.completionRate
      })

    const mandatoryMaterials = trainingMaterialsOut.filter((m) => m.isMandatory)
    const mandatoryAssigned = mandatoryMaterials.reduce((s, m) => s + m.assigned, 0)
    const mandatoryCompleted = mandatoryMaterials.reduce((s, m) => s + m.completed, 0)
    const mandatoryComplianceRate =
      mandatoryAssigned > 0 ? Math.round((mandatoryCompleted / mandatoryAssigned) * 1000) / 10 : 0

    // Performance score distribution: 1–5 buckets
    const PERFORMANCE_BUCKETS = [
      { label: '1', min: 0.5, max: 1.5 },
      { label: '2', min: 1.5, max: 2.5 },
      { label: '3', min: 2.5, max: 3.5 },
      { label: '4', min: 3.5, max: 4.5 },
      { label: '5', min: 4.5, max: 5.5 },
    ]
    const performanceHistogram = PERFORMANCE_BUCKETS.map((b) => ({ label: b.label, count: 0 }))
    let perfSum = 0
    let perfCount = 0
    for (const row of performanceRows) {
      const score = Number(row.score ?? 0)
      perfSum += score
      perfCount++
      for (let i = 0; i < PERFORMANCE_BUCKETS.length; i++) {
        if (score >= PERFORMANCE_BUCKETS[i].min && score < PERFORMANCE_BUCKETS[i].max) {
          performanceHistogram[i].count++
          break
        }
      }
    }
    const avgPerformance = perfCount > 0 ? Math.round((perfSum / perfCount) * 10) / 10 : 0

    // ── Action lists ────────────────────────────────────────────────────────
    const probationEnding = probationEndingRows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      probationEndDate: r.probationEndDate ? r.probationEndDate.toISOString() : null,
      daysLeft: r.probationEndDate
        ? Math.ceil((r.probationEndDate.getTime() - now.getTime()) / 86_400_000)
        : null,
    }))
    const contractEnding = contractEndingRows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      contractEndDate: r.contractEndDate ? r.contractEndDate.toISOString() : null,
      daysLeft: r.contractEndDate
        ? Math.ceil((r.contractEndDate.getTime() - now.getTime()) / 86_400_000)
        : null,
    }))
    const credentialsExpiring = credentialsExpiringRows.map((r) => ({
      id: r.id,
      staffId: r.staffId,
      credentialType: r.credentialType,
      credentialName: r.credentialName,
      expiryDate: r.expiryDate ? r.expiryDate.toISOString() : null,
      daysLeft: r.expiryDate
        ? Math.ceil((r.expiryDate.getTime() - now.getTime()) / 86_400_000)
        : null,
    }))

    return c.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        headcount: {
          tiles: {
            total: headcountTotal,
            newHires12mo,
            leavers12mo,
            turnoverPct,
            probationCount: probationEnding.length,
            contractEndingCount: contractEnding.length,
            credentialsExpiringCount: credentialsExpiring.length,
          },
          byPosition,
          tenureHistogram,
          probationEnding,
          contractEnding,
          credentialsExpiring,
        },
        attendance: {
          tiles: {
            attendanceRate,
            latenessRate,
            present: attPresent,
            late: attLate,
            absent: attAbsent,
            totalRecords: attTotalDays,
          },
          trend: attendanceTrend,
        },
        payroll: {
          tiles: {
            latestNet: latestPayrollNet,
            latestGross: latestPayrollGross,
            grossToNetRatio,
            totalNetYtd: Math.round(totalNetYtd * 100) / 100,
            runCount: payrollRows.length,
          },
          trend: payrollTrend,
        },
        training: {
          tiles: {
            totalMaterials: trainingMaterialsOut.length,
            mandatoryMaterials: mandatoryMaterials.length,
            mandatoryComplianceRate,
            avgPerformance,
            perfRecords: perfCount,
          },
          materials: trainingMaterialsOut,
          performanceHistogram,
        },
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[analytics/workforce]' })
    return c.json({ error: 'Failed to fetch workforce analytics' }, 500)
  }
})

// ─── GET /operational/inventory ───────────────────────────────────────────────
analyticsApp.get('/operational/inventory', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const allowed = await checkPermission(c, user.id, MODULES.INVENTORY, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  await logAnalyticsAccess(c, 'operational-inventory', '')

  const db = getDb(process.env.DATABASE_URL!)

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const ninetyDaysFromNow = new Date(startOfToday.getTime() + 90 * 24 * 60 * 60 * 1000)

  try {
    const [allInventory, lowStockList] = await Promise.all([
      // Full inventory snapshot — small table for a clinic, so it's fine to
      // pull and aggregate in JS. Lets us return both the category breakdown
      // and the at-risk count from one query.
      db
        .select({
          id: items.id,
          name: items.name,
          category: items.category,
          stockQuantity: items.stockQuantity,
          reorderLevel: items.reorderLevel,
          expiryDate: items.expiryDate,
        })
        .from(items)
        .where(eq(items.consumable, true)),

      // Low-stock list with details so the UI can render an action list
      db
        .select({
          id: items.id,
          name: items.name,
          category: items.category,
          stockQuantity: items.stockQuantity,
          reorderLevel: items.reorderLevel,
        })
        .from(items)
        .where(
          and(
            eq(items.consumable, true),
            sql`${items.stockQuantity} <= COALESCE(${items.reorderLevel}, 10)`
          )
        )
        .orderBy(asc(items.stockQuantity)),
    ])

    // Category breakdown (by stockQuantity only — we don't have cost on
    // inventory, so value-by-category is deferred until inventory.costPrice
    // lands)
    const categoryMap: Record<string, { itemCount: number; totalUnits: number }> = {}
    for (const row of allInventory) {
      const category = row.category || 'Uncategorised'
      if (!categoryMap[category]) categoryMap[category] = { itemCount: 0, totalUnits: 0 }
      categoryMap[category].itemCount++
      categoryMap[category].totalUnits += row.stockQuantity
    }
    const byCategory = Object.entries(categoryMap)
      .map(([category, m]) => ({ category, itemCount: m.itemCount, totalUnits: m.totalUnits }))
      .sort((a, b) => b.totalUnits - a.totalUnits)

    // Expiring within 90 days
    const expiringSoon = allInventory
      .filter(
        (row) =>
          row.expiryDate !== null && row.expiryDate > now && row.expiryDate < ninetyDaysFromNow
      )
      .map((row) => {
        const expiry = row.expiryDate as Date
        const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
        return {
          id: row.id,
          name: row.name,
          category: row.category,
          stockQuantity: row.stockQuantity,
          expiryDate: expiry.toISOString(),
          daysLeft,
        }
      })
      .sort((a, b) => a.daysLeft - b.daysLeft)

    // Already-expired (negative days)
    const expired = allInventory.filter(
      (row) => row.expiryDate !== null && row.expiryDate <= now
    ).length

    return c.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        tiles: {
          totalSkus: allInventory.length,
          lowStock: lowStockList.length,
          expiringSoon: expiringSoon.length,
          expired,
        },
        byCategory,
        lowStock: lowStockList,
        expiringSoon,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[analytics/operational-inventory]' })
    return c.json({ error: 'Failed to fetch inventory operations' }, 500)
  }
})

export { analyticsApp }
