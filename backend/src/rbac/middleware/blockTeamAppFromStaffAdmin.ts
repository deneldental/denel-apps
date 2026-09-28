/**
 * blockTeamAppFromStaffAdmin — the staff-administration APIs refuse the Team app.
 *
 * /api/staff, /api/hr, /api/hr3 and /api/payroll are the HR and payroll back
 * office: every staff member's records, attendance, reviews, requests, training
 * and pay. They serve the portal and the HR app. The Team app never calls them
 * — a staff member's own payslips, requests, training and attendance live under
 * /api/staff-portal, scoped to the caller — yet nothing stopped a Team-app
 * session from calling them, and the Team bundle's old grants (payroll:read,
 * staff_performance:read, …) passed their permission checks.
 *
 * This is the second layer behind narrowing that bundle: whatever a Team-app
 * role is granted in future, these APIs stay off-limits to it.
 *
 * Gated on `resolveAppScope` — the same resolution `enforceInterfaceScope` and
 * `checkPermission` use — so a request is never judged as one app here and as
 * another there. Declaring a different X-App-Id does not help a Team session:
 * the session cookie, the scope gate and the permission matrix all follow the
 * same resolution, and none of them grant it anything outside the Team app.
 */

import type { MiddlewareHandler } from 'hono'
import { logWarn } from '../../lib/logger'
import type { HonoEnv } from '../../lib/types'
import { resolveAppScope } from './detectInterface'

export const STAFF_ADMIN_API_PREFIXES = ['/api/staff', '/api/hr', '/api/hr3', '/api/payroll']

/** True for the prefix itself and anything under it — not for /api/staff-portal. */
export function isStaffAdminApiPath(path: string): boolean {
  return STAFF_ADMIN_API_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))
}

export function blockTeamAppFromStaffAdmin(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    if (!isStaffAdminApiPath(c.req.path)) return next()
    if (resolveAppScope(c) !== 'pwa') return next()

    logWarn('[team-app] refused a staff-administration API call', {
      method: c.req.method,
      path: c.req.path,
    })
    return c.json(
      {
        error: 'Not available in the Team app',
        detail: 'Staff administration and payroll are only available in the portal and the HR app.',
      },
      403
    )
  }
}
