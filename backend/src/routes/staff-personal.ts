/**
 * Staff personal-data child records — contacts, qualifications, dependents,
 * work experience (migration 0177).
 *
 * These are the one-to-many halves of the employee record that `staff` used to
 * carry as single flat column sets. Mounted under /api/staff alongside the
 * other staff sub-apps.
 *
 * All four resources are the same shape — list / add / edit / remove, scoped to
 * a staff member — so they're generated from one factory rather than sixteen
 * hand-written handlers. Hand-maintained duplication across near-identical
 * surfaces is precisely what let these fields drift in the first place; see
 * project-docs/staff-personal-data-build-plan.md.
 *
 * Routes (× contacts | qualifications | dependents | work-experience):
 *   GET    /api/staff/:staffId/<resource>
 *   POST   /api/staff/:staffId/<resource>
 *   PATCH  /api/staff/<resource>/:id
 *   DELETE /api/staff/<resource>/:id
 */

import {
  staffContactRecordSchema,
  staffDependentSchema,
  staffQualificationSchema,
  staffWorkExperienceSchema,
} from '@denel/types'
import { asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { ZodType } from 'zod'
import { getDb } from '../db'
import {
  staff,
  staffContacts,
  staffDependents,
  staffQualifications,
  staffWorkExperience,
} from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const app = new Hono<HonoEnv>()
const MODULE = MODULES.STAFF as string
const UUID = '{[0-9a-fA-F-]{36}}'

interface ChildResource {
  /** URL segment, e.g. 'contacts'. */
  path: string
  /** Drizzle table. Typed loosely — the zod schema is the real guard. */
  table: any
  schema: ZodType<any>
  /** Singular, for audit entries + error copy. */
  label: string
  /** ISO strings → Date, since drizzle calls .toISOString() on timestamps. */
  dateFields?: string[]
  /** Deterministic list order. */
  orderBy?: (t: any) => any
}

const RESOURCES: ChildResource[] = [
  {
    path: 'contacts',
    table: staffContacts,
    schema: staffContactRecordSchema,
    label: 'contact',
    // Primary first, then oldest — so the emergency contact HR should call is
    // at the top rather than wherever the DB felt like putting it.
    orderBy: (t) => [asc(t.type), asc(t.createdAt)],
  },
  {
    path: 'qualifications',
    table: staffQualifications,
    schema: staffQualificationSchema,
    label: 'qualification',
    orderBy: (t) => [asc(t.createdAt)],
  },
  {
    path: 'dependents',
    table: staffDependents,
    schema: staffDependentSchema,
    label: 'dependent',
    dateFields: ['dateOfBirth'],
    orderBy: (t) => [asc(t.createdAt)],
  },
  {
    path: 'work-experience',
    table: staffWorkExperience,
    schema: staffWorkExperienceSchema,
    label: 'work experience entry',
    dateFields: ['startDate', 'endDate'],
    orderBy: (t) => [asc(t.startDate)],
  },
]

/** ISO date strings → Date objects (drizzle timestamps reject strings). */
function coerceDates(data: Record<string, any>, fields: string[] = []) {
  for (const f of fields) {
    if (typeof data[f] === 'string' && data[f] !== '') data[f] = new Date(data[f])
    else if (data[f] === '') data[f] = null
  }
  return data
}

function firstIssue(err: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  const i = err.issues[0]
  const path = i?.path.join('.')
  return path ? `${path}: ${i?.message}` : (i?.message ?? 'Invalid value')
}

for (const res of RESOURCES) {
  // ── List ────────────────────────────────────────────────────────────────
  app.get(`/:staffId${UUID}/${res.path}`, async (c) => {
    const authUser = await getCurrentUser(c)
    if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
    if (!(await checkPermission(c, authUser.id, MODULE, ACTIONS.READ as string)))
      return c.json({ error: 'Unauthorized' }, 403)

    try {
      const db = getDb(process.env.DATABASE_URL!)
      const staffId = c.req.param('staffId')
      const rows = await db
        .select()
        .from(res.table)
        .where(eq(res.table.staffId, staffId))
        .orderBy(...(res.orderBy ? res.orderBy(res.table) : []))
      return c.json({ success: true, data: rows })
    } catch (error) {
      logError(error, { context: `[staff-personal] list ${res.path}` })
      return c.json({ error: `Failed to load ${res.path}` }, 500)
    }
  })

  // ── Add ─────────────────────────────────────────────────────────────────
  app.post(`/:staffId${UUID}/${res.path}`, async (c) => {
    const authUser = await getCurrentUser(c)
    if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
    if (!(await checkPermission(c, authUser.id, MODULE, ACTIONS.UPDATE as string)))
      return c.json({ error: 'Unauthorized' }, 403)

    try {
      const db = getDb(process.env.DATABASE_URL!)
      const staffId = c.req.param('staffId')

      // The FK would catch this, but a 404 beats a constraint violation.
      const owner = await db.query.staff.findFirst({
        where: eq(staff.id, staffId),
        columns: { id: true, fullName: true },
      })
      if (!owner) return c.json({ error: 'Staff member not found' }, 404)

      const parsed = res.schema.safeParse(await c.req.json().catch(() => ({})))
      if (!parsed.success) return c.json({ error: firstIssue(parsed.error) }, 400)

      const values = coerceDates({ ...(parsed.data as object) }, res.dateFields)
      // `res.table` is loosely typed so one factory can serve four tables, so
      // drizzle can't infer the row shape here. The zod schema above is the
      // real guard.
      const [row] = (await db
        .insert(res.table)
        .values({ ...values, staffId })
        .returning()) as any[]

      c.set('skipAudit', true)
      await createAuditLog(db, {
        userId: authUser.id,
        action: `add_${res.path.replace(/-/g, '_')}`,
        module: 'staff',
        entityId: staffId,
        entityName: owner.fullName,
        changes: values,
      })

      return c.json({ success: true, data: row })
    } catch (error) {
      logError(error, { context: `[staff-personal] add ${res.path}` })
      return c.json({ error: `Failed to add ${res.label}` }, 500)
    }
  })

  // ── Edit ────────────────────────────────────────────────────────────────
  app.patch(`/${res.path}/:id${UUID}`, async (c) => {
    const authUser = await getCurrentUser(c)
    if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
    if (!(await checkPermission(c, authUser.id, MODULE, ACTIONS.UPDATE as string)))
      return c.json({ error: 'Unauthorized' }, 403)

    try {
      const db = getDb(process.env.DATABASE_URL!)
      const id = c.req.param('id')

      // Partial edits are the norm (toggling isPrimary, fixing a phone), so
      // validate the MERGED record — a .partial() alone would let a cross-field
      // rule like "a name or a phone" pass on an update that empties both.
      const [existing] = await db.select().from(res.table).where(eq(res.table.id, id)).limit(1)
      if (!existing) return c.json({ error: `${res.label} not found` }, 404)

      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
      const merged = { ...existing, ...body }
      // Timestamps come back from the DB as Dates; the schemas expect ISO.
      for (const f of res.dateFields ?? []) {
        if (merged[f] instanceof Date) merged[f] = (merged[f] as Date).toISOString()
      }
      const parsed = res.schema.safeParse(merged)
      if (!parsed.success) return c.json({ error: firstIssue(parsed.error) }, 400)

      const values = coerceDates({ ...(parsed.data as object) }, res.dateFields)
      const [row] = await db
        .update(res.table)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(res.table.id, id))
        .returning()

      c.set('skipAudit', true)
      await createAuditLog(db, {
        userId: authUser.id,
        action: `update_${res.path.replace(/-/g, '_')}`,
        module: 'staff',
        entityId: existing.staffId,
        entityName: res.label,
        changes: values,
      })

      return c.json({ success: true, data: row })
    } catch (error) {
      logError(error, { context: `[staff-personal] update ${res.path}` })
      return c.json({ error: `Failed to update ${res.label}` }, 500)
    }
  })

  // ── Remove ──────────────────────────────────────────────────────────────
  app.delete(`/${res.path}/:id${UUID}`, async (c) => {
    const authUser = await getCurrentUser(c)
    if (!authUser) return c.json({ error: 'Not authenticated' }, 401)
    if (!(await checkPermission(c, authUser.id, MODULE, ACTIONS.UPDATE as string)))
      return c.json({ error: 'Unauthorized' }, 403)

    try {
      const db = getDb(process.env.DATABASE_URL!)
      const id = c.req.param('id')
      const [existing] = await db.select().from(res.table).where(eq(res.table.id, id)).limit(1)
      if (!existing) return c.json({ error: `${res.label} not found` }, 404)

      // Hard delete: these are small, self-contained records with no history to
      // preserve, unlike `staff` itself (which soft-deletes because a dozen
      // tables cascade off it).
      await db.delete(res.table).where(eq(res.table.id, id))

      c.set('skipAudit', true)
      await createAuditLog(db, {
        userId: authUser.id,
        action: `remove_${res.path.replace(/-/g, '_')}`,
        module: 'staff',
        entityId: existing.staffId,
        entityName: res.label,
        beforeJson: existing,
      })

      return c.json({ success: true })
    } catch (error) {
      logError(error, { context: `[staff-personal] delete ${res.path}` })
      return c.json({ error: `Failed to remove ${res.label}` }, 500)
    }
  })
}

export { app as staffPersonalApp }
