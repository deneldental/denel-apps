import { and, count, desc, eq, gte, lte } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { auditLogs } from '../db/schema'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const auditLogsApp = new Hono<HonoEnv>()

auditLogsApp.get('/', async (c) => {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) return c.json({ error: 'Not authenticated' }, 401)

  // §19.1 — server-side filtering + pagination.
  const limitRaw = Number.parseInt(c.req.query('limit') || '50', 10)
  const offsetRaw = Number.parseInt(c.req.query('offset') || '0', 10)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 50
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0
  const entityId = c.req.query('entityId')
  const moduleParam = c.req.query('module')
  const action = c.req.query('action')
  const userId = c.req.query('userId')
  const from = c.req.query('from')
  const to = c.req.query('to')
  const db = getDb(process.env.DATABASE_URL!)

  try {
    // Authorise on the permission, not on the role name. `audit_logs:read` ships
    // in bundle_audit_read and bundle_settings_full, and admin still passes via
    // the engine's bypass — so this is the same access set, resolved the way
    // every other route resolves it and grantable without editing code.
    if (
      !(await checkPermission(
        c,
        currentUser.id,
        MODULES.AUDIT_LOGS as string,
        ACTIONS.READ as string
      ))
    ) {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    const conditions = []
    if (entityId) conditions.push(eq(auditLogs.entityId, entityId))
    if (moduleParam) conditions.push(eq(auditLogs.module, moduleParam))
    if (action) conditions.push(eq(auditLogs.action, action))
    if (userId) conditions.push(eq(auditLogs.userId, userId))
    if (from && !Number.isNaN(Date.parse(from)))
      conditions.push(gte(auditLogs.createdAt, new Date(from)))
    if (to && !Number.isNaN(Date.parse(to))) conditions.push(lte(auditLogs.createdAt, new Date(to)))
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const [logs, totalRows] = await Promise.all([
      db.query.auditLogs.findMany({
        where: whereClause,
        orderBy: [desc(auditLogs.createdAt)],
        limit,
        offset,
        with: { user: { columns: { id: true, name: true, email: true } } },
      }),
      db.select({ n: count() }).from(auditLogs).where(whereClause),
    ])

    return c.json({ success: true, data: logs, total: totalRows[0]?.n ?? 0, limit, offset })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

export { auditLogsApp }
