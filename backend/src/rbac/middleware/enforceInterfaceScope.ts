/**
 * enforceInterfaceScope — global interface-scope guard (defense-in-depth).
 *
 * The frontends gate access by interface scope client-side (e.g. HR's
 * RequireHrAccess → /api/auth/scope-access). Several backend routes are shared
 * across apps (e.g. /api/staff and /api/payroll serve both the portal and the
 * HR app), so they can't be per-route guarded by a single scope. Per-module RBAC
 * (checkPermission) still protects the data, but the *interface scope* itself was
 * never enforced server-side.
 *
 * This middleware closes that gap. It runs after detectInterface() (which derives
 * c.var.interface from the unspoofable Origin header) and, for an authenticated
 * request coming from a KNOWN app interface, requires the user to hold that scope.
 * Requests from `unknown` origins (patient app, website, server-to-server) are
 * left alone, as are pre-auth / cross-app / device-authed routes.
 *
 * Rollout is controlled by SCOPE_ENFORCEMENT:
 *   off    — disabled (no-op)
 *   dryrun — log would-be violations, never block
 *   hr     — enforce only the HR interface (minimal blast radius)
 *   all    — enforce portal + pwa + hr  ← DEFAULT
 *
 * The default was 'dryrun', and SCOPE_ENFORCEMENT was set in no env file, no CI
 * workflow and no service config — so interface scope was never enforced
 * anywhere, in any environment. Role scope grants are now the mechanism that
 * keeps doctors and admins out of the Team app, so the default has to be
 * fail-closed. Set SCOPE_ENFORCEMENT=dryrun in Doppler to soften it during a
 * staged rollout.
 *
 * Requests that cannot be attributed to an interface no longer pass through
 * ungated — they resolve to 'portal' (see `resolveAppScope`) and are gated as
 * portal, because that is the matrix their permissions will be resolved
 * against. Unauthenticated traffic is still untouched: with no session the
 * guard returns early and the route's own auth answers.
 *
 * The patient app is unaffected for a different reason — patient sessions are
 * not staff sessions, so `getCurrentUser` returns null for them and the guard
 * exits before any scope check.
 */

import type { MiddlewareHandler } from 'hono'
import { getDb } from '../../db'
import { recordAuthEvent } from '../../lib/auth-events'
import { logWarn } from '../../lib/logger'
import { getCurrentUser } from '../../lib/rbac'
import type { HonoEnv } from '../../lib/types'
import { PermissionEngine } from '../engine/PermissionEngine'
import { resolveAppScope } from './detectInterface'

type Mode = 'off' | 'dryrun' | 'hr' | 'all'

// Never scope-gate these: pre-auth (login/session/csrf), health, the public
// website-booking intake, and the kiosk device routes (their own token auth).
const BYPASS_PREFIXES = [
  '/api/auth',
  '/api/csrf',
  '/api/health',
  '/api/website-bookings',
  '/api/kiosk',
]

// Ending a session is never gated. Gating it creates a trap: a principal
// holding a session for an interface they lack the scope for gets 403 on every
// route INCLUDING logout, so the client cannot clear the credential it was
// just handed and the user is stuck until the session expires. Observed on
// /api/staff-auth/logout once SCOPE_ENFORCEMENT defaulted to 'all'.
//
// Safe to exempt: logout only ever destroys the caller's own session, so the
// worst a scope-less caller can do here is sign themselves out.
const ALWAYS_ALLOWED_PATHS = new Set(['/api/staff-auth/logout', '/api/patient-auth/logout'])

function readMode(): Mode {
  const v = (process.env.SCOPE_ENFORCEMENT ?? 'all').toLowerCase()
  return v === 'off' || v === 'dryrun' || v === 'hr' || v === 'all' ? v : 'all'
}

function isBypassed(path: string): boolean {
  if (ALWAYS_ALLOWED_PATHS.has(path)) return true
  return BYPASS_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))
}

export function enforceInterfaceScope(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const mode = readMode()
    if (mode === 'off') return next()

    // Gate on the scope the request will actually be RESOLVED against, not on
    // the Origin alone.
    //
    // This used to read `c.var.interface`, which comes only from the Origin
    // allow-list, and pass through anything that resolved to 'unknown'. But
    // `resolveAppScope` — the function `checkPermission` uses to pick the
    // permission matrix — falls back to the client-declared X-App-Id and then
    // defaults to 'portal'. So a caller who simply omitted Origin had their
    // permissions resolved against 'portal' while skipping this gate entirely:
    // the two disagreed, and the disagreement was the bypass.
    //
    // Using one function for both means you are always gated on the same scope
    // your permissions are resolved against, whichever signal supplied it.
    const iface = resolveAppScope(c)

    // In 'hr' mode, only the HR interface is enforced.
    if (mode === 'hr' && iface !== 'hr') return next()

    if (isBypassed(c.req.path)) return next()

    const user = await getCurrentUser(c)
    // No session: let the route's own auth answer with 401 — don't mask it as 403.
    if (!user) return next()

    const engine = new PermissionEngine(getDb(process.env.DATABASE_URL!))
    const hasAccess = await engine.checkScope(user.id, iface)
    if (hasAccess) return next()

    if (mode === 'dryrun') {
      logWarn('[scope] would block request (dry-run)', {
        userId: user.id,
        interface: iface,
        method: c.req.method,
        path: c.req.path,
      })
      return next()
    }

    recordAuthEvent({
      event: 'scope_denied',
      outcome: 'blocked',
      userId: user.id,
      reason: 'missing_interface_scope',
      appScope: iface,
      ipAddress: c.req.header('CF-Connecting-IP') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
      detail: { method: c.req.method, path: c.req.path },
    })

    return c.json(
      {
        error: 'Interface access not granted',
        detail: `Your account does not have ${iface} access.`,
      },
      403
    )
  }
}
