import { and, asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { env } from '../config/env'
import { getDb } from '../db'
import { reminderTemplates } from '../db/schema'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, isAdmin } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'
import { verifySession } from '../rbac/middleware/verifySession'

const reminderTemplatesApp = new Hono<HonoEnv>()

// GET /api/reminder-templates — all active and non-admin-only (or all for admin)
//
// This is the single source for every template list in the portal — the CRM
// manager page AND the scheduling/reminder picker — so filtering `adminOnly`
// here hides a flagged template everywhere at once.
reminderTemplatesApp.get('/', verifySession(), async (c) => {
  const { user } = c.var
  const db = getDb(env.DATABASE_URL)
  try {
    const admin = await isAdmin(c, user.id)
    const rows = admin
      ? await db.select().from(reminderTemplates).orderBy(asc(reminderTemplates.name))
      : await db
          .select()
          .from(reminderTemplates)
          .where(and(eq(reminderTemplates.isActive, true), eq(reminderTemplates.adminOnly, false)))
          .orderBy(asc(reminderTemplates.name))
    return c.json({ success: true, data: rows })
  } catch (_err: unknown) {
    return c.json({ error: 'Failed to fetch templates' }, 500)
  }
})

// POST /api/reminder-templates — create (messaging:create)
reminderTemplatesApp.post('/', verifySession(), async (c) => {
  const { user } = c.var
  const db = getDb(env.DATABASE_URL)
  try {
    if (!(await checkPermission(c, user.id, MODULES.MESSAGING, ACTIONS.CREATE)))
      return c.json({ error: 'Unauthorized' }, 403)

    const body = await c.req.json()
    if (!body.name?.trim() || !body.messageTemplate?.trim()) {
      return c.json({ error: 'name and messageTemplate are required' }, 400)
    }

    const [created] = await db
      .insert(reminderTemplates)
      .values({
        name: body.name.trim(),
        messageTemplate: body.messageTemplate.trim(),
        adminOnly: body.adminOnly === true,
        createdById: user.id,
      })
      .returning()

    return c.json({ success: true, data: created }, 201)
  } catch (_err: unknown) {
    return c.json({ error: 'Failed to create template' }, 500)
  }
})

// PATCH /api/reminder-templates/:id — update (messaging:update)
reminderTemplatesApp.patch('/:id', verifySession(), async (c) => {
  const { user } = c.var
  const { id } = c.req.param()
  const db = getDb(env.DATABASE_URL)
  try {
    if (!(await checkPermission(c, user.id, MODULES.MESSAGING, ACTIONS.UPDATE)))
      return c.json({ error: 'Unauthorized' }, 403)

    const body = await c.req.json()
    const updates: Partial<typeof reminderTemplates.$inferInsert> = { updatedAt: new Date() }
    if (body.name !== undefined) updates.name = body.name.trim()
    if (body.messageTemplate !== undefined) updates.messageTemplate = body.messageTemplate.trim()
    if (body.isActive !== undefined) updates.isActive = body.isActive
    if (body.adminOnly !== undefined) updates.adminOnly = body.adminOnly === true

    const [updated] = await db
      .update(reminderTemplates)
      .set(updates)
      .where(eq(reminderTemplates.id, id))
      .returning()

    if (!updated) return c.json({ error: 'Template not found' }, 404)
    return c.json({ success: true, data: updated })
  } catch (_err: unknown) {
    return c.json({ error: 'Failed to update template' }, 500)
  }
})

// DELETE /api/reminder-templates/:id — hard delete (messaging:delete)
reminderTemplatesApp.delete('/:id', verifySession(), async (c) => {
  const { user } = c.var
  const { id } = c.req.param()
  const db = getDb(env.DATABASE_URL)
  try {
    if (!(await checkPermission(c, user.id, MODULES.MESSAGING, ACTIONS.DELETE)))
      return c.json({ error: 'Unauthorized' }, 403)

    // System templates (with a stable `key`, e.g. lab_status:*) are wired into
    // backend events — deleting one silently breaks that SMS. Block it; admins
    // can still edit the message or deactivate it.
    const existing = await db.query.reminderTemplates.findFirst({
      where: eq(reminderTemplates.id, id),
      columns: { key: true },
    })
    if (existing?.key) {
      return c.json(
        {
          error:
            'This is a system template used by automated messaging. Edit it instead of deleting.',
        },
        400
      )
    }

    await db.delete(reminderTemplates).where(eq(reminderTemplates.id, id))
    return c.json({ success: true })
  } catch (_err: unknown) {
    return c.json({ error: 'Failed to delete template' }, 500)
  }
})

export { reminderTemplatesApp }
