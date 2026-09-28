import { Money } from '@denel/utils'
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { env } from '../config/env'
import { type DB, getDb } from '../db'
import {
  dailyReports,
  dailyRestockDrafts,
  expenses,
  items,
  labCases,
  reportDayWaivers,
  sales,
} from '../db/schema'
import { buildModuleSummaries, type ModuleSummary, type ModuleSummaryMetric } from '../lib/digest'
import { recalculateReportTotals } from '../lib/finance-service'
import { generateBalanceSheet, generateProfitLoss } from '../lib/financial-reports'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import {
  buildPeriodList,
  buildPeriodSummary,
  isIsoDate,
  PERIOD_LIST_MAX,
  PERIOD_TIERS,
  type PeriodTier,
} from '../lib/period-report-service'
import { checkPermission, getCurrentUser, isAdmin } from '../lib/rbac'
import { postRetailSaleToGL } from '../lib/retail-service'
import type { HonoEnv } from '../lib/types'

// ── Zod input schemas ─────────────────────────────────────────────────────────

// Inventory item used during a daily report (references inventory.id)
const inventoryUsedItemSchema = z.object({
  id: z.string().uuid(),
  quantity: z.number().int().nonnegative(),
})

// Product sold inline at report submission time (references products.id)
const productSoldItemSchema = z.object({
  id: z.string().uuid(),
  quantity: z.number().int().nonnegative(),
})

// Restock item recorded in this report
const restockedItemSchema = z.object({
  inventoryId: z.string().uuid().optional(),
  inventoryType: z.string().optional(),
  name: z.string(),
  quantityAdded: z.number().int().positive(),
  location: z.string().nullish(),
})

// POST / — create a daily report
// Excluded (server-owned): id, createdAt, submittedById, isMissedReport,
// adminNote, adminSubmittedById
const createDailyReportSchema = z.object({
  reportDate: z.string().optional(),
  checkedInCount: z.number().int().nonnegative(),
  newPatientsCount: z.number().int().nonnegative(),
  // totalPayments / totalExpenses: numeric(15,2) in DB; coerce to number
  totalPayments: z.coerce.number(),
  totalExpenses: z.coerce.number(),
  balances: z.record(z.string(), z.unknown()),
  inventoryUsed: z.array(inventoryUsedItemSchema).default([]),
  productsSold: z.array(productSoldItemSchema).optional(),
  restockedItems: z.array(restockedItemSchema).optional(),
  additionalNote: z.string().nullish(),
  // Admin-provided explanation when submitting a missed report (written to
  // dailyReports.adminNote server-side only if isMissed is true).
  // isMissedReport and adminSubmittedById are ALWAYS server-computed — excluded.
  adminNote: z.string().nullish(),
  // Non-column payload fields for linking pre-created draft sales / expenses
  saleIds: z.array(z.string().uuid()).optional(),
  expenseIds: z.array(z.string().uuid()).optional(),
})

// POST /restock-drafts — record an intra-day restock draft
// Excluded (server-owned): id, recordedById, recordedAt
const createRestockDraftSchema = z.object({
  date: z.string().optional(),
  inventoryId: z.string().uuid().nullish(),
  inventoryType: z.string().optional(),
  name: z.string(),
  quantityAdded: z.number().int().positive(),
  location: z.string().nullish(),
})

const reportsApp = new Hono<HonoEnv>()

const MODULE = MODULES.REPORTS

// §10.5 — daily-report list pagination + optional date range. Extracted for testing.
export async function listDailyReports(
  db: DB,
  opts: { limit?: number; offset?: number; from?: string; to?: string } = {}
) {
  const limit = Number.isFinite(opts.limit) ? Math.min(Math.max(opts.limit as number, 1), 200) : 50
  const offset = opts.offset && opts.offset > 0 ? opts.offset : 0
  const conditions = []
  if (opts.from && !Number.isNaN(Date.parse(opts.from)))
    conditions.push(gte(dailyReports.reportDate, new Date(opts.from)))
  if (opts.to && !Number.isNaN(Date.parse(opts.to)))
    conditions.push(lte(dailyReports.reportDate, new Date(opts.to)))
  const where = conditions.length > 0 ? and(...conditions) : undefined

  const [data, totalRows] = await Promise.all([
    db.query.dailyReports.findMany({
      where,
      orderBy: [desc(dailyReports.reportDate)],
      with: { submittedBy: { columns: { name: true, email: true } } },
      limit,
      offset,
    }),
    db.select({ n: count() }).from(dailyReports).where(where),
  ])
  return { data, total: totalRows[0]?.n ?? 0, limit, offset }
}

reportsApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const result = await listDailyReports(db, {
      limit: Number.parseInt(c.req.query('limit') || '50', 10),
      offset: Number.parseInt(c.req.query('offset') || '0', 10),
      from: c.req.query('from'),
      to: c.req.query('to'),
    })
    return c.json({ success: true, ...result })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// GET /digest?date=YYYY-MM-DD — live per-module summary blocks for a date
// (admin-v1 §10.1). Static route; Hono prioritises it over /:id.
reportsApp.get('/digest', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const dateParam = c.req.query('date')
  const date = dateParam ? new Date(dateParam) : new Date()
  if (Number.isNaN(date.getTime())) return c.json({ error: 'Invalid date' }, 400)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    // §10.2 — surface the GL-sourced revenue/expense alongside the live module
    // blocks so the day-sheet can reconcile its raw totals against the books.
    const [summaries, glReconciled] = await Promise.all([
      buildModuleSummaries(db, date),
      glDayReconciliation(db, date),
    ])
    return c.json({ success: true, data: summaries, glReconciled })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to build digest' }, 500)
  }
})

// §10.4 — count lab cases that became expense-ready on/before `before` but whose
// expense hasn't been recorded yet (no externalExpenseId). The day-sheet gate.
export async function countUnclearedLabExpenses(db: DB, before: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(labCases)
    .where(
      and(
        isNotNull(labCases.expenseReadyAt),
        lt(labCases.expenseReadyAt, before),
        isNull(labCases.externalExpenseId)
      )
    )
  return row?.n ?? 0
}

// §10.2 — GL-reconciled day figures. The day-sheet's totalPayments/totalExpenses
// come from the raw payment/expense tables filtered by day; this surfaces the
// SAME figures sourced from the GL (the books the P&L / revenue-by-category use)
// so the two can be reconciled rather than drifting as a second source of truth.
//
// `revenue` / `expenses` are P&L account activity for the single calendar day
// (identical to running `generateProfitLoss(db, day, day)`), so a day's digest
// revenue/expense lines up with the statements exactly. Returns the YYYY-MM-DD
// the figures were computed for.
export interface GlDayReconciliation {
  date: string
  revenue: number
  expenses: number
  netIncome: number
}

export async function glDayReconciliation(db: DB, date: Date): Promise<GlDayReconciliation> {
  const day = ymd(date)
  // Single-day P&L window [day, day]; entry_date is a DATE column so an inclusive
  // BETWEEN on the same date captures exactly that calendar day's postings.
  const pl = await generateProfitLoss(db, day, day)
  return {
    date: day,
    revenue: pl.totalRevenue,
    expenses: pl.totalExpenses,
    netIncome: pl.netIncome,
  }
}

