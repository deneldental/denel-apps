import { addDays, addMonths, addWeeks } from 'date-fns'
import { and, asc, eq, lte } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import { recarePlans } from '../db/schema'
import { recordCompletion } from '../lib/activity-completions-service'
import { createAuditLog, recordDiffAudit } from '../lib/audit'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import { denyUnless } from '../lib/route-access'
import type { HonoEnv } from '../lib/types'

// Client-settable fields for PATCH /api/recare/:id
// Excluded (server-owned): id, createdAt, updatedAt, createdById,
//   completedAt, completedById, nextAlertDate, lastAlertDate
const recarePatchSchema = z.object({
  scopeType: z.enum(['treatment', 'service', 'patient']).optional(),
  treatmentTypeId: z.string().uuid().nullish(),
  serviceId: z.string().uuid().nullish(),
  durationValue: z.number().int().positive().optional(),
  durationUnit: z.enum(['days', 'weeks', 'months']).optional(),
  recurrence: z.enum(['one_time', 'recurring']).optional(),
  templateId: z.string().uuid().nullish(),
  customMessage: z.string().nullish(),
  isActive: z.boolean().optional(),
  status: z.enum(['pending', 'alerted', 'completed', 'dismissed']).optional(),
  notes: z.string().nullish(),
})

export const recareApp = new Hono<HonoEnv>()

// `recare` labels the audit-log rows, but it is NOT a seeded permission —
// PERMISSION_DEFINITIONS has no `recare` module, so `recare:*` resolves to
// false for every non-admin and these routes were admin-only in practice.
// Authorise on `patients` instead, matching the sibling CRM endpoints
// (/api/crm/recare-due, /api/crm/follow-ups) that read the same rows.
const MODULE = MODULES.RECARE
const PERM_MODULE = MODULES.PATIENTS

function computeNextAlertDate(from: Date, value: number, unit: 'days' | 'weeks' | 'months'): Date {
  if (unit === 'days') return addDays(from, value)
  if (unit === 'weeks') return addWeeks(from, value)
  return addMonths(from, value)
}

// ── GET /api/recare — list plans ──────────────────────────────────────────────
recareApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, PERM_MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const { status, treatmentTypeId, serviceId, patientId, dueWithinDays } = c.req.query()

  try {
    const conditions = []
    if (status) conditions.push(eq(recarePlans.status, status))
    if (treatmentTypeId) conditions.push(eq(recarePlans.treatmentTypeId, treatmentTypeId))
    if (serviceId) conditions.push(eq(recarePlans.serviceId, serviceId))
    if (patientId) conditions.push(eq(recarePlans.patientId, patientId))
    if (dueWithinDays) {
      const cutoff = addDays(new Date(), Number(dueWithinDays))
      conditions.push(lte(recarePlans.nextAlertDate, cutoff))
    }

    const data = await db.query.recarePlans.findMany({
      where: conditions.length ? and(...conditions) : undefined,
      orderBy: [asc(recarePlans.nextAlertDate)],
      with: {
        patient: { columns: { id: true, name: true } },
        treatmentType: { columns: { id: true, name: true, displayName: true } },
        service: { columns: { id: true, name: true } },
      },
    })

    return c.json({ success: true, data })
  } catch (error) {
    logError(error, { route: 'recare.list', userId: user.id })
    return c.json({ error: 'Failed to fetch recare plans', code: 'RECARE_LIST_FAILED' }, 500)
  }
})

// ── GET /api/recare/patient/:patientId — plans for one patient ────────────────
recareApp.get('/patient/:patientId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, PERM_MODULE, ACTIONS.READ)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const patientId = c.req.param('patientId')

  try {
    const data = await db.query.recarePlans.findMany({
      where: eq(recarePlans.patientId, patientId),
      orderBy: [asc(recarePlans.nextAlertDate)],
      with: {
        patient: { columns: { id: true, name: true } },
        treatmentType: { columns: { id: true, name: true, displayName: true } },
        service: { columns: { id: true, name: true } },
      },
    })
    return c.json({ success: true, data })
  } catch (error) {
    logError(error, { route: 'recare.byPatient', userId: user.id, patientId })
    return c.json({ error: 'Failed to fetch recare plans', code: 'RECARE_LIST_FAILED' }, 500)
  }
})

