import { and, count, eq, gt, gte, ilike, lte, type SQL, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import { inventoryBatches, inventoryLocations, items, stockMovements } from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { adjustStock, receiveStock } from '../lib/inventory-ledger'
import { valueInventory, valueItem } from '../lib/inventory-valuation'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import { getInventoryPolicies } from '../lib/settings-store'
import type { HonoEnv } from '../lib/types'
import { canPerformAction } from './settings'

const inventoryApp = new Hono<HonoEnv>()

const MODULE = MODULES.INVENTORY

// ── Zod schemas ───────────────────────────────────────────────────────────────
// id, createdAt, updatedAt are server-owned and excluded from all client schemas.

const InventoryCreateSchema = z.object({
  name: z.string(),
  description: z.string().nullish(),
  sku: z.string().nullish(),
  category: z.string().nullish(),
  unit: z.string().nullish(),
  stockQuantity: z.number().int().optional(),
  reorderLevel: z.number().int().nullish(),
  expiryDate: z.coerce.date().nullish(),
  lotNumber: z.string().nullish(),
  supplierId: z.string().uuid().nullish(),
  image: z.string().nullish(),
  unitCost: z.coerce.number().nullish(),
})

// Stock quantity is ledger-owned: it changes through POST /:id/adjust (reason
// + stock_movements row), never by overwriting the column (settings-domain-audit
// S5-B). Sending it here is a client bug, so it is rejected rather than dropped.
const InventoryUpdateSchema = InventoryCreateSchema.omit({ stockQuantity: true })
  .partial()
  .extend({ stockQuantity: z.never().optional() })

const AdjustSchema = z
  .object({
    /** `set` = the new physical count; `delta` = signed change. */
    mode: z.enum(['set', 'delta']),
    quantity: z.number().int(),
    reason: z.string().trim().min(1).max(120),
    note: z.string().trim().max(500).optional(),
    locationId: z.string().uuid().nullish(),
  })
  .refine((b) => b.mode === 'delta' || b.quantity >= 0, {
    message: 'A new count cannot be negative',
    path: ['quantity'],
  })

// ── GET / — paginated + searchable list ──────────────────────────────────────

inventoryApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const check = await canPerformAction(c, user.id, MODULE as string, ACTIONS.READ as string)
  if (!check.allowed) return c.json({ error: check.reason }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200)
    const offset = parseInt(c.req.query('offset') || '0', 10)
    const search = c.req.query('search')?.trim()

    // Build where clause: consumable=true + optional name search
    const whereClause = search
      ? and(eq(items.consumable, true), ilike(items.name, `%${search}%`))
      : eq(items.consumable, true)

    const [totalRow, rows] = await Promise.all([
      db.select({ n: count() }).from(items).where(whereClause),
      db.select().from(items).where(whereClause).orderBy(items.name).limit(limit).offset(offset),
    ])

    const total = Number(totalRow[0]?.n ?? 0)
    // Preserve the legacy inventory response shape (unitCost = costPrice).
    const data = rows.map((r) => ({ ...r, unitCost: r.costPrice }))
    return c.json({ success: true, data, total })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch inventory' }, 500)
  }
})

// ── POST / — create item ──────────────────────────────────────────────────────

inventoryApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const check = await canPerformAction(c, user.id, MODULE as string, ACTIONS.CREATE as string)
  if (!check.allowed) return c.json({ error: check.reason }, 403)

  try {
    const parsed = InventoryCreateSchema.safeParse(await c.req.json())
    if (!parsed.success)
      return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
    const data = parsed.data
    const db = getDb(process.env.DATABASE_URL!)
    const [created] = await db
      .insert(items)
      .values({
        name: data.name,
        description: data.description ?? null,
        sku: data.sku ?? null,
        category: data.category ?? null,
        unit: data.unit ?? null,
        stockQuantity: data.stockQuantity ?? 0,
        reorderLevel: data.reorderLevel ?? 10,
        expiryDate: data.expiryDate ?? null,
        lotNumber: data.lotNumber ?? null,
        supplierId: data.supplierId ?? null,
        image: data.image ?? null,
        costPrice: data.unitCost ?? null,
        consumable: true,
        source: 'inventory',
      })
      .returning()
    const newItem = { ...created, unitCost: created.costPrice }

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: user.id,
      action: 'create',
      module: 'inventory',
      entityId: newItem.id,
      entityName: newItem.name,
      changes: data,
    })

    return c.json({ success: true, data: newItem })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to create item' }, 500)
  }
})

// ── POST /receive — costed goods-received receipt (§11.2) ────────────────────

const ReceiveLineSchema = z.object({
  itemId: z.string().uuid(),
  qty: z.number().int().positive(),
  unitCost: z.number().nonnegative(),
  locationId: z.string().uuid().nullish(),
  expiryDate: z.coerce.date().nullish(),
  lotNumber: z.string().nullish(),
})

