/**
 * checkPermission â€” Hono middleware factory
 *
 * Creates a middleware that checks if the authenticated user has the required
 * permission before the route handler runs.
 *
 * Requires verifySession() to have run first (attaches c.var.user).
 *
 * Usage in routes:
 *   app.get('/patients', verifySession(), checkPermission('patients', 'read'), handler)
 *   app.post('/patients', verifySession(), checkPermission('patients', 'create'), handler)
 *
 * On failure: returns 403 Forbidden.
 * On success: calls next().
 */

import type { MiddlewareHandler } from 'hono'
import { env } from '../../config/env'
import { getDb } from '../../db'
import type { HonoEnv } from '../../lib/types'
import { PermissionEngine } from '../engine/PermissionEngine'
import { resolveAppScope } from './detectInterface'

export function checkPermission(module: string, action: string): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const user = c.var.user
    if (!user) {
      return c.json({ error: 'Not authenticated' }, 401)
    }

    const db = getDb(env.DATABASE_URL)
    const engine = new PermissionEngine(db)
    // Same scope resolution as the route shim in lib/rbac.ts. Omitting this
    // argument silently resolved every check against the portal matrix, so
    // pwa-only roles (lab_technician) 403'd on their own screens.
    const allowed = await engine.check(user.id, module, action, resolveAppScope(c))

    if (!allowed) {
      return c.json({ error: `Insufficient permissions: ${module}:${action}` }, 403)
    }

    await next()
  }
}

/**
 * checkScope â€” middleware that enforces interface scope access.
 *
 * Use on routes that should only be accessible from a specific interface.
 * Most scope gating is handled globally by enforceInterfaceScope(); reach for
 * this only when a single route needs a scope its app does not normally carry.
 *
 * Usage:
 *   app.get('/admin/roles', verifySession(), checkScope('portal'), handler)
 */
export function checkScope(scope: 'portal' | 'pwa' | 'hr'): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const user = c.var.user
    if (!user) {
      return c.json({ error: 'Not authenticated' }, 401)
    }

    const db = getDb(env.DATABASE_URL)
    const engine = new PermissionEngine(db)
    const hasAccess = await engine.checkScope(user.id, scope)

    if (!hasAccess) {
      return c.json({ error: `Access to ${scope} interface not granted for your role` }, 403)
    }

    await next()
  }
}
