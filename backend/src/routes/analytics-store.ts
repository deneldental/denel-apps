import { and, eq, gte, ne, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { bills, expenses, items, payments, suppliers } from '../db/schema'
import { logAnalyticsAccess } from '../lib/analytics-audit'
import { parsePeriod } from '../lib/analytics-period'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const analyticsStoreApp = new Hono<HonoEnv>()

/**
 * Store / Supply-Chain analytics — A/P aging, supplier spend concentration,
 * expense category mix, inventory health.
 *
 *   /store/inventory   — snapshot of inventory health (already partly covered
 *                        by /operational/inventory; this one adds aging)
 *   /store/suppliers   — A/P aging + DPO + supplier concentration
 *   /store/expenses    — category breakdown + MoM trend + expense-to-revenue
 *
 * Endpoint shape is one POST-style aggregate per concern so the page can
 * render every tab without paying for unrelated work when only one is open.
 */

analyticsStoreApp.get('/store/suppliers', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const allowed = await checkPermission(c, user.id, MODULES.SUPPLIERS, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  await logAnalyticsAccess(c, 'store-suppliers', '')

  const db = getDb(process.env.DATABASE_URL!)
  const period = parsePeriod(c)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)
  const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1)
  const spendWindowStart = period?.from ?? twelveMonthsAgo
  const spendWindowEnd = period?.to ?? startOfTomorrow

  try {
    const [agingRows, spendRows, supplierCountRow, postedBillsForDPO] = await Promise.all([
      // A/P aging buckets — every posted, unpaid bill keyed by dueDate distance
      db
        .select({
          supplierId: bills.supplierId,
          supplierName: suppliers.name,
          balance: sql<number>`COALESCE(${bills.balance}, 0)::float`,
          dueDate: bills.dueDate,
        })
        .from(bills)
        .leftJoin(suppliers, eq(bills.supplierId, suppliers.id))
        .where(
          and(sql`${bills.status} IN ('posted', 'partially_paid')`, sql`${bills.balance} > 0`)
        ),

      // Total spend per supplier within window — for concentration ratio
      db
        .select({
          supplierId: bills.supplierId,
          supplierName: suppliers.name,
          spend: sql<number>`COALESCE(SUM(${bills.total}), 0)::float`,
          billCount: sql<number>`COUNT(*)::int`,
        })
        .from(bills)
        .leftJoin(suppliers, eq(bills.supplierId, suppliers.id))
        .where(
          and(
            ne(bills.status, 'void'),
            sql`${bills.issueDate} >= ${spendWindowStart.toISOString().slice(0, 10)}`,
            sql`${bills.issueDate} < ${spendWindowEnd.toISOString().slice(0, 10)}`
          )
        )
        .groupBy(bills.supplierId, suppliers.name),

      // Active supplier count
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(suppliers)
        .where(eq(suppliers.active, true)),

      // DPO denominator: total bills posted in window
      db
        .select({
          total: sql<number>`COALESCE(SUM(${bills.total}), 0)::float`,
        })
        .from(bills)
        .where(
          and(
            ne(bills.status, 'void'),
            sql`${bills.issueDate} >= ${spendWindowStart.toISOString().slice(0, 10)}`,
            sql`${bills.issueDate} < ${spendWindowEnd.toISOString().slice(0, 10)}`
          )
        ),
    ])

    // ── A/P aging buckets ───────────────────────────────────────────────────
    const buckets = {
      current: { label: 'Current', count: 0, balance: 0 },
      d1_30: { label: '1–30 days', count: 0, balance: 0 },
      d31_60: { label: '31–60 days', count: 0, balance: 0 },
      d61_90: { label: '61–90 days', count: 0, balance: 0 },
      d90plus: { label: '90+ days', count: 0, balance: 0 },
    }
    const today = new Date(startOfToday)
    for (const row of agingRows) {
      if (!row.dueDate) continue
      const due = new Date(row.dueDate as unknown as string)
      const daysOverdue = Math.floor((today.getTime() - due.getTime()) / 86_400_000)
      const bucket =
        daysOverdue <= 0
          ? buckets.current
          : daysOverdue <= 30
            ? buckets.d1_30
            : daysOverdue <= 60
              ? buckets.d31_60
              : daysOverdue <= 90
                ? buckets.d61_90
                : buckets.d90plus
      bucket.count++
      bucket.balance += row.balance
    }
    const apBuckets = Object.values(buckets).map((b) => ({
      label: b.label,
      count: b.count,
      balance: Math.round(b.balance * 100) / 100,
    }))
    const totalAPOutstanding = apBuckets.reduce((s, b) => s + b.balance, 0)
    const overdueAP = apBuckets
      .filter((b) => b.label !== 'Current')
      .reduce((s, b) => s + b.balance, 0)

    // ── Supplier concentration ──────────────────────────────────────────────
    const totalSpend = spendRows.reduce((s, r) => s + r.spend, 0)
    const concentration = spendRows
      .map((r) => ({
        supplierId: r.supplierId,
        supplierName: r.supplierName ?? 'Unknown',
        spend: Math.round(r.spend * 100) / 100,
        billCount: r.billCount,
        share: totalSpend > 0 ? Math.round((r.spend / totalSpend) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.spend - a.spend)
    const top5Share = concentration.slice(0, 5).reduce((s, r) => s + r.share, 0)

    // ── DPO = (Open AP / period spend) * window days ────────────────────────
    const periodSpend = postedBillsForDPO[0]?.total ?? 0
    const windowDays = Math.max(
      1,
      Math.round((spendWindowEnd.getTime() - spendWindowStart.getTime()) / 86_400_000)
    )
    const dpo =
      periodSpend > 0 ? Math.round((totalAPOutstanding / periodSpend) * windowDays * 10) / 10 : 0

    return c.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        tiles: {
          totalAPOutstanding: Math.round(totalAPOutstanding * 100) / 100,
          overdueAP: Math.round(overdueAP * 100) / 100,
          dpo,
          activeSuppliers: supplierCountRow[0]?.count ?? 0,
          topSupplierSharePct: concentration[0]?.share ?? 0,
          top5SharePct: Math.round(top5Share * 10) / 10,
        },
        apBuckets,
        concentration: concentration.slice(0, 20),
        windowDays,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[analytics/store-suppliers]' })
    return c.json({ error: 'Failed to load supplier analytics' }, 500)
  }
})

analyticsStoreApp.get('/store/expenses', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const allowed = await checkPermission(c, user.id, MODULES.EXPENSES, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  await logAnalyticsAccess(c, 'store-expenses', '')

  const db = getDb(process.env.DATABASE_URL!)
  const period = parsePeriod(c)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)
  const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1)
  const expWindowStart = period?.from ?? twelveMonthsAgo
  const expWindowEnd = period?.to ?? startOfTomorrow

  try {
    const [categoryRows, monthlyExpenseRows, monthlyRevenueRows, totalRows] = await Promise.all([
      db
        .select({
          category: expenses.category,
          amount: sql<number>`COALESCE(SUM(${expenses.amount}), 0)::float`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(expenses)
        .where(and(gte(expenses.date, expWindowStart), sql`${expenses.date} < ${expWindowEnd}`))
        .groupBy(expenses.category),

      // Monthly expense trend for the window
      db
        .select({
          month: sql<string>`TO_CHAR(DATE_TRUNC('month', ${expenses.date}), 'YYYY-MM')`,
          category: expenses.category,
          amount: sql<number>`COALESCE(SUM(${expenses.amount}), 0)::float`,
        })
        .from(expenses)
        .where(and(gte(expenses.date, expWindowStart), sql`${expenses.date} < ${expWindowEnd}`))
        .groupBy(sql`DATE_TRUNC('month', ${expenses.date})`, expenses.category)
        .orderBy(sql`DATE_TRUNC('month', ${expenses.date})`),

      // Monthly revenue for the same window — to compute expense/revenue ratio
      db
        .select({
          month: sql<string>`TO_CHAR(DATE_TRUNC('month', ${payments.createdAt}), 'YYYY-MM')`,
          amount: sql<number>`COALESCE(SUM(${payments.amount}), 0)::float`,
        })
        .from(payments)
        .where(
          and(
            eq(payments.status, 'posted'),
            gte(payments.createdAt, expWindowStart),
            sql`${payments.createdAt} < ${expWindowEnd}`
          )
        )
        .groupBy(sql`DATE_TRUNC('month', ${payments.createdAt})`)
        .orderBy(sql`DATE_TRUNC('month', ${payments.createdAt})`),

      db
        .select({ total: sql<number>`COALESCE(SUM(${expenses.amount}), 0)::float` })
        .from(expenses)
        .where(and(gte(expenses.date, expWindowStart), sql`${expenses.date} < ${expWindowEnd}`)),
    ])

    const byCategory = categoryRows
      .map((r) => ({
        category: r.category || 'Uncategorised',
        amount: Math.round(r.amount * 100) / 100,
        count: r.count,
      }))
      .sort((a, b) => b.amount - a.amount)

    // Pivot monthly trend by month → { totalExpense, totalRevenue }
    const monthMap = new Map<
      string,
      { month: string; expense: number; revenue: number; ratio: number }
    >()
    for (const row of monthlyExpenseRows) {
      const m = monthMap.get(row.month) ?? { month: row.month, expense: 0, revenue: 0, ratio: 0 }
      m.expense += row.amount
      monthMap.set(row.month, m)
    }
    for (const row of monthlyRevenueRows) {
      const m = monthMap.get(row.month) ?? { month: row.month, expense: 0, revenue: 0, ratio: 0 }
      m.revenue += row.amount
      monthMap.set(row.month, m)
    }
    const monthly = Array.from(monthMap.values())
      .map((m) => ({
        month: m.month,
        expense: Math.round(m.expense * 100) / 100,
        revenue: Math.round(m.revenue * 100) / 100,
        ratio: m.revenue > 0 ? Math.round((m.expense / m.revenue) * 1000) / 10 : 0,
      }))
      .sort((a, b) => (a.month < b.month ? -1 : 1))

    const totalExpense = Math.round((totalRows[0]?.total ?? 0) * 100) / 100
    const totalRevenue = monthly.reduce((s, m) => s + m.revenue, 0)
    const ratio = totalRevenue > 0 ? Math.round((totalExpense / totalRevenue) * 1000) / 10 : 0

    return c.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        tiles: {
          totalExpense,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          expenseToRevenuePct: ratio,
          categoryCount: byCategory.length,
          topCategory: byCategory[0]?.category ?? null,
          topCategoryAmount: byCategory[0]?.amount ?? 0,
        },
        byCategory: byCategory.slice(0, 20),
        monthly,
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[analytics/store-expenses]' })
    return c.json({ error: 'Failed to load expense analytics' }, 500)
  }
})

analyticsStoreApp.get('/store/inventory-aging', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const allowed = await checkPermission(c, user.id, MODULES.INVENTORY, ACTIONS.READ)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  await logAnalyticsAccess(c, 'store-inventory-aging', '')

  const db = getDb(process.env.DATABASE_URL!)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const ninetyDaysAgo = new Date(startOfToday.getTime() - 90 * 24 * 60 * 60 * 1000)
  const oneEightyDaysAgo = new Date(startOfToday.getTime() - 180 * 24 * 60 * 60 * 1000)
  const oneYearAgo = new Date(startOfToday.getTime() - 365 * 24 * 60 * 60 * 1000)

  try {
    const rows = await db
      .select({
        id: items.id,
        name: items.name,
        category: items.category,
        stockQuantity: items.stockQuantity,
        reorderLevel: items.reorderLevel,
        expiryDate: items.expiryDate,
        createdAt: items.createdAt,
      })
      .from(items)
      .where(eq(items.consumable, true))

    let agedUnder90 = 0
    let aged90 = 0
    let aged180 = 0
    let aged365 = 0
    let unitsUnder90 = 0
    let units90 = 0
    let units180 = 0
    let units365 = 0
    const agedItems: Array<{
      id: string
      name: string
      category: string | null
      stockQuantity: number
      daysOnHand: number
    }> = []
    for (const row of rows) {
      const created = row.createdAt ? new Date(row.createdAt as unknown as string) : null
      const days = created ? Math.floor((now.getTime() - created.getTime()) / 86_400_000) : 0
      const stock = row.stockQuantity ?? 0
      if (stock <= 0) continue
      if (created && created > ninetyDaysAgo) {
        agedUnder90++
        unitsUnder90 += stock
      } else if (created && created > oneEightyDaysAgo) {
        aged90++
        units90 += stock
      } else if (created && created > oneYearAgo) {
        aged180++
        units180 += stock
      } else {
        aged365++
        units365 += stock
        agedItems.push({
          id: row.id,
          name: row.name,
          category: row.category,
          stockQuantity: stock,
          daysOnHand: days,
        })
      }
    }

    return c.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        tiles: {
          totalSkusWithStock: agedUnder90 + aged90 + aged180 + aged365,
          aged90: aged90 + aged180 + aged365,
          aged180: aged180 + aged365,
          aged365: aged365,
        },
        ageBuckets: [
          { label: 'Under 90 days', items: agedUnder90, units: unitsUnder90 },
          { label: '90–180 days', items: aged90, units: units90 },
          { label: '180–365 days', items: aged180, units: units180 },
          { label: '365+ days', items: aged365, units: units365 },
        ],
        agedItems: agedItems.sort((a, b) => b.daysOnHand - a.daysOnHand).slice(0, 25),
      },
    })
  } catch (error: unknown) {
    logError(error, { context: '[analytics/store-inventory-aging]' })
    return c.json({ error: 'Failed to load inventory aging' }, 500)
  }
})

export default analyticsStoreApp
