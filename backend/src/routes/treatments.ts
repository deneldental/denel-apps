import { asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { treatmentTypes, user as userSchema } from '../db/schema'
import { logError } from '../lib/logger'
import { ROLES } from '../lib/modules'
import { getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const treatmentsApp = new Hono<HonoEnv>()

// GET /api/treatments - Fetch active treatment types
treatmentsApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(process.env.DATABASE_URL!)

  try {
    const data = await db
      .select()
      .from(treatmentTypes)
      .where(eq(treatmentTypes.isActive, true))
      .orderBy(asc(treatmentTypes.name))
    return c.json({ success: true, data })
  } catch (error: unknown) {
    logError(error, { context: '[GET /api/treatments] Error' })
    return c.json({ error: 'Failed' }, 500)
  }
})

// GET /api/treatments/all - Fetch all treatment types (Admin only)
treatmentsApp.get('/all', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(process.env.DATABASE_URL!)

  try {
    const dbUser = await db.query.user.findFirst({
      where: eq(userSchema.id, user.id),
      columns: { roleId: true },
    })

    if (dbUser?.roleId !== ROLES.ADMIN) {
      // Fallback to active only for non-admins
      const data = await db
        .select()
        .from(treatmentTypes)
        .where(eq(treatmentTypes.isActive, true))
        .orderBy(asc(treatmentTypes.name))
      return c.json({ success: true, data })
    }

    const data = await db.select().from(treatmentTypes).orderBy(asc(treatmentTypes.name))
    return c.json({ success: true, data })
  } catch (error: unknown) {
    logError(error, { context: '[GET /api/treatments/all] Error' })
    return c.json({ error: 'Failed' }, 500)
  }
})

// §6.4 — standard ADA-style top-level groups. Fixed taxonomy (not clinic-editable).
export const ADA_GROUPS = [
  'Diagnostic',
  'Preventive',
  'Restorative',
  'Endodontics',
  'Periodontics',
  'Prosthodontics',
  'Oral Surgery',
  'Orthodontics',
  'Implant',
  'Adjunctive',
] as const

/** Coerce an input to a valid ADA group; unknown/empty → 'Adjunctive'. */
export function normalizeAdaGroup(value: unknown): string {
  return typeof value === 'string' && (ADA_GROUPS as readonly string[]).includes(value)
    ? value
    : 'Adjunctive'
}

// GET /api/treatments/ada-groups — the standard ADA top-level groups (for grouping UI)
treatmentsApp.get('/ada-groups', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  return c.json({ success: true, data: ADA_GROUPS })
})

// POST /api/treatments - Create new treatment type (Admin only)
treatmentsApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const db = getDb(process.env.DATABASE_URL!)

  try {
    const dbUser = await db.query.user.findFirst({
      where: eq(userSchema.id, user.id),
      columns: { roleId: true },
    })

    if (dbUser?.roleId !== ROLES.ADMIN) return c.json({ error: 'Unauthorized' }, 403)

    const body = await c.req.json()
    const [newItem] = await db
      .insert(treatmentTypes)
      .values({
        name: body.name.toLowerCase().trim(),
        displayName: body.displayName?.trim() || null,
        adaGroup: normalizeAdaGroup(body.adaGroup),
      })
      .returning()

    return c.json({ success: true, data: newItem })
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      return c.json({ error: 'Already exists' }, 400)
    }
    logError(error, { context: '[POST /api/treatments] Error' })
    return c.json({ error: 'Failed' }, 500)
  }
})

treatmentsApp.patch('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const dbUser = await db.query.user.findFirst({
      where: eq(userSchema.id, user.id),
      columns: { roleId: true },
    })
    if (dbUser?.roleId !== ROLES.ADMIN) return c.json({ error: 'Unauthorized' }, 403)

    const body = await c.req.json()
    const patch: Record<string, unknown> = {}
    if (typeof body.name === 'string') patch.name = body.name.toLowerCase().trim()
    if (body.displayName !== undefined) patch.displayName = body.displayName?.trim() || null
    if (typeof body.isActive === 'boolean') patch.isActive = body.isActive
    if (typeof body.autoSyncEnabled === 'boolean') patch.autoSyncEnabled = body.autoSyncEnabled
    if (body.defaultRecareMonths !== undefined) patch.defaultRecareMonths = body.defaultRecareMonths
    if (body.adaGroup !== undefined) patch.adaGroup = normalizeAdaGroup(body.adaGroup)
    patch.updatedAt = new Date()

    await db.update(treatmentTypes).set(patch).where(eq(treatmentTypes.id, id))
    return c.json({ success: true })
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === '23505')
      return c.json({ error: 'Name already in use' }, 400)
    logError(error, { context: '[PATCH /api/treatments/:id] Error' })
    return c.json({ error: 'Failed' }, 500)
  }
})

// DELETE — soft-delete (set isActive=false). Hard delete would break historical
// service rows that reference the type via ON DELETE SET NULL but we'd rather
// preserve the audit trail.
treatmentsApp.delete('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const dbUser = await db.query.user.findFirst({
      where: eq(userSchema.id, user.id),
      columns: { roleId: true },
    })
    if (dbUser?.roleId !== ROLES.ADMIN) return c.json({ error: 'Unauthorized' }, 403)

    const [updated] = await db
      .update(treatmentTypes)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(treatmentTypes.id, id))
      .returning()

    if (!updated) return c.json({ error: 'Not found' }, 404)
    return c.json({ success: true, data: updated })
  } catch (error: unknown) {
    logError(error, { context: '[DELETE /api/treatments/:id] Error' })
    return c.json({ error: 'Failed' }, 500)
  }
})

export { treatmentsApp }
