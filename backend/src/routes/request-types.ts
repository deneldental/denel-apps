/**
 * Request kinds + subtypes — the two-level lookup behind the staff request forms
 * (staff app + HR "file request"). A **Request kind** is the top-level choice
 * (Leave, Permit, …); a **Type** is a subtype under a kind. Both are managed in
 * HR Settings.
 *
 * GET is open to any authenticated user (the staff form reads it); create/update/
 * delete require STAFF_REQUESTS:UPDATE (HR admin).
 *
 * The four built-in kinds (leave | permit | emergency | official_support) are
 * `isSystem` rows: their slug is fixed and they can't be deleted/deactivated,
 * because backend behaviour keys on those slugs. Custom kinds are generic and
 * opt into date/amount fields via `showsDates` / `showsAmount`.
 */

import { asc, eq } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { getDb } from '../db'
import { requestKinds, requestSubtypes, staffRequests } from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const requestTypesApp = new Hono<HonoEnv>()

/** Derive a stable snake_case slug from a display name. */
function slugify(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

async function requireUpdate(c: Context<HonoEnv>) {
  const authUser = await getCurrentUser(c)
  if (!authUser) return { error: c.json({ error: 'Not authenticated' }, 401) }
  if (
    !(await checkPermission(
      c,
      authUser.id,
      MODULES.STAFF_REQUESTS as string,
      ACTIONS.UPDATE as string
    ))
  )
    return { error: c.json({ error: 'Unauthorized' }, 403) }
  return { authUser }
}

// ── Request kinds (top-level "Request") ─────────────────────────────────────

/** GET /kinds — active kinds (any authenticated user). ?all=1 → include inactive. */
requestTypesApp.get('/kinds', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  const includeInactive = c.req.query('all') === '1'
  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db
    .select()
    .from(requestKinds)
    .where(includeInactive ? undefined : eq(requestKinds.isActive, true))
    .orderBy(asc(requestKinds.displayOrder), asc(requestKinds.displayName))
  return c.json({ success: true, data: rows })
})

/** POST /kinds — create a custom kind. Body: { displayName, showsDates?, showsAmount? } */
requestTypesApp.post('/kinds', async (c) => {
  const auth = await requireUpdate(c)
  if ('error' in auth) return auth.error

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : ''
  if (!displayName) return c.json({ error: 'displayName is required' }, 400)
  const name = (typeof body.name === 'string' && body.name.trim() ? body.name : displayName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!name) return c.json({ error: 'Could not derive a slug from displayName' }, 400)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    const [row] = await db
      .insert(requestKinds)
      .values({
        name,
        displayName,
        showsDates: body.showsDates === true,
        showsAmount: body.showsAmount === true,
        isSystem: false,
      })
      .returning()
    await createAuditLog(db, {
      userId: auth.authUser.id,
      action: 'create',
      module: 'staff_requests',
      entityId: row?.id,
      entityName: `Request kind ${displayName}`,
    })
    return c.json({ success: true, data: row })
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
      return c.json({ error: 'A request with that name already exists' }, 409)
    }
    return c.json({ error: 'Failed to create request kind' }, 500)
  }
})

/** PATCH /kinds/:id — update a kind. System kinds keep their slug + can't be deactivated. */
requestTypesApp.patch('/kinds/:id', async (c) => {
  const auth = await requireUpdate(c)
  if ('error' in auth) return auth.error

  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const db = getDb(process.env.DATABASE_URL!)
  const [existing] = await db
    .select({ isSystem: requestKinds.isSystem })
    .from(requestKinds)
    .where(eq(requestKinds.id, id))
    .limit(1)
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (typeof body.displayName === 'string' && body.displayName.trim())
    patch.displayName = body.displayName.trim()
  if (typeof body.displayOrder === 'number') patch.displayOrder = body.displayOrder
  if (typeof body.showsDates === 'boolean') patch.showsDates = body.showsDates
  if (typeof body.showsAmount === 'boolean') patch.showsAmount = body.showsAmount
  if (typeof body.isActive === 'boolean') {
    // System kinds can't be deactivated — the request flow depends on them.
    if (existing.isSystem && body.isActive === false) {
      return c.json({ error: 'Built-in requests can’t be deactivated.' }, 409)
    }
    patch.isActive = body.isActive
  }

  await db.update(requestKinds).set(patch).where(eq(requestKinds.id, id))
  return c.json({ success: true })
})

