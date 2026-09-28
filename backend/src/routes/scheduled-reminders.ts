import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import { scheduledReminders } from '../db/schema'
import { createAuditLog, recordDiffAudit } from '../lib/audit'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const scheduledRemindersApp = new Hono<HonoEnv>()

/**
 * Minimal 5-field cron validator (minute hour day-of-month month day-of-week).
 * Accepts: digits, `*`, ranges `a-b`, lists `a,b`, steps `*\/n` or `a-b/n`.
 * Rejects everything else. Good enough to catch typos at save time; the worker
 * that actually executes these still needs a real cron parser at run time.
 */
function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const fieldRe = /^(\*|(\*\/\d+)|(\d+(-\d+)?(\/\d+)?)(,\d+(-\d+)?(\/\d+)?)*)$/
  return parts.every((p) => fieldRe.test(p))
}

// GET /api/scheduled-reminders
scheduledRemindersApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.MESSAGING as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const db = getDb(process.env.DATABASE_URL!)
    // Eager-load patient + template so the table on the Scheduled Reminders
    // page can render `patient.name` / `template.name` without a second
    // round-trip per row. Without these joins the frontend's nested-shape
    // expectation (`r.patient.name`, `r.template.name`) silently rendered
    // empty cells for every reminder.
    const data = await db.query.scheduledReminders.findMany({
      with: {
        patient: { columns: { id: true, name: true, patientId: true } },
        template: { columns: { id: true, name: true } },
      },
      orderBy: (r, { desc: descOp }) => [descOp(r.createdAt)],
    })
    return c.json({ success: true, data })
  } catch (error) {
    logError(error, { route: 'scheduled-reminders.list', userId: user.id })
    return c.json({ error: 'Failed to list reminders', code: 'REMINDERS_LIST_FAILED' }, 500)
  }
})

// POST /api/scheduled-reminders
scheduledRemindersApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.MESSAGING as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const body = await c.req.json()

  if (body.cronExpression && !isValidCron(String(body.cronExpression))) {
    return c.json({ error: 'Invalid cron expression', code: 'INVALID_CRON' }, 400)
  }

  try {
    c.set('skipAudit', true)
    const [reminder] = await db
      .insert(scheduledReminders)
      .values({
        name: body.name,
        type: body.type,
        triggerType: body.triggerType,
        triggerOffsetHours: body.triggerOffsetHours ?? null,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
        cronExpression: body.cronExpression ?? null,
        messageTemplate: body.messageTemplate,
        isActive: body.isActive ?? true,
        // Persist the patient/template FKs the frontend sends. Without these
        // the table rows render "—" for Patient + Template because the join
        // has nothing to match on. Status falls back to the column default
        // ('pending') but the client may send 'pending' explicitly.
        status: body.status ?? 'pending',
        patientId: body.patientId ?? null,
        templateId: body.templateId ?? null,
        createdById: user.id,
      })
      .returning()

    await createAuditLog(db, {
      userId: user.id,
      action: 'create',
      module: MODULES.MESSAGING as string,
      entityId: reminder.id,
      entityName: `Reminder "${reminder.name}"`,
      afterJson: reminder,
    })

    return c.json({ success: true, data: reminder })
  } catch (error) {
    logError(error, { route: 'scheduled-reminders.create', userId: user.id })
    return c.json({ error: 'Failed to create reminder', code: 'REMINDER_CREATE_FAILED' }, 500)
  }
})

// PATCH /api/scheduled-reminders/:id
/**
 * Fields a caller may edit on a scheduled reminder.
 *
 * Deliberately excluded (system-owned, not caller-owned):
 *   `lastRunAt`     — stamped by the scheduler
 *   `confirmedAt`, `confirmedById` — owned by the POST /:id/confirm route; a
 *                     client that could set them would self-confirm a reminder
 *                     that requires review before it sends
 *   `id`, `createdById`, `createdAt`
 *   `updatedAt`     — stamped by the handler
 *
 * zod strips unknown keys, so only these reach `.set()`.
 */
const updateReminderSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    type: z.string().trim().min(1).optional(),
    triggerType: z.string().trim().min(1).optional(),
    triggerOffsetHours: z.number().int().nullish(),
    scheduledAt: z.coerce.date().nullish(),
    cronExpression: z.string().nullish(),
    messageTemplate: z.string().min(1).optional(), // NOT NULL
    isActive: z.boolean().optional(),
    status: z.string().trim().min(1).optional(),
    patientId: z.string().uuid().nullish(),
    templateId: z.string().uuid().nullish(),
    requiresConfirmation: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Supply at least one updatable field',
  })

scheduledRemindersApp.patch('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.MESSAGING as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const parsed = updateReminderSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
  }
  const body = parsed.data

  if (body.cronExpression && !isValidCron(String(body.cronExpression))) {
    return c.json({ error: 'Invalid cron expression', code: 'INVALID_CRON' }, 400)
  }

  try {
    c.set('skipAudit', true)
    const [existing] = await db
      .select()
      .from(scheduledReminders)
      .where(eq(scheduledReminders.id, id))
      .limit(1)
    if (!existing) return c.json({ error: 'Not found' }, 404)

    const [updated] = await db
      .update(scheduledReminders)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(scheduledReminders.id, id))
      .returning()

    await recordDiffAudit(db, {
      userId: user.id,
      action: 'update',
      module: MODULES.MESSAGING as string,
      entityId: id,
      entityName: `Reminder "${updated.name}"`,
      before: existing,
      after: updated,
    })

    return c.json({ success: true, data: updated })
  } catch (error) {
    logError(error, { route: 'scheduled-reminders.update', userId: user.id, reminderId: id })
    return c.json({ error: 'Failed to update reminder', code: 'REMINDER_UPDATE_FAILED' }, 500)
  }
})

// POST /api/scheduled-reminders/:id/confirm — §13.2: a staff member approves a
// queued (requiresConfirmation) send, which lets the scheduler dispatch it.
scheduledRemindersApp.post('/:id/confirm', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.MESSAGING as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)

  try {
    c.set('skipAudit', true)
    const [existing] = await db
      .select()
      .from(scheduledReminders)
      .where(eq(scheduledReminders.id, id))
      .limit(1)
    if (!existing) return c.json({ error: 'Not found' }, 404)
    if (existing.confirmedAt) return c.json({ success: true, data: existing }) // idempotent

    const [updated] = await db
      .update(scheduledReminders)
      .set({ confirmedAt: new Date(), confirmedById: user.id, updatedAt: new Date() })
      .where(eq(scheduledReminders.id, id))
      .returning()

    await createAuditLog(db, {
      userId: user.id,
      action: 'confirm',
      module: MODULES.MESSAGING as string,
      entityId: id,
      entityName: `Reminder "${updated.name}"`,
      afterJson: updated,
    })

    return c.json({ success: true, data: updated })
  } catch (error) {
    logError(error, { route: 'scheduled-reminders.confirm', userId: user.id, reminderId: id })
    return c.json({ error: 'Failed to confirm reminder', code: 'REMINDER_CONFIRM_FAILED' }, 500)
  }
})

// DELETE /api/scheduled-reminders/:id
scheduledRemindersApp.delete('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.MESSAGING as string, ACTIONS.DELETE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)

  try {
    c.set('skipAudit', true)
    const [existing] = await db
      .select()
      .from(scheduledReminders)
      .where(eq(scheduledReminders.id, id))
      .limit(1)
    if (!existing) return c.json({ error: 'Not found' }, 404)

    await db.delete(scheduledReminders).where(eq(scheduledReminders.id, id))

    await recordDiffAudit(db, {
      userId: user.id,
      action: 'delete',
      module: MODULES.MESSAGING as string,
      entityId: id,
      entityName: `Reminder "${existing.name}"`,
      before: existing,
      after: null,
    })

    return c.json({ success: true })
  } catch (error) {
    logError(error, { route: 'scheduled-reminders.delete', userId: user.id, reminderId: id })
    return c.json({ error: 'Failed to delete reminder', code: 'REMINDER_DELETE_FAILED' }, 500)
  }
})

export { scheduledRemindersApp }
