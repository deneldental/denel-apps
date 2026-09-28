/**
 * Labs module — Phase 4
 *
 * Vendors (internal + external), services catalog, lab cases, photos.
 * External lab cases auto-create an expenses entry (lab_work) that gates day-sheet submission.
 */

import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQL,
} from 'drizzle-orm'
import { Hono } from 'hono'
import { type DB, getDb } from '../db'
import {
  expenses,
  labBaseServices,
  labCasePhotos,
  labCaseStatuses,
  labCaseStatusHistory,
  labCases,
  labServiceCategories,
  labServices,
  labVendorServiceExpressOptions,
  labVendors,
  patientReminders,
  patients,
  reminderTemplates,
  serviceChangeRequests,
  user as userTable,
} from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { ensureExpensePosted, reverseExpenseGL } from '../lib/expense-service'
import {
  applyTwoWeekFallback,
  createExternalLabInvoice,
  createInternalLabInvoice,
} from '../lib/lab-case-billing'
import { getLabDailySummary } from '../lib/lab-summary'
import { resolveTurnaroundDays } from '../lib/lab-turnaround'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser, isAdmin } from '../lib/rbac'
import { getDefaultLabTurnaroundDays } from '../lib/settings-store'
import { sendSMS } from '../lib/sms'
import type { HonoEnv } from '../lib/types'

const labsApp = new Hono<HonoEnv>()

// ═════════════════════════════════════════════════════════════════════════════
// Vendors
// ═════════════════════════════════════════════════════════════════════════════

labsApp.get('/vendors', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db.select().from(labVendors).orderBy(asc(labVendors.name))
  return c.json({ success: true, data: rows })
})

labsApp.get('/vendors/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }
  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db.select().from(labVendors).where(eq(labVendors.id, id)).limit(1)
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true, data: row })
})

labsApp.post('/vendors', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.CREATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const body = await c.req.json()
  if (!body.name || !body.type) return c.json({ error: 'name and type required' }, 400)
  if (!['internal', 'external'].includes(body.type))
    return c.json({ error: 'type must be internal|external' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .insert(labVendors)
    .values({
      name: body.name,
      type: body.type,
      contactEmail: body.contactEmail ?? null,
      contactPhone: body.contactPhone ?? null,
      address: body.address ?? null,
      notes: body.notes ?? null,
      active: body.active ?? true,
    })
    .returning()

  await createAuditLog(db, {
    userId: user.id,
    action: 'create',
    module: 'labs',
    entityId: row.id,
    entityName: `Lab Vendor: ${row.name}`,
    changes: body,
  })
  return c.json({ success: true, data: row })
})

labsApp.patch('/vendors/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.UPDATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const body = await c.req.json()
  const db = getDb(process.env.DATABASE_URL!)
  const updates: any = { updatedAt: new Date() }
  for (const k of ['name', 'type', 'contactEmail', 'contactPhone', 'address', 'notes', 'active']) {
    if (body[k] !== undefined) updates[k] = body[k]
  }
  const [row] = await db.update(labVendors).set(updates).where(eq(labVendors.id, id)).returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true, data: row })
})

labsApp.delete('/vendors/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.DELETE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db.delete(labVendors).where(eq(labVendors.id, id)).returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true })
})

// ═════════════════════════════════════════════════════════════════════════════
// Service Categories  (read-only here — CRUD lives in /api/services/lab-categories
// under the Services module. Kept for the case-form & catalog reads.)
// ═════════════════════════════════════════════════════════════════════════════

labsApp.get('/categories', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }
  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db.select().from(labServiceCategories).orderBy(asc(labServiceCategories.name))
  return c.json({ success: true, data: rows })
})

// ═════════════════════════════════════════════════════════════════════════════
// Lab-case statuses (admin-v1 §8.3)
// Serves the admin-editable lookup (migration 0120, seeded with the canonical 8)
// so the FE drives labels/variants from the DB instead of the hardcoded enum.
// labCases.status stays text and references `name` by value — no FK.
// ═════════════════════════════════════════════════════════════════════════════

labsApp.get('/case-statuses', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }
  const db = getDb(process.env.DATABASE_URL!)
  // Active-only by default; ?all=1 includes inactive for an admin editor.
  const includeInactive = c.req.query('all') === '1'
  const rows = await db
    .select()
    .from(labCaseStatuses)
    .where(includeInactive ? undefined : eq(labCaseStatuses.isActive, true))
    .orderBy(asc(labCaseStatuses.sortOrder), asc(labCaseStatuses.displayName))
  return c.json({ success: true, data: rows })
})

// ═════════════════════════════════════════════════════════════════════════════
// Labs mini-report (admin-v1 §8.6)
// The day's lab metrics (cases by status, patient lab revenue, lab-work +
// lab-inventory expenses) shaped as a §10.1 ModuleSummary. Rolls into the main
// daily report; also queryable directly for the Labs module's mini-report tab.
// ═════════════════════════════════════════════════════════════════════════════

labsApp.get('/daily-summary', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }
  const db = getDb(process.env.DATABASE_URL!)
  const dateParam = c.req.query('date')
  const date = dateParam ? new Date(dateParam) : new Date()
  if (Number.isNaN(date.getTime())) return c.json({ error: 'Invalid date' }, 400)
  const summary = await getLabDailySummary(db, date)
  return c.json({ success: true, data: summary })
})

// ═════════════════════════════════════════════════════════════════════════════
// Vendor Services (junction)
// A vendor's extension of a base service: regular price + turnaround. Express
// options are a child collection — see /vendors/:id/services/:serviceId/express-options.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /vendors/:vendorId/services — every service this vendor offers, joined
 * to its base-service definition + express options.
 */
labsApp.get('/vendors/:vendorId/services', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const vendorId = c.req.param('vendorId')
  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db.query.labServices.findMany({
    where: eq(labServices.vendorId, vendorId),
    with: {
      baseService: { with: { category: true } },
      expressOptions: true,
    },
    orderBy: [asc(labServices.createdAt)],
  })
  return c.json({ success: true, data: rows })
})