// ── POST /api/recare — create plan ────────────────────────────────────────────
recareApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, PERM_MODULE, ACTIONS.CREATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const body = await c.req.json()
  const {
    patientId,
    scopeType,
    treatmentTypeId,
    serviceId,
    durationValue,
    durationUnit,
    recurrence,
    templateId,
    customMessage,
    isActive,
    notes,
  } = body

  if (!patientId || !scopeType || !durationValue || !durationUnit || !recurrence) {
    return c.json(
      { error: 'patientId, scopeType, durationValue, durationUnit, recurrence are required' },
      400
    )
  }

  if (scopeType === 'treatment' && !treatmentTypeId) {
    return c.json({ error: 'treatmentTypeId required when scopeType is treatment' }, 400)
  }
  if (scopeType === 'service' && !serviceId) {
    return c.json({ error: 'serviceId required when scopeType is service' }, 400)
  }

  const nextAlertDate = computeNextAlertDate(new Date(), Number(durationValue), durationUnit)

  try {
    c.set('skipAudit', true)
    const now = new Date()
    const [created] = await db
      .insert(recarePlans)
      .values({
        patientId,
        scopeType,
        treatmentTypeId: scopeType === 'treatment' ? (treatmentTypeId ?? null) : null,
        serviceId: scopeType === 'service' ? (serviceId ?? null) : null,
        durationValue: Number(durationValue),
        durationUnit,
        recurrence,
        nextAlertDate,
        templateId: templateId ?? null,
        customMessage: customMessage ?? null,
        isActive: isActive ?? true,
        status: 'pending',
        createdById: user.id,
        notes: notes ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    await createAuditLog(db, {
      userId: user.id,
      action: 'create',
      module: MODULE,
      entityId: created.id,
      entityName: `Recare plan (${created.scopeType})`,
      afterJson: created,
    })

    return c.json({ success: true, data: created }, 201)
  } catch (error) {
    logError(error, { route: 'recare.create', userId: user.id })
    return c.json({ error: 'Failed to create recare plan', code: 'RECARE_CREATE_FAILED' }, 500)
  }
})

// ── PATCH /api/recare/:id — update plan ──────────────────────────────────────
recareApp.patch('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, PERM_MODULE, ACTIONS.UPDATE)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')

  const parsed = recarePatchSchema.safeParse(await c.req.json())
  if (!parsed.success)
    return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
  const body = parsed.data

  try {
    c.set('skipAudit', true)
    const [existing] = await db.select().from(recarePlans).where(eq(recarePlans.id, id))
    if (!existing) return c.json({ error: 'Recare plan not found' }, 404)

    const updates: Partial<typeof recarePlans.$inferInsert> = { ...body, updatedAt: new Date() }

    // If completing, stamp completedAt and recalculate next alert for recurring
    if (body.status === 'completed' && existing.status !== 'completed') {
      updates.completedAt = new Date()
      updates.completedById = user.id
      if (existing.recurrence === 'recurring') {
        updates.nextAlertDate = computeNextAlertDate(
          new Date(),
          existing.durationValue,
          existing.durationUnit as 'days' | 'weeks' | 'months'
        )
        updates.lastAlertDate = new Date()
        updates.status = 'pending'
      }
    }

    const [updated] = await db
      .update(recarePlans)
      .set(updates)
      .where(eq(recarePlans.id, id))
      .returning()

    // §13.1 — unify recare completion into the activity_completions log (idempotent
    // per plan), so a completion from ANY surface lands in the Completed tab.
    if (body.status === 'completed' && existing.status !== 'completed') {
      await recordCompletion(db, {
        activityType: 'recare',
        refId: id,
        completedById: user.id,
      }).catch((e) => logError(e, { route: 'recare.completion-log', planId: id }))
    }

    await recordDiffAudit(db, {
      userId: user.id,
      action: 'update',
      module: MODULE,
      entityId: id,
      entityName: `Recare plan (${updated.scopeType})`,
      before: existing,
      after: updated,
    })

    return c.json({ success: true, data: updated })
  } catch (error) {
    logError(error, { route: 'recare.update', userId: user.id, planId: id })
    return c.json({ error: 'Failed to update recare plan', code: 'RECARE_UPDATE_FAILED' }, 500)
  }
})