// Local YYYY-MM-DD — matches how the day-sheet keys a calendar day. Avoids the
// UTC shift `toISOString().slice(0,10)` would introduce for non-UTC servers.
function ymd(d: Date): string {
  const pad = (n: number) => `${n}`.padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// GET /api/reports/gl-reconciliation?date=YYYY-MM-DD — the GL-sourced revenue /
// expense for a calendar day, to reconcile against the day-sheet totals. Static
// route; declared before /:id so Hono matches it first.
reportsApp.get('/gl-reconciliation', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const dateParam = c.req.query('date')
  const date = dateParam ? new Date(dateParam) : new Date()
  if (Number.isNaN(date.getTime())) return c.json({ error: 'Invalid date' }, 400)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const data = await glDayReconciliation(db, date)
    return c.json({ success: true, data })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to compute GL reconciliation' }, 500)
  }
})

// GET /api/reports/daily-expense-total?date=YYYY-MM-DD — the day's expense
// TOTAL only, for the daily-report reconciliation panel.
//
// Reception submits the daily report (`reports:create`) but deliberately has no
// `expenses:read` — expenses sit under financial_records in roles.config.ts. The
// report still has to show what was spent so the balance reconciles, so this
// returns the aggregate and nothing else: no payees, categories, or rows. Gated
// on `reports:create`, since needing the figure follows from submitting.
// Static route; declared before /:id so Hono matches it first.
reportsApp.get('/daily-expense-total', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const dateParam = c.req.query('date')
  const date = dateParam ? new Date(dateParam) : new Date()
  if (Number.isNaN(date.getTime())) return c.json({ error: 'Invalid date' }, 400)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const dayStart = new Date(date)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)

    const rows = await db
      .select({ amount: expenses.amount })
      .from(expenses)
      .where(and(gte(expenses.date, dayStart), lt(expenses.date, dayEnd)))

    // `expenses.amount` is an `integer` CENTS column since migration 0209.
    // Read it through `Money.fromDb` (which still tolerates the string form a
    // bigint column would return) and hand back cents, matching every other
    // money figure on the API.
    const totalExpenses = Money.sum(rows.map((row) => Money.fromDb(row.amount))).toDbValue()
    return c.json({ success: true, data: { totalExpenses, expenseCount: rows.length } })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to compute expense total' }, 500)
  }
})

reportsApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const parsed = createDailyReportSchema.safeParse(await c.req.json())
  if (!parsed.success)
    return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
  const data = parsed.data
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const submissionDate = data.reportDate ? new Date(data.reportDate) : new Date()

    // Idempotency guard (one report per calendar day): re-submitting would deduct
    // stock + create store sales + post retail GL a SECOND time (the productsSold
    // branch has no per-item guard). Reject a duplicate for the same day.
    const dayStart = new Date(submissionDate)
    dayStart.setHours(0, 0, 0, 0)
    const nextDay = new Date(dayStart)
    nextDay.setDate(nextDay.getDate() + 1)
    const [dupe] = await db
      .select({ id: dailyReports.id })
      .from(dailyReports)
      .where(and(gte(dailyReports.reportDate, dayStart), lt(dailyReports.reportDate, nextDay)))
      .limit(1)
    if (dupe) return c.json({ error: 'A report for this date already exists.' }, 409)

    // §10.4 — server-side lab-expense gate (the client hard-blocks; this enforces it
    // for direct API calls): reject while a lab case ready on/before this day is
    // still uncleared, BEFORE any stock deduction / sale finalisation.
    const pendingLab = await countUnclearedLabExpenses(db, nextDay)
    if (pendingLab > 0) {
      return c.json(
        {
          error: `${pendingLab} lab expense${pendingLab === 1 ? '' : 's'} must be recorded before submitting this report.`,
        },
        409
      )
    }

    // Update inventory stock
    for (const item of data.inventoryUsed) {
      if (item.quantity > 0) {
        // §12.1 — deduct from the unified catalog (consumable items).
        await db
          .update(items)
          .set({
            stockQuantity: sql`${items.stockQuantity} - ${item.quantity}`,
            updatedAt: new Date(),
          })
          .where(and(eq(items.id, item.id), gte(items.stockQuantity, item.quantity)))
      }
    }

    // Freeze every module's digest block onto the report (admin-v1 §10.1).
    const moduleSummaries = await buildModuleSummaries(db, submissionDate)

    const [report] = await db
      .insert(dailyReports)
      .values({
        reportDate: submissionDate,
        moduleSummaries,
        checkedInCount: data.checkedInCount,
        newPatientsCount: data.newPatientsCount,
        totalPayments: data.totalPayments,
        totalExpenses: data.totalExpenses,
        balances: data.balances,
        inventoryUsed: data.inventoryUsed,
        productsSold: data.productsSold ?? [],
        restockedItems: data.restockedItems ?? [],
        additionalNote: data.additionalNote ?? null,
        submittedById: user.id,
      })
      .returning()

    // Handle the new drafting flow by linking pre-created draft sales
    if (data.saleIds && Array.isArray(data.saleIds) && data.saleIds.length > 0) {
      for (const saleId of data.saleIds) {
        // Fetch the draft sale to get the product + quantity
        const [draftSale] = await db.select().from(sales).where(eq(sales.id, saleId)).limit(1)
        // Skip a sale already finalised (re-submitting a report must not deduct stock
        // twice or re-attempt the post).
        if (draftSale && draftSale.status !== 'submitted') {
          // Deduct stock now that the sale is being finalized
          const [product] = await db
            .select()
            .from(items)
            .where(eq(items.id, draftSale.itemId))
            .limit(1)
          if (product) {
            const quantityPerPack = product.quantityPerPack || 1
            // Convert individual item quantity to packs and deduct (catalog).
            const packsToDeduct = draftSale.quantity / quantityPerPack
            await db
              .update(items)
              .set({
                stockQuantity: sql`${items.stockQuantity} - ${packsToDeduct}`,
                updatedAt: new Date(),
              })
              .where(eq(items.id, draftSale.itemId))
          }

          await db
            .update(sales)
            .set({
              status: 'submitted',
              dailyReportId: report.id,
            })
            .where(eq(sales.id, saleId))

          // Phase 4 (§12.2): put the finalised store sale on the books (best-effort).
          try {
            await postRetailSaleToGL(
              db,
              { ...draftSale, status: 'submitted' },
              user.id,
              submissionDate
            )
          } catch (glErr) {
            logError(glErr, { context: 'retail sale GL (non-fatal)' })
          }
        }
      }
    }

    if (data.productsSold && Array.isArray(data.productsSold)) {
      // Creates sales right at submission for non-draft items
      for (const item of data.productsSold) {
        if (item.quantity > 0) {
          const [product] = await db.select().from(items).where(eq(items.id, item.id)).limit(1)
          if (!product) throw new Error(`Item ${item.id} not found`)

          const unitPrice = product.price || 0
          const costPrice = product.costPrice || 0

          const [newSale] = await db
            .insert(sales)
            .values({
              itemId: item.id,
              quantity: item.quantity,
              unitPrice: unitPrice,
              costPrice: costPrice,
              totalAmount: unitPrice * item.quantity,
              profit: (unitPrice - costPrice) * item.quantity,
              saleDate: data.reportDate ? new Date(data.reportDate) : new Date(),
              status: 'submitted', // explicitly submit since it's going right into the report
              dailyReportId: report.id,
            })
            .returning()

          // Phase 4 (§12.2): put the finalised store sale on the books (best-effort).
          try {
            await postRetailSaleToGL(db, newSale, user.id, submissionDate)
          } catch (glErr) {
            logError(glErr, { context: 'retail sale GL (non-fatal)' })
          }

          // §12.1 — deduct from the unified catalog.
          await db
            .update(items)
            .set({
              stockQuantity: sql`${items.stockQuantity} - ${item.quantity}`,
              updatedAt: new Date(),
            })
            .where(eq(items.id, item.id))
        }
      }
    }

    // M5.6 — attach expenses to this daily report so they become locked for
    // receptionists. The frontend already filters expenses by `reportDate` day
    // when computing `totalExpenses`, so we mirror that: link every unlocked
    // expense whose `date` falls within the same calendar day as the report.
    //
    // Optional payload: `expenseIds` — if the frontend explicitly sends an
    // array, use it verbatim instead of the date-based match.
    const reportDate = report.reportDate
    if (Array.isArray(data.expenseIds) && data.expenseIds.length > 0) {
      await db
        .update(expenses)
        .set({ dailyReportId: report.id })
        .where(
          and(inArray(expenses.id, data.expenseIds as string[]), isNull(expenses.dailyReportId))
        )
    } else if (reportDate) {
      const dayStart = new Date(reportDate)
      dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(dayStart)
      dayEnd.setDate(dayEnd.getDate() + 1)
      await db
        .update(expenses)
        .set({ dailyReportId: report.id })
        .where(
          and(
            gte(expenses.date, dayStart),
            lt(expenses.date, dayEnd),
            isNull(expenses.dailyReportId)
          )
        )
    }

    // The client's `totalExpenses` is advisory only — recompute from the
    // expenses just linked above so the stored figure is authoritative.
    //
    // Without this, a submitter who cannot read expenses (reception holds
    // `reports:create` but not `expenses:read`) posts `totalExpenses: 0`,
    // because the form's expense fetch 403s and its local total collapses to
    // zero. That silently understates expenses and overstates the balance.
    // Recomputing here also makes creation agree with every later edit, which
    // already routes through this same helper.
    await recalculateReportTotals(db, report.id)

    // Apply restocked items — increment inventory stock for each entry.
    const restockedItems: Array<{
      inventoryId?: string
      inventoryType?: string
      name: string
      quantityAdded: number
      location?: string | null
    }> = Array.isArray(data.restockedItems) ? data.restockedItems : []

    for (const item of restockedItems) {
      if (!item.inventoryId || !item.quantityAdded || item.quantityAdded <= 0) continue
      // §12.1 — restock the unified catalog (inventoryType kept only as provenance).
      await db
        .update(items)
        .set({
          stockQuantity: sql`${items.stockQuantity} + ${item.quantityAdded}`,
          updatedAt: new Date(),
        })
        .where(eq(items.id, item.inventoryId))
    }

    // Clear pending restock drafts for this date (they are now applied).
    if (restockedItems.length > 0) {
      const dateKey = reportDate
        ? new Date(reportDate).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10)
      await db.delete(dailyRestockDrafts).where(eq(dailyRestockDrafts.date, dateKey))
    }

    // Mark as missed report if the report date is before today.
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const rDate = reportDate ? new Date(reportDate) : new Date()
    rDate.setHours(0, 0, 0, 0)
    const isMissed = rDate < today

    if (isMissed) {
      await db
        .update(dailyReports)
        .set({
          isMissedReport: true,
          adminNote: data.adminNote ?? null,
          adminSubmittedById: user.id,
        })
        .where(eq(dailyReports.id, report.id))
    }

    return c.json({ success: true, data: { ...report, restockedItems } })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// ── Restock draft endpoints ───────────────────────────────────────────────────
