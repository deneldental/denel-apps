/**
 * Patient tags — admin-v1 §2.7. Admin-managed labels + per-patient assignment.
 * Gated on the patients module.
 */

import { and, eq, ne, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { patientTagLinks, patientTags } from '../db/schema'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

export const patientTagsApp = new Hono<HonoEnv>()
const MODULE = MODULES.PATIENTS

// GET / — all tags
patientTagsApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db.select().from(patientTags).orderBy(patientTags.name)
  return c.json({ success: true, data: rows })
})

// POST / — create a tag
patientTagsApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; color?: string }
  const name = body.name?.trim()
  if (!name) return c.json({ error: 'name is required' }, 400)
  const db = getDb(process.env.DATABASE_URL!)

  // Case-insensitive duplicate check. `name` is UNIQUE but Postgres compares it
  // case-sensitively, which is exactly how 'Insurance' and 'insurance' both came
  // to exist and broke the insurance-fields trigger. Answer with a clear 409
  // rather than letting the index raise a 500.
  const [clash] = await db
    .select({ id: patientTags.id, name: patientTags.name })
    .from(patientTags)
    .where(sql`lower(${patientTags.name}) = lower(${name})`)
    .limit(1)
  if (clash) {
    return c.json({ error: `A tag named "${clash.name}" already exists` }, 409)
  }

  try {
    const [row] = await db
      .insert(patientTags)
      .values({ name, color: body.color ?? 'slate' })
      .returning()
    return c.json({ success: true, data: row })
  } catch (error: unknown) {
    logError(error, { context: '[patient-tags] create' })
    return c.json({ error: 'Failed to create tag' }, 500)
  }
})

// PATCH /:id — rename / recolour / (de)activate
patientTagsApp.patch('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const body = (await c.req.json().catch(() => ({}))) as Partial<{
    name: string
    color: string
    isActive: boolean
  }>
  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')

  const [existing] = await db.select().from(patientTags).where(eq(patientTags.id, id)).limit(1)
  if (!existing) return c.json({ error: 'Not found' }, 404)

  // System tags may be renamed and recoloured — the display name is cosmetic and
  // behaviour keys off `systemKey`. They may NOT be deactivated: hiding the
  // insurance tag would silently stop reception from ever capturing insurance
  // details, with no error to explain why.
  if (existing.isSystem && body.isActive === false) {
    return c.json(
      {
        error: `"${existing.name}" is a system tag and cannot be deactivated`,
        detail: 'It drives patient intake behaviour. Rename or recolour it instead.',
      },
      400
    )
  }

  const nextName = body.name?.trim()
  if (nextName !== undefined) {
    if (!nextName) return c.json({ error: 'name cannot be empty' }, 400)
    const [clash] = await db
      .select({ id: patientTags.id, name: patientTags.name })
      .from(patientTags)
      .where(and(sql`lower(${patientTags.name}) = lower(${nextName})`, ne(patientTags.id, id)))
      .limit(1)
    if (clash) return c.json({ error: `A tag named "${clash.name}" already exists` }, 409)
  }

  const [row] = await db
    .update(patientTags)
    .set({
      ...(nextName !== undefined ? { name: nextName } : {}),
      ...(body.color !== undefined ? { color: body.color } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    })
    .where(eq(patientTags.id, id))
    .returning()
  return c.json({ success: true, data: row })
})

// DELETE /:id — remove a tag from the catalog.
//
// System tags are never deletable. For ordinary tags the assignment rows go
// too, so the caller is told how many patients are affected rather than
// discovering it afterwards.
patientTagsApp.delete('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.DELETE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')

  const [existing] = await db.select().from(patientTags).where(eq(patientTags.id, id)).limit(1)
  if (!existing) return c.json({ error: 'Not found' }, 404)

  if (existing.isSystem) {
    return c.json(
      {
        error: `"${existing.name}" is a system tag and cannot be deleted`,
        detail: 'It drives patient intake behaviour. Rename or recolour it instead.',
      },
      400
    )
  }

  try {
    const removed = await db
      .delete(patientTagLinks)
      .where(eq(patientTagLinks.tagId, id))
      .returning({ patientId: patientTagLinks.patientId })
    await db.delete(patientTags).where(eq(patientTags.id, id))
    return c.json({ success: true, data: { id, patientsUntagged: removed.length } })
  } catch (error: unknown) {
    logError(error, { context: '[patient-tags] delete' })
    return c.json({ error: 'Failed to delete tag' }, 500)
  }
})

// GET /patient/:patientId — a patient's tags
patientTagsApp.get('/patient/:patientId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db
    .select({ id: patientTags.id, name: patientTags.name, color: patientTags.color })
    .from(patientTagLinks)
    .innerJoin(patientTags, eq(patientTags.id, patientTagLinks.tagId))
    .where(eq(patientTagLinks.patientId, c.req.param('patientId')))
  return c.json({ success: true, data: rows })
})

// POST /patient/:patientId — assign a tag { tagId }
patientTagsApp.post('/patient/:patientId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const body = (await c.req.json().catch(() => ({}))) as { tagId?: string }
  if (!body.tagId) return c.json({ error: 'tagId is required' }, 400)
  const db = getDb(process.env.DATABASE_URL!)
  await db
    .insert(patientTagLinks)
    .values({ patientId: c.req.param('patientId'), tagId: body.tagId, assignedById: user.id })
    .onConflictDoNothing()
  return c.json({ success: true })
})

// DELETE /patient/:patientId/:tagId — unassign
patientTagsApp.delete('/patient/:patientId/:tagId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)
  const db = getDb(process.env.DATABASE_URL!)
  await db
    .delete(patientTagLinks)
    .where(
      and(
        eq(patientTagLinks.patientId, c.req.param('patientId')),
        eq(patientTagLinks.tagId, c.req.param('tagId'))
      )
    )
  return c.json({ success: true })
})
