/**
 * R3 — the cross-request session cache must be invalidated by sign-out.
 *
 * Before the fix this test guards, `invalidateSessionCache()` was exported and
 * never called: a credential that had been signed out kept resolving from
 * `sessionCache` for up to AUTH_SESSION_CACHE_TTL_MS (5 s) on every route
 * outside /api/auth/*. The "stale without invalidation" case below is kept
 * deliberately — it is the control that proves the passing case is not vacuous.
 */

import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

// Better Auth is mocked so this stays a pure unit test — no DB, no env, no
// network. getCurrentUser's only other source (the staff-session cookie) is
// stubbed to "absent" so every request falls through to Better Auth.
const getSession = vi.fn<() => Promise<{ user: Record<string, unknown> } | null>>()

vi.mock('../../src/auth', () => ({
  getAuth: () => ({ api: { getSession } }),
  // `getCurrentUser` folds the cookie prefix into the cache key, so the mock
  // has to supply it too. A constant is right here: this file is about
  // invalidation, and the prefix's own effect on the key is pinned by the
  // `credentialKey` cases above.
  resolveCookiePrefix: () => 'portal',
}))

vi.mock('../../src/lib/staff-session', () => ({
  getSessionStaff: vi.fn(async () => null),
}))

import { getCurrentUser } from '../../src/lib/rbac'
import {
  credentialKey,
  invalidateSessionCache,
  invalidateSessionCacheForAuthPath,
  readSessionCache,
  SESSION_CACHE_TTL_MS,
  sessionCacheSize,
  writeSessionCache,
} from '../../src/rbac/session-cache'

const SESSION_USER = {
  id: 'user-1',
  email: 'admin@framada.app',
  name: 'Admin',
  role: 'admin',
  roleId: 'admin',
}

const COOKIE = 'portal.session_token=tok-abc; csrf_token=zzz'

// A real Hono app, so getCurrentUser receives a genuine Context and a genuine
// Request object (the per-request WeakMap memo is keyed on that identity).
const app = new Hono<HonoEnv>()
app.get('/api/patients', async (c) => {
  const user = await getCurrentUser(c)
  return user ? c.json({ id: user.id }) : c.json({ error: 'Unauthorized' }, 401)
})

const request = (cookie: string) =>
  app.request('http://localhost/api/patients', { headers: { Cookie: cookie } })

beforeEach(() => {
  invalidateSessionCache()
  getSession.mockReset()
})

describe('credentialKey', () => {
  it('is null when the caller presents no credential', () => {
    expect(credentialKey(new Headers(), 'portal')).toBeNull()
    expect(credentialKey(new Headers({ Cookie: 'theme=dark' }), 'portal')).toBeNull()
  })

  it('is stable for the same credential and differs for another', () => {
    const a = credentialKey(new Headers({ Cookie: COOKIE }), 'portal')
    const b = credentialKey(new Headers({ Cookie: COOKIE }), 'portal')
    const other = credentialKey(new Headers({ Cookie: 'portal.session_token=tok-xyz' }), 'portal')
    expect(a).toBeTruthy()
    expect(a).toBe(b)
    expect(a).not.toBe(other)
  })

  it('ignores non-session cookies so unrelated state cannot fragment the key', () => {
    const bare = credentialKey(new Headers({ Cookie: 'portal.session_token=tok-abc' }), 'portal')
    const noisy = credentialKey(
      new Headers({ Cookie: 'theme=dark; portal.session_token=tok-abc; locale=en' }),
      'portal'
    )
    expect(bare).toBe(noisy)
  })

  it('keys an Authorization header separately from a cookie', () => {
    const viaCookie = credentialKey(new Headers({ Cookie: 'portal.session_token=t' }), 'portal')
    const viaBearer = credentialKey(new Headers({ Authorization: 'Bearer t' }), 'portal')
    expect(viaCookie).not.toBe(viaBearer)
  })

  it('keys the same cookies separately per app (cookie-prefix collision)', () => {
    // A browser signed into the portal and the Team app sends BOTH
    // .framada.app session cookies on every request; only X-App-Id says which
    // one resolveUser reads. Without the prefix in the key these collided and
    // one app was served the other app's user for the cache TTL.
    const both = new Headers({
      Cookie: 'portal.session_token=tok-a; staff-pwa.session_token=tok-b',
    })
    expect(credentialKey(both, 'portal')).not.toBe(credentialKey(both, 'staff-pwa'))
  })
})

