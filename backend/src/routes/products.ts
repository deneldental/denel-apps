import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import { items } from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { getCurrentUser, isAdmin } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'
import { canPerformAction } from './settings'

// Client-settable product columns — excludes id, createdAt, updatedAt (server-owned).
// isLocked is included but access is still gated to admins only in each handler.
const ProductWriteSchema = z.object({
  name: z.string(),
  description: z.string().nullish(),
  sku: z.string().nullish(),
  category: z.string().nullish(),
  unit: z.string().nullish(),
  sizeValue: z.union([z.string(), z.number()]).nullish(),
  sizeUnit: z.string().nullish(),
  price: z.union([z.string(), z.number()]),
  costPrice: z.union([z.string(), z.number()]).nullish(),
  stockQuantity: z.number().int().optional(),
  quantityPerPack: z.number().int().optional(),
  reorderLevel: z.number().int().nullish(),
  image: z.string().nullish(),
  isLocked: z.boolean().optional(),
  // Set by the form's "Expiry product" toggle; null clears a previously set date.
  expiryDate: z.coerce.date().nullish(),
})

const ProductPatchSchema = ProductWriteSchema.partial()

const productsApp = new Hono<HonoEnv>()

const MODULE = MODULES.PRODUCTS

productsApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const check = await canPerformAction(c, user.id, MODULE as string, ACTIONS.READ as string)
  if (!check.allowed) return c.json({ error: check.reason }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    // §12.1 — products is now a capability view over items (sellable).
    const data = await db.select().from(items).where(eq(items.sellable, true))
    return c.json({ success: true, data })
  } catch (error: unknown) {
    logError(error, { context: 'Products GET Error' })
    return c.json({ error: 'Failed' }, 500)
  }
})

productsApp.get('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const check = await canPerformAction(c, user.id, MODULE as string, ACTIONS.READ as string)
  if (!check.allowed) return c.json({ error: check.reason }, 403)

  try {
    const id = c.req.param('id')
    const db = getDb(process.env.DATABASE_URL!)
    const [data] = await db
      .select()
      .from(items)
      .where(and(eq(items.id, id), eq(items.sellable, true)))
      .limit(1)
    if (!data) return c.json({ error: 'Not found' }, 404)
    return c.json({ success: true, data })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

productsApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const check = await canPerformAction(c, user.id, MODULE as string, ACTIONS.CREATE as string)
  if (!check.allowed) return c.json({ error: check.reason }, 403)

  try {
    const parsed = ProductWriteSchema.safeParse(await c.req.json())
    if (!parsed.success)
      return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
    const data = parsed.data

    // Data normalization from frontend logic
    let costPrice: number | null = null
    if (data.costPrice !== null && data.costPrice !== undefined) {
      const rawCost = parseFloat(String(data.costPrice))
      costPrice = Number.isNaN(rawCost) || rawCost === 0 ? null : rawCost
    }

    const sizeValue = data.sizeValue ? parseInt(String(data.sizeValue), 10) : null
    const sizeUnit = data.sizeUnit || null

    const productData = {
      name: data.name,
      description: data.description,
      sku: data.sku,
      category: data.category,
      unit: data.unit,
      price: typeof data.price === 'string' ? parseFloat(data.price) : data.price,
      costPrice,
      sizeValue,
      sizeUnit,
      stockQuantity: data.stockQuantity,
      quantityPerPack: data.quantityPerPack ?? 1,
      reorderLevel: data.reorderLevel,
      image: data.image,
      isLocked: data.isLocked,
      expiryDate: data.expiryDate ?? null,
    }

    // Enforce admin-only locking
    if ('isLocked' in productData) {
      const adminCheck = await isAdmin(c, user.id)
      if (!adminCheck) {
        delete productData.isLocked
      }
    }

    const db = getDb(process.env.DATABASE_URL!)
    const [newItem] = await db
      .insert(items)
      .values({ ...productData, sellable: true, source: 'product' })
      .returning()

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: user.id,
      action: 'create',
      module: 'products',
      entityId: newItem.id,
      entityName: newItem.name,
      changes: productData,
    })

    return c.json({ success: true, data: newItem })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to create product' }, 500)
  }
})