// Intra-day staging: receptionist records a delivery here during the day.
// The report submission handler applies these to inventory and clears them.

// GET /api/reports/restock-drafts?date=YYYY-MM-DD
reportsApp.get('/restock-drafts', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const date = c.req.query('date') ?? new Date().toISOString().slice(0, 10)
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const drafts = await db
      .select()
      .from(dailyRestockDrafts)
      .where(eq(dailyRestockDrafts.date, date))
    return c.json({ success: true, data: drafts })
  } catch {
    return c.json({ error: 'Failed to fetch restock drafts' }, 500)
  }
})

// POST /api/reports/restock-drafts
// Body: { date, inventoryId, inventoryType, name, quantityAdded, location? }
reportsApp.post('/restock-drafts', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const parsed = createRestockDraftSchema.safeParse(await c.req.json())
  if (!parsed.success)
    return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
  const body = parsed.data

  const db = getDb(process.env.DATABASE_URL!)
  const date = body.date ?? new Date().toISOString().slice(0, 10)

  try {
    const [draft] = await db
      .insert(dailyRestockDrafts)
      .values({
        date,
        inventoryId: body.inventoryId ?? null,
        inventoryType: body.inventoryType ?? 'inventory',
        name: body.name,
        quantityAdded: body.quantityAdded,
        location: body.location ?? null,
        recordedById: user.id,
      })
      .returning()
    return c.json({ success: true, data: draft }, 201)
  } catch {
    return c.json({ error: 'Failed to record restock draft' }, 500)
  }
})

// DELETE /api/reports/restock-drafts/:id
reportsApp.delete('/restock-drafts/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.DELETE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)

  try {
    await db.delete(dailyRestockDrafts).where(eq(dailyRestockDrafts.id, id))
    return c.json({ success: true })
  } catch {
    return c.json({ error: 'Failed to delete restock draft' }, 500)
  }
})

// ── Report-day waivers ────────────────────────────────────────────────────────
// Lets an admin excuse a specific day from the missed-reports banner without
// submitting a fabricated report for it. Admin-only (isAdmin, not
// checkPermission) — same reasoning as /price-adjustments: this needs to stay
// exclusive to the admin role regardless of what bundles get assigned around
// it.

// GET /api/reports/waivers — the full list (small table, no pagination needed).
reportsApp.get('/waivers', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const rows = await db.query.reportDayWaivers.findMany({
      orderBy: (t, { desc: descOp }) => [descOp(t.date)],
      with: { waivedBy: { columns: { name: true } } },
    })
    return c.json({
      success: true,
      data: rows.map((r) => ({
        date: r.date,
        reason: r.reason,
        waivedById: r.waivedById,
        waivedByName: r.waivedBy?.name ?? null,
        createdAt: r.createdAt,
      })),
    })
  } catch {
    return c.json({ error: 'Failed to fetch report waivers' }, 500)
  }
})

