/**
 * /api/periods — Accounting period management.
 *
 * GET / and GET /:id are gated by periods:read. POST /close and POST /reopen
 * require periods:update. Reopening is an admin-only audited action.
 */

import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db'
import { accountingPeriods } from '../db/schema'
import { recordDiffAudit } from '../lib/audit'
import { postUnpostedInRange } from '../lib/expense-service'
import { ACTIONS, MODULES } from '../lib/modules'
import {
  closePeriod,
  countEntriesInPeriod,
  getOrCreatePeriodFor,
  listPeriods,
  reopenPeriod,
} from '../lib/period-service'
import { checkPermission, getCurrentUser, isAdmin } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const periodsApp = new Hono<HonoEnv>()

const createSchema = z.object({
  forDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
})

// ── GET /api/periods ─────────────────────────────────────────────────────────
periodsApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PERIODS as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }
  const db = getDb(process.env.DATABASE_URL!)
  const data = await listPeriods(db)
  return c.json({ success: true, data })
})

// ── GET /api/periods/:id ─────────────────────────────────────────────────────
periodsApp.get('/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PERIODS as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }
  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')
  const data = await db.query.accountingPeriods.findFirst({ where: eq(accountingPeriods.id, id) })
  if (!data) return c.json({ error: 'Not found' }, 404)
  const entryCount = await countEntriesInPeriod(db, id)
  return c.json({ success: true, data: { ...data, entryCount } })
})

// ── POST /api/periods — ensure the period for a date exists ──────────────────
periodsApp.post('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PERIODS as string, ACTIONS.CREATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }
  const parsed = createSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: 'Invalid input', issues: parsed.error.issues }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const period = await getOrCreatePeriodFor(db, new Date(parsed.data.forDate))
  return c.json({ success: true, data: period }, 201)
})

// ── POST /api/periods/:id/close ──────────────────────────────────────────────
periodsApp.post('/:id/close', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PERIODS as string, ACTIONS.UPDATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')
  const before = await db.query.accountingPeriods.findFirst({ where: eq(accountingPeriods.id, id) })
  if (!before) return c.json({ error: 'Not found' }, 404)
  if (before.status === 'closed') return c.json({ success: true, data: before })

  const updated = await closePeriod(db, id, user.id)
  await recordDiffAudit(db, {
    userId: user.id,
    action: 'update',
    module: 'periods',
    entityId: id,
    entityName: `Period ${before.name}`,
    before,
    after: updated,
    reason: 'Period closed',
  })
  return c.json({ success: true, data: updated })
})

// ── POST /api/periods/:id/reopen (admin) ─────────────────────────────────────
periodsApp.post('/:id/reopen', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await isAdmin(c, user.id))) {
    return c.json({ error: 'Admin only' }, 403)
  }
  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')
  const before = await db.query.accountingPeriods.findFirst({ where: eq(accountingPeriods.id, id) })
  if (!before) return c.json({ error: 'Not found' }, 404)

  const updated = await reopenPeriod(db, id)

  // Phase 4: now that the month is open again, file any expenses that were stamped
  // but couldn't post while it was closed. Best-effort; failures stay on /unposted.
  try {
    const start = new Date(before.startDate)
    const end = new Date(before.endDate)
    end.setHours(23, 59, 59, 999)
    await postUnpostedInRange(db, start, end, user.id)
  } catch {
    // sweep is best-effort; the unposted list still surfaces anything left
  }

  await recordDiffAudit(db, {
    userId: user.id,
    action: 'update',
    module: 'periods',
    entityId: id,
    entityName: `Period ${before.name}`,
    before,
    after: updated,
    reason: 'Period reopened by admin',
  })
  return c.json({ success: true, data: updated })
})

export { periodsApp }