describe('invalidateSessionCacheForAuthPath', () => {
  it('clears the cache for session-revoking Better Auth paths', () => {
    for (const path of [
      '/sign-out',
      '/revoke-session',
      '/revoke-sessions',
      '/revoke-other-sessions',
      '/delete-user',
      '/change-password',
      '/reset-password',
      '/admin/ban-user',
      '/admin/revoke-user-sessions',
      '/admin/set-role',
    ]) {
      writeSessionCache('k', SESSION_USER)
      expect(invalidateSessionCacheForAuthPath(path)).toBe(true)
      expect(sessionCacheSize()).toBe(0)
    }
  })

  it('leaves the cache alone for read-only auth paths', () => {
    writeSessionCache('k', SESSION_USER)
    expect(invalidateSessionCacheForAuthPath('/get-session')).toBe(false)
    expect(invalidateSessionCacheForAuthPath('/list-sessions')).toBe(false)
    expect(invalidateSessionCacheForAuthPath('/sign-in/email')).toBe(false)
    expect(sessionCacheSize()).toBe(1)
  })

  it('accepts the raw HTTP path as well as the basePath-relative one', () => {
    // hooks.after hands us '/sign-out'; anything holding the unprefixed request
    // path must resolve to the same entry.
    writeSessionCache('k', SESSION_USER)
    expect(invalidateSessionCacheForAuthPath('/api/auth/sign-out')).toBe(true)
    expect(sessionCacheSize()).toBe(0)
  })
})

describe('session cache entries', () => {
  it('round-trips a resolution and honours the TTL', () => {
    writeSessionCache('k', SESSION_USER)
    expect(readSessionCache('k')?.user).toEqual(SESSION_USER)

    vi.useFakeTimers()
    try {
      vi.setSystemTime(Date.now() + SESSION_CACHE_TTL_MS + 1)
      expect(readSessionCache('k')).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('caches a negative resolution too', () => {
    writeSessionCache('k', null)
    const entry = readSessionCache('k')
    expect(entry).toBeDefined()
    expect(entry?.user).toBeNull()
  })
})

describe('getCurrentUser + sign-out invalidation', () => {
  it('serves a second request for the same credential from the cache', async () => {
    getSession.mockResolvedValue({ user: SESSION_USER })

    expect((await request(COOKIE)).status).toBe(200)
    expect((await request(COOKIE)).status).toBe(200)

    // Two HTTP requests, one Better Auth round trip — that is the whole point
    // of layer 2, and the reason a revocation has to be pushed into it.
    expect(getSession).toHaveBeenCalledTimes(1)
  })

  it('rejects the old cookie immediately after sign-out', async () => {
    getSession.mockResolvedValue({ user: SESSION_USER })
    expect((await request(COOKIE)).status).toBe(200)

    // Sign-out: Better Auth deletes the session row, then hooks.after fires.
    getSession.mockResolvedValue(null)
    expect(invalidateSessionCacheForAuthPath('/sign-out')).toBe(true)

    const after = await request(COOKIE)
    expect(after.status).toBe(401)
    expect(getSession).toHaveBeenCalledTimes(2)
  })

  it('CONTROL: without the invalidation the dead cookie would still pass', async () => {
    getSession.mockResolvedValue({ user: SESSION_USER })
    expect((await request(COOKIE)).status).toBe(200)

    // Same revocation, but nothing tells the cache about it.
    getSession.mockResolvedValue(null)

    expect((await request(COOKIE)).status).toBe(200)
    expect(getSession).toHaveBeenCalledTimes(1)
  })

  it('does not share a cache entry between different credentials', async () => {
    getSession.mockResolvedValue({ user: SESSION_USER })
    expect((await request(COOKIE)).status).toBe(200)

    getSession.mockResolvedValue(null)
    expect((await request('portal.session_token=someone-else')).status).toBe(401)
    expect(getSession).toHaveBeenCalledTimes(2)
  })

  it('never consults the cross-request cache for /api/auth/* routes', async () => {
    const authApp = new Hono<HonoEnv>()
    authApp.get('/api/auth/permissions', async (c) => {
      const user = await getCurrentUser(c)
      return c.json({ id: user?.id ?? null })
    })
    getSession.mockResolvedValue({ user: SESSION_USER })

    await authApp.request('http://localhost/api/auth/permissions', {
      headers: { Cookie: COOKIE },
    })
    await authApp.request('http://localhost/api/auth/permissions', {
      headers: { Cookie: COOKIE },
    })

    expect(getSession).toHaveBeenCalledTimes(2)
    expect(sessionCacheSize()).toBe(0)
  })
})
