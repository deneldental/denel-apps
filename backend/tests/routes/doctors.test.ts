/**
 * HTTP-level tests for /api/doctors routes.
 *
 * Pins the fix for finding H1
 * (project-docs/patient-records-and-scheduling-audit.md): `GET /` and
 * `GET /unavailability` had no permission check at all — only
 * `getCurrentUser`. Any authenticated user of any role could pull the full
 * doctor roster or every doctor's clinic-wide block-time. Both now gate on
 * `appointments:read`, matching the sibling POST/DELETE unavailability
 * routes' `appointments:create`/`:delete`.
 */
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    BETTER_AUTH_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
  },
  validateBackendEnv: vi.fn(),
}))

vi.mock('../../src/lib/rbac')
vi.mock('../../src/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { doctorsApp } from '../../src/routes/doctors'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/doctors', doctorsApp)
  return app
}

const staff = {
  id: 'u-1',
  email: 'staff@deneldental.com',
  name: 'Staff',
  role: 'user',
  roleId: 'staff',
}

afterEach(() => vi.clearAllMocks())

describe.each([
  ['GET', '/api/doctors'],
  ['GET', '/api/doctors/unavailability'],
])('%s %s — permission gate [H1]', (method, path) => {
  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request(path, { method })
    expect(res.status).toBe(401)
  })

  it('returns 403 when the caller lacks appointments:read', async () => {
    mockGetCurrentUser.mockResolvedValue(staff)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request(path, { method })
    expect(res.status).toBe(403)
  })

  it('does not short-circuit to 401/403 once checkPermission allows it', async () => {
    mockGetCurrentUser.mockResolvedValue(staff)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request(path, { method })
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
  })
})
