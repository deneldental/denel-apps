/**
 * ─── Cross-request session resolution cache ────────────────────────────────
 *
 * Extracted from `lib/rbac.ts` so that **both** the resolver (`getCurrentUser`)
 * and the Better Auth kernel (`src/auth.ts`) can reach it. `lib/rbac.ts` imports
 * `getAuth` from `src/auth.ts`, so if the cache lived in `lib/rbac.ts` the
 * sign-out hook would have to import it back and create a runtime import cycle.
 * This module imports nothing at runtime, which makes it safe for either side.
 *
 * The cache is keyed on the exact credential the caller presented (every
 * `*session*` cookie plus any Authorization header, hashed) — never on the user
 * id — so one caller's entry can never be served to another. TTL is deliberately
 * tiny: AUTH_SESSION_CACHE_TTL_MS, default 5,000 ms. Set it to 0 to disable the
 * layer entirely.
 *
 * A session revoked out of band (sign-out, session delete, an account banned)
 * used to stay accepted for up to the TTL because nothing could clear this map.
 * `invalidateSessionCacheForAuthPath()` closes that window: `src/auth.ts` calls
 * it from Better Auth's `hooks.after`, so any endpoint that revokes or mutates a
 * session drops the cache before the response is even returned to the client.
 *
 * ─── SINGLE PROCESS ONLY (audit finding M5) ────────────────────────────────
 * `sessionCache` is a module-level `Map`, so every statement above is true of
 * **the instance that handled the revoking request, and only that one.** This
 * file used to claim a revoked credential "is rejected on the very next
 * request" without qualification; on a horizontally-scaled deployment that is
 * false, and the rate-limiter config in `src/auth.ts` explicitly targets such a
 * deployment, so the claim and the design disagreed.
 *
 * What is actually true:
 *
 *   - The revoking instance rejects the credential immediately.
 *   - Every OTHER instance keeps accepting it until its own entry expires —
 *     bounded by SESSION_CACHE_TTL_MS (default 5 s), never longer, because the
 *     underlying `session` rows are deleted and the next resolution hits the
 *     database.
 *
 * Today the backend runs as a single container, so the exposure is zero in
 * practice. Before scaling to more than one instance, choose one:
 *
 *   - Set `AUTH_SESSION_CACHE_TTL_MS=0` to disable this layer (costs one extra
 *     session lookup per request), or
 *   - Give it a shared invalidation channel. Note that the permission cache's
 *     Upstash approach — a Redis GET on every cache hit — is NOT a model to
 *     copy here: a network round trip per request is strictly worse than the
 *     database read this cache exists to avoid.
 */

import { createHash } from 'node:crypto'
// Type-only: erased at compile time, so this does NOT create a runtime cycle
// with lib/rbac.ts (which imports this module for its values).
import type { AuthUser } from '../lib/rbac'

export const SESSION_CACHE_TTL_MS = Number.parseInt(
  process.env.AUTH_SESSION_CACHE_TTL_MS ?? '5000',
  10
)
const SESSION_CACHE_MAX = 500

interface SessionCacheEntry {
  user: AuthUser | null
  expiresAt: number
}

const sessionCache = new Map<string, SessionCacheEntry>()

/**
 * Build the cache key from the credential the caller presented, plus the cookie
 * prefix that decides WHICH of those cookies is the session.
 *
 * Returns null when no credential is present, which disables the layer for that
 * request (an anonymous request must never share an entry with another one).
 *
 * `cookiePrefix` is not optional and not cosmetic. The cache hashes the whole
 * Cookie header, but `resolveUser` reads only the cookie named for the app that
 * sent the request (`portal.session_token`, `staff-pwa.session_token`, …), and
 * that name comes from `X-App-Id` — see `resolveCookiePrefix` in src/auth.ts.
 * Better Auth cookies are scoped to `.deneldental.com`, so a browser signed into
 * the portal as one person and the Team app as another sends BOTH tokens to
 * api.deneldental.com on every request. Keyed on cookies alone, those two requests
 * collide: whichever arrived first populated the entry, and for the next 5 s
 * the other app was answered with the first app's user. That is identity
 * confusion in the auth path — wrong-user attribution on a shared front-desk
 * workstation, and spurious 403s when the borrowed identity lacks the scope.
 */