/** POST /vendors/:vendorId/services — link this vendor to a base service. */
labsApp.post('/vendors/:vendorId/services', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.CREATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const vendorId = c.req.param('vendorId')
  const body = await c.req.json()
  if (!body.baseServiceId) {
    return c.json({ error: 'baseServiceId required' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [row] = await db
      .insert(labServices)
      .values({
        vendorId,
        baseServiceId: body.baseServiceId,
        regularCost: body.regularCost == null ? null : Number(body.regularCost),
        clinicPrice: body.clinicPrice == null ? null : Number(body.clinicPrice),
        regularTurnaroundDays:
          body.regularTurnaroundDays == null ? null : Number(body.regularTurnaroundDays),
        notes: body.notes ?? null,
        active: body.active ?? true,
      })
      .returning()
    return c.json({ success: true, data: row })
  } catch (err: unknown) {
    const pgErr = err as { code?: string; message?: string }
    if (pgErr.code === '23505') {
      return c.json({ error: 'This vendor already offers that base service' }, 409)
    }
    throw err
  }
})

labsApp.patch('/services/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.UPDATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const body = await c.req.json()
  const db = getDb(process.env.DATABASE_URL!)
  const updates: any = { updatedAt: new Date() }
  for (const k of ['regularCost', 'clinicPrice', 'regularTurnaroundDays', 'notes', 'active']) {
    if (body[k] !== undefined) updates[k] = body[k]
  }

  const [row] = await db.update(labServices).set(updates).where(eq(labServices.id, id)).returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true, data: row })
})

labsApp.delete('/services/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.DELETE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db.delete(labServices).where(eq(labServices.id, id)).returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true })
})

// ─── Vendor service express options ───────────────────────────────────────────
// Each vendor-service can offer N express tiers (label + cost + turnaround).
// The case form lets the receptionist pick at most one when creating a case.

labsApp.post('/services/:serviceId/express-options', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.UPDATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }
  const serviceId = c.req.param('serviceId')
  const body = await c.req.json()
  if (!body.label?.trim() || body.cost == null || body.turnaroundDays == null) {
    return c.json({ error: 'label, cost, turnaroundDays required' }, 400)
  }
  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .insert(labVendorServiceExpressOptions)
    .values({
      vendorServiceId: serviceId,
      label: body.label.trim(),
      cost: Number(body.cost),
      turnaroundDays: Number(body.turnaroundDays),
      sortOrder: body.sortOrder ?? 0,
    })
    .returning()
  return c.json({ success: true, data: row })
})

labsApp.patch('/express-options/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.UPDATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }
  const id = c.req.param('id')
  const body = await c.req.json()
  const db = getDb(process.env.DATABASE_URL!)
  const updates: any = { updatedAt: new Date() }
  if (body.label !== undefined) updates.label = body.label
  if (body.cost !== undefined) updates.cost = Number(body.cost)
  if (body.turnaroundDays !== undefined) updates.turnaroundDays = Number(body.turnaroundDays)
  if (body.isActive !== undefined) updates.isActive = body.isActive
  if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder
  const [row] = await db
    .update(labVendorServiceExpressOptions)
    .set(updates)
    .where(eq(labVendorServiceExpressOptions.id, id))
    .returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true, data: row })
})

labsApp.delete('/express-options/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.DELETE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }
  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .delete(labVendorServiceExpressOptions)
    .where(eq(labVendorServiceExpressOptions.id, id))
    .returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true })
})

// ─── Service catalog ──────────────────────────────────────────────────────────
// One row per base service, with the list of vendors that offer it. Each
// offering carries the vendor's regular price + turnaround + their list of
// express options. Used by the case-creation form.

labsApp.get('/service-catalog', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const bases = await db.query.labBaseServices.findMany({
    where: eq(labBaseServices.isActive, true),
    with: {
      category: true,
      scope: true,
      vendorOfferings: {
        where: eq(labServices.active, true),
        with: { vendor: true, expressOptions: true },
      },
    },
    orderBy: [asc(labBaseServices.name)],
  })

  const data = bases.map((b) => ({
    baseServiceId: b.id,
    name: b.name,
    unitType: b.unitType,
    scope: b.scope
      ? { name: b.scope.name, displayName: b.scope.displayName, quantityMode: b.scope.quantityMode }
      : null,
    standardTurnaroundDays: b.standardTurnaroundDays,
    category: b.category ? { id: b.category.id, name: b.category.name } : null,
    offerings: b.vendorOfferings
      .filter((vs) => vs.vendor.active)
      .map((vs) => ({
        serviceId: vs.id,
        vendorId: vs.vendor.id,
        vendorName: vs.vendor.name,
        vendorType: vs.vendor.type,
        regularCost: Number(vs.regularCost ?? 0),
        regularTurnaroundDays: vs.regularTurnaroundDays ?? b.standardTurnaroundDays ?? 7,
        expressOptions: vs.expressOptions
          .filter((eo) => eo.isActive)
          .map((eo) => ({
            id: eo.id,
            label: eo.label,
            cost: Number(eo.cost),
            turnaroundDays: eo.turnaroundDays,
          })),
      })),
  }))

  return c.json({ success: true, data })
})

// ═════════════════════════════════════════════════════════════════════════════
// Lab Base Services CRUD (consumed by the Services module's Lab tab)
// Endpoints live under /api/labs/base-services for backend cohesion; the
// frontend route group hits these from the Services UI.
// ═════════════════════════════════════════════════════════════════════════════

labsApp.get('/base-services', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }
  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db.query.labBaseServices.findMany({
    with: { category: true, scope: true },
    orderBy: [asc(labBaseServices.name)],
  })
  return c.json({ success: true, data: rows })
})

