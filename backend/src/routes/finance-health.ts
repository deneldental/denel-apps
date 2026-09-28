/**
 * /api/finance-health — sub-ledger reconciliation health check.
 *
 * Admin-only. Returns a list of control accounts whose GL balance disagrees
 * with the matching sub-ledger. An empty list is the success state.
 */

import { Hono } from 'hono'
import { getDb } from '../db'
import { getCurrentUser, isAdmin } from '../lib/rbac'
import { findUnbalancedEntries, runHealthCheck } from '../lib/reconciliation'
import type { HonoEnv } from '../lib/types'

const financeHealthApp = new Hono<HonoEnv>()

financeHealthApp.get('/', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await isAdmin(c, user.id))) return c.json({ error: 'Admin only' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const [report, unbalanced] = await Promise.all([runHealthCheck(db), findUnbalancedEntries(db)])
  return c.json({
    success: true,
    data: {
      ...report,
      unbalancedEntries: unbalanced,
      ok: report.ok && unbalanced.length === 0,
    },
  })
})

export { financeHealthApp }