export function credentialKey(headers: Headers, cookiePrefix: string): string | null {
  const cookieHeader = headers.get('Cookie') ?? ''
  const sessionCookies = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.toLowerCase().includes('session'))
    .sort()
    .join(';')
  const authorization = headers.get('Authorization') ?? ''
  if (!sessionCookies && !authorization) return null
  return createHash('sha256')
    .update(`${cookiePrefix}\n${sessionCookies}\n${authorization}`)
    .digest('hex')
}

export function readSessionCache(key: string): SessionCacheEntry | undefined {
  const entry = sessionCache.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    sessionCache.delete(key)
    return undefined
  }
  return entry
}

export function writeSessionCache(key: string, user: AuthUser | null): void {
  if (sessionCache.size >= SESSION_CACHE_MAX) {
    const now = Date.now()
    for (const [k, v] of sessionCache) if (now > v.expiresAt) sessionCache.delete(k)
    if (sessionCache.size >= SESSION_CACHE_MAX) {
      const oldest = sessionCache.keys().next().value
      if (oldest !== undefined) sessionCache.delete(oldest)
    }
  }
  sessionCache.set(key, { user, expiresAt: Date.now() + SESSION_CACHE_TTL_MS })
}

/**
 * Drop every cached session resolution.
 *
 * Deliberately a full clear rather than a targeted delete of the presenting
 * credential:
 *
 *  - `/revoke-sessions`, `/admin/ban-user`, `/delete-user` etc. invalidate
 *    sessions the *current* request never presented, so a targeted delete would
 *    miss them entirely.
 *  - even for plain `/sign-out`, the credential string can differ between the
 *    request that populated the cache and the sign-out request (Better Auth
 *    rotates the session cookie on refresh; other `*session*` cookies come and
 *    go), which would leave the stale entry behind.
 *
 * The cost of over-clearing is bounded and tiny: entries live at most
 * SESSION_CACHE_TTL_MS (5 s) anyway, so the worst case is one extra session
 * lookup per active credential, on an event (sign-out / revocation) that is rare
 * compared to ordinary traffic. Correctness wins.
 *
 * Note this does NOT touch the per-request WeakMap memo in `lib/rbac.ts`: that
 * layer is scoped to a single in-flight Request and is freed with it, and a
 * request cannot observe its own mid-flight revocation in any case.
 */
export function invalidateSessionCache(): void {
  sessionCache.clear()
}

/** Test/diagnostic helper — how many entries the cross-request layer holds. */
export function sessionCacheSize(): number {
  return sessionCache.size
}

/**
 * Better Auth endpoint paths after which a cached session resolution may no
 * longer reflect the database. Two groups:
 *
 *  1. Session revocation — the cached user must stop being accepted at once.
 *  2. Identity/role mutation — the cached AuthUser carries `role` and `roleId`,
 *     so a role change would otherwise be served stale for the TTL.
 *
 * Paths are Better Auth's own, i.e. relative to `basePath` ('/api/auth').
 */
export const SESSION_MUTATING_AUTH_PATHS: ReadonlySet<string> = new Set([
  // 1 — revocation
  '/sign-out',
  '/revoke-session',
  '/revoke-sessions',
  '/revoke-other-sessions',
  '/delete-user',
  '/delete-user/callback',
  '/change-password',
  '/reset-password',
  '/admin/ban-user',
  '/admin/remove-user',
  '/admin/revoke-user-session',
  '/admin/revoke-user-sessions',
  '/admin/set-user-password',
  '/admin/impersonate-user',
  '/admin/stop-impersonating',
  // 2 — identity / role mutation
  '/update-user',
  '/change-email',
  '/admin/set-role',
  '/admin/update-user',
])

const AUTH_BASE_PATH = '/api/auth'

/**
 * Normalise a path to Better Auth's own form. `hooks.after` receives the
 * basePath-relative path ('/sign-out'), but callers that only have the raw HTTP
 * path ('/api/auth/sign-out') must resolve to the same entry.
 */
function normalizeAuthPath(path: string): string {
  return path.startsWith(AUTH_BASE_PATH) ? path.slice(AUTH_BASE_PATH.length) || '/' : path
}

/**
 * Clear the cross-request cache if `path` is an auth endpoint that revokes or
 * mutates a session. Returns true when the cache was cleared, so callers (and
 * tests) can assert the wiring actually fired.
 */
export function invalidateSessionCacheForAuthPath(path: string): boolean {
  if (!SESSION_MUTATING_AUTH_PATHS.has(normalizeAuthPath(path))) return false
  invalidateSessionCache()
  return true
}