// Creating a lab base service is admin-only — it adds a billable entry to the
// price catalog. Everyone else proposes edits to existing ones via PATCH below.
labsApp.post('/base-services', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await isAdmin(c, user.id))) {
    return c.json({ error: 'Only an administrator can create a lab base service.' }, 403)
  }
  const body = await c.req.json()
  if (!body.name?.trim()) return c.json({ error: 'name required' }, 400)
  const unitType = ['per_tooth', 'per_arch', 'per_case'].includes(body.unitType)
    ? body.unitType
    : 'per_case'
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [row] = await db
      .insert(labBaseServices)
      .values({
        name: body.name.trim(),
        categoryId: body.categoryId ?? null,
        scopeId: body.scopeId ?? null,
        unitType,
        standardTurnaroundDays:
          body.standardTurnaroundDays == null ? 7 : Number(body.standardTurnaroundDays),
        notes: body.notes ?? null,
        isActive: body.isActive ?? true,
      })
      .returning()
    return c.json({ success: true, data: row })
  } catch (err: unknown) {
    const pgErr = err as { code?: string; message?: string }
    if (pgErr.code === '23505') return c.json({ error: 'Service name already exists' }, 409)
    throw err
  }
})

// Admin edits apply immediately. Doctors and receptionists instead file a
// change request for admin review — the same flow regular services use, and the
// reason this is gated on `services:update` rather than `labs:update`: the
// proposer is changing the price catalog, not managing a lab case.
labsApp.patch('/base-services/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const id = c.req.param('id')
  const body = await c.req.json()
  const db = getDb(process.env.DATABASE_URL!)

  if (!(await isAdmin(c, user.id))) {
    if (!(await checkPermission(c, user.id, MODULES.SERVICES as string, ACTIONS.UPDATE as string)))
      return c.json({ error: 'Unauthorized' }, 403)

    const [existing] = await db
      .select()
      .from(labBaseServices)
      .where(eq(labBaseServices.id, id))
      .limit(1)
    if (!existing) return c.json({ error: 'Not found' }, 404)

    const requestType =
      body.isActive === false
        ? 'deactivate'
        : body.isActive === true && !existing.isActive
          ? 'activate'
          : 'update'

    const [request] = await db
      .insert(serviceChangeRequests)
      .values({
        labBaseServiceId: id,
        requestedById: user.id,
        requestType,
        currentValue: {
          name: existing.name,
          standardTurnaroundDays: existing.standardTurnaroundDays,
          isActive: existing.isActive,
        },
        requestedValue: {
          name: body.name ?? existing.name,
          standardTurnaroundDays: body.standardTurnaroundDays ?? existing.standardTurnaroundDays,
          isActive: body.isActive ?? existing.isActive,
        },
        status: 'pending',
        createdAt: new Date(),
      })
      .returning()

    return c.json({ success: true, data: request, pendingReview: true }, 202)
  }

  const updates: any = { updatedAt: new Date() }
  for (const k of [
    'name',
    'categoryId',
    'scopeId',
    'unitType',
    'standardTurnaroundDays',
    'notes',
    'isActive',
  ]) {
    if (body[k] !== undefined) updates[k] = body[k]
  }
  try {
    const [row] = await db
      .update(labBaseServices)
      .set(updates)
      .where(eq(labBaseServices.id, id))
      .returning()
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json({ success: true, data: row })
  } catch (err: unknown) {
    const pgErr = err as { code?: string; message?: string }
    if (pgErr.code === '23505') return c.json({ error: 'Service name already exists' }, 409)
    throw err
  }
})

// Removing a catalog entry is at least as consequential as adding one — admin only.
labsApp.delete('/base-services/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await isAdmin(c, user.id))) {
    return c.json({ error: 'Only an administrator can delete a lab base service.' }, 403)
  }
  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db.delete(labBaseServices).where(eq(labBaseServices.id, id)).returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true })
})

// ═════════════════════════════════════════════════════════════════════════════
// Lab service categories CRUD (consumed by Services module's Lab tab)
// ═════════════════════════════════════════════════════════════════════════════

labsApp.post('/categories', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.CREATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }
  const body = await c.req.json()
  if (!body.name?.trim()) return c.json({ error: 'name required' }, 400)
  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [row] = await db
      .insert(labServiceCategories)
      .values({ name: body.name.trim(), isActive: body.isActive ?? true })
      .returning()
    return c.json({ success: true, data: row })
  } catch (err: unknown) {
    const pgErr = err as { code?: string; message?: string }
    if (pgErr.code === '23505') return c.json({ error: 'Category name already exists' }, 409)
    return c.json({ error: 'Failed to create category' }, 500)
  }
})

labsApp.patch('/categories/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.UPDATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }
  const id = c.req.param('id')
  const body = await c.req.json()
  const db = getDb(process.env.DATABASE_URL!)
  const updates: any = { updatedAt: new Date() }
  if (body.name !== undefined) updates.name = body.name
  if (body.isActive !== undefined) updates.isActive = body.isActive
  try {
    const [row] = await db
      .update(labServiceCategories)
      .set(updates)
      .where(eq(labServiceCategories.id, id))
      .returning()
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json({ success: true, data: row })
  } catch (err: unknown) {
    const pgErr = err as { code?: string; message?: string }
    if (pgErr.code === '23505') return c.json({ error: 'Category name already exists' }, 409)
    return c.json({ error: 'Failed to update category' }, 500)
  }
})

labsApp.delete('/categories/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.DELETE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }
  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .delete(labServiceCategories)
    .where(eq(labServiceCategories.id, id))
    .returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true })
})

// ═════════════════════════════════════════════════════════════════════════════
// Cases
// ═════════════════════════════════════════════════════════════════════════════

