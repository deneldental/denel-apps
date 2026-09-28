/**
 * Unified item catalog — admin-v1 §12.1 (slice 2).
 *
 * Read API over the merged `items` table (products + inventory). Capability
 * filters (sellable/consumable/medication/lab) let each consumer pull its slice:
 * Store -> sellable, daily-report consumables -> consumable, prescription picker
 * -> medication, lab inventory -> lab.
 *
 * Gated on MODULES.INVENTORY for now (parent of products). Moves to the new
 * Catalog (ITEMS) module + permissions-seed migration when the portal Catalog UI
 * lands (slice 7). CRUD arrives with the products/inventory adapter routes (slice 5).
 */

import { and, eq, ilike, inArray, or, type SQL } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { categories, items } from '../db/schema'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

export const itemsApp = new Hono<HonoEnv>()

// Unified Catalog module. Grants mirrored from inventory/products by migration
// 0101 (staging-verified), so existing roles keep access.
const MODULE = MODULES.ITEMS

// GET /?q=&sellable=&consumable=&medication=|Prescription=&lab=
itemsApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const q = (c.req.query('q') ?? '').trim()
  const flag = (name: string) => c.req.query(name) === 'true'
  const conds = []
  if (q) conds.push(or(ilike(items.name, `%${q}%`), ilike(items.sku, `${q}%`)))
  if (flag('sellable')) conds.push(eq(items.sellable, true))
  if (flag('consumable')) conds.push(eq(items.consumable, true))
  // "Medication" is classified by the item's category purpose (§11.6 categories
  // table). `items.medication` is an optional explicit override; either qualifies.
  // Items reference a category by name, so we match against medication-purpose
  // category names.
  // `or()` is typed as possibly-undefined (it is, for an empty arg list); both
  // operands here are always present, so the cast is safe and keeps this usable
  // as both a filter and a projected column.
  const isMedication = or(
    eq(items.medication, true),
    inArray(
      items.category,
      db
        .select({ name: categories.name })
        .from(categories)
        .where(eq(categories.purpose, 'medication'))
    )
  ) as SQL<boolean>
  // The portal calls this capability "Prescription"; `medication` is the
  // original spelling. Accept both so neither caller silently returns
  // everything (an unrecognised flag is simply no filter at all).
  if (flag('medication') || flag('Prescription')) conds.push(isMedication)
  if (flag('lab')) conds.push(eq(items.lab, true))

  try {
    const rows = await db
      .select({
        item: items,
        // Effective medication flag, so a "medication"-category product shows
        // under Prescription without needing the per-item override set.
        prescription: isMedication,
      })
      .from(items)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(items.name)
    return c.json({
      success: true,
      data: rows.map((r) => ({ ...r.item, Prescription: !!r.prescription })),
    })
  } catch (error: unknown) {
    logError(error, { context: '[items] list' })
    return c.json({ error: 'Failed to fetch items' }, 500)
  }
})

// GET /:id
itemsApp.get('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [row] = await db
      .select()
      .from(items)
      .where(eq(items.id, c.req.param('id')))
      .limit(1)
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json({ success: true, data: row })
  } catch (error: unknown) {
    logError(error, { context: '[items] get' })
    return c.json({ error: 'Failed to fetch item' }, 500)
  }
})
