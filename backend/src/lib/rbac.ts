// Compatibility shim used by route handlers.
// Routes call getCurrentUser(c) + checkPermission(c, userId, module, action).
// The new middleware pattern (verifySession + checkPermission middleware) in
// src/rbac/ will eventually replace this; this file bridges the gap.

import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { getAuth, resolveCookiePrefix } from '../auth'
import { getDb } from '../db'
import { user } from '../db/schema'
import { PermissionEngine } from '../rbac/engine/PermissionEngine'
import { resolveAppScope } from '../rbac/middleware/detectInterface'
import {
  credentialKey,
  invalidateSessionCache,
  readSessionCache,
  SESSION_CACHE_TTL_MS,
  writeSessionCache,
} from '../rbac/session-cache'
import { isAccountDisabled } from './account-sessions'
import { ROLES } from './modules'
import { getSessionStaff } from './staff-session'
import type { HonoEnv } from './types'

// Re-exported for the many call sites that already import it from here; the
// implementation now lives in ../rbac/session-cache so that src/auth.ts can
// reach it without an import cycle.
export { invalidateSessionCache }

export interface AuthUser {
  id: string
  email: string
  name: string
  role: string | null
  roleId: string | null
}

interface BetterAuthSessionUser {
  id: string
  email: string
  name: string
  role?: string | null
  roleId?: string | null
  // Added to `user` by the admin() plugin and returned on the session.
  banned?: boolean | null
  banExpires?: Date | string | null
}

/**
 * ─── Session resolution caching ────────────────────────────────────────────
 *
 * An authenticated request used to resolve the session at least twice — once in
 * the global `enforceInterfaceScope` guard and again in the route's own
 * `getCurrentUser` / `verifySession` — and each resolution is a Better Auth
 * session+user round trip. On the dev stack (remote Neon, ~140 ms/round trip)
 * that alone was ~300 ms of every request before any work was done.
 *
 * Two layers, both scoped to the credential presented:
 *
 *  1. Per-request memo (`requestMemo`) — a WeakMap keyed on the Request object,
 *     so it is freed with the request and can never be shared between requests.
 *     One HTTP request now performs exactly one session lookup. This layer has
 *     no security implications at all: the same request cannot observe a
 *     mid-flight revocation today either.
 *
 *  2. Cross-request memo (`sessionCache`, now in ../rbac/session-cache) — keyed
 *     on the exact credential the caller presented (every `*session*` cookie
 *     plus any Authorization header, hashed) AND on the cookie prefix that
 *     decides which of those cookies is the session, never on the user id, so
 *     one caller's entry can never be served to another. The prefix belongs in
 *     the key because `.deneldental.com` cookies mean a browser can present the
 *     portal's and the Team app's tokens on the same request, and only
 *     `X-App-Id` says which one counts. TTL is deliberately tiny:
 *     AUTH_SESSION_CACHE_TTL_MS, default 5,000 ms. Set it to 0 to disable the
 *     layer entirely.
 *
 *     SECURITY NOTE — layer 2 is now actively invalidated. Better Auth's
 *     `hooks.after` (see src/auth.ts) calls
 *     `invalidateSessionCacheForAuthPath(ctx.path)`, so sign-out and every other
 *     session-revoking or role-mutating auth endpoint clears the whole map
 *     before the response is returned. A revoked credential is therefore
 *     rejected on the very next request rather than after the TTL. The TTL now
 *     only bounds revocations that happen *outside* the Better Auth endpoints
 *     (a direct DB delete, say). Requests to /api/auth/* bypass layer 2
 *     outright, so `get-session` always reports the database's truth.
 *     Permission and role-grant changes still resolve through PermissionEngine,
 *     which has its own (also short) TTL.
 */
const requestMemo = new WeakMap<Request, Promise<AuthUser | null>>()

