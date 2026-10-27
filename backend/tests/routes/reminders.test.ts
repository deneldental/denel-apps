/**
 * HTTP-level tests for /api/reminders routes.
 *
 * Pins the fix for finding H1
 * (project-docs/patient-records-and-scheduling-audit.md): `GET
 * /payment/cooldown-status` had no permission check — any authenticated user
 * could pass an arbitrary `?phones=` list and learn whether/when a reminder
 * SMS was sent to any phone number. Now gates on `sms:read`, matching the
 * actual-send sibling's `sms:create`.
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
vi.mock('../../src/lib/sms', () => ({ sendSMS: vi.fn().mockResolvedValue({ success: true }) }))

import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { remindersApp } from '../../src/routes/reminders'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/reminders', remindersApp)
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

describe('GET /api/reminders/payment/cooldown-status — permission gate [H1]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    const res = await makeApp().request(
      '/api/reminders/payment/cooldown-status?phones=233241234567'
    )
    expect(res.status).toBe(401)
  })

  it('returns 403 when the caller lacks sms:read', async () => {
    mockGetCurrentUser.mockResolvedValue(staff)
    mockCheckPermission.mockResolvedValue(false)
    const res = await makeApp().request(
      '/api/reminders/payment/cooldown-status?phones=233241234567'
    )
    expect(res.status).toBe(403)
  })

  it('returns 200 once checkPermission allows it', async () => {
    mockGetCurrentUser.mockResolvedValue(staff)
    mockCheckPermission.mockResolvedValue(true)
    const res = await makeApp().request(
      '/api/reminders/payment/cooldown-status?phones=233241234567'
    )
    // The route swallows its own DB errors internally and still returns 200
    // with an empty map — this route never 500s, so 200 is the correct
    // "checkPermission was consulted and passed" signal here.
    expect(res.status).toBe(200)
  })
})
