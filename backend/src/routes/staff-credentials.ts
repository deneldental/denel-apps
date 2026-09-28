/**
 * Staff Credentials — Phase 7.4
 * Tracks licenses + certifications with configurable expiry reminders.
 */

import { asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { staffCredentials } from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const staffCredentialsApp = new Hono<HonoEnv>()

// GET /api/staff-credentials — all (admin) or filter by staffId
staffCredentialsApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.STAFF as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const staffId = c.req.query('staffId')
  const rows = staffId
    ? await db
        .select()
        .from(staffCredentials)
        .where(eq(staffCredentials.staffId, staffId))
        .orderBy(asc(staffCredentials.expiryDate))
    : await db.select().from(staffCredentials).orderBy(asc(staffCredentials.expiryDate))
  return c.json({ success: true, data: rows })
})

// GET /api/staff-credentials/expiring — list credentials within reminder window
staffCredentialsApp.get('/expiring', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.STAFF as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const all = await db.select().from(staffCredentials)
  const now = new Date()

  const expiring = all.filter((c) => {
    if (!c.reminderEnabled || !c.expiryDate) return false
    const expiry = new Date(c.expiryDate)
    const daysBefore = c.reminderDaysBefore ?? 30
    const windowStart = new Date(expiry)
    windowStart.setDate(windowStart.getDate() - daysBefore)
    return now >= windowStart
  })

  return c.json({ success: true, data: expiring })
})

staffCredentialsApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.STAFF as string, ACTIONS.CREATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const body = await c.req.json()
  if (!body.staffId || !body.credentialType || !body.credentialName) {
    return c.json({ error: 'staffId, credentialType, credentialName required' }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .insert(staffCredentials)
    .values({
      staffId: body.staffId,
      credentialType: body.credentialType,
      credentialName: body.credentialName,
      issuingBody: body.issuingBody ?? null,
      issueDate: body.issueDate ? new Date(body.issueDate) : null,
      expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
      documentUrl: body.documentUrl ?? null,
      notes: body.notes ?? null,
      reminderDaysBefore: body.reminderDaysBefore ?? null,
      reminderEnabled: body.reminderEnabled ?? true,
      createdById: user.id,
    })
    .returning()

  await createAuditLog(db, {
    userId: user.id,
    action: 'create',
    module: 'staff',
    entityId: row.id,
    entityName: `Credential: ${row.credentialName}`,
    changes: body,
  })
  return c.json({ success: true, data: row })
})

staffCredentialsApp.patch('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.STAFF as string, ACTIONS.UPDATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const body = await c.req.json()
  const db = getDb(process.env.DATABASE_URL!)

  const updates: any = { updatedAt: new Date() }
  for (const k of [
    'credentialType',
    'credentialName',
    'issuingBody',
    'documentUrl',
    'notes',
    'reminderDaysBefore',
    'reminderEnabled',
  ]) {
    if (body[k] !== undefined) updates[k] = body[k]
  }
  if (body.issueDate !== undefined)
    updates.issueDate = body.issueDate ? new Date(body.issueDate) : null
  if (body.expiryDate !== undefined)
    updates.expiryDate = body.expiryDate ? new Date(body.expiryDate) : null

  const [row] = await db
    .update(staffCredentials)
    .set(updates)
    .where(eq(staffCredentials.id, id))
    .returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true, data: row })
})

staffCredentialsApp.delete('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.STAFF as string, ACTIONS.DELETE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db.delete(staffCredentials).where(eq(staffCredentials.id, id)).returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true })
})

export { staffCredentialsApp }