// POST /api/reports/waivers — Body: { date: YYYY-MM-DD, reason?: string }
reportsApp.post('/waivers', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await isAdmin(c, user.id))) return c.json({ error: 'Unauthorized' }, 403)

  const body = await c.req.json().catch(() => ({}))
  const date = typeof body.date === 'string' ? body.date : null
  if (!date || !isIsoDate(date)) {
    return c.json({ error: 'date is required (YYYY-MM-DD)' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [row] = await db
      .insert(reportDayWaivers)
      .values({ date, reason: body.reason ?? null, waivedById: user.id })
      .onConflictDoUpdate({
        target: reportDayWaivers.date,
        set: { reason: body.reason ?? null, waivedById: user.id },
      })
      .returning()
    return c.json({ success: true, data: row }, 201)
  } catch {
    return c.json({ error: 'Failed to waive report day' }, 500)
  }
})

// DELETE /api/reports/waivers/:date — undo a waiver (the day goes back to
// being flagged as missed if it still has no submitted report).
reportsApp.delete('/waivers/:date', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await isAdmin(c, user.id))) return c.json({ error: 'Unauthorized' }, 403)

  const date = c.req.param('date')
  const db = getDb(process.env.DATABASE_URL!)
  try {
    await db.delete(reportDayWaivers).where(eq(reportDayWaivers.date, date))
    return c.json({ success: true })
  } catch {
    return c.json({ error: 'Failed to remove report waiver' }, 500)
  }
})

