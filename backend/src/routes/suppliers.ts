/**
 * Suppliers — Phase 7.6
 * Simple vendor database for inventory sourcing.
 */

import { and, asc, eq, ne, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import { bills, supplierDocuments, supplierPriceItems, suppliers } from '../db/schema'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

/**
 * Suppliers sit in two worlds: they are sourced from Inventory (the front desk
 * reorders stock) and paid from Finance (AP bills, supplier statements). The
 * routes originally checked `inventory` only, so a finance role holding
 * `suppliers:*` — the module that actually exists in the permission table — was
 * refused its own module.
 *
 * The inventory alias is READ-ONLY. Accepting it for writes too meant anyone
 * holding `inventory:*` could create, edit and delete supplier records: the
 * front desk holds inventory in full, so reception could delete a vendor with
 * AP bills and statements hanging off it. Supplier master data belongs to
 * finance — `suppliers` is a child of `financial_records` in the module
 * hierarchy — so writes require the supplier grant itself.
 *
 * Reading stays aliased because reception genuinely needs it: Receive Stock
 * offers an optional supplier picker sourced from this list.
 */
async function canSupplier(
  c: Parameters<typeof checkPermission>[0],
  userId: string,
  action: string
): Promise<boolean> {
  if (await checkPermission(c, userId, MODULES.SUPPLIERS as string, action)) return true
  if (action !== ACTIONS.READ) return false
  return checkPermission(c, userId, MODULES.INVENTORY as string, ACTIONS.READ as string)
}

// ── Zod schemas ───────────────────────────────────────────────────────────────
// id, createdAt, updatedAt are server-owned and excluded from all client schemas.

const SupplierCreateSchema = z.object({
  name: z.string(),
  contactEmail: z.string().nullish(),
  contactPhone: z.string().nullish(),
  address: z.string().nullish(),
  paymentTerms: z.string().nullish(),
  notes: z.string().nullish(),
  active: z.boolean().optional(),
  tin: z.string().nullish(),
  defaultPaymentTermsDays: z.number().int().nullish(),
})

const SupplierUpdateSchema = SupplierCreateSchema.partial()

const SupplierDocumentCreateSchema = z.object({
  title: z.string(),
  fileName: z.string(),
  fileUrl: z.string(),
  fileKey: z.string().nullish(),
  sizeBytes: z.number().int().optional(),
})

const SupplierPriceItemCreateSchema = z.object({
  itemName: z.string(),
  unit: z.string(),
  unitPrice: z.union([z.string(), z.number()]),
})

const SupplierPriceItemUpdateSchema = SupplierPriceItemCreateSchema.partial()

const suppliersApp = new Hono<HonoEnv>()

suppliersApp.get('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await canSupplier(c, user.id, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db.select().from(suppliers).where(eq(suppliers.id, id))
  if (!row) return c.json({ error: 'Not found' }, 404)

  // `lastOrderAt` is derived, not stored: the most recent non-void bill this
  // supplier has issued to the clinic. The supplier detail page had a "Last
  // order" field that was hardcoded to null by a client-side mock adapter —
  // it rendered "—" for every supplier regardless of history. `bills` is the
  // only table that records ordering activity against a supplier, so it is
  // the answer to that question. Voided bills are excluded: a voided bill is
  // not an order. Returns null when the supplier has never been billed.
  const [lastOrder] = await db
    .select({ at: sql<string | null>`max(${bills.issueDate})` })
    .from(bills)
    .where(and(eq(bills.supplierId, id), ne(bills.status, 'void')))

  return c.json({ success: true, data: { ...row, lastOrderAt: lastOrder?.at ?? null } })
})

suppliersApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await canSupplier(c, user.id, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db.select().from(suppliers).orderBy(asc(suppliers.name))
  return c.json({ success: true, data: rows })
})

suppliersApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await canSupplier(c, user.id, ACTIONS.CREATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const parsed = SupplierCreateSchema.safeParse(await c.req.json())
  if (!parsed.success)
    return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
  const data = parsed.data
  if (!data.name) return c.json({ error: 'name required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .insert(suppliers)
    .values({
      name: data.name,
      contactEmail: data.contactEmail ?? null,
      contactPhone: data.contactPhone ?? null,
      address: data.address ?? null,
      paymentTerms: data.paymentTerms ?? null,
      notes: data.notes ?? null,
      active: data.active ?? true,
      tin: data.tin ?? null,
      defaultPaymentTermsDays: data.defaultPaymentTermsDays ?? null,
    })
    .returning()
  return c.json({ success: true, data: row })
})

suppliersApp.patch('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await canSupplier(c, user.id, ACTIONS.UPDATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const parsed = SupplierUpdateSchema.safeParse(await c.req.json())
  if (!parsed.success)
    return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
  const data = parsed.data
  const db = getDb(process.env.DATABASE_URL!)
  const updates: Record<string, unknown> = { updatedAt: new Date() }
  for (const k of [
    'name',
    'contactEmail',
    'contactPhone',
    'address',
    'paymentTerms',
    'notes',
    'active',
    'tin',
    'defaultPaymentTermsDays',
  ] as const) {
    if (data[k] !== undefined) updates[k] = data[k]
  }
  const [row] = await db.update(suppliers).set(updates).where(eq(suppliers.id, id)).returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true, data: row })
})

