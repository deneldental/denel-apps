/**
 * Patient reminders — Phase 2.2
 * Custom per-patient reminders created manually by staff.
 */

import { and, asc, desc, eq, lte, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { patientReminders } from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const patientRemindersApp = new Hono<HonoEnv>()

// GET /api/patient-reminders — list all with optional filters
// Query: ?status=pending&dueBefore=YYYY-MM-DD&assignedToMe=true
patientRemindersApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, user.id, MODULES.APPOINTMENTS as string, ACTIONS.READ as string))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const status = c.req.query('status')
  const dueBefore = c.req.query('dueBefore')
  const assignedToMe = c.req.query('assignedToMe')
  const limit = Math.min(Math.max(1, Number(c.req.query('limit') ?? 100)), 500)
  const offset = Math.max(0, Number(c.req.query('offset') ?? 0))

  const conditions: any[] = []
  if (status) conditions.push(eq(patientReminders.status, status))
  if (dueBefore) conditions.push(lte(patientReminders.reminderDate, new Date(dueBefore)))
  if (assignedToMe === 'true') conditions.push(eq(patientReminders.assignedToId, user.id))

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const [rows, totalRow] = await Promise.all([
    db.query.patientReminders.findMany({
      where,
      with: { patient: true, targetSpecialist: true },
      orderBy: [asc(patientReminders.reminderDate)],
      limit,
      offset,
    }),
    db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(patientReminders)
      .where(where),
  ])

  return c.json({ success: true, data: rows, total: totalRow[0]?.count ?? 0 })
})

// GET /api/patient-reminders/patient/:patientId
patientRemindersApp.get('/patient/:patientId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, user.id, MODULES.APPOINTMENTS as string, ACTIONS.READ as string))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const patientId = c.req.param('patientId')

  const rows = await db
    .select()
    .from(patientReminders)
    .where(eq(patientReminders.patientId, patientId))
    .orderBy(desc(patientReminders.reminderDate))
  return c.json({ success: true, data: rows })
})

// POST /api/patient-reminders
patientRemindersApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, user.id, MODULES.APPOINTMENTS as string, ACTIONS.CREATE as string))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const body = await c.req.json()
  if (!body.title || !body.reminderDate) {
    return c.json({ error: 'title, reminderDate required' }, 400)
  }

  // Polymorphic target: either patient (default) or specialist (lab-update
  // queue for external cases). Validate the matching id is present.
  const targetType: 'patient' | 'specialist' =
    body.targetType === 'specialist' ? 'specialist' : 'patient'
  if (targetType === 'patient' && !body.patientId) {
    return c.json({ error: 'patientId required for patient-targeted reminders' }, 400)
  }
  if (targetType === 'specialist' && !body.targetSpecialistId) {
    return c.json({ error: 'targetSpecialistId required for specialist-targeted reminders' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const [row] = await db
      .insert(patientReminders)
      .values({
        patientId: targetType === 'patient' ? body.patientId : null,
        targetType,
        targetSpecialistId: targetType === 'specialist' ? body.targetSpecialistId : null,
        title: body.title,
        notes: body.notes ?? null,
        reminderDate: new Date(body.reminderDate),
        assignedToId: body.assignedToId ?? null,
        status: 'pending',
        createdById: user.id,
      })
      .returning()

    await createAuditLog(db, {
      userId: user.id,
      action: 'create',
      module: 'appointments',
      entityId: row.id,
      entityName: `Reminder: ${body.title}`,
      changes: body,
    })

    return c.json({ success: true, data: row })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// PATCH /api/patient-reminders/:id
patientRemindersApp.patch('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, user.id, MODULES.APPOINTMENTS as string, ACTIONS.UPDATE as string))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const body = await c.req.json()
  const db = getDb(process.env.DATABASE_URL!)

  const updates: any = { updatedAt: new Date() }
  if (body.title !== undefined) updates.title = body.title
  if (body.notes !== undefined) updates.notes = body.notes
  if (body.reminderDate !== undefined) updates.reminderDate = new Date(body.reminderDate)
  if (body.assignedToId !== undefined) updates.assignedToId = body.assignedToId
  if (body.status !== undefined) {
    updates.status = body.status
    if (body.status === 'completed') {
      updates.completedAt = new Date()
      updates.completedById = user.id
      if (body.completionNotes !== undefined) updates.completionNotes = body.completionNotes
    }
  }

  try {
    const [row] = await db
      .update(patientReminders)
      .set(updates)
      .where(eq(patientReminders.id, id))
      .returning()
    if (!row) return c.json({ error: 'Not found' }, 404)

    await createAuditLog(db, {
      userId: user.id,
      action: 'update',
      module: 'appointments',
      entityId: id,
      entityName: `Reminder: ${row.title}`,
      changes: updates,
    })

    return c.json({ success: true, data: row })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

// DELETE /api/patient-reminders/:id
patientRemindersApp.delete('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, user.id, MODULES.APPOINTMENTS as string, ACTIONS.DELETE as string))
  ) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const [row] = await db.delete(patientReminders).where(eq(patientReminders.id, id)).returning()
    if (!row) return c.json({ error: 'Not found' }, 404)

    await createAuditLog(db, {
      userId: user.id,
      action: 'delete',
      module: 'appointments',
      entityId: id,
      entityName: `Reminder: ${row.title}`,
    })

    return c.json({ success: true })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

export { patientRemindersApp }
