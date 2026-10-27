import { eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { env } from '../config/env'
import { getDb } from '../db'
import { appointmentTypeReminders } from '../db/schema'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const appointmentTypeRemindersApp = new Hono<HonoEnv>()
const MODULE = MODULES.APPOINTMENTS // Tie this to scheduling/appointments module permissions

/** `default` (the reminders every type falls back to) or the id of an appointment type. */
const TYPE_PARAM = /^(default|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

// GET /api/appointment-type-reminders/:appointmentTypeId
appointmentTypeRemindersApp.get('/:appointmentTypeId', async (c) => {
  try {
    const user = await getCurrentUser(c)
    if (!user) return c.json({ error: 'Not authenticated' }, 401)

    if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string))) {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    const appointmentTypeId = c.req.param('appointmentTypeId')
    // The column is a uuid: anything else used to reach the database and come back as a 500.
    if (!TYPE_PARAM.test(appointmentTypeId)) {
      return c.json({ error: 'Invalid appointment type id' }, 400)
    }
    const db = getDb(env.DATABASE_URL)

    const condition =
      appointmentTypeId === 'default'
        ? isNull(appointmentTypeReminders.appointmentTypeId)
        : eq(appointmentTypeReminders.appointmentTypeId, appointmentTypeId)

    const reminders = await db.query.appointmentTypeReminders.findMany({
      where: condition,
      with: {
        template: true,
      },
    })

    return c.json({ success: true, data: reminders })
  } catch (error: unknown) {
    // The detail goes to the log. The browser used to be sent the database's own message and the
    // server's stack trace (file paths and line numbers) with every failure.
    logError(error, { route: 'appointment-type-reminders.get', userId: 'unknown' })
    return c.json({ error: 'Failed to fetch appointment type reminders' }, 500)
  }
})

const updateRemindersSchema = z.object({
  reminders: z.array(
    z.object({
      triggerType: z.enum(['on_booking', 'before_appointment']),
      offsetHours: z.number().nullable().optional(),
      templateId: z.string().uuid(),
      isActive: z.boolean().default(true),
    })
  ),
})

// PUT /api/appointment-type-reminders/:appointmentTypeId
appointmentTypeRemindersApp.put('/:appointmentTypeId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const typeParam = c.req.param('appointmentTypeId')
  if (!TYPE_PARAM.test(typeParam)) return c.json({ error: 'Invalid appointment type id' }, 400)
  const isDefault = typeParam === 'default'
  const appointmentTypeId = isDefault ? null : typeParam

  try {
    const parseResult = updateRemindersSchema.safeParse(await c.req.json())
    if (!parseResult.success) {
      return c.json({ error: 'Invalid request body', issues: parseResult.error.issues }, 400)
    }

    const { reminders } = parseResult.data
    const db = getDb(process.env.DATABASE_URL!)

    // We do a full replacement of reminders for this type
    await db.transaction(async (tx) => {
      // 1. Delete existing
      const condition = isDefault
        ? isNull(appointmentTypeReminders.appointmentTypeId)
        : eq(appointmentTypeReminders.appointmentTypeId, typeParam)

      await tx.delete(appointmentTypeReminders).where(condition)

      // 2. Insert new ones
      if (reminders.length > 0) {
        const valuesToInsert = reminders.map((r) => ({
          appointmentTypeId: appointmentTypeId,
          triggerType: r.triggerType,
          offsetHours: r.offsetHours ?? null,
          templateId: r.templateId,
          isActive: r.isActive,
        }))
        await tx.insert(appointmentTypeReminders).values(valuesToInsert)
      }
    })

    return c.json({ success: true })
  } catch (error) {
    logError(error, { route: 'appointment-type-reminders.put', userId: user.id })
    return c.json({ error: 'Failed to save appointment type reminders' }, 500)
  }
})

export { appointmentTypeRemindersApp }
