/**
 * The staff-administration APIs refuse the Team app — and only the Team app,
 * and only those APIs. The Team app's own self-service lives under
 * /api/staff-portal and must stay reachable; the portal and the HR app must
 * keep reaching the admin APIs.
 */

import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/logger', () => ({ logWarn: vi.fn() }))

import type { HonoEnv } from '../../src/lib/types'
import {
  blockTeamAppFromStaffAdmin,
  isStaffAdminApiPath,
} from '../../src/rbac/middleware/blockTeamAppFromStaffAdmin'

const app = new Hono<HonoEnv>()
app.use('/api/*', blockTeamAppFromStaffAdmin())
app.all('/api/*', (c) => c.json({ reached: true }))

// No Origin header, so resolveAppScope falls back to X-App-Id (then 'portal').
const call = (path: string, appId?: string) =>
  app.request(path, { headers: appId ? { 'X-App-Id': appId } : {} })

const ADMIN_PATHS = [
  '/api/staff',
  '/api/staff/3f9c2c1e-0000-4000-8000-000000000000',
  '/api/staff/performance/all',
  '/api/staff/requests/all',
  '/api/staff/training/all',
  '/api/staff/attendance',
  '/api/hr/review-cycles',
  '/api/hr3/shifts',
  '/api/payroll',
  '/api/payroll/runs',
  '/api/payroll/payslips/abc/pdf',
]

const TEAM_OWN_PATHS = [
  '/api/staff-portal/payslips',
  '/api/staff-portal/requests',
  '/api/staff-auth/me',
  '/api/staff-registration/public/abc',
  '/api/request-types',
  '/api/labs/cases',
]

describe('isStaffAdminApiPath', () => {
  it('matches each prefix and everything under it', () => {
    for (const path of ADMIN_PATHS) expect(isStaffAdminApiPath(path), path).toBe(true)
  })

  it('does not match neighbours that merely share the letters', () => {
    for (const path of [...TEAM_OWN_PATHS, '/api/hrx', '/api/payrolls', '/api/staffing']) {
      expect(isStaffAdminApiPath(path), path).toBe(false)
    }
  })
})

describe('blockTeamAppFromStaffAdmin', () => {
  it('refuses the Team app on every staff-administration API', async () => {
    for (const path of ADMIN_PATHS) {
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
        const res = await app.request(path, { method, headers: { 'X-App-Id': 'pwa' } })
        expect(res.status, `${method} ${path}`).toBe(403)
        const body = (await res.json()) as { error: string }
        expect(body.error).toBe('Not available in the Team app')
      }
    }
  })

  it('lets the Team app reach its own APIs', async () => {
    for (const path of TEAM_OWN_PATHS) {
      const res = await call(path, 'pwa')
      expect(res.status, path).toBe(200)
    }
  })

  it('lets the portal, the HR app and unattributed callers through', async () => {
    for (const appId of ['portal', 'hr', undefined]) {
      for (const path of ADMIN_PATHS) {
        const res = await call(path, appId)
        expect(res.status, `${appId ?? '(none)'} ${path}`).toBe(200)
      }
    }
  })
})
