import { endOfDay, startOfDay } from 'date-fns'
import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import { items, sales } from '../db/schema'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'
import { DateParamError, parseQueryDate } from '../lib/validate-date'

const salesApp = new Hono<HonoEnv>()

const MODULE = MODULES.INVENTORY

// ─── R7 · `/api/sales/today` + `/api/sales/history` — deliberately NOT built ──
//
// `portals/src/features/products/__mock__/sales.ts` carried a
// `TODO(backend-wiring)` naming those two endpoints. The mock was deleted
// (2026-09-02) because **nothing imported it** — neither its data nor its
// types — and the sales UI was already reading live data the whole time:
//
//   - `features/products/pages/sales.tsx`      → `getSales(start, end)`
//   - `features/products/components/sales-view.tsx` → `getDailySales(date)`
//
// Both resolve to `GET /api/sales?startDate=…&endDate=…` below, which joins
// `sales.itemId → items` (never `products`/`inventory` — migration 0102 dropped
// both tables and made `sales.itemId` NOT NULL).
//
// Neither proposed endpoint would add a capability:
//   - `/today` is exactly `?startDate=<today>&endDate=<today>` — a pure alias.
//   - `/history` would move the sales page's per-day grouping to the server.
//     That is a payload win, not a correctness one, and it would leave two
//     server-side ways to read the same rows.
//
// Building them now would add unused surface area, so this is a deferral, not
// an oversight. Revisit only if the 30-day window on the sales page grows large
// enough that shipping raw rows costs more than the aggregate would.
// ─────────────────────────────────────────────────────────────────────────────

salesApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const db = getDb(process.env.DATABASE_URL!)

  try {
    let whereClause
    if (startDate && endDate) {
      let start: Date
      let end: Date
      try {
        start = parseQueryDate(startDate, new Date())
        end = parseQueryDate(endDate, new Date())
      } catch (err) {
        if (err instanceof DateParamError) return c.json({ error: err.message }, 400)
        throw err
      }
      whereClause = and(gte(sales.saleDate, startOfDay(start)), lte(sales.saleDate, endOfDay(end)))
    }

    const data = await db
      .select({ sale: sales, product: items })
      .from(sales)
      .leftJoin(items, eq(sales.itemId, items.id))
      .where(whereClause)
      .orderBy(desc(sales.saleDate))

    return c.json({ success: true, data })
  } catch (error: unknown) {
    logError(error, { context: 'Sales GET Error' })
    return c.json({ error: 'Failed to fetch sales' }, 500)
  }
})

salesApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const body = await c.req.json()
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const [product] = await db.select().from(items).where(eq(items.id, body.productId)).limit(1)
    if (!product) throw new Error('Product not found')

    // Check if a draft sale for this product already exists today
    const todayStart = startOfDay(new Date())
    const todayEnd = endOfDay(new Date())
    const [existingDraft] = await db
      .select()
      .from(sales)
      .where(
        and(
          eq(sales.itemId, body.productId),
          eq(sales.status, 'draft'),
          gte(sales.saleDate, todayStart),
          lte(sales.saleDate, todayEnd)
        )
      )
      .limit(1)

    let result
    if (existingDraft) {
      // Increment the existing draft sale instead of creating a new row
      const newQuantity = existingDraft.quantity + body.quantity
      const unitPrice = existingDraft.unitPrice
      const costPrice = existingDraft.costPrice

      const [updatedSale] = await db
        .update(sales)
        .set({
          quantity: newQuantity,
          totalAmount: unitPrice * newQuantity,
          profit: (unitPrice - costPrice) * newQuantity,
        })
        .where(eq(sales.id, existingDraft.id))
        .returning()

      result = updatedSale
    } else {
      // No draft exists yet for this product today — create a new one
      const [newSale] = await db
        .insert(sales)
        .values({
          itemId: body.productId, // request field name kept; value is the item id
          quantity: body.quantity,
          unitPrice: body.unitPrice,
          costPrice: body.costPrice,
          totalAmount: body.unitPrice * body.quantity,
          profit: (body.unitPrice - body.costPrice) * body.quantity,
          saleDate: new Date(),
        })
        .returning()

      result = newSale
    }

    // NOTE: Stock is NOT deducted here. Draft sales are just "intent to sell".
    // Stock deduction happens when the daily report is submitted and drafts are finalized.

    return c.json({ success: true, data: result })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

/**
 * Fields a caller may edit on a draft sale.
 *
 * Deliberately excluded (system-owned, not caller-owned):
 *   `totalAmount`, `profit` — recomputed below from quantity/prices
 *   `status`        — workflow-owned; a client that could set 'submitted' would
 *                     mark the sale sold without the stock deduction that
 *                     submitting a daily report performs
 *   `dailyReportId` — would move the sale between reports and corrupt both
 *                     reports' totals
 *   `id`, `createdAt`
 *
 * zod strips unknown keys, so only these reach `.set()`.
 */
const updateSaleSchema = z
  .object({
    itemId: z.string().uuid().optional(),
    quantity: z.number().int().positive().optional(),
    unitPrice: z.number().finite().nonnegative().optional(),
    costPrice: z.number().finite().nonnegative().optional(),
    saleDate: z.coerce.date().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Supply at least one updatable field',
  })

salesApp.patch('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const parsed = updateSaleSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
  }
  const body = parsed.data
  const db = getDb(process.env.DATABASE_URL!)

  try {
    let result
    const [sale] = await db.select().from(sales).where(eq(sales.id, id)).limit(1)
    if (!sale) throw new Error('Sale not found')
    if (sale.status === 'submitted') throw new Error('Cannot edit a submitted sale')

    // Recalculate totals if quantity, unitPrice, or costPrice changed
    const unitPrice = body.unitPrice ?? sale.unitPrice
    const costPrice = body.costPrice ?? sale.costPrice
    const quantity = body.quantity ?? sale.quantity

    const [updatedSale] = await db
      .update(sales)
      .set({
        ...body,
        totalAmount: unitPrice * quantity,
        profit: (unitPrice - costPrice) * quantity,
      })
      .where(eq(sales.id, id))
      .returning()

    result = updatedSale

    // NOTE: Stock is NOT adjusted here. Draft edits do not affect stock.
    // Stock deduction only happens when the daily report is submitted.

    return c.json({ success: true, data: result })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

salesApp.delete('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.DELETE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const [sale] = await db.select().from(sales).where(eq(sales.id, id)).limit(1)
    if (!sale) throw new Error('Sale not found')
    if (sale.status === 'submitted') throw new Error('Cannot delete a submitted sale')

    await db.delete(sales).where(eq(sales.id, id))

    // NOTE: No stock is restored since no stock was deducted when the draft was created.

    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

export { salesApp }