// NOTE: `:id` is UUID-constrained so it cannot shadow the static GL-report
// routes registered below it (/profit-loss, /cash-flow, /balance-sheet, …).
// Without the constraint, a request to /api/reports/profit-loss matches this
// param route with id="profit-loss", which then fails the uuid lookup and
// returns a 500 instead of the intended report. See the daily-report id column
// (uuid) — a 36-char hex+dash guard is exact.
reportsApp.get('/:id{[0-9a-fA-F-]{36}}', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const report = await db.query.dailyReports.findFirst({
      where: eq(dailyReports.id, id),
      with: { submittedBy: { columns: { name: true, email: true } } },
    })

    if (!report) return c.json({ error: 'Not found' }, 404)
    return c.json({ success: true, data: report })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

reportsApp.delete('/:id{[0-9a-fA-F-]{36}}', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.DELETE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)

  try {
    await db.delete(dailyReports).where(eq(dailyReports.id, id))
    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// ── GL-driven Financial Reports (Phase 1) ────────────────────────────────────

// GET /api/reports/profit-loss?from=YYYY-MM-DD&to=YYYY-MM-DD
reportsApp.get('/profit-loss', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const from = c.req.query('from')
  const to = c.req.query('to')
  if (!from || !to) return c.json({ error: 'from and to are required (YYYY-MM-DD)' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const report = await generateProfitLoss(db, from, to)
  return c.json({ success: true, data: report })
})

// GET /api/reports/cash-flow?from=YYYY-MM-DD&to=YYYY-MM-DD
// Classifies cash movements (changes in 10xx accounts) into Operating,
// Investing, and Financing using source_doc_type on the journal entry.
// Spec §8.3.
reportsApp.get('/cash-flow', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const from = c.req.query('from')
  const to = c.req.query('to')
  if (!from || !to) return c.json({ error: 'from and to are required (YYYY-MM-DD)' }, 400)

  const db = getDb(process.env.DATABASE_URL!)

  // Cash accounts: 10xx (1000–1099 = cash, bank, MoMo, card processor).
  // Positive net = inflow (DR cash), negative = outflow (CR cash).
  const rows = await db.execute<{ source_doc_type: string; category: string; net: string }>(sql`
    SELECT
      je.source_doc_type,
      CASE je.source_doc_type
        WHEN 'invoice'           THEN 'operating'
        WHEN 'payment'           THEN 'operating'
        WHEN 'credit_note'       THEN 'operating'
        WHEN 'refund'            THEN 'operating'
        WHEN 'bill'              THEN 'operating'
        WHEN 'specialist_payout' THEN 'operating'
        WHEN 'write_off'         THEN 'operating'
        WHEN 'depreciation'      THEN 'investing'
        WHEN 'manual'            THEN 'operating'
        WHEN 'reversal'          THEN 'operating'
        WHEN 'period_close'      THEN 'financing'
        ELSE                          'operating'
      END AS category,
      COALESCE(SUM(jl.debit - jl.credit), 0)::text AS net
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE a.code LIKE '10__'
      AND je.entry_date BETWEEN ${from}::date AND ${to}::date
    GROUP BY je.source_doc_type
  `)

  // Opening and closing cash balance.
  const balances = await db.execute<{ kind: string; bal: string }>(sql`
    SELECT 'opening' AS kind, COALESCE(SUM(jl.debit - jl.credit), 0)::text AS bal
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE a.code LIKE '10__' AND je.entry_date < ${from}::date
    UNION ALL
    SELECT 'closing' AS kind, COALESCE(SUM(jl.debit - jl.credit), 0)::text AS bal
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE a.code LIKE '10__' AND je.entry_date <= ${to}::date
  `)
  const opening = Number(balances.rows.find((r) => r.kind === 'opening')?.bal ?? '0')
  const closing = Number(balances.rows.find((r) => r.kind === 'closing')?.bal ?? '0')

  const byCategory: Record<
    'operating' | 'investing' | 'financing',
    { sourceDocType: string; net: number }[]
  > = { operating: [], investing: [], financing: [] }
  for (const r of rows.rows) {
    const cat = r.category as 'operating' | 'investing' | 'financing'
    byCategory[cat].push({ sourceDocType: r.source_doc_type, net: Number(r.net) })
  }
  const totals = {
    operating: byCategory.operating.reduce((s, r) => s + r.net, 0),
    investing: byCategory.investing.reduce((s, r) => s + r.net, 0),
    financing: byCategory.financing.reduce((s, r) => s + r.net, 0),
  }
  const netChange = totals.operating + totals.investing + totals.financing

  return c.json({
    success: true,
    data: {
      from,
      to,
      operating: byCategory.operating,
      investing: byCategory.investing,
      financing: byCategory.financing,
      totals,
      netChange,
      openingCash: opening,
      closingCash: closing,
    },
  })
})

// GET /api/reports/revenue-by-category?from=YYYY-MM-DD&to=YYYY-MM-DD
reportsApp.get('/revenue-by-category', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const from = c.req.query('from')
  const to = c.req.query('to')
  if (!from || !to) return c.json({ error: 'from and to are required (YYYY-MM-DD)' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db.execute<{
    code: string
    name: string
    subtype: string | null
    amount: string
  }>(sql`
    SELECT
      a.code,
      a.name,
      a.subtype,
      COALESCE(SUM(CASE WHEN je.entry_date BETWEEN ${from}::date AND ${to}::date THEN jl.credit - jl.debit ELSE 0 END), 0)::text AS amount
    FROM accounts a
    LEFT JOIN journal_lines jl ON jl.account_id = a.id
    LEFT JOIN journal_entries je ON je.id = jl.entry_id
    WHERE a.type = 'revenue'
    GROUP BY a.code, a.name, a.subtype
    ORDER BY a.code
  `)

  const data = rows.rows.map((r) => ({
    accountCode: r.code,
    accountName: r.name,
    subtype: r.subtype,
    amount: Number(r.amount),
  }))
  const total = data.reduce((s, r) => s + r.amount, 0)
  return c.json({ success: true, data: { from, to, rows: data, total } })
})

// GET /api/reports/revenue-by-provider?from=YYYY-MM-DD&to=YYYY-MM-DD&by=provider|specialist
reportsApp.get('/revenue-by-provider', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const from = c.req.query('from')
  const to = c.req.query('to')
  const by = c.req.query('by') === 'specialist' ? 'specialist' : 'provider'
  if (!from || !to) return c.json({ error: 'from and to are required (YYYY-MM-DD)' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const rows =
    by === 'specialist'
      ? await db.execute<{
          id: string | null
          name: string | null
          total: string
          count: string
        }>(sql`
          SELECT
            s.id::text AS id,
            s.name     AS name,
            COALESCE(SUM(il.line_total), 0)::text AS total,
            count(il.id)::text AS count
          FROM invoice_lines il
          JOIN invoices i ON i.id = il.invoice_id
          LEFT JOIN specialists s ON s.id = il.specialist_id
          WHERE i.status IN ('issued', 'partially_paid', 'paid')
            AND i.archived = false
            AND i.issue_date BETWEEN ${from}::date AND ${to}::date
          GROUP BY s.id, s.name
          ORDER BY COALESCE(SUM(il.line_total), 0) DESC
        `)
      : await db.execute<{
          id: string | null
          name: string | null
          total: string
          count: string
        }>(sql`
          SELECT
            u.id::text AS id,
            u.name     AS name,
            COALESCE(SUM(il.line_total), 0)::text AS total,
            count(il.id)::text AS count
          FROM invoice_lines il
          JOIN invoices i ON i.id = il.invoice_id
          LEFT JOIN "user" u ON u.id = il.provider_id
          WHERE i.status IN ('issued', 'partially_paid', 'paid')
            AND i.archived = false
            AND i.issue_date BETWEEN ${from}::date AND ${to}::date
          GROUP BY u.id, u.name
          ORDER BY COALESCE(SUM(il.line_total), 0) DESC
        `)

  const data = rows.rows.map((r) => ({
    id: r.id,
    name: r.name ?? (by === 'specialist' ? '(no specialist)' : '(no provider)'),
    revenue: Number(r.total),
    lineCount: Number(r.count),
  }))
  const total = data.reduce((s, r) => s + r.revenue, 0)
  return c.json({ success: true, data: { from, to, by, rows: data, total } })
})

// GET /api/reports/cash-position?from=YYYY-MM-DD&to=YYYY-MM-DD
// Per 10xx account: opening, inflow, outflow, closing. Spec §8.11.
reportsApp.get('/cash-position', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const from = c.req.query('from')
  const to = c.req.query('to')
  if (!from || !to) return c.json({ error: 'from and to are required (YYYY-MM-DD)' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db.execute<{
    code: string
    name: string
    opening: string
    inflow: string
    outflow: string
    closing: string
  }>(sql`
    WITH cash_accts AS (
      SELECT id, code, name FROM accounts
      WHERE code LIKE '10__' AND is_active = true
    )
    SELECT
      ca.code,
      ca.name,
      COALESCE((
        SELECT SUM(jl.debit - jl.credit)
        FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.entry_id
        WHERE jl.account_id = ca.id AND je.entry_date < ${from}::date
      ), 0)::text AS opening,
      COALESCE((
        SELECT SUM(jl.debit)
        FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.entry_id
        WHERE jl.account_id = ca.id
          AND je.entry_date BETWEEN ${from}::date AND ${to}::date
      ), 0)::text AS inflow,
      COALESCE((
        SELECT SUM(jl.credit)
        FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.entry_id
        WHERE jl.account_id = ca.id
          AND je.entry_date BETWEEN ${from}::date AND ${to}::date
      ), 0)::text AS outflow,
      COALESCE((
        SELECT SUM(jl.debit - jl.credit)
        FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.entry_id
        WHERE jl.account_id = ca.id AND je.entry_date <= ${to}::date
      ), 0)::text AS closing
    FROM cash_accts ca
    ORDER BY ca.code
  `)

  const data = rows.rows.map((r) => ({
    accountCode: r.code,
    accountName: r.name,
    opening: Number(r.opening),
    inflow: Number(r.inflow),
    outflow: Number(r.outflow),
    closing: Number(r.closing),
  }))
  const totals = data.reduce(
    (acc, r) => ({
      opening: acc.opening + r.opening,
      inflow: acc.inflow + r.inflow,
      outflow: acc.outflow + r.outflow,
      closing: acc.closing + r.closing,
    }),
    { opening: 0, inflow: 0, outflow: 0, closing: 0 }
  )
  return c.json({ success: true, data: { from, to, accounts: data, totals } })
})

// GET /api/reports/specialist-commissions?from=YYYY-MM-DD&to=YYYY-MM-DD
// Per-specialist accrued / payable / paid totals + per-commission detail.
reportsApp.get('/specialist-commissions', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const from = c.req.query('from')
  const to = c.req.query('to')
  if (!from || !to) return c.json({ error: 'from and to are required (YYYY-MM-DD)' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db.execute<{
    specialist_id: string
    specialist_name: string
    accrued: string
    payable: string
    paid: string
    reversed: string
    total_commissioned: string
    commission_count: string
  }>(sql`
    SELECT
      s.id::text  AS specialist_id,
      s.name      AS specialist_name,
      COALESCE(SUM(CASE WHEN c.status = 'accrued'  THEN c.commission_amount - c.payable_amount ELSE 0 END), 0)::text AS accrued,
      COALESCE(SUM(CASE WHEN c.status = 'payable'  THEN c.payable_amount ELSE 0 END), 0)::text AS payable,
      COALESCE(SUM(CASE WHEN c.status = 'paid'     THEN c.commission_amount ELSE 0 END), 0)::text AS paid,
      COALESCE(SUM(CASE WHEN c.status = 'reversed' THEN c.commission_amount ELSE 0 END), 0)::text AS reversed,
      COALESCE(SUM(CASE WHEN c.status <> 'reversed' THEN c.commission_amount ELSE 0 END), 0)::text AS total_commissioned,
      count(c.id)::text AS commission_count
    FROM specialists s
    JOIN specialist_commissions c ON c.specialist_id = s.id
    WHERE c.accrued_at::date BETWEEN ${from}::date AND ${to}::date
    GROUP BY s.id, s.name
    ORDER BY COALESCE(SUM(CASE WHEN c.status <> 'reversed' THEN c.commission_amount ELSE 0 END), 0) DESC
  `)

  const data = rows.rows.map((r) => ({
    specialistId: r.specialist_id,
    specialistName: r.specialist_name,
    accrued: Number(r.accrued),
    payable: Number(r.payable),
    paid: Number(r.paid),
    reversed: Number(r.reversed),
    totalCommissioned: Number(r.total_commissioned),
    commissionCount: Number(r.commission_count),
  }))
  const summary = {
    accrued: data.reduce((s, r) => s + r.accrued, 0),
    payable: data.reduce((s, r) => s + r.payable, 0),
    paid: data.reduce((s, r) => s + r.paid, 0),
    reversed: data.reduce((s, r) => s + r.reversed, 0),
    totalCommissioned: data.reduce((s, r) => s + r.totalCommissioned, 0),
  }

  return c.json({ success: true, data: { from, to, rows: data, summary } })
})

// GET /api/reports/ap-aging?as_of=YYYY-MM-DD
// Buckets every open supplier bill by age from its due_date.
reportsApp.get('/ap-aging', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const asOf = c.req.query('as_of') ?? c.req.query('asOf') ?? new Date().toISOString().slice(0, 10)
  const db = getDb(process.env.DATABASE_URL!)

  const rows = await db.execute<{
    supplier_id: string
    supplier_name: string
    bill_count: string
    current: string
    bucket30: string
    bucket60: string
    bucket90: string
    total: string
    oldest_due: string | null
  }>(sql`
    WITH open_bills AS (
      SELECT b.id, b.supplier_id, b.due_date, b.balance,
             GREATEST(0, (${asOf}::date - b.due_date)) AS days_overdue
      FROM bills b
      WHERE b.status IN ('posted', 'partially_paid')
        AND b.balance > 0
    )
    SELECT
      s.id::text AS supplier_id,
      s.name AS supplier_name,
      count(ob.id)::text AS bill_count,
      COALESCE(SUM(CASE WHEN ob.days_overdue <= 30 THEN ob.balance END), 0)::text AS current,
      COALESCE(SUM(CASE WHEN ob.days_overdue BETWEEN 31 AND 60 THEN ob.balance END), 0)::text AS bucket30,
      COALESCE(SUM(CASE WHEN ob.days_overdue BETWEEN 61 AND 90 THEN ob.balance END), 0)::text AS bucket60,
      COALESCE(SUM(CASE WHEN ob.days_overdue > 90 THEN ob.balance END), 0)::text AS bucket90,
      COALESCE(SUM(ob.balance), 0)::text AS total,
      MIN(ob.due_date)::text AS oldest_due
    FROM suppliers s
    JOIN open_bills ob ON ob.supplier_id = s.id
    GROUP BY s.id, s.name
    HAVING SUM(ob.balance) > 0
    ORDER BY SUM(ob.balance) DESC
  `)

  const summary = { current: 0, bucket30: 0, bucket60: 0, bucket90: 0, total: 0 }
  const data = rows.rows.map((r) => {
    const row = {
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      billCount: Number(r.bill_count),
      current: Number(r.current),
      bucket30: Number(r.bucket30),
      bucket60: Number(r.bucket60),
      bucket90: Number(r.bucket90),
      total: Number(r.total),
      oldestDue: r.oldest_due,
    }
    summary.current += row.current
    summary.bucket30 += row.bucket30
    summary.bucket60 += row.bucket60
    summary.bucket90 += row.bucket90
    summary.total += row.total
    return row
  })

  return c.json({ success: true, data: { asOf, rows: data, summary } })
})

// GET /api/reports/discounts?from=YYYY-MM-DD&to=YYYY-MM-DD
// Combines line-level discounts (invoice_lines.discount_amount on issued
// invoices) with post-issue credit notes whose reason is 'discount'.
reportsApp.get('/discounts', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const from = c.req.query('from')
  const to = c.req.query('to')
  if (!from || !to) return c.json({ error: 'from and to are required (YYYY-MM-DD)' }, 400)

  const db = getDb(process.env.DATABASE_URL!)

  // Line-level discounts on issued invoices in the date range.
  const lineDiscounts = await db.execute<{
    invoice_id: string
    invoice_number: string
    issue_date: string | null
    discount_amount: string
    discount_reason: string | null
    authorized_by: string | null
    authorizer_name: string | null
    provider_id: string | null
    provider_name: string | null
  }>(sql`
    SELECT
      il.invoice_id::text,
      i."invoiceNumber" AS invoice_number,
      i.issue_date::text,
      il.discount_amount::text,
      il.discount_reason,
      il.discount_authorized_by AS authorized_by,
      auth.name AS authorizer_name,
      il.provider_id,
      prov.name AS provider_name
    FROM invoice_lines il
    JOIN invoices i ON i.id = il.invoice_id
    LEFT JOIN "user" auth ON auth.id = il.discount_authorized_by
    LEFT JOIN "user" prov ON prov.id = il.provider_id
    WHERE il.discount_amount > 0
      AND i.status IN ('issued', 'partially_paid', 'paid')
      AND i.issue_date BETWEEN ${from}::date AND ${to}::date
    ORDER BY i.issue_date DESC NULLS LAST
  `)

  // Credit notes issued with reason='discount' in the date range.
  const cnDiscounts = await db.execute<{
    credit_note_id: string
    credit_note_number: string
    invoice_number: string
    issue_date: string
    amount: string
    reason_notes: string | null
    approver_id: string | null
    approver_name: string | null
  }>(sql`
    SELECT
      cn.id::text AS credit_note_id,
      cn.credit_note_number,
      i."invoiceNumber" AS invoice_number,
      cn.issue_date::text,
      cn.amount::text,
      cn.reason_notes,
      cn.approved_by AS approver_id,
      app.name AS approver_name
    FROM credit_notes cn
    JOIN invoices i ON i.id = cn.invoice_id
    LEFT JOIN "user" app ON app.id = cn.approved_by
    WHERE cn.status = 'posted'
      AND cn.reason = 'discount'
      AND cn.issue_date BETWEEN ${from}::date AND ${to}::date
    ORDER BY cn.issue_date DESC
  `)

  const lineRows = lineDiscounts.rows.map((r) => ({
    source: 'invoice_line' as const,
    invoiceNumber: r.invoice_number,
    issueDate: r.issue_date,
    amount: Number(r.discount_amount),
    reason: r.discount_reason ?? null,
    authorizerId: r.authorized_by ?? null,
    authorizerName: r.authorizer_name ?? null,
    providerId: r.provider_id ?? null,
    providerName: r.provider_name ?? null,
  }))
  const cnRows = cnDiscounts.rows.map((r) => ({
    source: 'credit_note' as const,
    creditNoteNumber: r.credit_note_number,
    invoiceNumber: r.invoice_number,
    issueDate: r.issue_date,
    amount: Number(r.amount),
    reason: r.reason_notes ?? null,
    authorizerId: r.approver_id ?? null,
    authorizerName: r.approver_name ?? null,
  }))

  const totalLine = Number(lineRows.reduce((sum, r) => sum + r.amount, 0).toFixed(2))
  const totalCN = Number(cnRows.reduce((sum, r) => sum + r.amount, 0).toFixed(2))

  return c.json({
    success: true,
    data: {
      from,
      to,
      lineDiscounts: lineRows,
      creditNoteDiscounts: cnRows,
      totals: {
        lineDiscounts: totalLine,
        creditNoteDiscounts: totalCN,
        total: Number((totalLine + totalCN).toFixed(2)),
      },
    },
  })
})

// GET /api/reports/price-adjustments?from=YYYY-MM-DD&to=YYYY-MM-DD
// Admin-only monitoring view over invoice_lines.surcharge_amount /
// discount_amount (0215) — line-level detail per adjustment so an admin can
// spot anomalies (who, on which patient/service, by how much) without a
// reason field having been required at entry time.
reportsApp.get('/price-adjustments', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  // Deliberately isAdmin, not checkPermission — the REPORTS module bundle is
  // assignable to any role by an admin, so it can't gate an admin-exclusive
  // view. isAdmin is the only role-identity check in the codebase that can.
  if (!(await isAdmin(c, user.id))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const from = c.req.query('from')
  const to = c.req.query('to')
  if (!from || !to) return c.json({ error: 'from and to are required (YYYY-MM-DD)' }, 400)

  const db = getDb(process.env.DATABASE_URL!)

  const rows = await db.execute<{
    line_id: string
    invoice_id: string
    invoice_number: string
    issue_date: string | null
    patient_id: string | null
    patient_name: string | null
    description: string
    line_subtotal: string
    surcharge_type: string
    surcharge_value: string
    surcharge_amount: string
    surcharge_by_id: string | null
    surcharge_by_name: string | null
    discount_type: string
    discount_value: string
    discount_amount: string
    discount_by_id: string | null
    discount_by_name: string | null
    provider_id: string | null
    provider_name: string | null
  }>(sql`
    SELECT
      il.id::text AS line_id,
      il.invoice_id::text,
      i."invoiceNumber" AS invoice_number,
      i.issue_date::text,
      i."patientId" AS patient_id,
      p.name AS patient_name,
      il.description,
      il.line_subtotal::text,
      il.surcharge_type,
      il.surcharge_value::text,
      il.surcharge_amount::text,
      il.surcharge_authorized_by AS surcharge_by_id,
      su.name AS surcharge_by_name,
      il.discount_type,
      il.discount_value::text,
      il.discount_amount::text,
      il.discount_authorized_by AS discount_by_id,
      du.name AS discount_by_name,
      il.provider_id,
      prov.name AS provider_name
    FROM invoice_lines il
    JOIN invoices i ON i.id = il.invoice_id
    LEFT JOIN patients p ON p.id = i."patientId"
    LEFT JOIN "user" su ON su.id = il.surcharge_authorized_by
    LEFT JOIN "user" du ON du.id = il.discount_authorized_by
    LEFT JOIN "user" prov ON prov.id = il.provider_id
    WHERE (il.surcharge_amount > 0 OR il.discount_amount > 0)
      AND i.status IN ('issued', 'partially_paid', 'paid')
      AND i.issue_date BETWEEN ${from}::date AND ${to}::date
    ORDER BY i.issue_date DESC NULLS LAST
  `)

  const surcharges: Array<Record<string, unknown>> = []
  const discounts: Array<Record<string, unknown>> = []
  let surchargeTotal = 0
  let discountTotal = 0

  for (const r of rows.rows) {
    const base = {
      lineId: r.line_id,
      invoiceId: r.invoice_id,
      invoiceNumber: r.invoice_number,
      issueDate: r.issue_date,
      patientId: r.patient_id,
      patientName: r.patient_name,
      description: r.description,
      lineSubtotal: Number(r.line_subtotal),
      providerId: r.provider_id,
      providerName: r.provider_name,
    }
    const surchargeAmount = Number(r.surcharge_amount)
    if (surchargeAmount > 0) {
      surchargeTotal += surchargeAmount
      surcharges.push({
        ...base,
        type: r.surcharge_type,
        value: Number(r.surcharge_value),
        amount: surchargeAmount,
        deltaPct: base.lineSubtotal > 0 ? (surchargeAmount / base.lineSubtotal) * 100 : null,
        byId: r.surcharge_by_id,
        byName: r.surcharge_by_name,
      })
    }
    const discountAmount = Number(r.discount_amount)
    if (discountAmount > 0) {
      discountTotal += discountAmount
      discounts.push({
        ...base,
        type: r.discount_type,
        value: Number(r.discount_value),
        amount: discountAmount,
        deltaPct: base.lineSubtotal > 0 ? (discountAmount / base.lineSubtotal) * 100 : null,
        byId: r.discount_by_id,
        byName: r.discount_by_name,
      })
    }
  }

  return c.json({
    success: true,
    data: {
      from,
      to,
      surcharges,
      discounts,
      totals: { surcharges: surchargeTotal, discounts: discountTotal },
    },
  })
})

// GET /api/reports/balance-sheet?as_of=YYYY-MM-DD
reportsApp.get('/balance-sheet', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const asOf = c.req.query('as_of') ?? c.req.query('asOf')
  if (!asOf) return c.json({ error: 'as_of is required (YYYY-MM-DD)' }, 400)

  const db = getDb(env.DATABASE_URL)
  const report = await generateBalanceSheet(db, asOf)
  return c.json({ success: true, data: report })
})

// ── §10.3 — Period rollups over the persisted module summaries ────────────────
//
// Each daily report freezes every module's §10.1 digest block onto
// `dailyReports.moduleSummaries` at submission. A period rollup AGGREGATES those
// frozen blocks across all days in a week / month / quarter into one period-level
// summary: per module, per metric, the numeric values are summed across days.
//
// Metric values come in two stored shapes (see digest.ts):
//   - plain counts: `value: number`            → summed as-is
//   - money:        `value: "GHS 123.45"`      → parsed, summed, re-emitted "GHS …"
// A metric whose value can't be parsed to a number (rare/free-text) is carried
// through unchanged from the LAST day that reported it, and flagged non-numeric.

/** A money metric is stored as the string `GHS <amount>` (digest.ts convention). */
const GHS_RE = /^GHS\s+(-?\d+(?:\.\d+)?)$/

type ParsedMetricValue =
  | { kind: 'number'; n: number }
  | { kind: 'money'; n: number }
  | { kind: 'other'; raw: string | number }

function parseMetricValue(value: string | number): ParsedMetricValue {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { kind: 'number', n: value } : { kind: 'other', raw: value }
  }
  const money = GHS_RE.exec(value.trim())
  if (money) return { kind: 'money', n: Number(money[1]) }
  // A bare numeric string still aggregates as a count.
  const asNum = Number(value)
  if (value.trim() !== '' && Number.isFinite(asNum)) return { kind: 'number', n: asNum }
  return { kind: 'other', raw: value }
}

function formatMetricValue(kind: 'number' | 'money', n: number): string | number {
  return kind === 'money' ? `GHS ${n.toFixed(2)}` : n
}

export interface PeriodModuleMetric extends ModuleSummaryMetric {
  /** False when the metric value wasn't numeric and was carried through, not summed. */
  aggregated: boolean
}

export interface PeriodModuleSummary {
  module: string
  title: string
  metrics: PeriodModuleMetric[]
}

/**
 * Aggregate the per-day `moduleSummaries` blocks (already parsed from JSONB) into
 * one period-level summary. Pure + synchronous so it is trivially unit-testable.
 *
 * Modules are emitted in first-seen order across the period; within a module,
 * metrics are emitted in first-seen order. A module/metric absent on some days is
 * simply summed over the days it WAS present (missing == 0 contribution).
 */
export function rollupModuleSummaries(perDay: ModuleSummary[][]): PeriodModuleSummary[] {
  // module key → { title, order, metrics: Map<label, {value, kind, order, numeric}> }
  type MetricAcc = {
    label: string
    order: number
    kind: 'number' | 'money'
    sum: number
    numeric: boolean
    lastRaw: string | number
  }
  type ModuleAcc = { module: string; title: string; order: number; metrics: Map<string, MetricAcc> }
  const modules = new Map<string, ModuleAcc>()

  for (const day of perDay) {
    if (!Array.isArray(day)) continue
    for (const block of day) {
      if (!block || typeof block.module !== 'string' || !Array.isArray(block.metrics)) continue
      let mod = modules.get(block.module)
      if (!mod) {
        mod = { module: block.module, title: block.title, order: modules.size, metrics: new Map() }
        modules.set(block.module, mod)
      }
      for (const metric of block.metrics) {
        if (!metric || typeof metric.label !== 'string') continue
        const parsed = parseMetricValue(metric.value)
        let acc = mod.metrics.get(metric.label)
        if (!acc) {
          acc = {
            label: metric.label,
            order: mod.metrics.size,
            kind: parsed.kind === 'money' ? 'money' : 'number',
            sum: 0,
            numeric: true,
            lastRaw: metric.value,
          }
          mod.metrics.set(metric.label, acc)
        }
        acc.lastRaw = metric.value
        if (parsed.kind === 'other') {
          acc.numeric = false
        } else {
          // Once a label has shown a money value, keep it money-formatted.
          if (parsed.kind === 'money') acc.kind = 'money'
          acc.sum += parsed.n
        }
      }
    }
  }

  return [...modules.values()]
    .sort((a, b) => a.order - b.order)
    .map((mod) => ({
      module: mod.module,
      title: mod.title,
      metrics: [...mod.metrics.values()]
        .sort((a, b) => a.order - b.order)
        .map((m) => ({
          label: m.label,
          value: m.numeric ? formatMetricValue(m.kind, m.sum) : m.lastRaw,
          aggregated: m.numeric,
        })),
    }))
}

/**
 * Load every daily report whose `reportDate` falls in [from, to] (inclusive
 * calendar days) and roll their frozen `moduleSummaries` into a period summary.
 * Also returns the GL-sourced revenue/expense for the SAME window (§10.2) so the
 * period figures reconcile with the statements, plus the contributing day count.
 */
export async function getPeriodRollup(
  db: DB,
  from: string,
  to: string
): Promise<{
  from: string
  to: string
  dayCount: number
  modules: PeriodModuleSummary[]
  glReconciled: { revenue: number; expenses: number; netIncome: number }
}> {
  // Date-based window matching the GL's entry_date calendar window (§10.2/§10.3) so
  // the frozen module summaries and glReconciled describe the SAME days regardless of
  // server timezone. reportDate is a timestamp; ::date truncates to its calendar day.
  const rows = await db
    .select({ moduleSummaries: dailyReports.moduleSummaries })
    .from(dailyReports)
    .where(sql`${dailyReports.reportDate}::date BETWEEN ${from}::date AND ${to}::date`)
    .orderBy(dailyReports.reportDate)

  // moduleSummaries is JSONB; older rows may hold `{}` (object) instead of `[]`.
  const perDay: ModuleSummary[][] = rows.map((r) =>
    Array.isArray(r.moduleSummaries) ? (r.moduleSummaries as ModuleSummary[]) : []
  )

  // GL-sourced revenue/expense for the whole window — reuses the P&L generator so
  // the period figures match the statements exactly (§10.2).
  const pl = await generateProfitLoss(db, from, to)

  return {
    from,
    to,
    dayCount: rows.length,
    modules: rollupModuleSummaries(perDay),
    glReconciled: {
      revenue: pl.totalRevenue,
      expenses: pl.totalExpenses,
      netIncome: pl.netIncome,
    },
  }
}

// ─── Period report (T1) ──────────────────────────────────────────────────────
// These are a DIFFERENT feature from `/period-rollup` below. `/period-rollup`
// aggregates the frozen per-module daily-report digests; these two serve the
// portal Reports pages (Weekly / Monthly / Quarterly + the period detail view)
// and return the `PeriodSummary` / `PeriodListEntry[]` shapes those pages
// already declare in `portals/src/lib/actions/period-report.ts`.
//
// Path note: the `/:id{[0-9a-fA-F-]{36}}` routes above are UUID-constrained, so
// these literal paths are not shadowed by them (same as `/profit-loss`,
// `/balance-sheet`, `/period-rollup`).

// GET /api/reports/period-summary?from=YYYY-MM-DD&to=YYYY-MM-DD
reportsApp.get('/period-summary', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const from = c.req.query('from')
  const to = c.req.query('to')
  if (!from || !to) return c.json({ error: 'from and to are required (YYYY-MM-DD)' }, 400)
  if (!isIsoDate(from) || !isIsoDate(to)) return c.json({ error: 'Invalid date' }, 400)
  if (from > to) return c.json({ error: 'from must be on or before to' }, 400)

  try {
    const db = getDb(env.DATABASE_URL)
    const data = await buildPeriodSummary(db, from, to)
    return c.json({ success: true, data })
  } catch (error: unknown) {
    logError(error, { context: '[reports/period-summary]' })
    return c.json({ error: 'Failed to build period summary' }, 500)
  }
})

// GET /api/reports/period-list?tier=weekly|monthly|quarterly&count=N
reportsApp.get('/period-list', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const tierParam = c.req.query('tier') ?? 'monthly'
  if (!PERIOD_TIERS.includes(tierParam as PeriodTier)) {
    return c.json({ error: `tier must be one of ${PERIOD_TIERS.join(', ')}` }, 400)
  }

  const countRaw = c.req.query('count')
  const count = countRaw === undefined ? 6 : Number(countRaw)
  if (!Number.isFinite(count) || count < 1 || count > PERIOD_LIST_MAX) {
    return c.json({ error: `count must be between 1 and ${PERIOD_LIST_MAX}` }, 400)
  }

  try {
    const db = getDb(env.DATABASE_URL)
    const data = await buildPeriodList(db, tierParam as PeriodTier, count)
    return c.json({ success: true, data })
  } catch (error: unknown) {
    logError(error, { context: '[reports/period-list]' })
    return c.json({ error: 'Failed to build period list' }, 500)
  }
})

// GET /api/reports/period-rollup?from=YYYY-MM-DD&to=YYYY-MM-DD
// Period-level summary (§10.3): sums the frozen per-module digest metrics across
// every daily report in the range, plus the GL-reconciled period totals (§10.2).
reportsApp.get('/period-rollup', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const from = c.req.query('from')
  const to = c.req.query('to')
  if (!from || !to) return c.json({ error: 'from and to are required (YYYY-MM-DD)' }, 400)
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)))
    return c.json({ error: 'Invalid date' }, 400)

  try {
    const db = getDb(env.DATABASE_URL)
    const data = await getPeriodRollup(db, from, to)
    return c.json({ success: true, data })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to build period rollup' }, 500)
  }
})

export { reportsApp }