/** DELETE /kinds/:id — guarded: refuse system kinds, or kinds still in use. */
requestTypesApp.delete('/kinds/:id', async (c) => {
  const auth = await requireUpdate(c)
  if ('error' in auth) return auth.error

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .select({ name: requestKinds.name, isSystem: requestKinds.isSystem })
    .from(requestKinds)
    .where(eq(requestKinds.id, id))
    .limit(1)
  if (!row) return c.json({ error: 'Not found' }, 404)
  if (row.isSystem) {
    return c.json({ error: 'Built-in requests can’t be deleted — deactivate instead.' }, 409)
  }

  const [childType] = await db
    .select({ id: requestSubtypes.id })
    .from(requestSubtypes)
    .where(eq(requestSubtypes.category, row.name))
    .limit(1)
  if (childType) {
    return c.json(
      {
        error: 'This request still has types — delete those first, or deactivate it.',
        code: 'HAS_TYPES',
      },
      409
    )
  }
  const [used] = await db
    .select({ id: staffRequests.id })
    .from(staffRequests)
    .where(eq(staffRequests.requestType, row.name))
    .limit(1)
  if (used) {
    return c.json(
      { error: 'In use by existing requests — deactivate it instead.', code: 'IN_USE' },
      409
    )
  }

  await db.delete(requestKinds).where(eq(requestKinds.id, id))
  return c.json({ success: true })
})

// ── Request subtypes ("Types" under a kind) ─────────────────────────────────

/** GET / — active subtypes (any authenticated user). ?all=1 → include inactive. */
requestTypesApp.get('/', async (c) => {
  const authUser = await getCurrentUser(c)
  if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
  const includeInactive = c.req.query('all') === '1'
  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db
    .select()
    .from(requestSubtypes)
    .where(includeInactive ? undefined : eq(requestSubtypes.isActive, true))
    .orderBy(asc(requestSubtypes.category), asc(requestSubtypes.displayOrder))
  return c.json({ success: true, data: rows })
})

/** POST / — create a Type under a kind. Body: { category, name?, displayName } */
requestTypesApp.post('/', async (c) => {
  const auth = await requireUpdate(c)
  if ('error' in auth) return auth.error

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const category = typeof body.category === 'string' ? body.category : ''
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : ''
  if (!displayName) return c.json({ error: 'displayName is required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  // Validate the parent kind exists (dynamic — replaces the old fixed enum).
  const [parent] = await db
    .select({ id: requestKinds.id })
    .from(requestKinds)
    .where(eq(requestKinds.name, category))
    .limit(1)
  if (!parent) return c.json({ error: 'Unknown request kind' }, 400)

  const name =
    typeof body.name === 'string' && body.name.trim() ? slugify(body.name) : slugify(displayName)
  if (!name) return c.json({ error: 'Could not derive a slug from displayName' }, 400)

  try {
    const [row] = await db
      .insert(requestSubtypes)
      .values({ category, name, displayName })
      .returning()
    await createAuditLog(db, {
      userId: auth.authUser.id,
      action: 'create',
      module: 'staff_requests',
      entityId: row?.id,
      entityName: `Request type ${displayName}`,
    })
    return c.json({ success: true, data: row })
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
      return c.json({ error: 'A type with that name already exists' }, 409)
    }
    return c.json({ error: 'Failed to create type' }, 500)
  }
})

/** PATCH /:id — update displayName / isActive / displayOrder (admin). */
requestTypesApp.patch('/:id', async (c) => {
  const auth = await requireUpdate(c)
  if ('error' in auth) return auth.error

  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (typeof body.displayName === 'string' && body.displayName.trim())
    patch.displayName = body.displayName.trim()
  if (typeof body.isActive === 'boolean') patch.isActive = body.isActive
  if (typeof body.displayOrder === 'number') patch.displayOrder = body.displayOrder

  const db = getDb(process.env.DATABASE_URL!)
  await db.update(requestSubtypes).set(patch).where(eq(requestSubtypes.id, id))
  return c.json({ success: true })
})

/** DELETE /:id — guarded: refuse if any request already uses the subtype. */
requestTypesApp.delete('/:id', async (c) => {
  const auth = await requireUpdate(c)
  if ('error' in auth) return auth.error

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .select({ name: requestSubtypes.name })
    .from(requestSubtypes)
    .where(eq(requestSubtypes.id, id))
    .limit(1)
  if (!row) return c.json({ error: 'Not found' }, 404)

  const [used] = await db
    .select({ id: staffRequests.id })
    .from(staffRequests)
    .where(eq(staffRequests.subType, row.name))
    .limit(1)
  if (used) {
    return c.json(
      { error: 'In use by existing requests — deactivate it instead.', code: 'IN_USE' },
      409
    )
  }

  await db.delete(requestSubtypes).where(eq(requestSubtypes.id, id))
  return c.json({ success: true })
})

export { requestTypesApp }