async function generateCaseNumber(db: any): Promise<string> {
  const latest = await db.query.labCases.findFirst({
    orderBy: desc(labCases.createdAt),
  })
  let next = 1
  if (latest?.caseNumber) {
    const m = latest.caseNumber.match(/LC-(\d+)/)
    if (m) next = parseInt(m[1], 10) + 1
  }
  return `LC-${next.toString().padStart(6, '0')}`
}

// §8.2 — lab-case list search/filter + pagination, extracted so it's testable
// against a real DB (the route parses params, gates auth, runs the lazy fallback).
export interface LabCaseSearchOpts {
  status?: string
  vendorId?: string
  patientId?: string
  assignedTechnicianId?: string
  domain?: string
  referringDoctorId?: string
  /** Restrict to cases handled by an in-house (type='internal') vendor. The Team
   *  app is in-house only; external lab work is monitored from the portal. */
  internalOnly?: boolean
  q?: string
  limit?: number
  offset?: number
}

export async function searchLabCases(db: DB, opts: LabCaseSearchOpts) {
  const limit = Number.isFinite(opts.limit) ? Math.min(Math.max(opts.limit as number, 1), 200) : 50
  const offset = opts.offset && opts.offset > 0 ? opts.offset : 0

  const conditions: SQL[] = []
  if (opts.status) conditions.push(eq(labCases.status, opts.status))
  if (opts.vendorId) conditions.push(eq(labCases.vendorId, opts.vendorId))
  if (opts.internalOnly) {
    // In-house = cases whose vendor is internal. Empty list → inArray emits
    // `false`, so no cases leak when there is no internal vendor.
    const internalVendors = await db
      .select({ id: labVendors.id })
      .from(labVendors)
      .where(eq(labVendors.type, 'internal'))
    conditions.push(
      inArray(
        labCases.vendorId,
        internalVendors.map((v) => v.id)
      )
    )
  }
  if (opts.patientId) conditions.push(eq(labCases.patientId, opts.patientId))
  if (opts.assignedTechnicianId)
    conditions.push(eq(labCases.assignedTechnicianId, opts.assignedTechnicianId))
  if (opts.domain === 'internal' || opts.domain === 'external')
    conditions.push(eq(labCases.domain, opts.domain))
  if (opts.referringDoctorId)
    conditions.push(eq(labCases.referringDoctorId, opts.referringDoctorId))
  if (opts.q) {
    // search by case number OR patient name (subquery)
    const byName = inArray(
      labCases.patientId,
      db
        .select({ id: patients.id })
        .from(patients)
        .where(ilike(patients.name, `%${opts.q}%`))
    )
    const match = or(ilike(labCases.caseNumber, `%${opts.q}%`), byName)
    if (match) conditions.push(match)
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined

  const [rows, totalRows] = await Promise.all([
    db.query.labCases.findMany({
      where,
      with: { patient: true, vendor: true },
      orderBy: [desc(labCases.createdAt)],
      limit,
      offset,
    }),
    db.select({ n: count() }).from(labCases).where(where),
  ])
  return { data: rows, total: totalRows[0]?.n ?? 0, limit, offset }
}

labsApp.get('/cases', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  // The Team app (X-App-Id: pwa) is the in-house lab surface — scope it to
  // internal-vendor cases regardless of query params. The portal sees all.
  const internalOnly = c.req.header('X-App-Id') === 'pwa'
  // §8.2 — server-side pagination + search on top of the existing filters.
  const result = await searchLabCases(db, {
    status: c.req.query('status'),
    vendorId: c.req.query('vendorId'),
    patientId: c.req.query('patientId'),
    assignedTechnicianId: c.req.query('assignedTechnicianId'),
    domain: c.req.query('domain'),
    referringDoctorId: c.req.query('referringDoctorId'),
    internalOnly,
    q: c.req.query('q')?.trim(),
    limit: Number.parseInt(c.req.query('limit') || '50', 10),
    offset: Number.parseInt(c.req.query('offset') || '0', 10),
  })

  // Lazy 2-week fallback: cases older than 14 days with labCost>0 and no
  // expenseReadyAt get backfilled here so the next read shows them as ready.
  await applyTwoWeekFallback(db, result.data as any)

  return c.json({ success: true, ...result })
})

// GET /cases/expense-ready — cases with expenseReadyAt set and not yet cleared
// (no externalExpenseId yet). Used by the daily report "Lab Expenses to Record"
// section.
labsApp.get('/cases/expense-ready', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)

  // First sweep: apply the 2-week fallback so any newly-due cases surface.
  const all = await db.query.labCases.findMany({
    where: isNull(labCases.expenseReadyAt),
    columns: { id: true, createdAt: true, labCost: true, cost: true, expenseReadyAt: true },
    limit: 1000,
  })
  await applyTwoWeekFallback(db, all as any)

  // Now fetch all cases that are ready but not yet expensed.
  const rows = await db.query.labCases.findMany({
    where: and(isNotNull(labCases.expenseReadyAt), isNull(labCases.externalExpenseId)),
    with: { patient: true, vendor: true },
    orderBy: [asc(labCases.expenseReadyAt)],
    limit: 500,
  })

  return c.json({ success: true, data: rows })
})

labsApp.get('/cases/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')
  const caseRow = await db.query.labCases.findFirst({
    where: eq(labCases.id, id),
    with: { patient: true, vendor: true },
  })
  if (!caseRow) return c.json({ error: 'Not found' }, 404)

  const photos = await db
    .select()
    .from(labCasePhotos)
    .where(eq(labCasePhotos.labCaseId, id))
    .orderBy(desc(labCasePhotos.uploadedAt))

  return c.json({ success: true, data: { ...caseRow, photos } })
})

