import type { Context } from 'hono'
import { getDb } from '../db'
import { createAuditLog } from './audit'
import { logError } from './logger'
import { getCurrentUser } from './rbac'
import type { HonoEnv } from './types'

/**
 * Manually audit a read against an analytics / report endpoint.
 *
 * Why: the global `auditMiddleware` only logs mutations (POST/PUT/PATCH/DELETE).
 * The /analytics/financial page is the source for the clinic's annual financial
 * reports (see project memory) — every chart fetch should leave a traceable
 * "who looked at what data for which period" trail. This helper provides that
 * trail without touching the global middleware.
 *
 * Usage from a Hono GET handler:
 *
 *   const u = await getCurrentUser(c)
 *   if (!u) return c.json({ error: 'Not authenticated' }, 401)
 *   await logAnalyticsAccess(c, 'monthly-trend', `year=${year}`)
 *
 * Logs are tagged `module='analytics'`, `action='analytics_read'`, `entityName`
 * = what they asked for. The `reason` column carries the period / filter.
 *
 * Failures are swallowed — auditing must never break the user-facing read.
 */
export async function logAnalyticsAccess(
  c: Context<HonoEnv>,
  what: string,
  reason?: string | null
): Promise<void> {
  try {
    const user = await getCurrentUser(c)
    if (!user) return
    const db = getDb(process.env.DATABASE_URL!)
    await createAuditLog(db, {
      userId: user.id,
      action: 'analytics_read',
      module: 'analytics',
      entityName: what,
      reason: reason ?? null,
      ipAddress: c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip') || null,
      userAgent: c.req.header('user-agent') || null,
    })
  } catch (err) {
    logError(err, { context: '[logAnalyticsAccess] failed' })
  }
}
