import { asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { documentTags } from '../db/schema'
import { ACTIONS, MODULES } from '../lib/modules'
import { isUniqueViolation } from '../lib/pg-errors'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const documentTagsApp = new Hono<HonoEnv>()

documentTagsApp.get('/', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, currentUser.id, MODULES.COMPLIANCE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const tags = await db
      .select()
      .from(documentTags)
      .where(eq(documentTags.isActive, true))
      .orderBy(asc(documentTags.displayName))
    return c.json({ success: true, data: tags })
  } catch {
    return c.json({ error: 'Failed to fetch document tags' }, 500)
  }
})

documentTagsApp.post('/', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, currentUser.id, MODULES.COMPLIANCE, ACTIONS.CREATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid request body' }, 400)
  }

  if (!body?.name || !body?.displayName) {
    return c.json({ error: 'name and displayName are required' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [tag] = await db
      .insert(documentTags)
      .values({
        name: body.name,
        displayName: body.displayName,
        color: body.color ?? 'slate',
        isActive: true,
      })
      .returning()
    if (!tag) return c.json({ error: 'Failed to create document tag' }, 500)
    return c.json({ success: true, data: tag }, 201)
  } catch (err: unknown) {
    if (isUniqueViolation(err)) return c.json({ error: 'A tag with that name already exists' }, 409)
    return c.json({ error: 'Failed to create document tag' }, 500)
  }
})

documentTagsApp.patch('/:id', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, currentUser.id, MODULES.COMPLIANCE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid request body' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const updates: Partial<typeof documentTags.$inferInsert> = {
      updatedAt: new Date(),
    }
    if (body.displayName !== undefined) updates.displayName = body.displayName
    if (body.color !== undefined) updates.color = body.color
    if (body.isActive !== undefined) updates.isActive = body.isActive

    const [updated] = await db
      .update(documentTags)
      .set(updates)
      .where(eq(documentTags.id, id))
      .returning()

    if (!updated) return c.json({ error: 'Not found' }, 404)
    return c.json({ success: true, data: updated })
  } catch {
    return c.json({ error: 'Failed to update document tag' }, 500)
  }
})

documentTagsApp.delete('/:id', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, currentUser.id, MODULES.COMPLIANCE, ACTIONS.DELETE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [deactivated] = await db
      .update(documentTags)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(documentTags.id, id))
      .returning()

    if (!deactivated) return c.json({ error: 'Not found' }, 404)
    return c.json({ success: true })
  } catch {
    return c.json({ error: 'Failed to delete document tag' }, 500)
  }
})

export { documentTagsApp }