productsApp.patch('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const check = await canPerformAction(c, user.id, MODULE as string, ACTIONS.UPDATE as string)
  if (!check.allowed) return c.json({ error: check.reason }, 403)

  try {
    const id = c.req.param('id')
    const parsed = ProductPatchSchema.safeParse(await c.req.json())
    if (!parsed.success)
      return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
    const data = parsed.data

    // Coerce string numerics to numbers for Drizzle's real/integer columns
    const patchData: {
      name?: string
      description?: string | null
      sku?: string | null
      category?: string | null
      unit?: string | null
      sizeValue?: number | null
      sizeUnit?: string | null
      price?: number
      costPrice?: number | null
      stockQuantity?: number
      quantityPerPack?: number
      reorderLevel?: number | null
      image?: string | null
      isLocked?: boolean
      expiryDate?: Date | null
    } = {}

    if (data.name !== undefined) patchData.name = data.name
    if (data.description !== undefined) patchData.description = data.description
    if (data.sku !== undefined) patchData.sku = data.sku
    if (data.category !== undefined) patchData.category = data.category
    if (data.unit !== undefined) patchData.unit = data.unit
    if (data.sizeUnit !== undefined) patchData.sizeUnit = data.sizeUnit
    if (data.stockQuantity !== undefined) patchData.stockQuantity = data.stockQuantity
    if (data.quantityPerPack !== undefined) patchData.quantityPerPack = data.quantityPerPack
    if (data.reorderLevel !== undefined) patchData.reorderLevel = data.reorderLevel
    if (data.image !== undefined) patchData.image = data.image
    if (data.isLocked !== undefined) patchData.isLocked = data.isLocked
    if (data.expiryDate !== undefined) patchData.expiryDate = data.expiryDate ?? null
    if (data.price !== undefined) {
      patchData.price = typeof data.price === 'string' ? parseFloat(data.price) : data.price
    }
    if (data.costPrice !== undefined) {
      if (data.costPrice === null) {
        patchData.costPrice = null
      } else {
        const v = parseFloat(String(data.costPrice))
        patchData.costPrice = Number.isNaN(v) || v === 0 ? null : v
      }
    }
    if (data.sizeValue !== undefined) {
      patchData.sizeValue =
        data.sizeValue !== null && data.sizeValue !== undefined
          ? parseInt(String(data.sizeValue), 10)
          : null
    }

    // Enforce admin-only locking
    if ('isLocked' in patchData) {
      const adminCheck = await isAdmin(c, user.id)
      if (!adminCheck) {
        delete patchData.isLocked
      }
    }

    const db = getDb(process.env.DATABASE_URL!)
    const [updated] = await db
      .update(items)
      .set(patchData)
      .where(and(eq(items.id, id), eq(items.sellable, true)))
      .returning()

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: user.id,
      action: 'update',
      module: 'products',
      entityId: id,
      entityName: updated.name,
      changes: data,
    })

    return c.json({ success: true, data: updated })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

productsApp.delete('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const check = await canPerformAction(c, user.id, MODULE as string, ACTIONS.DELETE as string)
  if (!check.allowed) return c.json({ error: check.reason }, 403)

  try {
    const id = c.req.param('id')
    const db = getDb(process.env.DATABASE_URL!)

    // Check if product is locked before deleting
    const [product] = await db
      .select()
      .from(items)
      .where(and(eq(items.id, id), eq(items.sellable, true)))
      .limit(1)
    if (!product) return c.json({ error: 'Not found' }, 404)
    if (product.isLocked) {
      return c.json({ error: 'This product is locked and cannot be deleted.' }, 403)
    }

    await db.delete(items).where(eq(items.id, id))

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: user.id,
      action: 'delete',
      module: 'products',
      entityId: id,
      entityName: product.name,
    })

    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

export { productsApp }
