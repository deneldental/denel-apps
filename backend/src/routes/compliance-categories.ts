import { asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { complianceCategories } from '../db/schema'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import { denyUnless } from '../lib/route-access'
import type { HonoEnv } from '../lib/types'

const complianceCategoriesApp = new Hono<HonoEnv>()

complianceCategoriesApp.get('/', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)
  const denied = await denyUnless(c, currentUser.id, {
    apps: ['portal'],
    anyOf: [[MODULES.COMPLIANCE, ACTIONS.READ]],
  })
  if (denied) return denied

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const categories = await db.query.complianceCategories.findMany({
      where: eq(complianceCategories.isActive, true),
      orderBy: [asc(complianceCategories.name)],
    })
    return c.json({ success: true, data: categories })
  } catch {
    return c.json({ error: 'Failed to fetch compliance categories' }, 500)
  }
})

complianceCategoriesApp.post('/', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, currentUser.id, MODULES.COMPLIANCE, ACTIONS.CREATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const body = await c.req.json()
  if (!body.name) return c.json({ error: 'name is required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [category] = await db
      .insert(complianceCategories)
      .values({
        name: body.name,
        description: body.description ?? null,
        color: body.color ?? 'slate',
        iconName: body.iconName ?? null,
        isActive: true,
      })
      .returning()
    return c.json({ success: true, data: category }, 201)
  } catch {
    return c.json({ error: 'Failed to create compliance category' }, 500)
  }
})

complianceCategoriesApp.patch('/:id', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, currentUser.id, MODULES.COMPLIANCE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const body = await c.req.json()

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const updates: Partial<typeof complianceCategories.$inferInsert> = {
      updatedAt: new Date(),
    }
    if (body.name !== undefined) updates.name = body.name
    if (body.description !== undefined) updates.description = body.description
    if (body.color !== undefined) updates.color = body.color
    if (body.iconName !== undefined) updates.iconName = body.iconName
    if (body.isActive !== undefined) updates.isActive = body.isActive

    const [updated] = await db
      .update(complianceCategories)
      .set(updates)
      .where(eq(complianceCategories.id, id))
      .returning()

    if (!updated) return c.json({ error: 'Not found' }, 404)
    return c.json({ success: true, data: updated })
  } catch {
    return c.json({ error: 'Failed to update compliance category' }, 500)
  }
})

complianceCategoriesApp.delete('/:id', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, currentUser.id, MODULES.COMPLIANCE, ACTIONS.DELETE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [deactivated] = await db
      .update(complianceCategories)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(complianceCategories.id, id))
      .returning()

    if (!deactivated) return c.json({ error: 'Not found' }, 404)
    return c.json({ success: true })
  } catch {
    return c.json({ error: 'Failed to delete compliance category' }, 500)
  }
})

export { complianceCategoriesApp }
