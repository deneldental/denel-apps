/**
 * HTTP-level tests for /api/auth routes.
 *
 * These are unit tests — no real DB or Better Auth instance required.
 * The session layer is mocked so each test controls its own auth state.
 */
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

// ── Module mocks (hoisted by Vitest before any imports) ───────────────────────

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    BETTER_AUTH_URL: 'http://localhost:3000',
    NODE_ENV: 'development',
  },
  validateBackendEnv: vi.fn(),
}))

// Control the session returned by Better Auth per-test.
vi.mock('../../src/auth')

vi.mock('../../src/db', () => ({
  getDb: vi.fn(() => ({})),
}))

// PermissionEngine is only reached for authenticated requests — mock so no DB
// needed. Use a CLASS, not a function: the route does `new PermissionEngine(db)`,
// and an arrow function isn't constructable (Vitest 4 invokes the implementation
// with `new`). A plain `function(){}` would work, but Biome's useArrowFunction
// rule rewrites it back into an un-constructable arrow on commit — a class is
// immune to that and stays constructable.
vi.mock('../../src/rbac/engine/PermissionEngine', () => ({
  PermissionEngine: class {
    check = vi.fn().mockResolvedValue(false)
    checkScope = vi.fn().mockResolvedValue(true)
  },
}))

vi.mock('../../src/rbac/engine/BundleResolver', () => ({
  getRoleBundleNames: vi.fn().mockResolvedValue([]),
  resolveRolePermissions: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../src/rbac/utils/wildcardMatch', () => ({
  groupPermissionsByModule: vi.fn().mockReturnValue({}),
}))

vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

// ── Imports (resolved after mocks are hoisted) ────────────────────────────────

import { getAuth } from '../../src/auth'
import { authApp } from '../../src/routes/auth'

const mockGetAuth = vi.mocked(getAuth as any)

// ── Helpers ───────────────────────────────────────────────────────────────────

function noSessionAuth() {
  return { api: { getSession: vi.fn().mockResolvedValue(null) } }
}

function sessionAuth(userId = 'user-test-001') {
  return {
    api: {
      getSession: vi.fn().mockResolvedValue({
        user: {
          id: userId,
          email: 'test@framada.app',
          name: 'Test User',
          role: 'user',
          roleId: 'doctor',
        },
        session: { id: 'sess-001', userId },
      }),
    },
  }
}

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/auth', authApp)
  return app
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/auth/check-permission', () => {
  beforeEach(() => mockGetAuth.mockReturnValue(noSessionAuth()))
  afterEach(() => vi.clearAllMocks())

  it('returns allowed:false (not 401) when there is no session', async () => {
    const res = await makeApp().request('/api/auth/check-permission?module=patients&action=read')
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.success).toBe(true)
    expect(body.data.allowed).toBe(false)
  })

  it('returns 400 when module param is absent (authenticated)', async () => {
    mockGetAuth.mockReturnValue(sessionAuth())
    const res = await makeApp().request('/api/auth/check-permission?action=read')
    expect(res.status).toBe(400)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/Missing module or action/i)
  })

  it('returns 400 when action param is absent (authenticated)', async () => {
    mockGetAuth.mockReturnValue(sessionAuth())
    const res = await makeApp().request('/api/auth/check-permission?module=patients')
    expect(res.status).toBe(400)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/Missing module or action/i)
  })

  it('returns 400 when both params are absent (authenticated)', async () => {
    mockGetAuth.mockReturnValue(sessionAuth())
    const res = await makeApp().request('/api/auth/check-permission')
    expect(res.status).toBe(400)
  })
})

describe('GET /api/auth/scope-access', () => {
  beforeEach(() => mockGetAuth.mockReturnValue(noSessionAuth()))
  afterEach(() => vi.clearAllMocks())

  it('returns hasAccess:false (not 401) when there is no session', async () => {
    const res = await makeApp().request('/api/auth/scope-access?scope=portal')
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.success).toBe(true)
    expect(body.data.hasAccess).toBe(false)
  })

  it('returns 400 when scope param is absent (authenticated)', async () => {
    mockGetAuth.mockReturnValue(sessionAuth())
    const res = await makeApp().request('/api/auth/scope-access')
    expect(res.status).toBe(400)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/scope/i)
  })

  it('returns 400 for an invalid scope value (authenticated)', async () => {
    mockGetAuth.mockReturnValue(sessionAuth())
    const res = await makeApp().request('/api/auth/scope-access?scope=unknown')
    expect(res.status).toBe(400)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/invalid scope/i)
  })

  it('accepts valid scope values portal and pwa without error', async () => {
    mockGetAuth.mockReturnValue(sessionAuth())
    for (const scope of ['portal', 'pwa']) {
      const res = await makeApp().request(`/api/auth/scope-access?scope=${scope}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.data.scope).toBe(scope)
    }
  })
})

describe('GET /api/auth/permissions', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when there is no session', async () => {
    mockGetAuth.mockReturnValue(noSessionAuth())
    const res = await makeApp().request('/api/auth/permissions')
    expect(res.status).toBe(401)
  })
})
