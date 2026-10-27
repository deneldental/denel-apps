/**
 * HTTP-level tests for /api/reminder-templates routes.
 *
 * Pins the fix for finding H6
 * (project-docs/patient-records-and-scheduling-audit.md): POST/PATCH/DELETE
 * used a hand-rolled `roleId === ROLES.ADMIN` check instead of
 * checkPermission(), so a custom role granted `messaging:update` elsewhere in
 * the app (e.g. receptionist, via `bundle_messaging_full`) was silently
 * blocked here too — the same family of bug as C6. They now gate on
 * `messaging:create`/`:update`/`:delete`. GET's own admin/non-admin
 * data-filtering behaviour (via `isAdmin()`, not an access gate) is
 * unchanged and still covered here.
 */
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

const state = vi.hoisted(() => ({
  user: null as { id: string; email: string; name: string; roleId: string; role: string } | null,
}))

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    BETTER_AUTH_URL: 'http://localhost:3000',
  },
  validateBackendEnv: vi.fn(),
}))
vi.mock('../../src/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('../../src/lib/rbac')
vi.mock('../../src/rbac/middleware/verifySession', () => ({
  verifySession:
    () =>
    async (
      c: { set: (key: string, value: unknown) => void; json: (b: unknown, s: number) => Response },
      next: () => Promise<void>
    ) => {
      if (!state.user) return c.json({ error: 'Not authenticated' }, 401)
      c.set('user', state.user)
      await next()
    },
}))

import { checkPermission, isAdmin } from '../../src/lib/rbac'
import { reminderTemplatesApp } from '../../src/routes/reminder-templates'

const mockIsAdmin = vi.mocked(isAdmin)
const mockCheckPermission = vi.mocked(checkPermission)

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/reminder-templates', reminderTemplatesApp)
  return app
}

const receptionist = {
  id: 'u-recep',
  email: 'recep@deneldental.com',
  name: 'Front Desk',
  roleId: 'receptionist',
  role: 'user',
}

afterEach(() => {
  vi.clearAllMocks()
  state.user = null
})

describe('GET /api/reminder-templates', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await makeApp().request('/api/reminder-templates')
    expect(res.status).toBe(401)
  })

  it('still resolves for a non-admin (data-filtering, not an access gate)', async () => {
    state.user = receptionist
    mockIsAdmin.mockResolvedValue(false)
    const res = await makeApp().request('/api/reminder-templates')
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
  })
})

describe.each([
  ['POST', '/api/reminder-templates', 'create'],
  ['PATCH', '/api/reminder-templates/tpl-1', 'update'],
  ['DELETE', '/api/reminder-templates/tpl-1', 'delete'],
])('%s %s — permission gate [H6]', (method, path, action) => {
  it('returns 401 when unauthenticated', async () => {
    const res = await makeApp().request(path, { method })
    expect(res.status).toBe(401)
  })

  it(`returns 403 when the caller lacks messaging:${action} (even a receptionist, not just non-admin)`, async () => {
    state.user = receptionist
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'DELETE' ? undefined : JSON.stringify({ name: 'x', messageTemplate: 'y' }),
    })
    expect(res.status).toBe(403)
  })

  it(`does not short-circuit to 401/403 once checkPermission allows messaging:${action}`, async () => {
    state.user = receptionist
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'DELETE' ? undefined : JSON.stringify({ name: 'x', messageTemplate: 'y' }),
    })
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
  })
})