const ReceiveSchema = z.object({
  lines: z.array(ReceiveLineSchema).min(1),
  supplierId: z.string().uuid().nullish(),
  notes: z.string().nullish(),
  paidNow: z.boolean(),
  paymentMethod: z.string().nullish(),
  receiptUrl: z.string().url().nullish(),
})

inventoryApp.post('/receive', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULES.INVENTORY as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const parsed = ReceiveSchema.safeParse(await c.req.json())
    if (!parsed.success)
      return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)

    const body = parsed.data
    const db = getDb(process.env.DATABASE_URL!)

    const result = await receiveStock(db, {
      lines: body.lines.map((l) => ({
        itemId: l.itemId,
        qty: l.qty,
        unitCost: l.unitCost,
        locationId: l.locationId ?? null,
        expiryDate: l.expiryDate ?? null,
        lotNumber: l.lotNumber ?? null,
      })),
      supplierId: body.supplierId ?? null,
      notes: body.notes ?? null,
      paidNow: body.paidNow,
      paymentMethod: body.paymentMethod ?? null,
      receiptUrl: body.receiptUrl ?? null,
      createdById: user.id,
    })

    return c.json({ success: true, data: result })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to receive stock' }, 500)
  }
})

// ── GET /batches — expiry-aware batch list ────────────────────────────────────

inventoryApp.get('/batches', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULES.INVENTORY as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const itemIdParam = c.req.query('itemId')
    const expiringDays = parseInt(c.req.query('expiringDays') || '0', 10)
    const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200)
    const offset = parseInt(c.req.query('offset') || '0', 10)

    const now = new Date()

    // Build conditions array — only non-empty batches always included
    const whereParts: SQL[] = [gt(inventoryBatches.qtyRemaining, 0)]

    if (itemIdParam) {
      whereParts.push(eq(inventoryBatches.itemId, itemIdParam))
    }
    if (expiringDays > 0) {
      const cutoff = new Date(now)
      cutoff.setDate(cutoff.getDate() + expiringDays)
      whereParts.push(gte(inventoryBatches.expiryDate, now))
      whereParts.push(lte(inventoryBatches.expiryDate, cutoff))
    }

    const whereClause = and(...whereParts)

    const [totalRow, rows] = await Promise.all([
      db.select({ n: count() }).from(inventoryBatches).where(whereClause),
      db
        .select({
          id: inventoryBatches.id,
          itemId: inventoryBatches.itemId,
          locationId: inventoryBatches.locationId,
          movementId: inventoryBatches.movementId,
          qtyRemaining: inventoryBatches.qtyRemaining,
          unitCost: inventoryBatches.unitCost,
          expiryDate: inventoryBatches.expiryDate,
          lotNumber: inventoryBatches.lotNumber,
          createdAt: inventoryBatches.createdAt,
          itemName: items.name,
          locationName: inventoryLocations.name,
        })
        .from(inventoryBatches)
        .leftJoin(items, eq(inventoryBatches.itemId, items.id))
        .leftJoin(inventoryLocations, eq(inventoryBatches.locationId, inventoryLocations.id))
        .where(whereClause)
        .orderBy(sql`${inventoryBatches.expiryDate} ASC NULLS LAST`, inventoryBatches.createdAt)
        .limit(limit)
        .offset(offset),
    ])

    const total = Number(totalRow[0]?.n ?? 0)
    return c.json({ success: true, data: rows, total })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch batches' }, 500)
  }
})

// ── GET /valuation — stock value under the configured method (S5-B) ───────────

inventoryApp.get('/valuation', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULES.INVENTORY as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL as string)
    const { valuationMethod } = await getInventoryPolicies(db)
    const { totalValue, itemCount } = await valueInventory(db, valuationMethod)
    return c.json({ success: true, data: { method: valuationMethod, totalValue, itemCount } })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to value inventory' }, 500)
  }
})

// ── GET /:id — single item ────────────────────────────────────────────────────

inventoryApp.get('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const id = c.req.param('id')
  const check = await canPerformAction(c, user.id, MODULE as string, ACTIONS.READ as string)
  if (!check.allowed) return c.json({ error: check.reason }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const [item] = await db
      .select()
      .from(items)
      .where(and(eq(items.id, id), eq(items.consumable, true)))
      .limit(1)
    if (!item) return c.json({ error: 'Item not found' }, 404)
    const { valuationMethod } = await getInventoryPolicies(db)
    const stockValue = await valueItem(db, valuationMethod, item)
    return c.json({
      success: true,
      data: { ...item, unitCost: item.costPrice, stockValue, valuationMethod },
    })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch item' }, 500)
  }
})

// ── PATCH /:id — update item ──────────────────────────────────────────────────

