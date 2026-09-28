import { asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { consentTemplates } from '../db/schema'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const consentTemplatesApp = new Hono<HonoEnv>()

consentTemplatesApp.get('/', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      currentUser.id,
      MODULES.COMPLIANCE as string,
      ACTIONS.READ as string
    ))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const templates = await db.query.consentTemplates.findMany({
      where: eq(consentTemplates.isActive, true),
      orderBy: [asc(consentTemplates.name)],
    })
    return c.json({ success: true, data: templates })
  } catch {
    return c.json({ error: 'Failed to fetch consent templates' }, 500)
  }
})

consentTemplatesApp.post('/', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      currentUser.id,
      MODULES.COMPLIANCE as string,
      ACTIONS.CREATE as string
    ))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const body = await c.req.json()
  if (!body.name) return c.json({ error: 'name is required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [template] = await db
      .insert(consentTemplates)
      .values({
        name: body.name,
        type: body.type ?? 'general',
        description: body.description ?? null,
        pdfUrl: body.pdfUrl ?? null,
        pdfKey: body.pdfKey ?? null,
        isActive: true,
      })
      .returning()
    return c.json({ success: true, data: template }, 201)
  } catch {
    return c.json({ error: 'Failed to create consent template' }, 500)
  }
})

consentTemplatesApp.patch('/:id', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(
      c,
      currentUser.id,
      MODULES.COMPLIANCE as string,
      ACTIONS.UPDATE as string
    ))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const { id } = c.req.param()
  const body = await c.req.json()

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const updates: Partial<typeof consentTemplates.$inferInsert> = {
      updatedAt: new Date(),
    }
    if (body.name !== undefined) updates.name = body.name
    if (body.type !== undefined) updates.type = body.type
    if (body.description !== undefined) updates.description = body.description
    if (body.pdfUrl !== undefined) updates.pdfUrl = body.pdfUrl
    if (body.pdfKey !== undefined) updates.pdfKey = body.pdfKey
    if (body.isActive !== undefined) updates.isActive = body.isActive

    const [updated] = await db
      .update(consentTemplates)
      .set(updates)
      .where(eq(consentTemplates.id, id))
      .returning()

    if (!updated) return c.json({ error: 'Not found' }, 404)
    return c.json({ success: true, data: updated })
  } catch {
    return c.json({ error: 'Failed to update consent template' }, 500)
  }
})

consentTemplatesApp.delete('/:id', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, currentUser.id, MODULES.COMPLIANCE, ACTIONS.DELETE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { id } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [deactivated] = await db
      .update(consentTemplates)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(consentTemplates.id, id))
      .returning()

    if (!deactivated) return c.json({ error: 'Not found' }, 404)
    return c.json({ success: true })
  } catch {
    return c.json({ error: 'Failed to delete consent template' }, 500)
  }
})

export { consentTemplatesApp }
