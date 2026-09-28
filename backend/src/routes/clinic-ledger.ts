/**
 * /api/clinic-ledger
 *
 * Aggregated financial view for the clinic:
 * - Revenue committed (total invoiced)
 * - Revenue received (total payments collected)
 * - Outstanding (unpaid invoices) with aging buckets
 * - Expenses broken by category
 * - Collection rate
 * - Wallet balances (unallocated patient funds)
 */

import { and, count, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { expenses, invoices, patientWallets, paymentPlans, payments } from '../db/schema'
import { logAnalyticsAccess } from '../lib/analytics-audit'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const clinicLedgerApp = new Hono<HonoEnv>()

// GET /api/clinic-ledger/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
clinicLedgerApp.get('/summary', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const fromStr = c.req.query('from')
  const toStr = c.req.query('to')
  const from = fromStr ? new Date(fromStr) : new Date(new Date().getFullYear(), 0, 1) // YTD default
  const to = toStr ? new Date(`${toStr}T23:59:59`) : new Date()

  await logAnalyticsAccess(c, 'clinic-ledger-summary', `${fromStr || 'ytd'} to ${toStr || 'now'}`)

  // ── Revenue: total invoiced in period ──────────────────────────────────────
  const [invoiceAgg] = await db
    .select({
      totalInvoiced: sql<number>`COALESCE(SUM(amount), 0)`,
      totalPaid: sql<number>`COALESCE(SUM("paidAmount"), 0)`,
      totalOutstanding: sql<number>`COALESCE(SUM(amount - "paidAmount") FILTER (WHERE status NOT IN ('paid','waived')), 0)`,
      countPending: sql<number>`COUNT(*) FILTER (WHERE status = 'pending')`,
      countPartial: sql<number>`COUNT(*) FILTER (WHERE status = 'partial')`,
      countOverdue: sql<number>`COUNT(*) FILTER (WHERE status = 'overdue')`,
      countPaid: sql<number>`COUNT(*) FILTER (WHERE status = 'paid')`,
      countWaived: sql<number>`COUNT(*) FILTER (WHERE status = 'waived')`,
    })
    .from(invoices)
    .where(and(gte(invoices.createdAt, from), lte(invoices.createdAt, to)))

  // ── Revenue: actual payments received in period ────────────────────────────
  const [paymentAgg] = await db
    .select({
      totalReceived: sql<number>`COALESCE(SUM(amount), 0)`,
      countPayments: sql<number>`COUNT(*)`,
    })
    .from(payments)
    .where(
      and(eq(payments.status, 'posted'), gte(payments.createdAt, from), lte(payments.createdAt, to))
    )

  // ── Outstanding aging buckets (all time, not filtered by date) ────────────
  const now = new Date()
  const d30 = new Date(now)
  d30.setDate(d30.getDate() - 30)
  const d60 = new Date(now)
  d60.setDate(d60.getDate() - 60)
  const d90 = new Date(now)
  d90.setDate(d90.getDate() - 90)

  const [aging] = await db
    .select({
      current: sql<number>`COALESCE(SUM(amount - "paidAmount") FILTER (WHERE "dueDate" >= ${now} OR "dueDate" IS NULL), 0)`,
      overdue030: sql<number>`COALESCE(SUM(amount - "paidAmount") FILTER (WHERE "dueDate" >= ${d30} AND "dueDate" < ${now}), 0)`,
      overdue3160: sql<number>`COALESCE(SUM(amount - "paidAmount") FILTER (WHERE "dueDate" >= ${d60} AND "dueDate" < ${d30}), 0)`,
      overdue6190: sql<number>`COALESCE(SUM(amount - "paidAmount") FILTER (WHERE "dueDate" >= ${d90} AND "dueDate" < ${d60}), 0)`,
      overdue90plus: sql<number>`COALESCE(SUM(amount - "paidAmount") FILTER (WHERE "dueDate" < ${d90}), 0)`,
    })
    .from(invoices)
    .where(sql`status NOT IN ('paid', 'waived') AND (amount - "paidAmount") > 0`)

  // ── Expenses by category in period ────────────────────────────────────────
  const expensesByCategory = await db
    .select({
      category: expenses.category,
      total: sql<number>`COALESCE(SUM(amount), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(expenses)
    .where(
      and(
        gte(expenses.date, from),
        lte(expenses.date, to),
        // Option A: only expenses ON THE BOOKS count (matches the GL P&L).
        sql`EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_doc_type = 'expense' AND je.is_reversal = false AND je.source_doc_id = ${expenses.id})`
      )
    )
    .groupBy(expenses.category)
    .orderBy(desc(sql`SUM(amount)`))

  const totalExpenses = expensesByCategory.reduce((s, e) => s + e.total, 0)

  // ── Unallocated wallet balances (patients with credit sitting idle) ─────────
  const [walletAgg] = await db
    .select({
      totalUnallocated: sql<number>`COALESCE(SUM("creditBalance"), 0)`,
      patientsWithCredit: sql<number>`COUNT(*) FILTER (WHERE "creditBalance" > 0)`,
    })
    .from(patientWallets)

  // ── Active plans summary ───────────────────────────────────────────────────
  const [planAgg] = await db
    .select({
      activeFixed: sql<number>`COUNT(*) FILTER (WHERE type = 'fixed' AND status = 'activated')`,
      activeFlexible: sql<number>`COUNT(*) FILTER (WHERE type = 'flexible' AND status NOT IN ('completed','paused'))`,
      completed: sql<number>`COUNT(*) FILTER (WHERE status = 'completed')`,
      overdue: sql<number>`COUNT(*) FILTER (WHERE status = 'overdue')`,
    })
    .from(paymentPlans)

  const totalInvoiced = invoiceAgg.totalInvoiced ?? 0
  const totalReceived = paymentAgg.totalReceived ?? 0
  const totalOutstanding = invoiceAgg.totalOutstanding ?? 0
  const collectionRate = totalInvoiced > 0 ? (totalReceived / totalInvoiced) * 100 : 0

  return c.json({
    success: true,
    data: {
      period: { from: from.toISOString(), to: to.toISOString() },
      revenue: {
        totalInvoiced,
        totalReceived,
        totalOutstanding,
        collectionRate: Math.round(collectionRate * 10) / 10,
        invoiceCounts: {
          pending: invoiceAgg.countPending,
          partial: invoiceAgg.countPartial,
          overdue: invoiceAgg.countOverdue,
          paid: invoiceAgg.countPaid,
          waived: invoiceAgg.countWaived,
        },
      },
      aging: {
        current: aging.current,
        overdue030: aging.overdue030,
        overdue3160: aging.overdue3160,
        overdue6190: aging.overdue6190,
        overdue90plus: aging.overdue90plus,
      },
      expenses: {
        total: totalExpenses,
        byCategory: expensesByCategory,
      },
      netCashPosition: totalReceived - totalExpenses,
      wallets: {
        totalUnallocated: walletAgg.totalUnallocated,
        patientsWithCredit: walletAgg.patientsWithCredit,
      },
      plans: planAgg,
    },
  })
})

// GET /api/clinic-ledger/outstanding — list all outstanding invoices with patient info
clinicLedgerApp.get('/outstanding', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)

  const page = Math.max(1, Number.parseInt(c.req.query('page') ?? '1', 10) || 1)
  const limit = Math.min(
    200,
    Math.max(1, Number.parseInt(c.req.query('limit') ?? '100', 10) || 100)
  )
  const offset = (page - 1) * limit

  const outstandingWhere = sql`status NOT IN ('paid', 'waived') AND (amount - "paidAmount") > 0`
  const [data, countRows] = await Promise.all([
    db.query.invoices.findMany({
      where: outstandingWhere,
      with: {
        patient: { columns: { id: true, name: true, patientId: true, phone: true } },
        plan: { columns: { id: true, type: true } },
      },
      orderBy: [desc(invoices.dueDate)],
      limit,
      offset,
    }),
    db.select({ total: count() }).from(invoices).where(outstandingWhere),
  ])

  const total = countRows[0]?.total ?? 0
  return c.json({ success: true, data, total, limit, page })
})

export { clinicLedgerApp }