/** The uncached resolution — one staff-session probe, then Better Auth. */
async function resolveUser(c: Context<HonoEnv>): Promise<AuthUser | null> {
  try {
    const staffSession = await getSessionStaff(c)
    if (staffSession) {
      const su = staffSession.user
      return {
        id: su.id,
        email: su.email,
        name: su.name,
        role: su.role ?? null,
        roleId: su.roleId ?? null,
      }
    }

    const auth = getAuth(c)
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session?.user) return null
    const u = session.user as BetterAuthSessionUser

    // Better Auth enforces a ban when a session is CREATED, not when one is
    // read, so a ban landing on an account with a live session left that
    // session fully usable until it expired. `getSessionStaff` already applied
    // this rule to the custom stack; applying it here too is what makes
    // `isAccountDisabled` the single contract it claims to be — and it now
    // matters far more, because stages 2–3 moved every surface (portal, HR,
    // Team PWA, kiosk) onto exactly this branch.
    if (
      isAccountDisabled({
        banned: u.banned,
        banExpires: u.banExpires ? new Date(u.banExpires) : null,
      })
    ) {
      return null
    }

    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role ?? null,
      roleId: u.roleId ?? null,
    }
  } catch {
    return null
  }
}

/**
 * Resolve the authenticated user from the current session cookie. Dual-source:
 *   1. The custom staff (phone+OTP PWA) session — `staff_session` cookie.
 *   2. Better Auth — portal / HR / reports (email+password).
 * `getSessionStaff` returns null instantly (no DB hit) when the staff cookie is
 * absent, so portal/HR requests fall straight through to Better Auth.
 *
 * Memoised per request, then (briefly) per credential — see the block comment
 * above for the security envelope.
 */
export async function getCurrentUser(c: Context<HonoEnv>): Promise<AuthUser | null> {
  const req = c.req.raw
  const memoised = requestMemo.get(req)
  if (memoised) return memoised

  // Never let the cross-request layer answer for the auth endpoints themselves:
  // get-session / sign-out must always see the database.
  const useSharedCache = SESSION_CACHE_TTL_MS > 0 && !c.req.path.startsWith('/api/auth/')
  const key = useSharedCache ? credentialKey(req.headers, resolveCookiePrefix(c)) : null

  if (key) {
    const cached = readSessionCache(key)
    if (cached) {
      const settled = Promise.resolve(cached.user)
      requestMemo.set(req, settled)
      return settled
    }
  }

  const pending = resolveUser(c).then((user) => {
    if (key) writeSessionCache(key, user)
    return user
  })
  requestMemo.set(req, pending)
  return pending
}

/** Returns true if the user has the given module + action permission. */
export async function checkPermission(
  c: Context<HonoEnv>,
  userId: string,
  module: string,
  action: string
): Promise<boolean> {
  const db = getDb(process.env.DATABASE_URL!)
  const engine = new PermissionEngine(db)
  // Scope the check to the requesting surface. Without this, PWA-only roles
  // (e.g. lab_technician, whose grants live in a pwa-scoped bundle) would be
  // checked against portal grants they don't have and get a spurious 403.
  return engine.check(userId, module, action, resolveAppScope(c))
}

/**
 * The single definition of "is an admin" (L11).
 *
 * There were two. This module used `roleId === 'admin'`; `routes/auth.ts` used
 * `roleId === 'admin' || role === 'admin'`. The difference is not cosmetic:
 * `role` is the column Better Auth's `admin()` plugin writes (via
 * `/admin/set-role`), while `roleId` is the FK into our RBAC `roles` table that
 * every permission decision is resolved from. The looser check meant setting
 * someone's `role` through Better Auth — without ever assigning them an RBAC
 * role — made `/api/auth/permissions` report `isAdmin: true` for them.
 *
 * `roleId` wins: it is the field the permission engine actually reads, and the
 * seed sets both for a genuine admin, so nothing legitimate depends on the
 * looser form.
 */
export function isAdminUser(u: { roleId?: string | null } | null | undefined): boolean {
  return u?.roleId === ROLES.ADMIN
}

/** Returns true if the given user has the admin role. */
export async function isAdmin(_c: Context<HonoEnv>, userId: string): Promise<boolean> {
  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db.select({ roleId: user.roleId }).from(user).where(eq(user.id, userId))
  return isAdminUser(row)
}