// POST /cases — create case, auto-expense if external vendor
labsApp.post('/cases', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.CREATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  try {
    const body = await c.req.json()
    if (!body.vendorId || !body.serviceId) {
      return c.json({ error: 'vendorId, serviceId required' }, 400)
    }

    const domain = body.domain === 'external' ? 'external' : 'internal'

    // Domain-specific validation: internal needs a real patient; external needs a
    // referring doctor + a free-text patient name (no patient row created).
    if (domain === 'internal' && !body.patientId) {
      return c.json({ error: 'Internal lab cases require patientId' }, 400)
    }
    if (domain === 'external' && !body.referringDoctorId) {
      return c.json({ error: 'External lab cases require referringDoctorId' }, 400)
    }
    if (domain === 'external' && !body.externalPatientName?.trim()) {
      return c.json({ error: 'External lab cases require externalPatientName' }, 400)
    }

    const db = getDb(process.env.DATABASE_URL!)

    // Resolve vendor service + its base + selected express option.
    const vendorService = await db.query.labServices.findFirst({
      where: and(eq(labServices.id, body.serviceId), eq(labServices.vendorId, body.vendorId)),
      with: { vendor: true, baseService: { with: { scope: true } }, expressOptions: true },
    })
    if (!vendorService) return c.json({ error: 'Invalid vendorId/serviceId pairing' }, 400)
    if (!vendorService.vendor.active) {
      return c.json({ error: 'Vendor is inactive' }, 400)
    }

    // Express option (optional). When set it overrides per-unit pricing +
    // turnaround for this case.
    let expressOption: { id: string; cost: number; turnaroundDays: number } | null = null
    if (body.expressOptionId) {
      const found = vendorService.expressOptions.find((o) => o.id === body.expressOptionId)
      if (!found) return c.json({ error: 'Invalid expressOptionId for this service' }, 400)
      expressOption = {
        id: found.id,
        cost: Number(found.cost),
        turnaroundDays: found.turnaroundDays,
      }
    }

    // Units: array of { label, cost }. If client didn't send any, fall back to
    // a single { label: '—', cost: regular/express price } so we always have a
    // breakdown stored.
    const fallbackUnitPrice = expressOption?.cost ?? Number(vendorService.regularCost ?? 0)
    const inputUnits: Array<{ label?: string; cost?: number }> = Array.isArray(body.units)
      ? body.units
      : [
          {
            label:
              (vendorService.baseService.scope?.name ?? vendorService.baseService.unitType) ===
                'arch' || vendorService.baseService.unitType === 'per_arch'
                ? 'Arch'
                : 'Unit',
            cost: fallbackUnitPrice,
          },
        ]
    const units = inputUnits.map((u, i) => ({
      label: (u.label ?? `Unit ${i + 1}`).toString(),
      cost: Number(u.cost ?? fallbackUnitPrice),
    }))
    const labCost = units.reduce((s, u) => s + (Number.isFinite(u.cost) ? u.cost : 0), 0)

    // patientCharge:
    //  internal → defaults to labCost, receptionist can override on the form.
    //  external → ALWAYS equals labCost (no markup).
    const patientCharge = domain === 'external' ? labCost : Number(body.patientCharge ?? labCost)

    // Auto-compute expectedReturn from turnaround if the client didn't send one.
    // The final fallback is Settings → Clinical → Charting Preferences
    // (`defaultLabTurnaroundDays`, settings-domain-audit S5-B).
    const turnaroundDays = resolveTurnaroundDays(
      [
        expressOption?.turnaroundDays,
        vendorService.regularTurnaroundDays,
        vendorService.baseService.standardTurnaroundDays,
      ],
      await getDefaultLabTurnaroundDays(db)
    )
    const expectedReturn = body.expectedReturn
      ? new Date(body.expectedReturn)
      : new Date(Date.now() + turnaroundDays * 24 * 60 * 60 * 1000)

    const caseNumber = await generateCaseNumber(db)
    const [caseRow] = await db
      .insert(labCases)
      .values({
        caseNumber,
        patientId: domain === 'internal' ? body.patientId : null,
        vendorId: body.vendorId,
        serviceId: body.serviceId,
        serviceName: vendorService.baseService.name,
        status: body.status ?? 'draft',
        domain,
        expressOptionId: expressOption?.id ?? null,
        units,
        labCost,
        patientCharge,
        referringDoctorId: domain === 'external' ? body.referringDoctorId : null,
        externalPatientName: domain === 'external' ? body.externalPatientName.trim() : null,
        sentAt: body.sentAt ? new Date(body.sentAt) : null,
        expectedReturn,
        // Mirror labCost into legacy `cost` so older readers / external-expense
        // auto-creation still see the same value.
        cost: labCost,
        assignedDoctorId: body.assignedDoctorId ?? null,
        assignedTechnicianId: body.assignedTechnicianId ?? null,
        createdById: user.id,
        notes: body.notes ?? null,
      })
      .returning()

    // Auto-create the billing invoice for this case.
    //   Internal  → patient-billed   (Phase 2)
    //   External  → specialist-billed (Phase 3)
    // The payment-threshold check (in payment-service) sets expenseReadyAt
    // once cumulative payments cover labCost, regardless of debtor type.
    if ((caseRow.patientCharge ?? 0) > 0) {
      try {
        if (domain === 'internal' && body.patientId) {
          const { invoiceId } = await createInternalLabInvoice(db, {
            labCaseId: caseRow.id,
            caseNumber: caseRow.caseNumber,
            patientId: body.patientId,
            serviceName: caseRow.serviceName,
            patientCharge: caseRow.patientCharge ?? 0,
            createdBy: user.id,
            assignedDoctorId: body.assignedDoctorId ?? null,
          })
          caseRow.invoiceId = invoiceId
        } else if (domain === 'external' && body.referringDoctorId && body.externalPatientName) {
          const { invoiceId } = await createExternalLabInvoice(db, {
            labCaseId: caseRow.id,
            caseNumber: caseRow.caseNumber,
            referringDoctorId: body.referringDoctorId,
            externalPatientName: body.externalPatientName.trim(),
            serviceName: caseRow.serviceName,
            patientCharge: caseRow.patientCharge ?? 0,
            createdBy: user.id,
            assignedDoctorId: body.assignedDoctorId ?? null,
          })
          caseRow.invoiceId = invoiceId
        }
      } catch (err: unknown) {
        logError(err, { context: '[labs] auto-invoice failed' })
        // Non-fatal — case stays created; receptionist can re-issue manually.
      }
    }

    // v2: auto-create a follow-up reminder dated at expectedReturn. Internal
    // cases target the patient ("Check on lab + update patient"); external
    // cases target the referring doctor. Non-fatal — case stays created.
    try {
      const reminderDate = caseRow.expectedReturn ?? new Date()
      const isExternal = caseRow.domain === 'external'
      const targetName = isExternal ? 'referring doctor' : caseRow.patientId ? 'patient' : 'contact'
      await db.insert(patientReminders).values({
        patientId: isExternal ? undefined : caseRow.patientId,
        targetType: isExternal ? 'specialist' : 'patient',
        targetSpecialistId: isExternal ? caseRow.referringDoctorId : undefined,
        title: `Lab case ${caseRow.caseNumber}: check completion + update ${targetName}`,
        notes: `${caseRow.serviceName} · expected return ${reminderDate.toISOString().slice(0, 10)}`,
        reminderDate,
        status: 'pending',
        createdById: user.id,
      })
    } catch (err: unknown) {
      logError(err, { context: '[labs] follow-up reminder failed' })
    }

    await createAuditLog(db, {
      userId: user.id,
      action: 'create',
      module: 'labs',
      entityId: caseRow.id,
      entityName: `Lab case ${caseRow.caseNumber}`,
      changes: body,
    })

    return c.json({ success: true, data: caseRow })
  } catch (err: unknown) {
    logError(err, { context: '[labs POST /cases]' })
    const pgErr = err as { code?: string; message?: string }
    return c.json({ error: pgErr.message || 'Failed to create lab case' }, 500)
  }
})

