import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, csrfMiddleware } from '../../src/lib/csrf'

// Build a tiny app that mirrors the real layout: CSRF middleware in front of a
// trivial OK handler. Each test fires through `app.request()` so the full Hono
// pipeline (cookie reads, header reads, response shaping) actually runs.
function makeApp() {
  const app = new Hono()
  app.use('/api/*', csrfMiddleware())
  app.get('/api/health', (c) => c.json({ ok: true }))
  app.get('/api/ping', (c) => c.json({ ok: true }))
  app.post('/api/ping', (c) => c.json({ ok: true }))
  app.get('/api/auth/get-session', (c) => c.json({ ok: true }))
  app.post('/api/auth/sign-in/email', (c) => c.json({ ok: true }))
  app.post('/api/website-bookings/submit', (c) => c.json({ ok: true }))
  app.get('/api/xrays/public/share/abc', (c) => c.json({ ok: true }))
  // Called server-to-server (the "Run now" self-call, QStash deliveries); the
  // route authenticates each call itself with the cron secret or QStash signature.
  app.post('/api/internal/cron/backup-daily', (c) => c.json({ ok: true }))
  app.post('/api/internal/cron/_failure-callback', (c) => c.json({ ok: true }))
  app.post('/api/internal/cronx', (c) => c.json({ ok: true }))
  return app
}

function getSetCookieToken(res: Response): string | null {
  const header = res.headers.get('set-cookie')
  if (!header) return null
  const match = header.match(new RegExp(`${CSRF_COOKIE_NAME}=([^;]+)`))
  return match?.[1] ?? null
}

describe('csrfMiddleware', () => {
  describe('bypass list', () => {
    it.each([
      ['POST', '/api/auth/sign-in/email'],
      ['GET', '/api/auth/get-session'],
      ['GET', '/api/health'],
      ['POST', '/api/website-bookings/submit'],
      ['GET', '/api/xrays/public/share/abc'],
      ['POST', '/api/internal/cron/backup-daily'],
      ['POST', '/api/internal/cron/_failure-callback'],
    ])('allows %s %s without CSRF check', async (method, path) => {
      const app = makeApp()
      const res = await app.request(path, { method })
      expect(res.status).toBe(200)
    })

    it('still checks a path that only starts like the internal cron route', async () => {
      const app = makeApp()
      const res = await app.request('/api/internal/cronx', { method: 'POST' })
      expect(res.status).toBe(403)
    })

    it('does NOT set the csrf cookie on bypassed paths', async () => {
      const app = makeApp()
      const res = await app.request('/api/health')
      expect(res.status).toBe(200)
      expect(getSetCookieToken(res)).toBeNull()
    })
  })

  describe('safe methods', () => {
    it('mints a csrf_token cookie on first GET', async () => {
      const app = makeApp()
      const res = await app.request('/api/ping')
      expect(res.status).toBe(200)
      const token = getSetCookieToken(res)
      expect(token).toBeTruthy()
      expect(token).toMatch(/^[0-9a-f]{64}$/) // 32 bytes hex
    })

    it('reuses an existing csrf_token cookie instead of minting a new one', async () => {
      const app = makeApp()
      const existing = 'a'.repeat(64)
      const res = await app.request('/api/ping', {
        headers: { cookie: `${CSRF_COOKIE_NAME}=${existing}` },
      })
      expect(res.status).toBe(200)
      // No new Set-Cookie when the caller already has one.
      expect(getSetCookieToken(res)).toBeNull()
    })

    it('OPTIONS and HEAD are treated as safe', async () => {
      const app = makeApp()
      const optionsRes = await app.request('/api/ping', { method: 'OPTIONS' })
      // Hono returns 404 for unregistered methods, but the middleware should
      // pass through without 403 — and either way the cookie is set.
      expect(optionsRes.status).not.toBe(403)
    })
  })

  describe('unsafe methods', () => {
    it('rejects POST with no cookie and no header (403)', async () => {
      const app = makeApp()
      const res = await app.request('/api/ping', { method: 'POST' })
      expect(res.status).toBe(403)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe('CSRF token mismatch')
    })

    it('rejects POST with cookie but missing header (403)', async () => {
      const app = makeApp()
      const token = 'b'.repeat(64)
      const res = await app.request('/api/ping', {
        method: 'POST',
        headers: { cookie: `${CSRF_COOKIE_NAME}=${token}` },
      })
      expect(res.status).toBe(403)
    })

    it('rejects POST with header but missing cookie (403)', async () => {
      const app = makeApp()
      const token = 'c'.repeat(64)
      const res = await app.request('/api/ping', {
        method: 'POST',
        headers: { [CSRF_HEADER_NAME]: token },
      })
      expect(res.status).toBe(403)
    })

    it('rejects POST when cookie and header do not match (403)', async () => {
      const app = makeApp()
      const cookie = 'd'.repeat(64)
      const header = 'e'.repeat(64)
      const res = await app.request('/api/ping', {
        method: 'POST',
        headers: {
          cookie: `${CSRF_COOKIE_NAME}=${cookie}`,
          [CSRF_HEADER_NAME]: header,
        },
      })
      expect(res.status).toBe(403)
    })

    it('rejects POST when lengths differ (timing-safe path)', async () => {
      const app = makeApp()
      const cookie = 'f'.repeat(64)
      const res = await app.request('/api/ping', {
        method: 'POST',
        headers: {
          cookie: `${CSRF_COOKIE_NAME}=${cookie}`,
          [CSRF_HEADER_NAME]: cookie.slice(0, 32),
        },
      })
      expect(res.status).toBe(403)
    })

    it('accepts POST when cookie matches header', async () => {
      const app = makeApp()
      const token = '9'.repeat(64)
      const res = await app.request('/api/ping', {
        method: 'POST',
        headers: {
          cookie: `${CSRF_COOKIE_NAME}=${token}`,
          [CSRF_HEADER_NAME]: token,
        },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok: boolean }
      expect(body.ok).toBe(true)
    })

    it.each(['PUT', 'PATCH', 'DELETE'])('enforces CSRF on %s requests', async (method) => {
      const app = makeApp()
      const reject = await app.request('/api/ping', { method })
      expect(reject.status).toBe(403)

      // Re-register the handler for the method so we can verify success too.
      const app2 = new Hono()
      app2.use('/api/*', csrfMiddleware())
      app2.on(method, '/api/ping', (c) => c.json({ ok: true }))
      const token = '1'.repeat(64)
      const accept = await app2.request('/api/ping', {
        method,
        headers: {
          cookie: `${CSRF_COOKIE_NAME}=${token}`,
          [CSRF_HEADER_NAME]: token,
        },
      })
      expect(accept.status).toBe(200)
    })
  })

  describe('token entropy', () => {
    it('generates a different token on each mint', async () => {
      const app = makeApp()
      const tokens = new Set<string>()
      for (let i = 0; i < 16; i++) {
        const res = await app.request('/api/ping')
        const t = getSetCookieToken(res)
        if (t) tokens.add(t)
      }
      // All 16 mints should produce unique tokens.
      expect(tokens.size).toBe(16)
    })
  })
})