suppliersApp.delete('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await canSupplier(c, user.id, ACTIONS.DELETE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db.delete(suppliers).where(eq(suppliers.id, id)).returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true })
})

// ── Supplier Documents ────────────────────────────────────────────────────────

suppliersApp.get('/:id/documents', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await canSupplier(c, user.id, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const supplierId = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db
    .select()
    .from(supplierDocuments)
    .where(eq(supplierDocuments.supplierId, supplierId))
    .orderBy(asc(supplierDocuments.createdAt))
  return c.json({ success: true, data: rows })
})

suppliersApp.post('/:id/documents', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await canSupplier(c, user.id, ACTIONS.CREATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const supplierId = c.req.param('id')
  const parsed = SupplierDocumentCreateSchema.safeParse(await c.req.json())
  if (!parsed.success)
    return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
  const data = parsed.data
  if (!data.title) return c.json({ error: 'title required' }, 400)
  if (!data.fileName) return c.json({ error: 'fileName required' }, 400)
  if (!data.fileUrl) return c.json({ error: 'fileUrl required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .insert(supplierDocuments)
    .values({
      supplierId,
      title: data.title,
      fileName: data.fileName,
      fileUrl: data.fileUrl,
      fileKey: data.fileKey ?? null,
      sizeBytes: data.sizeBytes ?? 0,
    })
    .returning()
  return c.json({ success: true, data: row }, 201)
})

suppliersApp.delete('/:id/documents/:docId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await canSupplier(c, user.id, ACTIONS.DELETE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const docId = c.req.param('docId')
  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .delete(supplierDocuments)
    .where(eq(supplierDocuments.id, docId))
    .returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true })
})

// ── Supplier Price Items ──────────────────────────────────────────────────────

suppliersApp.get('/:id/pricing', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await canSupplier(c, user.id, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const supplierId = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db
    .select()
    .from(supplierPriceItems)
    .where(eq(supplierPriceItems.supplierId, supplierId))
    .orderBy(asc(supplierPriceItems.itemName))
  return c.json({ success: true, data: rows })
})

suppliersApp.post('/:id/pricing', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await canSupplier(c, user.id, ACTIONS.CREATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const supplierId = c.req.param('id')
  const parsed = SupplierPriceItemCreateSchema.safeParse(await c.req.json())
  if (!parsed.success)
    return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
  const data = parsed.data
  if (!data.itemName) return c.json({ error: 'itemName required' }, 400)
  if (!data.unit) return c.json({ error: 'unit required' }, 400)
  const price = parseFloat(String(data.unitPrice))
  if (Number.isNaN(price) || price < 0) return c.json({ error: 'valid unitPrice required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .insert(supplierPriceItems)
    .values({ supplierId, itemName: data.itemName, unit: data.unit, unitPrice: price })
    .returning()
  return c.json({ success: true, data: row }, 201)
})

suppliersApp.patch('/:id/pricing/:itemId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await canSupplier(c, user.id, ACTIONS.UPDATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const itemId = c.req.param('itemId')
  const parsed = SupplierPriceItemUpdateSchema.safeParse(await c.req.json())
  if (!parsed.success)
    return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
  const data = parsed.data
  const db = getDb(process.env.DATABASE_URL!)
  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (data.itemName !== undefined) updates.itemName = data.itemName
  if (data.unit !== undefined) updates.unit = data.unit
  if (data.unitPrice !== undefined) {
    const price = parseFloat(String(data.unitPrice))
    if (!Number.isNaN(price)) updates.unitPrice = price
  }
  const [row] = await db
    .update(supplierPriceItems)
    .set(updates)
    .where(eq(supplierPriceItems.id, itemId))
    .returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true, data: row })
})

suppliersApp.delete('/:id/pricing/:itemId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await canSupplier(c, user.id, ACTIONS.DELETE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const itemId = c.req.param('itemId')
  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .delete(supplierPriceItems)
    .where(eq(supplierPriceItems.id, itemId))
    .returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true })
})

export { suppliersApp }