labsApp.patch('/cases/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.UPDATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const body = await c.req.json()
  const db = getDb(process.env.DATABASE_URL!)

  const updates: any = { updatedAt: new Date() }
  for (const k of [
    'status',
    'expressOptionId',
    'patientCharge',
    'cost',
    'assignedDoctorId',
    'assignedTechnicianId',
    'notes',
    'externalPatientName',
    'referringDoctorId',
    'delayReason',
  ]) {
    if (body[k] !== undefined) updates[k] = body[k]
  }
  // Recompute labCost from units if the caller updated the breakdown.
  if (Array.isArray(body.units)) {
    const units = body.units.map((u: any, i: number) => ({
      label: (u.label ?? `Unit ${i + 1}`).toString(),
      cost: Number(u.cost ?? 0),
    }))
    updates.units = units
    const total = units.reduce((s: number, u: any) => s + (Number.isFinite(u.cost) ? u.cost : 0), 0)
    updates.labCost = total
    updates.cost = total
  } else if (body.labCost !== undefined) {
    updates.labCost = Number(body.labCost)
    if (body.cost === undefined) updates.cost = Number(body.labCost)
  }
  for (const k of ['sentAt', 'expectedReturn', 'receivedAt', 'insertedAt', 'expenseReadyAt']) {
    if (body[k] !== undefined) updates[k] = body[k] ? new Date(body[k]) : null
  }

  // Auto-stamp status transitions
  if (body.status === 'sent' && !body.sentAt) updates.sentAt = new Date()
  if (body.status === 'received' && !body.receivedAt) updates.receivedAt = new Date()
  if (body.status === 'inserted' && !body.insertedAt) updates.insertedAt = new Date()

  // Capture previous status so we only enqueue a reminder on a real transition.
  const [prev] = await db
    .select({ status: labCases.status })
    .from(labCases)
    .where(eq(labCases.id, id))
    .limit(1)

  const [row] = await db.update(labCases).set(updates).where(eq(labCases.id, id)).returning()
  if (!row) return c.json({ error: 'Not found' }, 404)

  // Phase 4: when the status changes to a milestone the receptionist usually
  // communicates outward, drop a pending reminder in the queue so they can
  // confirm or cancel before any SMS / call goes out. Internal cases → patient;
  // external cases → referring doctor. The title carries the real (admin-
  // configured) status label so the activities card reads clearly.
  const REMINDER_ACTIONS: Record<string, string> = {
    sent: 'Sent to the lab — keep the patient posted.',
    received: 'Back from the lab — book the patient for fitting.',
    ready_for_insertion: 'Ready — schedule the patient for fitting.',
    delayed: 'Delayed — let the patient know the new date.',
    cancelled: 'Cancelled — inform the patient.',
  }
  if (body.status && body.status !== prev?.status && REMINDER_ACTIONS[body.status as string]) {
    try {
      const [stage] = await db
        .select({ displayName: labCaseStatuses.displayName })
        .from(labCaseStatuses)
        .where(eq(labCaseStatuses.name, body.status as string))
        .limit(1)
      const statusLabel = stage?.displayName ?? (body.status as string)
      const title = `${row.caseNumber} · ${row.serviceName} → ${statusLabel}`
      const action = REMINDER_ACTIONS[body.status as string]
      const isExternal = row.domain === 'external'
      const notes =
        body.status === 'delayed' && row.delayReason
          ? `${action} Reason: ${row.delayReason}`
          : action
      await db.insert(patientReminders).values({
        patientId: isExternal ? undefined : row.patientId,
        targetType: isExternal ? 'specialist' : 'patient',
        targetSpecialistId: isExternal ? row.referringDoctorId : undefined,
        title,
        notes,
        reminderDate: new Date(),
        status: 'pending',
        createdById: user.id,
      })
    } catch (err: unknown) {
      logError(err, { context: '[labs] reminder enqueue failed' })
      // Non-fatal — case update succeeded.
    }
  }

  // Record the progress change for the status-history table (captures changes
  // from every surface — portal, Team app, HR — via X-App-Id as the source).
  if (body.status && body.status !== prev?.status) {
    try {
      await db.insert(labCaseStatusHistory).values({
        labCaseId: id,
        fromStatus: prev?.status ?? null,
        toStatus: body.status as string,
        changedById: user.id,
        source: c.req.header('X-App-Id') ?? null,
      })
    } catch (err: unknown) {
      logError(err, { context: '[labs] status-history insert failed' })
    }
  }

  await createAuditLog(db, {
    userId: user.id,
    action: 'update',
    module: 'labs',
    entityId: id,
    entityName: `Lab case ${row.caseNumber}`,
    changes: updates,
  })
  return c.json({ success: true, data: row })
})

