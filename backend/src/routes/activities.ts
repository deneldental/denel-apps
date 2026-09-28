/**
 * Activities — admin-v1 §1.1. Mark dashboard/CRM action items done + read the
 * paginated Completed history. The write path is shared by the dashboard and the
 * reminders/CRM surfaces (§3.3 / §13.1). Authenticated staff only.
 */

import { Hono } from 'hono'
import { getDb } from '../db'
import {
  ACTIVITY_TYPES,
  listCompletions,
  recordCompletion,
  removeCompletion,
} from '../lib/activity-completions-service'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

export const activitiesApp = new Hono<HonoEnv>()

// POST /complete — mark an activity item done (idempotent per item)
activitiesApp.post('/complete', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const body = (await c.req.json().catch(() => ({}))) as {
    activityType?: string
    refId?: string
    label?: string
  }
  if (!body.activityType || !ACTIVITY_TYPES.includes(body.activityType as never)) {
    return c.json({ error: 'valid activityType required' }, 400)
  }
  const db = getDb(process.env.DATABASE_URL!)
  const row = await recordCompletion(db, {
    activityType: body.activityType,
    refId: body.refId ?? null,
    label: body.label ?? null,
    completedById: user.id,
  })
  return c.json({ success: true, data: row })
})

// GET /completed — paginated completed history
activitiesApp.get('/completed', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const db = getDb(process.env.DATABASE_URL!)
  const result = await listCompletions(db, {
    limit: Number.parseInt(c.req.query('limit') || '25', 10),
    offset: Number.parseInt(c.req.query('offset') || '0', 10),
    activityType: c.req.query('activityType'),
  })
  return c.json({ success: true, ...result })
})

// DELETE /completed/:id — undo a completion (returns the item to Pending)
activitiesApp.delete('/completed/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PATIENTS, ACTIONS.DELETE)))
    return c.json({ error: 'Unauthorized' }, 403)
  const db = getDb(process.env.DATABASE_URL!)
  const row = await removeCompletion(db, c.req.param('id'))
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true })
})
