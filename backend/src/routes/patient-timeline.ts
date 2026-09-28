import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { patientTimeline } from '../db/schema'
import { writeTimeline } from '../lib/ledger-service'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const patientTimelineApp = new Hono<HonoEnv>()

// GET /api/patient-timeline/:patientId
patientTimelineApp.get('/:patientId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PATIENTS as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { patientId } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)

  const data = await db.query.patientTimeline.findMany({
    where: eq(patientTimeline.patientId, patientId),
    with: {
      createdBy: { columns: { id: true, name: true } },
    },
    orderBy: [desc(patientTimeline.createdAt)],
  })

  return c.json({ success: true, data })
})

// POST /api/patient-timeline/:patientId — manually add a note to timeline
patientTimelineApp.post('/:patientId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PATIENTS as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { patientId } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  const body = await c.req.json()

  if (!body.title) return c.json({ error: 'title required' }, 400)

  const entry = await writeTimeline(db, patientId, body.eventType || 'note', body.title, {
    referenceType: body.referenceType,
    referenceId: body.referenceId,
    description: body.description,
    amount: body.amount,
    createdById: user.id,
    createdAt: body.createdAt ? new Date(body.createdAt) : undefined,
  })

  return c.json({ success: true, data: entry })
})

export { patientTimelineApp }