// GET /cases/:id/status-history — paginated progress-change log (newest first),
// with the actor's name + role and the surface it came from.
labsApp.get('/cases/:id/status-history', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }
  const id = c.req.param('id')
  const limit = Math.min(50, Math.max(1, Number.parseInt(c.req.query('limit') || '8', 10)))
  const offset = Math.max(0, Number.parseInt(c.req.query('offset') || '0', 10))
  const db = getDb(process.env.DATABASE_URL!)
  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: labCaseStatusHistory.id,
        fromStatus: labCaseStatusHistory.fromStatus,
        toStatus: labCaseStatusHistory.toStatus,
        source: labCaseStatusHistory.source,
        createdAt: labCaseStatusHistory.createdAt,
        byName: userTable.name,
        byRole: userTable.roleId,
      })
      .from(labCaseStatusHistory)
      .leftJoin(userTable, eq(labCaseStatusHistory.changedById, userTable.id))
      .where(eq(labCaseStatusHistory.labCaseId, id))
      .orderBy(desc(labCaseStatusHistory.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ n: count() })
      .from(labCaseStatusHistory)
      .where(eq(labCaseStatusHistory.labCaseId, id)),
  ])
  return c.json({ success: true, data: rows, total: totalRows[0]?.n ?? 0 })
})

// POST /cases/:id/clear-expense — receptionist confirms paying the lab.
// Creates an expense record (status='paid' by default), links it to the case
// via externalExpenseId so it stops appearing in /cases/expense-ready, and
// returns the new expense for attachment to today's daily report.
labsApp.post('/cases/:id/clear-expense', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.UPDATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const db = getDb(process.env.DATABASE_URL!)

  const caseRow = await db.query.labCases.findFirst({
    where: eq(labCases.id, id),
    with: { vendor: true },
  })
  if (!caseRow) return c.json({ error: 'Not found' }, 404)
  if (caseRow.externalExpenseId) {
    return c.json({ error: 'Lab expense already cleared for this case' }, 400)
  }

  const amount = Number(body.amount ?? caseRow.labCost ?? caseRow.cost ?? 0)
  if (amount <= 0) return c.json({ error: 'Amount must be > 0' }, 400)

  const [expense] = await db
    .insert(expenses)
    .values({
      date: body.date ? new Date(body.date) : new Date(),
      category: 'lab_work',
      description: `Lab case ${caseRow.caseNumber} — ${caseRow.vendor?.name ?? 'Lab'}: ${caseRow.serviceName}`,
      amount,
      paidTo: caseRow.vendor?.name ?? 'Lab',
      paymentMethod: body.paymentMethod ?? null,
      status: 'paid',
      linkedEntityType: 'lab_case',
      linkedEntityId: caseRow.id,
      createdById: user.id,
    })
    .returning()

  await db
    .update(labCases)
    .set({ externalExpenseId: expense.id, updatedAt: new Date() })
    .where(eq(labCases.id, id))

  // Phase 4: put the lab fee on the books (best-effort; surfaces on the unposted
  // list if the 'lab_work' category isn't mapped to a GL account yet).
  try {
    await ensureExpensePosted(db, expense, user.id)
  } catch (glError) {
    logError(glError, { context: 'lab expense GL posting (non-fatal)' })
  }

  await createAuditLog(db, {
    userId: user.id,
    action: 'clear_lab_expense',
    module: 'labs',
    entityId: id,
    entityName: `Lab case ${caseRow.caseNumber}`,
    changes: { amount, paymentMethod: body.paymentMethod, expenseId: expense.id },
  })

  return c.json({ success: true, data: { expense, caseId: id } })
})

labsApp.delete('/cases/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.DELETE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)

  const [caseRow] = await db.select().from(labCases).where(eq(labCases.id, id)).limit(1)
  if (!caseRow) return c.json({ error: 'Not found' }, 404)

  // §8.4: if a lab expense was recorded for this case, reverse it (in its original
  // month) + remove it BEFORE deleting the case, so no orphan expense / GL entry is
  // left. A closed month blocks the delete.
  if (caseRow.externalExpenseId) {
    try {
      await reverseExpenseGL(db, caseRow.externalExpenseId, user.id)
    } catch (glErr) {
      const msg = String((glErr as Error)?.message ?? glErr).toLowerCase()
      // ONLY a genuine closed-period error should block the delete. An
      // already-reversed / no-live-entry error means the GL needs no further
      // reversal — proceed so the delete isn't permanently wedged.
      if (msg.includes('closed') || msg.includes('period')) {
        logError(glErr, { context: 'lab case delete: reversal blocked (closed period)' })
        return c.json(
          {
            error:
              'This case has a recorded lab expense in a closed accounting month. Reopen the month or remove the expense first.',
          },
          409
        )
      }
      logError(glErr, { context: 'lab case delete: reversal skipped (non-blocking)' })
    }
    await db.delete(expenses).where(eq(expenses.id, caseRow.externalExpenseId))
  }

  await db.delete(labCases).where(eq(labCases.id, id))
  return c.json({ success: true })
})

// ═════════════════════════════════════════════════════════════════════════════
// Photos
// ═════════════════════════════════════════════════════════════════════════════