inventoryApp.patch('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const id = c.req.param('id')
  const check = await canPerformAction(c, user.id, MODULE as string, ACTIONS.UPDATE as string)
  if (!check.allowed) return c.json({ error: check.reason }, 403)

  try {
    const parsed = InventoryUpdateSchema.safeParse(await c.req.json())
    if (!parsed.success)
      return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
    const data = parsed.data
    const db = getDb(process.env.DATABASE_URL!)
    // Map the legacy inventory shape onto items (unitCost -> costPrice).
    const { unitCost, ...rest } = data
    const itemSet: Record<string, unknown> = { ...rest, updatedAt: new Date() }
    if (unitCost !== undefined) itemSet.costPrice = unitCost
    const [updated] = await db
      .update(items)
      .set(itemSet)
      .where(and(eq(items.id, id), eq(items.consumable, true)))
      .returning()

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: user.id,
      action: 'update',
      module: 'inventory',
      entityId: id,
      entityName: updated.name,
      changes: data,
    })

    return c.json({ success: true, data: { ...updated, unitCost: updated.costPrice } })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to update item' }, 500)
  }
})

// ── DELETE /:id — soft-delete item ───────────────────────────────────────────

inventoryApp.delete('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const id = c.req.param('id')
  const check = await canPerformAction(c, user.id, MODULE as string, ACTIONS.DELETE as string)
  if (!check.allowed) return c.json({ error: check.reason }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const [deleted] = await db
      .delete(items)
      .where(and(eq(items.id, id), eq(items.consumable, true)))
      .returning()

    if (!deleted) return c.json({ error: 'Item not found' }, 404)

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: user.id,
      action: 'delete',
      module: 'inventory',
      entityId: id,
      entityName: deleted.name,
      changes: null,
    })

    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to delete item' }, 500)
  }
})

// ── POST /:id/transfer — inter-location transfer ──────────────────────────────

const TransferSchema = z.object({
  fromLocationId: z.string().uuid(),
  toLocationId: z.string().uuid(),
  qty: z.number().int().positive(),
})

inventoryApp.post('/:id/transfer', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULES.INVENTORY as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const itemId = c.req.param('id')

  try {
    const parsed = TransferSchema.safeParse(await c.req.json())
    if (!parsed.success)
      return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)

    const { fromLocationId, toLocationId, qty } = parsed.data
    const db = getDb(process.env.DATABASE_URL!)

    // Verify item exists and is a consumable.
    const [item] = await db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.consumable, true)))
      .limit(1)
    if (!item) return c.json({ error: 'Item not found' }, 404)

    // Insert transfer_out + transfer_in as a pair.
    // Total stockQuantity is unchanged (only location allocation shifts).
    await db.insert(stockMovements).values([
      {
        itemId,
        type: 'transfer_out',
        qty: -qty,
        locationId: fromLocationId,
        reason: `Transfer to location ${toLocationId}`,
        sourceType: 'transfer',
        createdById: user.id,
      },
      {
        itemId,
        type: 'transfer_in',
        qty: qty,
        locationId: toLocationId,
        reason: `Transfer from location ${fromLocationId}`,
        sourceType: 'transfer',
        createdById: user.id,
      },
    ])

    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to transfer stock' }, 500)
  }
})

// ── POST /:id/adjust — reasoned stock adjustment (S5-B) ───────────────────────
// The only way a quantity changes outside receipts and issues. Every call
// leaves a stock_movements row (type 'adjustment') carrying the reason, which
// the portal picks from `inventory:policies.adjustmentReasons` or types in.

inventoryApp.post('/:id/adjust', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const id = c.req.param('id')
  const check = await canPerformAction(c, user.id, MODULE as string, ACTIONS.UPDATE as string)
  if (!check.allowed) return c.json({ error: check.reason }, 403)

  const parsed = AdjustSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success)
    return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
  const body = parsed.data

  try {
    const db = getDb(process.env.DATABASE_URL as string)
    const [item] = await db
      .select({ id: items.id, name: items.name, stockQuantity: items.stockQuantity })
      .from(items)
      .where(and(eq(items.id, id), eq(items.consumable, true)))
      .limit(1)
    if (!item) return c.json({ error: 'Item not found' }, 404)

    const delta = body.mode === 'set' ? body.quantity - item.stockQuantity : body.quantity
    if (delta === 0) return c.json({ error: 'No change: the quantity already matches' }, 400)
    if (item.stockQuantity + delta < 0)
      return c.json({ error: `Cannot remove ${-delta}: only ${item.stockQuantity} in stock` }, 400)

    const reason = body.note ? `${body.reason} — ${body.note}` : body.reason
    await adjustStock(db, {
      itemId: id,
      qtyDelta: delta,
      reason,
      locationId: body.locationId ?? null,
      createdById: user.id,
    })

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: user.id,
      action: 'update',
      module: 'inventory',
      entityId: id,
      entityName: item.name,
      changes: {
        stockQuantity: { from: item.stockQuantity, to: item.stockQuantity + delta },
        reason,
      },
    })

    return c.json({ success: true, data: { stockQuantity: item.stockQuantity + delta, delta } })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to adjust stock' }, 500)
  }
})

export { inventoryApp }
