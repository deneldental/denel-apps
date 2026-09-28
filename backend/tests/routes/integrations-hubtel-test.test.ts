/**
 * POST /api/integrations/hubtel/test — the Integrations "Test" button.
 *
 * Hubtel publishes no free credential check, and the address the button used
 * to call (api-sms.hubtel.com) does not exist, so it always failed. It now
 * sends ONE real test SMS through the normal sending path — proving the keys,
 * the Sender ID and delivery together — and reports what actually happened.
 * `sendSMS` is the boundary: what the route hands it and how it reports the
 * result are the contract under test.
 */
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

const state = vi.hoisted(() => ({
  /** Permissions the signed-in user holds, as `module:action`. */
  allowed: new Set<string>(),
  credentials: null as { clientId: string; clientSecret: string } | null,
}))

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    BETTER_AUTH_URL: 'http://localhost:3000',
  },
  validateBackendEnv: vi.fn(),
  isDevEnvironment: () => false,
  resolvedEnvironment: () => 'production',
}))
vi.mock('../../src/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../src/lib/branding', () => ({
  getBranding: vi.fn(async () => ({ name: 'Denel Dental Clinic', shortName: 'Denel' })),
  setBranding: vi.fn(),
}))
vi.mock('../../src/lib/sms', () => ({
  sendSMS: vi.fn(),
  getHubtelCredentials: vi.fn(async () => state.credentials),
}))
vi.mock('../../src/lib/integrations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/integrations')>()),
  getHubtelConfig: vi.fn(async () =>
    state.credentials ? { ...state.credentials, senderId: 'Denel' } : null
  ),
}))
vi.mock('../../src/rbac/middleware/verifySession', () => ({
  verifySession:
    () =>
    async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>
    ): Promise<void> => {
      c.set('user', {
        id: 'u-admin',
        email: 'admin@framada.app',
        name: 'Admin',
        roleId: 'admin',
        role: 'admin',
      })
      await next()
    },
}))
vi.mock('../../src/rbac/middleware/checkPermission', () => ({
  checkPermission:
    (module: string, action: string) =>
    async (c: { json: (body: unknown, status: number) => Response }, next: () => Promise<void>) => {
      if (!state.allowed.has(`${module}:${action}`)) {
        return c.json({ error: `Insufficient permissions: ${module}:${action}` }, 403)
      }
      await next()
    },
}))

import { sendSMS } from '../../src/lib/sms'
import { integrationsApp } from '../../src/routes/integrations'

const mockSendSMS = vi.mocked(sendSMS)

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/integrations', integrationsApp)
  return app
}

type TestReply = {
  success?: boolean
  error?: string
  data: { ok: boolean; sent?: boolean; simulated?: boolean; reason?: string; error?: string }
}

async function runTest(body: unknown) {
  const res = await makeApp().request('/api/integrations/hubtel/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json()) as TestReply }
}

beforeEach(() => {
  state.allowed = new Set(['settings:read', 'settings:update'])
  state.credentials = { clientId: 'card-id', clientSecret: 'card-secret' }
  mockSendSMS.mockResolvedValue({ success: true, data: { messageId: 'hubtel-msg-1' } })
  // Nothing here may reach the network. A direct Hubtel call fails the way
  // the old address really did: its hostname does not resolve.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('POST /api/integrations/hubtel/test', () => {
  it('sends one test SMS to the number entered, under the configured sender, logged as a test', async () => {
    const { status, body } = await runTest({ phone: '0240000001' })

    expect(status).toBe(200)
    expect(body).toEqual({ success: true, data: { ok: true, sent: true } })
    expect(mockSendSMS).toHaveBeenCalledTimes(1)
    const [recipients, from, type, sentById] = mockSendSMS.mock.calls[0]
    expect(recipients).toHaveLength(1)
    expect(recipients[0].phone).toBe('0240000001')
    // One SMS segment: a test must not cost more than one message.
    expect(recipients[0].message.length).toBeGreaterThan(0)
    expect(recipients[0].message.length).toBeLessThanOrEqual(160)
    expect(from).toBeUndefined()
    expect(type).toBe('test')
    expect(sentById).toBe('u-admin')
  })

  it('says so when local development simulated the send instead of texting', async () => {
    mockSendSMS.mockResolvedValue({
      success: true,
      data: { simulated: true, reason: 'SMS_REDIRECT_PHONE is not set' },
    })

    const { body } = await runTest({ phone: '0240000001' })

    expect(body.data).toEqual({
      ok: true,
      sent: false,
      simulated: true,
      reason: 'SMS_REDIRECT_PHONE is not set',
    })
  })

  it("passes on Hubtel's own reason when Hubtel rejects the message", async () => {
    mockSendSMS.mockResolvedValue({
      success: false,
      error: 'Hubtel API error',
      details:
        '{"rate":0.0,"messageId":null,"status":11,"networkId":null,"clientReference":null,"statusDescription":"Invalid SenderId (From)"}',
    })

    const { body } = await runTest({ phone: '0240000001' })

    expect(body.data).toEqual({
      ok: false,
      error: 'Hubtel rejected the message: Invalid SenderId (From)',
    })
  })

  it('reports a failure that carries no Hubtel reason as is', async () => {
    mockSendSMS.mockResolvedValue({ success: false, error: 'fetch failed' })

    const { body } = await runTest({ phone: '0240000001' })

    expect(body.data).toEqual({ ok: false, error: 'fetch failed' })
  })

  it('asks for a phone number and sends nothing without one', async () => {
    const { status } = await runTest({})

    expect(status).toBe(400)
    expect(mockSendSMS).not.toHaveBeenCalled()
  })

  it('sends nothing when no Hubtel keys are configured', async () => {
    state.credentials = null

    const { body } = await runTest({ phone: '0240000001' })

    expect(body.data.ok).toBe(false)
    expect(mockSendSMS).not.toHaveBeenCalled()
  })

  it('needs settings:update, because a test SMS spends credit', async () => {
    state.allowed = new Set(['settings:read'])

    const { status } = await runTest({ phone: '0240000001' })

    expect(status).toBe(403)
    expect(mockSendSMS).not.toHaveBeenCalled()
  })
})
