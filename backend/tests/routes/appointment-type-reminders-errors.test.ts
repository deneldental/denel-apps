/**
 * `/api/appointment-type-reminders` — what the browser is told when something goes wrong. See
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.14).
 *
 * The read handler answered every failure with the error's own message AND its stack trace
 * (`{ error: error.message, stack: error.stack }`): the database's text, the bound parameters, and
 * the server's file paths and line numbers. A malformed id reached the database as a uuid and came
 * back that way. The detail belongs in the log; the browser gets a sentence, and a malformed id is a
 * 400.
 */
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

const findMany = vi.hoisted(() => vi.fn())
const transaction = vi.hoisted(() => vi.fn())

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
vi.mock('../../src/lib/logger', () => ({ logError: vi.fn(), logger: { error: vi.fn() } }))
vi.mock('../../src/db', () => ({
  getDb: vi.fn(() => ({
    query: { appointmentTypeReminders: { findMany } },
    transaction,
  })),
}))

import { logError } from '../../src/lib/logger'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { appointmentTypeRemindersApp } from '../../src/routes/appointment-type-reminders'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)

const app = new Hono<HonoEnv>()
app.route('/api/appointment-type-reminders', appointmentTypeRemindersApp)

const TYPE_ID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const get = (id: string) => app.request(`/api/appointment-type-reminders/${id}`)
const put = (id: string, body: unknown = { reminders: [] }) =>
  app.request(`/api/appointment-type-reminders/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  mockGetCurrentUser.mockResolvedValue({
    id: 'u-1',
    email: 'admin@deneldental.com',
    name: 'Admin',
    role: 'user',
    roleId: 'admin',
  })
  mockCheckPermission.mockResolvedValue(true)
  findMany.mockResolvedValue([])
  transaction.mockResolvedValue(undefined)
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/appointment-type-reminders/:id — a failure', () => {
  const SECRET = 'select "templateId" from "appointment_type_reminders" params: patient-9f3a'

  it('tells the browser a sentence, not the database text or the stack', async () => {
    findMany.mockRejectedValue(new Error(SECRET))
    const res = await get('default')
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ error: 'Failed to fetch appointment type reminders' })
    expect(text).not.toContain('patient-9f3a')
    expect(text).not.toContain('appointment_type_reminders')
    expect(text).not.toContain('stack')
    expect(text).not.toMatch(/\bat .*\(.*:\d+:\d+\)/) // no "at fn (file:line:col)"
  })

  it('still writes the detail to the log', async () => {
    findMany.mockRejectedValue(new Error(SECRET))
    await get('default')
    expect(logError).toHaveBeenCalledTimes(1)
    expect(vi.mocked(logError).mock.calls[0][0]).toMatchObject({ message: SECRET })
  })
})

describe('/api/appointment-type-reminders/:id — the id', () => {
  it.each([['default'], [TYPE_ID], [TYPE_ID.toUpperCase()]])('accepts %s', async (id) => {
    expect((await get(id)).status).toBe(200)
    expect((await put(id)).status).toBe(200)
  })

  it.each([
    ['not-a-uuid'],
    ['1'],
    ['default-'],
    [`${TYPE_ID}x`],
    ['%27%20or%201%3D1'],
  ])('refuses %s with a 400 before reaching the database', async (id) => {
    expect((await get(id)).status).toBe(400)
    expect((await put(id)).status).toBe(400)
    expect(findMany).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })
})

describe('/api/appointment-type-reminders — who may use it (unchanged)', () => {
  it('needs a signed-in person', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    expect((await get('default')).status).toBe(401)
    expect((await put('default')).status).toBe(401)
  })

  it('needs the appointments permission', async () => {
    mockCheckPermission.mockResolvedValue(false)
    expect((await get('default')).status).toBe(403)
    expect((await put('default')).status).toBe(403)
    expect(findMany).not.toHaveBeenCalled()
  })
})
