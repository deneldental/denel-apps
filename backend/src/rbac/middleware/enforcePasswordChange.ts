/**
 * enforcePasswordChange — a signed-in person who must choose a new password can do
 * nothing else until they have (F20 / decision D8).
 *
 * The portal and the HR app send such a session to their change-password screen. That
 * is the convenience; this is the control. Without it the screen is only a redirect a
 * browser can skip, and the admin-known password would stay good for every API call.
 *
 * Scope: the portal and the HR app (`resolveAppScope`), the two apps D8 names and the
 * two that have the screen. The Team app is deliberately NOT covered, and must not be: it has
 * no password at all (staff sign in with their phone number and an SMS code, see
 * routes/staff-auth.ts), so there is nothing for it to change and enforcing the rule there
 * would lock every Team-app user out with no screen to get back in. Decided by the owner on
 * 2026-10-26 (D18: leave it).
 *
 * What stays reachable: everything under /api/auth except Better Auth's admin
 * endpoints (the session read, the password change itself, sign-out, the permissions
 * the app mounts with, and the sign-in / reset endpoints a person with a stale cookie
 * needs), and the session-less public routes the CSRF layer already lists. Better Auth's
 * `/api/auth/admin/*` act on OTHER people and stay behind the change.
 *
 * Runs after `enforceInterfaceScope`, which has already resolved the session, so the
 * lookup below is the per-request memo, not a second query.
 */

import type { MiddlewareHandler } from 'hono'
import { isCsrfBypassPath } from '../../lib/csrf'
import { getCurrentUser } from '../../lib/rbac'
import type { HonoEnv } from '../../lib/types'
import { resolveAppScope } from './detectInterface'

/** The `code` the apps match on. */
export const PASSWORD_CHANGE_REQUIRED = 'PASSWORD_CHANGE_REQUIRED'

const ENFORCED_SCOPES = new Set(['portal', 'hr'])

function isExempt(path: string): boolean {
  if (path.startsWith('/api/auth/admin/')) return false
  // Session-less by design: Better Auth's own routes, health, the CSRF token, token
  // links and webhooks. Device-token routes authenticate themselves.
  return isCsrfBypassPath(path) || path === '/api/kiosk' || path.startsWith('/api/kiosk/')
}

export function enforcePasswordChange(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    if (c.req.method === 'OPTIONS') return next()
    if (!ENFORCED_SCOPES.has(resolveAppScope(c))) return next()
    if (isExempt(c.req.path)) return next()

    const user = await getCurrentUser(c)
    if (!user?.mustChangePassword) return next()

    return c.json(
      {
        error: 'You must choose a new password before you can continue.',
        code: PASSWORD_CHANGE_REQUIRED,
      },
      403
    )
  }
}