labsApp.post('/cases/:id/photos', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.UPDATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const labCaseId = c.req.param('id')
  const body = await c.req.json()
  if (!body.photoUrl || !body.photoType)
    return c.json({ error: 'photoUrl, photoType required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .insert(labCasePhotos)
    .values({
      labCaseId,
      photoUrl: body.photoUrl,
      photoType: body.photoType,
      notes: body.notes ?? null,
      uploadedById: user.id,
    })
    .returning()

  return c.json({ success: true, data: row })
})

labsApp.delete('/photos/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.UPDATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  await db.delete(labCasePhotos).where(eq(labCasePhotos.id, id))
  return c.json({ success: true })
})

// ═════════════════════════════════════════════════════════════════════════════
// Phase 2 — per-status patient-update SMS
// ═════════════════════════════════════════════════════════════════════════════

function labFirstName(name?: string | null): string {
  return name?.trim()?.split(/\s+/)[0] || 'there'
}

function labFmtDate(d: string | Date | null | undefined): string {
  if (!d) return 'TBD'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return 'TBD'
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function renderLabTemplate(
  tpl: string,
  vars: { firstName: string; service: string; expectedDate: string }
): string {
  return tpl
    .replace(/\{firstName\}/g, vars.firstName)
    .replace(/\{service\}/g, vars.service)
    .replace(/\{expectedDate\}/g, vars.expectedDate)
}

// Compose the per-status patient-update SMS for a case. Returns { noTemplate }
// when the target status has no template (e.g. Ordered) → no SMS is sent.
async function composeLabUpdateMessage(db: DB, caseId: string, statusName: string) {
  const row = await db.query.labCases.findFirst({
    where: eq(labCases.id, caseId),
    with: { patient: true },
  })
  if (!row) return { error: 'Case not found' as const }
  // Resolve the SMS body from the central CRM SMS Templates store by key
  // (`lab_status:<status>`). One edit there applies everywhere. An absent or
  // inactive template means this status sends no SMS (e.g. Ordered).
  const [stage] = await db
    .select({ messageTemplate: reminderTemplates.messageTemplate })
    .from(reminderTemplates)
    .where(
      and(
        eq(reminderTemplates.key, `lab_status:${statusName}`),
        eq(reminderTemplates.isActive, true)
      )
    )
    .limit(1)
  const patient = row.patient
    ? { id: row.patient.id, phone: row.patient.phone, doNotContact: row.patient.doNotContact }
    : null
  const tpl = stage?.messageTemplate?.trim()
  if (!tpl) return { noTemplate: true as const, patient }
  const message = renderLabTemplate(tpl, {
    firstName: labFirstName(row.patient?.name),
    service: row.serviceName ?? 'lab case',
    expectedDate: labFmtDate(row.expectedReturn),
  })
  return { message, patient }
}

// PATCH /case-statuses/:id — admin edits a stage's display config + SMS
// template. The canonical `name` (which billing keys off) is NOT editable.
// (GET /case-statuses is served by the pre-existing lookup route above.)
labsApp.patch('/case-statuses/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await isAdmin(c, user.id))) return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (typeof body.displayName === 'string' && body.displayName.trim())
    patch.displayName = body.displayName.trim()
  if (typeof body.color === 'string') patch.color = body.color
  if (typeof body.sortOrder === 'number') patch.sortOrder = body.sortOrder
  if (typeof body.isActive === 'boolean') patch.isActive = body.isActive
  // Empty string clears the template → no SMS for this status.
  if (typeof body.smsTemplate === 'string') patch.smsTemplate = body.smsTemplate.trim() || null

  const db = getDb(process.env.DATABASE_URL!)
  const [updated] = await db
    .update(labCaseStatuses)
    .set(patch)
    .where(eq(labCaseStatuses.id, id))
    .returning()
  if (!updated) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true, data: updated })
})

// GET /cases/:id/sms-preview?status=<name> — compose (do NOT send) so the tech
// can preview. `hasTemplate:false` when the status sends no SMS (e.g. Ordered).
labsApp.get('/cases/:id/sms-preview', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }
  const id = c.req.param('id')
  const status = c.req.query('status') ?? ''
  if (!status) return c.json({ error: 'status query param required' }, 400)
  const db = getDb(process.env.DATABASE_URL!)
  const composed = await composeLabUpdateMessage(db, id, status)
  if ('error' in composed) return c.json({ error: composed.error }, 404)
  return c.json({
    success: true,
    data: {
      hasTemplate: !('noTemplate' in composed),
      message: 'message' in composed ? composed.message : null,
      phone: composed.patient?.phone ?? null,
      doNotContact: composed.patient?.doNotContact ?? false,
      hasPhone: !!composed.patient?.phone,
    },
  })
})

// POST /cases/:id/notify-patient { status } — compose + send the per-status SMS.
labsApp.post('/cases/:id/notify-patient', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.LABS as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as { status?: unknown }
  const status = typeof body.status === 'string' ? body.status : ''
  if (!status) return c.json({ error: 'status required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const composed = await composeLabUpdateMessage(db, id, status)
  if ('error' in composed) return c.json({ error: composed.error }, 404)
  if ('noTemplate' in composed) return c.json({ error: 'No SMS template for this status' }, 400)
  if (!composed.patient?.phone) return c.json({ error: 'Patient has no phone number' }, 400)
  if (composed.patient.doNotContact)
    return c.json({ error: 'Patient is marked do-not-contact' }, 400)

  const res = await sendSMS(
    [{ phone: composed.patient.phone, message: composed.message, patientId: composed.patient.id }],
    undefined,
    'followup',
    user.id
  )
  if (!res.success) return c.json({ error: res.error || 'Failed to send SMS' }, 502)
  return c.json({ success: true, data: { message: composed.message } })
})

// §8.6 — re-export the digest aggregator so the orchestrator can wire it from
// either the route or the lib (the canonical source is lib/lab-summary.ts).
export { getLabDailySummary } from '../lib/lab-summary'

export { labsApp }
