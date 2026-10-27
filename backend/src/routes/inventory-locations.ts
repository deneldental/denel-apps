import { asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { inventoryLocations } from '../db/schema'
import { ACTIONS, MODULES } from '../lib/modules'
import { isUniqueViolation } from '../lib/pg-errors'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import { denyUnless } from '../lib/route-access'
import type { HonoEnv } from '../lib/types'

const inventoryLocationsApp = new Hono<HonoEnv>()

inventoryLocationsApp.get('/', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)
  const denied = await denyUnless(c, currentUser.id, {
    apps: ['portal'],
    anyOf: [
      [MODULES.INVENTORY, ACTIONS.READ],
      [MODULES.ITEMS, ACTIONS.READ],
      [MODULES.SETTINGS, ACTIONS.READ],
    ],
  })
  if (denied) return denied

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const locations = await db
      .select()
      .from(inventoryLocations)
      .where(eq(inventoryLocations.isActive, true))
      .orderBy(asc(inventoryLocations.name))
    return c.json({ success: true, data: locations })
  } catch {
    return c.json({ error: 'Failed to fetch inventory locations' }, 500)
  }
})

inventoryLocationsApp.post('/', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, currentUser.id, MODULES.INVENTORY, ACTIONS.CREATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const body = await c.req.json()
  if (!body.name || !body.code) {
    return c.json({ error: 'name and code are required' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [location] = await db
      .insert(inventoryLocations)
      .values({
        name: body.name,
        code: body.code.toUpperCase(),
        description: body.description ?? null,
        isActive: true,
      })
      .returning()
    return c.json({ success: true, data: location }, 201)
  } catch (err: unknown) {
    if (isUniqueViolation(err))
      return c.json({ error: 'A location with that code already exists' }, 409)
    return c.json({ error: 'Failed to create inventory location' }, 500)
  }
})

inventoryLocationsApp.patch('/:id', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, currentUser.id, MODULES.INVENTORY, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const body = await c.req.json()

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const updates: Partial<typeof inventoryLocations.$inferInsert> = {
      updatedAt: new Date(),
    }
    if (body.name !== undefined) updates.name = body.name
    if (body.code !== undefined) updates.code = body.code.toUpperCase()
    if (body.description !== undefined) updates.description = body.description
    if (body.isActive !== undefined) updates.isActive = body.isActive

    const [updated] = await db
      .update(inventoryLocations)
      .set(updates)
      .where(eq(inventoryLocations.id, id))
      .returning()

    if (!updated) return c.json({ error: 'Not found' }, 404)
    return c.json({ success: true, data: updated })
  } catch {
    return c.json({ error: 'Failed to update inventory location' }, 500)
  }
})

inventoryLocationsApp.delete('/:id', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, currentUser.id, MODULES.INVENTORY, ACTIONS.DELETE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [deactivated] = await db
      .update(inventoryLocations)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(inventoryLocations.id, id))
      .returning()

    if (!deactivated) return c.json({ error: 'Not found' }, 404)
    return c.json({ success: true })
  } catch {
    return c.json({ error: 'Failed to delete inventory location' }, 500)
  }
})

export { inventoryLocationsApp }