// ── DELETE /api/recare/:id — admin hard delete ────────────────────────────────
recareApp.delete('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (user.roleId !== 'admin') return c.json({ error: 'Admin only' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')

  try {
    c.set('skipAudit', true)
    const [existing] = await db.select().from(recarePlans).where(eq(recarePlans.id, id))
    if (!existing) return c.json({ error: 'Recare plan not found' }, 404)

    await db.delete(recarePlans).where(eq(recarePlans.id, id))

    await recordDiffAudit(db, {
      userId: user.id,
      action: 'delete',
      module: MODULE,
      entityId: id,
      entityName: `Recare plan (${existing.scopeType})`,
      before: existing,
      after: null,
    })

    return c.json({ success: true })
  } catch (error) {
    logError(error, { route: 'recare.delete', userId: user.id, planId: id })
    return c.json({ error: 'Failed to delete recare plan', code: 'RECARE_DELETE_FAILED' }, 500)
  }
})

// ── POST /api/recare/auto-from-record — called when medical record is saved ───
// Checks if the treatment type has an active treatment-scope recare plan template
// and creates a patient-specific alert if needed.
recareApp.post('/auto-from-record', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const denied = await denyUnless(c, user.id, {
    apps: ['portal'],
    anyOf: [
      [MODULES.RECARE, ACTIONS.CREATE],
      [MODULES.MEDICAL_RECORDS, ACTIONS.CREATE],
    ],
  })
  if (denied) return denied

  const db = getDb(process.env.DATABASE_URL!)
  const { patientId, treatmentTypeId } = await c.req.json()

  if (!patientId || !treatmentTypeId) {
    return c.json({ error: 'patientId and treatmentTypeId required' }, 400)
  }

  try {
    // Find active treatment-scope recare config for this treatment type
    const templates = await db
      .select()
      .from(recarePlans)
      .where(
        and(
          eq(recarePlans.scopeType, 'treatment'),
          eq(recarePlans.treatmentTypeId, treatmentTypeId),
          eq(recarePlans.isActive, true)
        )
      )

    if (templates.length === 0) return c.json({ success: true, created: 0 })

    const now = new Date()
    const created = []
    for (const tmpl of templates) {
      const nextAlertDate = computeNextAlertDate(
        now,
        tmpl.durationValue,
        tmpl.durationUnit as 'days' | 'weeks' | 'months'
      )
      const [plan] = await db
        .insert(recarePlans)
        .values({
          patientId,
          scopeType: 'patient',
          treatmentTypeId,
          durationValue: tmpl.durationValue,
          durationUnit: tmpl.durationUnit,
          recurrence: tmpl.recurrence,
          nextAlertDate,
          templateId: tmpl.templateId,
          customMessage: tmpl.customMessage,
          isActive: true,
          status: 'pending',
          createdById: user.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
      created.push(plan)
    }

    return c.json({ success: true, created: created.length, data: created })
  } catch (error) {
    logError(error, { route: 'recare.auto-from-record', userId: user.id })
    return c.json({ error: 'Failed to auto-create recare plan', code: 'RECARE_AUTO_FAILED' }, 500)
  }
})
