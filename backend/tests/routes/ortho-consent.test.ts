/**
 * HTTP-level tests for /api/ortho-consent routes.
 *
 * Pins the fix for finding H2
 * (project-docs/patient-records-and-scheduling-audit.md): `GET /` had no
 * permission check — only `getCurrentUser` — returning every ortho patient's
 * name/phone/email/photo/signed-consent status to any authenticated user
 * regardless of role. Its own siblings (POST, POST /process, PATCH delete)
 * all correctly gated on `MODULES.ORTHO_CONSENT`; the GET now matches.
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
vi.mock('../../src/lib/audit', () => ({ createAuditLog: vi.fn() }))

import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { orthoConsentApp } from '../../src/routes/ortho-consent'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/ortho-consent', orthoConsentApp)
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

describe('GET /api/ortho-consent — permission gate [H2]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request('/api/ortho-consent')
    expect(res.status).toBe(401)
  })

  it('returns 403 when the caller lacks ortho_consent:read', async () => {
    mockGetCurrentUser.mockResolvedValue(staff)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request('/api/ortho-consent')
    expect(res.status).toBe(403)
  })

  it('does not short-circuit to 401/403 once checkPermission allows it', async () => {
    mockGetCurrentUser.mockResolvedValue(staff)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request('/api/ortho-consent')
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
  })
})
