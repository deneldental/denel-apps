import { and, desc, eq, gte, isNotNull, lt, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import type { DB } from '../db'
import { getDb } from '../db'
import {
  creditNotes,
  invoiceLines,
  invoices,
  patientBalances,
  patients,
  paymentPlans,
  payments,
  revenueRecognitionEvents,
  specialists,
  taxCalculations,
  user,
} from '../db/schema'
import { logAnalyticsAccess } from '../lib/analytics-audit'
import { parsePeriod } from '../lib/analytics-period'
import { FINANCE_ACCOUNTS } from '../lib/finance-accounts'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const financialAnalyticsApp = new Hono<HonoEnv>()

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

// ── GL-sourced revenue / expense / tax (§20.1) ───────────────────────────────
// Analytics must reconcile with the financial statements (Reports P&L), so the
// headline income/expense/tax figures read from the GL — the SAME journal_lines
// the P&L sums (backend/src/lib/financial-reports.ts), not a parallel rollup of
// the operational `payments` / `expenses` / `taxCalculations` tables.
//
//   revenue (per period) = SUM(credit) − SUM(debit) over `revenue`-type accounts
//   expense (per period) = SUM(debit)  − SUM(credit) over `expense`-type accounts
//
// Buckets are keyed off `journal_entries.entry_date` (a DATE — the accounting
// date the statements use). Reversal entries are included: a reversal posts the
// mirror lines, so summing everything nets them out exactly, matching the P&L.

type GlBucketRow = { bucket: number; revenue: number; expense: number }

/**
 * Revenue + expense from the GL bucketed by EXTRACT(<part>) of entry_date over
 * a half-open [start, end) date range. `part` is 'MONTH' or 'YEAR'.
 */
async function glRevenueExpenseByBucket(
  db: DB,
  part: 'MONTH' | 'YEAR',
  startIso: string,
  endIso: string
): Promise<GlBucketRow[]> {
  const partSql = part === 'MONTH' ? sql`MONTH` : sql`YEAR`
  const res = await db.execute<{ bucket: number; revenue: string; expense: string }>(sql`
    SELECT
      EXTRACT(${partSql} FROM je.entry_date)::int AS bucket,
      COALESCE(SUM(
        CASE WHEN a.type = 'revenue' THEN jl.credit - jl.debit ELSE 0 END
      ), 0)::text AS revenue,
      COALESCE(SUM(
        CASE WHEN a.type = 'expense' THEN jl.debit - jl.credit ELSE 0 END
      ), 0)::text AS expense
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE a.type IN ('revenue', 'expense')
      AND je.entry_date >= ${startIso}::date
      AND je.entry_date <  ${endIso}::date
    GROUP BY 1
  `)
  return res.rows.map((r) => ({
    bucket: Number(r.bucket),
    revenue: Number(r.revenue),
    expense: Number(r.expense),
  }))
}

/**
 * Output tax collected from the GL, sourced from the Tax Payable account (2300)
 * bucketed by month. Tax is posted there as a credit at invoice issue and a
 * debit on credit-note/reversal, so net (credit − debit) is the tax owed for
 * the period — the figure that reconciles with the statements. The VAT / NHIL /
 * GETFund split is not in the GL (it posts a single combined line), so the
 * component breakdown still comes from `taxCalculations`; only the reconciling
 * `totalTax` headline is GL-sourced.
 */
async function glTaxByMonth(
  db: DB,
  startIso: string,
  endIso: string
): Promise<Record<number, number>> {
  const res = await db.execute<{ month: number; tax: string }>(sql`
    SELECT
      EXTRACT(MONTH FROM je.entry_date)::int AS month,
      COALESCE(SUM(jl.credit - jl.debit), 0)::text AS tax
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE a.code = ${FINANCE_ACCOUNTS.TAX_PAYABLE}
      AND je.entry_date >= ${startIso}::date
      AND je.entry_date <  ${endIso}::date
    GROUP BY 1
  `)
  const byMonth: Record<number, number> = {}
  for (const r of res.rows) byMonth[Number(r.month)] = Number(r.tax)
  return byMonth
}

/** YYYY-MM-DD for the GL date range. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// GET /api/financial-analytics/monthly-trend?year=X
// Returns 12 months of income, expenses, profit, and profit margin for a given year
financialAnalyticsApp.get('/monthly-trend', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const allowed = await checkPermission(c, user.id, MODULES.FINANCIAL_RECORDS, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const yearParam = c.req.query('year')
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear()

  if (Number.isNaN(year) || year < 2000 || year > 2100) {
    return c.json({ error: 'Invalid year' }, 400)
  }

  await logAnalyticsAccess(c, 'monthly-trend', `year=${year}`)

  const db = getDb(process.env.DATABASE_URL!)

  try {
    // GL-sourced (§20.1): income/expense read from journal_lines bucketed by
    // entry_date month, so the trend reconciles with the Reports P&L.
    const yearStart = isoDate(new Date(Date.UTC(year, 0, 1)))
    const yearEnd = isoDate(new Date(Date.UTC(year + 1, 0, 1))) // exclusive
    const glRows = await glRevenueExpenseByBucket(db, 'MONTH', yearStart, yearEnd)

    const incomeByMonth: Record<number, number> = {}
    const expensesByMonth: Record<number, number> = {}
    for (const row of glRows) {
      incomeByMonth[row.bucket] = row.revenue
      expensesByMonth[row.bucket] = row.expense
    }

    const months = MONTH_LABELS.map((label, i) => {
      const m = i + 1
      const income = Math.round((incomeByMonth[m] ?? 0) * 100) / 100
      const exp = Math.round((expensesByMonth[m] ?? 0) * 100) / 100
      const profit = Math.round((income - exp) * 100) / 100
      const profit_margin = income > 0 ? Math.round((profit / income) * 1000) / 10 : 0
      return { month: label, income, expenses: exp, profit, profit_margin }
    })

    const totals = months.reduce(
      (acc, m) => ({
        income: Math.round((acc.income + m.income) * 100) / 100,
        expenses: Math.round((acc.expenses + m.expenses) * 100) / 100,
        profit: Math.round((acc.profit + m.profit) * 100) / 100,
        profit_margin: 0,
      }),
      { income: 0, expenses: 0, profit: 0, profit_margin: 0 }
    )
    totals.profit_margin =
      totals.income > 0 ? Math.round((totals.profit / totals.income) * 1000) / 10 : 0

    return c.json({ success: true, data: { year, months, totals } })
  } catch (error: unknown) {
    logError(error, { context: '[financial-analytics/monthly-trend]' })
    return c.json({ error: 'Failed to fetch monthly trend' }, 500)
  }
})

// GET /api/financial-analytics/multi-year?from=2022&to=2025
// Returns year-by-year revenue, expenses, net profit comparison
financialAnalyticsApp.get('/multi-year', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const allowed = await checkPermission(c, user.id, MODULES.FINANCIAL_RECORDS, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const fromParam = c.req.query('from')
  const toParam = c.req.query('to')
  const currentYear = new Date().getFullYear()
  const from = fromParam ? parseInt(fromParam, 10) : currentYear - 4
  const to = toParam ? parseInt(toParam, 10) : currentYear

  if (
    Number.isNaN(from) ||
    Number.isNaN(to) ||
    from < 2000 ||
    to > 2100 ||
    from > to ||
    to - from > 10
  ) {
    return c.json({ error: 'Invalid year range (max 10 years, 2000–2100)' }, 400)
  }

  await logAnalyticsAccess(c, 'multi-year', `${from}-${to}`)

  const db = getDb(process.env.DATABASE_URL!)

  try {
    // GL-sourced (§20.1): revenue/expense read from journal_lines bucketed by
    // entry_date year, reconciling year-by-year with the Reports P&L.
    const rangeStart = isoDate(new Date(Date.UTC(from, 0, 1)))
    const rangeEnd = isoDate(new Date(Date.UTC(to + 1, 0, 1))) // exclusive
    const glRows = await glRevenueExpenseByBucket(db, 'YEAR', rangeStart, rangeEnd)

    const revenueByYear: Record<number, number> = {}
    const expensesByYear: Record<number, number> = {}
    for (const row of glRows) {
      revenueByYear[row.bucket] = row.revenue
      expensesByYear[row.bucket] = row.expense
    }

    const years = []
    for (let y = from; y <= to; y++) {
      const revenue = Math.round((revenueByYear[y] ?? 0) * 100) / 100
      const exp = Math.round((expensesByYear[y] ?? 0) * 100) / 100
      const net_profit = Math.round((revenue - exp) * 100) / 100
      years.push({ year: y, revenue, expenses: exp, net_profit })
    }

    return c.json({ success: true, data: { from, to, years } })
  } catch (error: unknown) {
    logError(error, { context: '[financial-analytics/multi-year]' })
    return c.json({ error: 'Failed to fetch multi-year data' }, 500)
  }
})

// GET /api/financial-analytics/payment-plans-summary
// Returns count and total amount by payment plan status
financialAnalyticsApp.get('/payment-plans-summary', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const allowed = await checkPermission(c, user.id, MODULES.FINANCIAL_RECORDS, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  await logAnalyticsAccess(c, 'payment-plans-summary')

  const db = getDb(process.env.DATABASE_URL!)

  try {
    const rows = await db
      .select({
        status: paymentPlans.status,
        count: sql<number>`COUNT(*)::int`,
        total_amount: sql<number>`COALESCE(SUM("totalAmount"), 0)::float`,
      })
      .from(paymentPlans)
      .groupBy(paymentPlans.status)

    const ALL_STATUSES = ['activated', 'completed', 'overdue', 'outstanding', 'paused']
    const byStatus: Record<string, { count: number; total_amount: number }> = {}
    for (const row of rows) {
      byStatus[row.status] = {
        count: row.count,
        total_amount: Math.round(row.total_amount * 100) / 100,
      }
    }

    const summary = ALL_STATUSES.map((status) => ({
      status,
      count: byStatus[status]?.count ?? 0,
      total_amount: byStatus[status]?.total_amount ?? 0,
    }))

    const totals = {
      total_plans: summary.reduce((s, r) => s + r.count, 0),
      active_amount: byStatus.activated?.total_amount ?? 0,
      overdue_amount: byStatus.overdue?.total_amount ?? 0,
      outstanding_amount: byStatus.outstanding?.total_amount ?? 0,
      completed_amount: byStatus.completed?.total_amount ?? 0,
    }

    return c.json({ success: true, data: { summary, totals } })
  } catch (error: unknown) {
    logError(error, { context: '[financial-analytics/payment-plans-summary]' })
    return c.json({ error: 'Failed to fetch payment plans summary' }, 500)
  }
})

// ── Helpers shared by the new analytics endpoints ────────────────────────────

function validateYear(yearParam: string | undefined): number | { error: string } {
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear()
  if (Number.isNaN(year) || year < 2000 || year > 2100) return { error: 'Invalid year' }
  return year
}

function yearBoundsUtc(year: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year + 1, 0, 1)), // exclusive
  }
}

// ── GET /collection-trend?year=X ─────────────────────────────────────────────
// Monthly time-series of collection rate (received / invoiced) for the year.
financialAnalyticsApp.get('/collection-trend', async (c) => {
  const u = await getCurrentUser(c)
  if (!u) return c.json({ error: 'Not authenticated' }, 401)
  const allowed = await checkPermission(c, u.id, MODULES.FINANCIAL_RECORDS, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const yr = validateYear(c.req.query('year'))
  if (typeof yr !== 'number') return c.json({ error: yr.error }, 400)

  await logAnalyticsAccess(c, 'collection-trend', `year=${yr}`)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const { start, end } = yearBoundsUtc(yr)
    const [invoicedRows, receivedRows] = await Promise.all([
      db
        .select({
          month: sql<number>`EXTRACT(MONTH FROM "createdAt")::int`,
          invoiced: sql<number>`COALESCE(SUM(amount), 0)::float`,
        })
        .from(invoices)
        .where(and(gte(invoices.createdAt, start), lt(invoices.createdAt, end)))
        .groupBy(sql`EXTRACT(MONTH FROM "createdAt")`),
      db
        .select({
          month: sql<number>`EXTRACT(MONTH FROM "createdAt")::int`,
          received: sql<number>`COALESCE(SUM(amount), 0)::float`,
        })
        .from(payments)
        .where(
          and(
            gte(payments.createdAt, start),
            lt(payments.createdAt, end),
            eq(payments.status, 'posted')
          )
        )
        .groupBy(sql`EXTRACT(MONTH FROM "createdAt")`),
    ])

    const invMap: Record<number, number> = {}
    for (const r of invoicedRows) invMap[r.month] = r.invoiced
    const recMap: Record<number, number> = {}
    for (const r of receivedRows) recMap[r.month] = r.received

    const MONTH_LABELS = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]
    const months = MONTH_LABELS.map((label, i) => {
      const m = i + 1
      const invoiced = Math.round((invMap[m] ?? 0) * 100) / 100
      const received = Math.round((recMap[m] ?? 0) * 100) / 100
      const collection_rate = invoiced > 0 ? Math.round((received / invoiced) * 1000) / 10 : 0
      return { month: label, invoiced, received, collection_rate }
    })

    const totalInvoiced = months.reduce((s, m) => s + m.invoiced, 0)
    const totalReceived = months.reduce((s, m) => s + m.received, 0)
    const avgCollectionRate =
      totalInvoiced > 0 ? Math.round((totalReceived / totalInvoiced) * 1000) / 10 : 0

    return c.json({
      success: true,
      data: { year: yr, months, totals: { totalInvoiced, totalReceived, avgCollectionRate } },
    })
  } catch (error: unknown) {
    logError(error, { context: '[financial-analytics/collection-trend]' })
    return c.json({ error: 'Failed to fetch collection trend' }, 500)
  }
})

// ── GET /refunds-summary?year=X ──────────────────────────────────────────────
// Total refunds (direction='outgoing' payments), refund count, refund rate vs
// gross revenue, and a monthly refund time-series for charting.
financialAnalyticsApp.get('/refunds-summary', async (c) => {
  const u = await getCurrentUser(c)
  if (!u) return c.json({ error: 'Not authenticated' }, 401)
  const allowed = await checkPermission(c, u.id, MODULES.FINANCIAL_RECORDS, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const yr = validateYear(c.req.query('year'))
  if (typeof yr !== 'number') return c.json({ error: yr.error }, 400)

  await logAnalyticsAccess(c, 'refunds-summary', `year=${yr}`)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const { start, end } = yearBoundsUtc(yr)
    const [refundAgg, revenueAgg, monthlyRefunds] = await Promise.all([
      db
        .select({
          total: sql<number>`COALESCE(SUM(amount), 0)::float`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(payments)
        .where(
          and(
            gte(payments.createdAt, start),
            lt(payments.createdAt, end),
            eq(payments.direction, 'outgoing'),
            eq(payments.partyType, 'patient')
          )
        ),
      db
        .select({
          total: sql<number>`COALESCE(SUM(amount), 0)::float`,
        })
        .from(payments)
        .where(
          and(
            gte(payments.createdAt, start),
            lt(payments.createdAt, end),
            eq(payments.direction, 'incoming'),
            eq(payments.status, 'posted')
          )
        ),
      db
        .select({
          month: sql<number>`EXTRACT(MONTH FROM "createdAt")::int`,
          amount: sql<number>`COALESCE(SUM(amount), 0)::float`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(payments)
        .where(
          and(
            gte(payments.createdAt, start),
            lt(payments.createdAt, end),
            eq(payments.direction, 'outgoing'),
            eq(payments.partyType, 'patient')
          )
        )
        .groupBy(sql`EXTRACT(MONTH FROM "createdAt")`),
    ])

    const totalRefunds = Math.round((refundAgg[0]?.total ?? 0) * 100) / 100
    const refundCount = refundAgg[0]?.count ?? 0
    const totalRevenue = revenueAgg[0]?.total ?? 0
    const refundRate = totalRevenue > 0 ? Math.round((totalRefunds / totalRevenue) * 1000) / 10 : 0

    const MONTH_LABELS = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]
    const monthMap: Record<number, { amount: number; count: number }> = {}
    for (const r of monthlyRefunds) monthMap[r.month] = { amount: r.amount, count: r.count }

    const monthly = MONTH_LABELS.map((label, i) => {
      const m = i + 1
      const entry = monthMap[m] ?? { amount: 0, count: 0 }
      return {
        month: label,
        amount: Math.round(entry.amount * 100) / 100,
        count: entry.count,
      }
    })

    return c.json({
      success: true,
      data: {
        year: yr,
        totals: {
          totalRefunds,
          refundCount,
          refundRate,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
        },
        monthly,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[financial-analytics/refunds-summary]' })
    return c.json({ error: 'Failed to fetch refunds summary' }, 500)
  }
})

// ── GET /payment-method-split?year=X ─────────────────────────────────────────
// Per-method totals + insurance-vs-OOP rollup for the year.
financialAnalyticsApp.get('/payment-method-split', async (c) => {
  const u = await getCurrentUser(c)
  if (!u) return c.json({ error: 'Not authenticated' }, 401)
  const allowed = await checkPermission(c, u.id, MODULES.FINANCIAL_RECORDS, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const yr = validateYear(c.req.query('year'))
  if (typeof yr !== 'number') return c.json({ error: yr.error }, 400)

  await logAnalyticsAccess(c, 'payment-method-split', `year=${yr}`)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const { start, end } = yearBoundsUtc(yr)
    const rows = await db
      .select({
        method: payments.method,
        count: sql<number>`COUNT(*)::int`,
        amount: sql<number>`COALESCE(SUM(amount), 0)::float`,
      })
      .from(payments)
      .where(
        and(
          gte(payments.createdAt, start),
          lt(payments.createdAt, end),
          eq(payments.status, 'posted'),
          eq(payments.direction, 'incoming')
        )
      )
      .groupBy(payments.method)

    const totalAmount = rows.reduce((s, r) => s + r.amount, 0)
    const totalCount = rows.reduce((s, r) => s + r.count, 0)

    const byMethod = rows
      .map((r) => ({
        method: r.method,
        count: r.count,
        amount: Math.round(r.amount * 100) / 100,
        percentage: totalAmount > 0 ? Math.round((r.amount / totalAmount) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.amount - a.amount)

    const insuranceTotal = rows
      .filter((r) => r.method === 'insurance')
      .reduce((s, r) => s + r.amount, 0)
    const oopTotal = totalAmount - insuranceTotal
    const insuranceCount = rows
      .filter((r) => r.method === 'insurance')
      .reduce((s, r) => s + r.count, 0)
    const oopCount = totalCount - insuranceCount

    return c.json({
      success: true,
      data: {
        year: yr,
        byMethod,
        insuranceVsOop: {
          insurance: {
            amount: Math.round(insuranceTotal * 100) / 100,
            count: insuranceCount,
            percentage:
              totalAmount > 0 ? Math.round((insuranceTotal / totalAmount) * 1000) / 10 : 0,
          },
          out_of_pocket: {
            amount: Math.round(oopTotal * 100) / 100,
            count: oopCount,
            percentage: totalAmount > 0 ? Math.round((oopTotal / totalAmount) * 1000) / 10 : 0,
          },
        },
        totals: {
          amount: Math.round(totalAmount * 100) / 100,
          count: totalCount,
        },
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[financial-analytics/payment-method-split]' })
    return c.json({ error: 'Failed to fetch payment method split' }, 500)
  }
})

// ── GET /top-patients?year=X&limit=N ─────────────────────────────────────────
// Top patients by revenue (sum of completed incoming payments) in the year.
financialAnalyticsApp.get('/top-patients', async (c) => {
  const u = await getCurrentUser(c)
  if (!u) return c.json({ error: 'Not authenticated' }, 401)
  const allowed = await checkPermission(c, u.id, MODULES.FINANCIAL_RECORDS, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const yr = validateYear(c.req.query('year'))
  if (typeof yr !== 'number') return c.json({ error: yr.error }, 400)
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '10', 10), 1), 50)

  await logAnalyticsAccess(c, 'top-patients', `year=${yr}, limit=${limit}`)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const { start, end } = yearBoundsUtc(yr)
    const rows = await db
      .select({
        patientId: payments.patientId,
        patientName: patients.name,
        patientCode: patients.patientId,
        revenue: sql<number>`COALESCE(SUM(${payments.amount}), 0)::float`,
        paymentCount: sql<number>`COUNT(*)::int`,
      })
      .from(payments)
      .innerJoin(patients, eq(patients.id, payments.patientId))
      .where(
        and(
          gte(payments.createdAt, start),
          lt(payments.createdAt, end),
          eq(payments.status, 'posted'),
          eq(payments.direction, 'incoming'),
          isNotNull(payments.patientId)
        )
      )
      .groupBy(payments.patientId, patients.name, patients.patientId)
      .orderBy(desc(sql`SUM(${payments.amount})`))
      .limit(limit)

    const enriched = rows.map((r) => ({
      patient_id: r.patientId,
      name: r.patientName,
      patient_code: r.patientCode,
      revenue: Math.round(r.revenue * 100) / 100,
      payment_count: r.paymentCount,
    }))

    return c.json({ success: true, data: enriched })
  } catch (error: unknown) {
    logError(error, { context: '[financial-analytics/top-patients]' })
    return c.json({ error: 'Failed to fetch top patients' }, 500)
  }
})

// ── GET /provider-revenue?year=X ─────────────────────────────────────────────
// Revenue contributed by each provider (doctor or visiting specialist) in the
// year, derived from invoice_lines.line_total grouped by providerId / specialistId.
financialAnalyticsApp.get('/provider-revenue', async (c) => {
  const u = await getCurrentUser(c)
  if (!u) return c.json({ error: 'Not authenticated' }, 401)
  const allowed = await checkPermission(c, u.id, MODULES.FINANCIAL_RECORDS, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const yr = validateYear(c.req.query('year'))
  if (typeof yr !== 'number') return c.json({ error: yr.error }, 400)

  await logAnalyticsAccess(c, 'provider-revenue', `year=${yr}`)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const { start, end } = yearBoundsUtc(yr)

    // Two parallel queries — staff doctors vs visiting specialists — then merge.
    const [doctorRows, specialistRows] = await Promise.all([
      db
        .select({
          providerId: invoiceLines.providerId,
          name: user.name,
          revenue: sql<number>`COALESCE(SUM(${invoiceLines.lineTotal}), 0)::float`,
          lineCount: sql<number>`COUNT(*)::int`,
        })
        .from(invoiceLines)
        .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
        .innerJoin(user, eq(user.id, invoiceLines.providerId))
        .where(
          and(
            gte(invoices.createdAt, start),
            lt(invoices.createdAt, end),
            isNotNull(invoiceLines.providerId)
          )
        )
        .groupBy(invoiceLines.providerId, user.name),
      db
        .select({
          specialistId: invoiceLines.specialistId,
          name: specialists.name,
          revenue: sql<number>`COALESCE(SUM(${invoiceLines.lineTotal}), 0)::float`,
          lineCount: sql<number>`COUNT(*)::int`,
        })
        .from(invoiceLines)
        .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
        .innerJoin(specialists, eq(specialists.id, invoiceLines.specialistId))
        .where(
          and(
            gte(invoices.createdAt, start),
            lt(invoices.createdAt, end),
            isNotNull(invoiceLines.specialistId)
          )
        )
        .groupBy(invoiceLines.specialistId, specialists.name),
    ])

    const doctors = doctorRows.map((r) => ({
      provider_id: r.providerId,
      name: r.name,
      provider_type: 'doctor' as const,
      revenue: Math.round(r.revenue * 100) / 100,
      line_count: r.lineCount,
    }))
    const specialistsOut = specialistRows.map((r) => ({
      provider_id: r.specialistId,
      name: r.name,
      provider_type: 'specialist' as const,
      revenue: Math.round(r.revenue * 100) / 100,
      line_count: r.lineCount,
    }))

    const merged = [...doctors, ...specialistsOut].sort((a, b) => b.revenue - a.revenue)
    const totalRevenue = merged.reduce((s, p) => s + p.revenue, 0)
    const enriched = merged.map((p) => ({
      ...p,
      percentage: totalRevenue > 0 ? Math.round((p.revenue / totalRevenue) * 1000) / 10 : 0,
    }))

    return c.json({
      success: true,
      data: {
        year: yr,
        providers: enriched,
        totals: { revenue: Math.round(totalRevenue * 100) / 100, providerCount: enriched.length },
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[financial-analytics/provider-revenue]' })
    return c.json({ error: 'Failed to fetch provider revenue' }, 500)
  }
})

// ── GET /tax-summary?year=X ──────────────────────────────────────────────────
// VAT / NHIL / GETFund collected for the year from `taxCalculations` snapshots.
financialAnalyticsApp.get('/tax-summary', async (c) => {
  const u = await getCurrentUser(c)
  if (!u) return c.json({ error: 'Not authenticated' }, 401)
  const allowed = await checkPermission(c, u.id, MODULES.FINANCIAL_RECORDS, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const yr = validateYear(c.req.query('year'))
  if (typeof yr !== 'number') return c.json({ error: yr.error }, 400)

  await logAnalyticsAccess(c, 'tax-summary', `year=${yr}`)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const { start, end } = yearBoundsUtc(yr)
    // The VAT / NHIL / GETFund split is only available in `taxCalculations`
    // (the GL posts one combined Tax Payable line). The reconciling `totalTax`
    // headline + per-month `total`, however, are GL-sourced (§20.1) from the
    // Tax Payable account (2300) so the tax figure agrees with the statements.
    const [totals, monthly, glTaxMonthMap] = await Promise.all([
      db
        .select({
          baseTotal: sql<number>`COALESCE(SUM(${taxCalculations.baseAmount}), 0)::float`,
          vatTotal: sql<number>`COALESCE(SUM(${taxCalculations.vatAmount}), 0)::float`,
          nhilTotal: sql<number>`COALESCE(SUM(${taxCalculations.nhilAmount}), 0)::float`,
          getfundTotal: sql<number>`COALESCE(SUM(${taxCalculations.getfundAmount}), 0)::float`,
          grossTotal: sql<number>`COALESCE(SUM(${taxCalculations.grossTotal}), 0)::float`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(taxCalculations)
        .where(and(gte(taxCalculations.createdAt, start), lt(taxCalculations.createdAt, end))),
      db
        .select({
          month: sql<number>`EXTRACT(MONTH FROM ${taxCalculations.createdAt})::int`,
          vat: sql<number>`COALESCE(SUM(${taxCalculations.vatAmount}), 0)::float`,
          nhil: sql<number>`COALESCE(SUM(${taxCalculations.nhilAmount}), 0)::float`,
          getfund: sql<number>`COALESCE(SUM(${taxCalculations.getfundAmount}), 0)::float`,
        })
        .from(taxCalculations)
        .where(and(gte(taxCalculations.createdAt, start), lt(taxCalculations.createdAt, end)))
        .groupBy(sql`EXTRACT(MONTH FROM ${taxCalculations.createdAt})`),
      glTaxByMonth(db, isoDate(start), isoDate(end)),
    ])

    const t = totals[0]
    const glTaxTotal = Object.values(glTaxMonthMap).reduce((s, v) => s + v, 0)
    const MONTH_LABELS = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]
    const monthMap: Record<number, { vat: number; nhil: number; getfund: number }> = {}
    for (const r of monthly) monthMap[r.month] = { vat: r.vat, nhil: r.nhil, getfund: r.getfund }

    const months = MONTH_LABELS.map((label, i) => {
      const m = i + 1
      const entry = monthMap[m] ?? { vat: 0, nhil: 0, getfund: 0 }
      return {
        month: label,
        vat: Math.round(entry.vat * 100) / 100,
        nhil: Math.round(entry.nhil * 100) / 100,
        getfund: Math.round(entry.getfund * 100) / 100,
        // GL-sourced (§20.1): the reconciling tax total for the month is the net
        // movement on Tax Payable (2300), not the sum of the component snapshots.
        total: Math.round((glTaxMonthMap[m] ?? 0) * 100) / 100,
      }
    })

    return c.json({
      success: true,
      data: {
        year: yr,
        totals: {
          baseAmount: Math.round((t?.baseTotal ?? 0) * 100) / 100,
          vat: Math.round((t?.vatTotal ?? 0) * 100) / 100,
          nhil: Math.round((t?.nhilTotal ?? 0) * 100) / 100,
          getfund: Math.round((t?.getfundTotal ?? 0) * 100) / 100,
          // GL-sourced (§20.1): reconciles with the statements / Reports.
          totalTax: Math.round(glTaxTotal * 100) / 100,
          grossTotal: Math.round((t?.grossTotal ?? 0) * 100) / 100,
          calcCount: t?.count ?? 0,
        },
        monthly: months,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[financial-analytics/tax-summary]' })
    return c.json({ error: 'Failed to fetch tax summary' }, 500)
  }
})

// ── GET /patient-cohorts ─────────────────────────────────────────────────────
// Revenue cohort heat map: each row is the YYYY-MM cohort of a patient's first
// completed payment; each column is months-since-first-payment (0–11). Cells
// hold revenue collected from that cohort in that lag-month. The chart is the
// single highest-signal patient-base view — a quick read of retention strength
// and LTV cadence.
//
// We bound to the last 12 cohorts so the matrix is 12×12. Anything older sits
// at "tail" and would dilute the live picture; if needed, add a `start` param
// later.
financialAnalyticsApp.get('/patient-cohorts', async (c) => {
  const u = await getCurrentUser(c)
  if (!u) return c.json({ error: 'Not authenticated' }, 401)
  const allowed = await checkPermission(c, u.id, MODULES.FINANCIAL_RECORDS, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  await logAnalyticsAccess(c, 'patient-cohorts', '')

  const db = getDb(process.env.DATABASE_URL!)

  try {
    // CTE chain:
    //   first_payment → each patient's first completed payment date
    //   cohort        → patients whose first payment is within the last 12 mo
    //   pivoted       → revenue + active patient count per (cohort, lag-month)
    //
    // months_since = (payment_year * 12 + payment_month)
    //              − (cohort_year   * 12 + cohort_month)
    // which gives a clean integer lag we can bucket on without TZ headaches.
    const result = await db.execute(sql`
      WITH first_payment AS (
        SELECT
          "patientId",
          MIN("createdAt") AS first_paying_at
        FROM payments
        WHERE status = 'posted'
        GROUP BY "patientId"
      ),
      cohort AS (
        SELECT
          DATE_TRUNC('month', first_paying_at) AS cohort_month,
          "patientId"
        FROM first_payment
        WHERE first_paying_at >= (DATE_TRUNC('month', NOW()) - INTERVAL '11 months')
      ),
      cohort_revenue AS (
        SELECT
          c.cohort_month,
          c."patientId",
          DATE_TRUNC('month', p."createdAt") AS payment_month,
          p.amount
        FROM cohort c
        JOIN payments p ON p."patientId" = c."patientId"
        WHERE p.status = 'posted'
      )
      SELECT
        cohort_month,
        (
          (EXTRACT(YEAR FROM payment_month)::int * 12 + EXTRACT(MONTH FROM payment_month)::int)
          - (EXTRACT(YEAR FROM cohort_month)::int * 12 + EXTRACT(MONTH FROM cohort_month)::int)
        ) AS months_since,
        SUM(amount)::float AS revenue,
        COUNT(DISTINCT "patientId")::int AS active_patients
      FROM cohort_revenue
      WHERE (
        (EXTRACT(YEAR FROM payment_month)::int * 12 + EXTRACT(MONTH FROM payment_month)::int)
        - (EXTRACT(YEAR FROM cohort_month)::int * 12 + EXTRACT(MONTH FROM cohort_month)::int)
      ) BETWEEN 0 AND 11
      GROUP BY cohort_month, months_since
      ORDER BY cohort_month, months_since
    `)

    // Cohort sizes (denominator for retention %)
    const sizeRows = await db.execute(sql`
      WITH first_payment AS (
        SELECT
          "patientId",
          MIN("createdAt") AS first_paying_at
        FROM payments
        WHERE status = 'posted'
        GROUP BY "patientId"
      )
      SELECT
        DATE_TRUNC('month', first_paying_at) AS cohort_month,
        COUNT(*)::int AS cohort_size
      FROM first_payment
      WHERE first_paying_at >= (DATE_TRUNC('month', NOW()) - INTERVAL '11 months')
      GROUP BY cohort_month
      ORDER BY cohort_month
    `)

    // Build 12 contiguous cohort months ending with the current month so the
    // heat map has a continuous axis even when no patients registered in a
    // given month.
    const now = new Date()
    const cohortLabels: string[] = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      cohortLabels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }

    const sizeMap: Record<string, number> = {}
    for (const row of sizeRows.rows as any[]) {
      const date = new Date(row.cohort_month)
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      sizeMap[key] = row.cohort_size
    }

    const cellMap: Record<string, { revenue: number; activePatients: number }[]> = {}
    for (const label of cohortLabels) {
      cellMap[label] = Array.from({ length: 12 }, () => ({ revenue: 0, activePatients: 0 }))
    }

    for (const row of result.rows as any[]) {
      const date = new Date(row.cohort_month)
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      const lag = Number(row.months_since)
      if (!cellMap[key] || lag < 0 || lag > 11) continue
      cellMap[key][lag] = {
        revenue: Math.round((Number(row.revenue) || 0) * 100) / 100,
        activePatients: Number(row.active_patients) || 0,
      }
    }

    const cohorts = cohortLabels.map((label) => ({
      month: label,
      cohortSize: sizeMap[label] ?? 0,
      cells: cellMap[label],
    }))

    // Max revenue across the matrix — used by the frontend for colour scaling.
    let maxRevenue = 0
    for (const cohort of cohorts) {
      for (const cell of cohort.cells) {
        if (cell.revenue > maxRevenue) maxRevenue = cell.revenue
      }
    }

    return c.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        cohorts,
        maxRevenue,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[financial-analytics/patient-cohorts]' })
    return c.json({ error: 'Failed to fetch patient cohorts' }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 2 extensions — credit notes, deferred revenue waterfall, A/R by payer
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/financial-analytics/credit-summary
// Credit notes grouped by reason + status, plus a monthly trend. Surfaces
// write-off / refund / goodwill behaviour at a glance.
financialAnalyticsApp.get('/credit-summary', async (c) => {
  const u = await getCurrentUser(c)
  if (!u) return c.json({ error: 'Not authenticated' }, 401)
  const allowed = await checkPermission(c, u.id, MODULES.CREDIT_NOTES, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  await logAnalyticsAccess(c, 'credit-summary', '')

  const db = getDb(process.env.DATABASE_URL!)
  const period = parsePeriod(c)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)
  const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1)
  const windowStart = period?.from ?? twelveMonthsAgo
  const windowEnd = period?.to ?? startOfTomorrow

  try {
    const [byReasonRows, monthlyRows, totalsRow, paymentTotalRow] = await Promise.all([
      db
        .select({
          reason: creditNotes.reason,
          status: creditNotes.status,
          amount: sql<number>`COALESCE(SUM(${creditNotes.amount}), 0)::float`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(creditNotes)
        .where(
          and(
            gte(creditNotes.issueDate, windowStart.toISOString().slice(0, 10)),
            sql`${creditNotes.issueDate} < ${windowEnd.toISOString().slice(0, 10)}`
          )
        )
        .groupBy(creditNotes.reason, creditNotes.status),

      db
        .select({
          month: sql<string>`TO_CHAR(DATE_TRUNC('month', ${creditNotes.issueDate}), 'YYYY-MM')`,
          reason: creditNotes.reason,
          amount: sql<number>`COALESCE(SUM(${creditNotes.amount}), 0)::float`,
        })
        .from(creditNotes)
        .where(
          and(
            gte(creditNotes.issueDate, windowStart.toISOString().slice(0, 10)),
            sql`${creditNotes.issueDate} < ${windowEnd.toISOString().slice(0, 10)}`,
            eq(creditNotes.status, 'posted')
          )
        )
        .groupBy(sql`DATE_TRUNC('month', ${creditNotes.issueDate})`, creditNotes.reason)
        .orderBy(sql`DATE_TRUNC('month', ${creditNotes.issueDate})`),

      db
        .select({
          total: sql<number>`COALESCE(SUM(${creditNotes.amount}), 0)::float`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(creditNotes)
        .where(
          and(
            gte(creditNotes.issueDate, windowStart.toISOString().slice(0, 10)),
            sql`${creditNotes.issueDate} < ${windowEnd.toISOString().slice(0, 10)}`,
            eq(creditNotes.status, 'posted')
          )
        ),

      // Total revenue in window — denominator for write-off ratio
      db
        .select({ total: sql<number>`COALESCE(SUM(${payments.amount}), 0)::float` })
        .from(payments)
        .where(
          and(
            eq(payments.status, 'posted'),
            gte(payments.createdAt, windowStart),
            sql`${payments.createdAt} < ${windowEnd}`
          )
        ),
    ])

    // Group by reason — sum amount and count across statuses
    const reasonMap: Record<
      string,
      { reason: string; amount: number; count: number; postedAmount: number; postedCount: number }
    > = {}
    for (const row of byReasonRows) {
      const key = row.reason
      if (!reasonMap[key]) {
        reasonMap[key] = { reason: key, amount: 0, count: 0, postedAmount: 0, postedCount: 0 }
      }
      reasonMap[key].amount += row.amount
      reasonMap[key].count += row.count
      if (row.status === 'posted') {
        reasonMap[key].postedAmount += row.amount
        reasonMap[key].postedCount += row.count
      }
    }
    const byReason = Object.values(reasonMap)
      .map((r) => ({
        reason: r.reason,
        amount: Math.round(r.amount * 100) / 100,
        count: r.count,
        postedAmount: Math.round(r.postedAmount * 100) / 100,
        postedCount: r.postedCount,
      }))
      .sort((a, b) => b.amount - a.amount)

    // Pivot monthly trend
    const monthMap = new Map<
      string,
      { month: string; writeoff: number; refund: number; other: number; total: number }
    >()
    for (const row of monthlyRows) {
      const m = monthMap.get(row.month) ?? {
        month: row.month,
        writeoff: 0,
        refund: 0,
        other: 0,
        total: 0,
      }
      if (row.reason === 'write_off') m.writeoff += row.amount
      else if (row.reason === 'cancellation' || row.reason === 'correction') m.refund += row.amount
      else m.other += row.amount
      m.total += row.amount
      monthMap.set(row.month, m)
    }
    const monthly = Array.from(monthMap.values())
      .map((m) => ({
        month: m.month,
        writeoff: Math.round(m.writeoff * 100) / 100,
        refund: Math.round(m.refund * 100) / 100,
        other: Math.round(m.other * 100) / 100,
        total: Math.round(m.total * 100) / 100,
      }))
      .sort((a, b) => (a.month < b.month ? -1 : 1))

    const totalPosted = totalsRow[0]?.total ?? 0
    const totalPostedCount = totalsRow[0]?.count ?? 0
    const totalRevenue = paymentTotalRow[0]?.total ?? 0
    const writeOffAmount = reasonMap.write_off?.postedAmount ?? 0
    const writeOffRatioPct =
      totalRevenue > 0 ? Math.round((writeOffAmount / totalRevenue) * 1000) / 10 : 0

    return c.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        tiles: {
          totalPostedAmount: Math.round(totalPosted * 100) / 100,
          totalPostedCount,
          writeOffAmount: Math.round(writeOffAmount * 100) / 100,
          writeOffRatioPct,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
        },
        byReason,
        monthly,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[financial-analytics/credit-summary]' })
    return c.json({ error: 'Failed to load credit summary' }, 500)
  }
})

// GET /api/financial-analytics/deferred-revenue
// Waterfall: amounts on invoices with deferRevenue=true vs amounts recognized
// via revenueRecognitionEvents. Trigger breakdown shows how recognition
// is firing (manual vs milestone vs period-close).
financialAnalyticsApp.get('/deferred-revenue', async (c) => {
  const u = await getCurrentUser(c)
  if (!u) return c.json({ error: 'Not authenticated' }, 401)
  const allowed = await checkPermission(c, u.id, MODULES.FINANCIAL_RECORDS, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  await logAnalyticsAccess(c, 'deferred-revenue', '')

  const db = getDb(process.env.DATABASE_URL!)
  const period = parsePeriod(c)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)
  const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1)
  const windowStart = period?.from ?? twelveMonthsAgo
  const windowEnd = period?.to ?? startOfTomorrow

  try {
    const [deferredLinesRow, recognitionByTriggerRows, recognitionMonthlyRows] = await Promise.all([
      // Total deferred — sum of invoice line totals where deferRevenue=true,
      // joined to invoices to scope by issuance window
      db
        .select({
          totalDeferred: sql<number>`COALESCE(SUM(${invoiceLines.lineTotal}), 0)::float`,
          lineCount: sql<number>`COUNT(*)::int`,
        })
        .from(invoiceLines)
        .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
        .where(
          and(
            eq(invoiceLines.deferRevenue, true),
            sql`${invoices.status} <> 'void'`,
            sql`${invoices.archived} = false`
          )
        ),

      // Recognition events by trigger
      db
        .select({
          trigger: revenueRecognitionEvents.trigger,
          amount: sql<number>`COALESCE(SUM(${revenueRecognitionEvents.amount}), 0)::float`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(revenueRecognitionEvents)
        .where(
          and(
            eq(revenueRecognitionEvents.reversed, false),
            gte(revenueRecognitionEvents.recognizedAt, windowStart),
            sql`${revenueRecognitionEvents.recognizedAt} < ${windowEnd}`
          )
        )
        .groupBy(revenueRecognitionEvents.trigger),

      // Monthly recognition trend
      db
        .select({
          month: sql<string>`TO_CHAR(DATE_TRUNC('month', ${revenueRecognitionEvents.recognizedAt}), 'YYYY-MM')`,
          amount: sql<number>`COALESCE(SUM(${revenueRecognitionEvents.amount}), 0)::float`,
        })
        .from(revenueRecognitionEvents)
        .where(
          and(
            eq(revenueRecognitionEvents.reversed, false),
            gte(revenueRecognitionEvents.recognizedAt, windowStart),
            sql`${revenueRecognitionEvents.recognizedAt} < ${windowEnd}`
          )
        )
        .groupBy(sql`DATE_TRUNC('month', ${revenueRecognitionEvents.recognizedAt})`)
        .orderBy(sql`DATE_TRUNC('month', ${revenueRecognitionEvents.recognizedAt})`),
    ])

    const totalDeferred = deferredLinesRow[0]?.totalDeferred ?? 0
    const deferredLineCount = deferredLinesRow[0]?.lineCount ?? 0

    const byTrigger = recognitionByTriggerRows.map((r) => ({
      trigger: r.trigger,
      amount: Math.round(r.amount * 100) / 100,
      count: r.count,
    }))
    const totalRecognized = byTrigger.reduce((s, r) => s + r.amount, 0)
    const stillDeferred = Math.max(0, totalDeferred - totalRecognized)

    const monthly = recognitionMonthlyRows.map((r) => ({
      month: r.month,
      amount: Math.round(r.amount * 100) / 100,
    }))

    return c.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        tiles: {
          totalDeferred: Math.round(totalDeferred * 100) / 100,
          totalRecognized: Math.round(totalRecognized * 100) / 100,
          stillDeferred: Math.round(stillDeferred * 100) / 100,
          deferredLineCount,
          recognitionEvents: byTrigger.reduce((s, r) => s + r.count, 0),
        },
        waterfall: [
          { stage: 'Deferred on invoices', amount: Math.round(totalDeferred * 100) / 100 },
          { stage: 'Recognized in period', amount: Math.round(totalRecognized * 100) / 100 },
          { stage: 'Still deferred', amount: Math.round(stillDeferred * 100) / 100 },
        ],
        byTrigger,
        monthly,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[financial-analytics/deferred-revenue]' })
    return c.json({ error: 'Failed to load deferred revenue' }, 500)
  }
})

// GET /api/financial-analytics/ar-by-payer
// A/R buckets grouped by payer class — patients with an insuranceProvider set
// roll up as "Insured", everyone else as "Self-pay". Useful for working-capital
// management when insurance pays late.
financialAnalyticsApp.get('/ar-by-payer', async (c) => {
  const u = await getCurrentUser(c)
  if (!u) return c.json({ error: 'Not authenticated' }, 401)
  const allowed = await checkPermission(c, u.id, MODULES.FINANCIAL_RECORDS, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  await logAnalyticsAccess(c, 'ar-by-payer', '')

  const db = getDb(process.env.DATABASE_URL!)

  try {
    const rows = await db
      .select({
        patientId: patients.id,
        insuranceProvider: patients.insuranceProvider,
        arBalance: sql<number>`COALESCE(${patientBalances.arBalance}, 0)::float`,
      })
      .from(patientBalances)
      .innerJoin(patients, eq(patientBalances.patientId, patients.id))
      .where(sql`${patientBalances.arBalance} > 0`)

    const groups: Record<string, { payer: string; balance: number; patientCount: number }> = {}
    for (const row of rows) {
      const payer = row.insuranceProvider?.trim() ? row.insuranceProvider.trim() : 'Self-pay'
      if (!groups[payer]) groups[payer] = { payer, balance: 0, patientCount: 0 }
      groups[payer].balance += row.arBalance
      groups[payer].patientCount++
    }
    const byPayer = Object.values(groups)
      .map((g) => ({
        payer: g.payer,
        balance: Math.round(g.balance * 100) / 100,
        patientCount: g.patientCount,
      }))
      .sort((a, b) => b.balance - a.balance)

    const totalAR = byPayer.reduce((s, g) => s + g.balance, 0)
    const insuredAR = byPayer
      .filter((g) => g.payer !== 'Self-pay')
      .reduce((s, g) => s + g.balance, 0)
    const insuredSharePct = totalAR > 0 ? Math.round((insuredAR / totalAR) * 1000) / 10 : 0

    return c.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        tiles: {
          totalAR: Math.round(totalAR * 100) / 100,
          insuredAR: Math.round(insuredAR * 100) / 100,
          selfPayAR: Math.round((totalAR - insuredAR) * 100) / 100,
          insuredSharePct,
          payerCount: byPayer.length,
        },
        byPayer,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[financial-analytics/ar-by-payer]' })
    return c.json({ error: 'Failed to load A/R by payer' }, 500)
  }
})

export { financialAnalyticsApp }
