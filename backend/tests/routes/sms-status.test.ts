/**
 * GET /api/sms/status/:id must ask Hubtel with the same account that sends:
 * the Integrations keys first, the environment as the fallback. It used to
 * read the environment only, so keys saved in Integrations could send a
 * message but never check its delivery.
 */
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

type HubtelCard = { clientId: string; clientSecret: string; senderId: string }

const state = vi.hoisted(() => ({
  card: null as HubtelCard | null,
  /** The validated env the backend reads (config/env). */
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    BETTER_AUTH_URL: 'http://localhost:3000',
  } as Record<string, string | undefined>,
}))

vi.mock('../../src/config/env', () => ({
  env: state.env,
  validateBackendEnv: vi.fn(),
  isDevEnvironment: () => false,
  resolvedEnvironment: () => 'production',
}))
vi.mock('../../src/lib/rbac')
vi.mock('../../src/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('../../src/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('../../src/lib/comms-cost', () => ({ recordCommsCost: vi.fn() }))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../src/lib/branding', () => ({
  getBranding: vi.fn(async () => ({ smsSenderId: 'Denel' })),
}))
vi.mock('../../src/lib/integrations', () => ({
  getHubtelConfig: vi.fn(async () => state.card),
}))

import { getCurrentUser } from '../../src/lib/rbac'
import { smsApp } from '../../src/routes/sms'

const CARD: HubtelCard = { clientId: 'card-id', clientSecret: 'card-secret', senderId: 'Denel' }

/** Hubtel's reply shape for GET /v1/messages/:id. */
const DELIVERED = {
  rate: 0.03,
  batchId: null,
  messageId: 'msg-1',
  content: 'Your appointment is tomorrow',
  status: 'Delivered',
  updateTime: '2026-09-25T10:00:02',
  time: '2026-09-25T10:00:00',
  to: '233240000001',
  from: 'Denel',
}

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/sms', smsApp)
  return app
}

/** Keys "in the environment" — set where the backend could read them. */
function setEnvKeys(id: string | undefined, secret: string | undefined) {
  state.env.HUBTEL_CLIENT_ID = id
  state.env.HUBTEL_CLIENT_SECRET = secret
  vi.stubEnv('HUBTEL_CLIENT_ID', id)
  vi.stubEnv('HUBTEL_CLIENT_SECRET', secret)
}

function stubHubtel(): Array<{ url: string; auth: string | null }> {
  const requests: Array<{ url: string; auth: string | null }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') })
      return new Response(JSON.stringify(DELIVERED), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
  )
  return requests
}

beforeEach(() => {
  vi.mocked(getCurrentUser).mockResolvedValue({
    id: 'u-admin',
    email: 'admin@framada.app',
    name: 'Admin',
    role: 'admin',
    roleId: 'admin',
  } as never)
  setEnvKeys(undefined, undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  state.card = null
})

describe('GET /api/sms/status/:id — which Hubtel account it asks with', () => {
  it('uses the Integrations keys when the environment has none', async () => {
    state.card = CARD
    const hubtel = stubHubtel()

    const res = await makeApp().request('/api/sms/status/msg-1')

    expect(res.status).toBe(200)
    expect(hubtel).toEqual([
      {
        url: 'https://sms.hubtel.com/v1/messages/msg-1',
        auth: 'Basic Y2FyZC1pZDpjYXJkLXNlY3JldA==', // card-id:card-secret
      },
    ])
    const reply = (await res.json()) as { data: typeof DELIVERED }
    expect(reply.data.status).toBe('Delivered')
  })

  it('prefers the Integrations keys over the environment keys', async () => {
    state.card = CARD
    setEnvKeys('env-id', 'env-secret')
    const hubtel = stubHubtel()

    await makeApp().request('/api/sms/status/msg-1')

    expect(hubtel.map((r) => r.auth)).toEqual(['Basic Y2FyZC1pZDpjYXJkLXNlY3JldA=='])
  })

  it('falls back to the environment keys when Integrations has none', async () => {
    setEnvKeys('env-id', 'env-secret')
    const hubtel = stubHubtel()

    const res = await makeApp().request('/api/sms/status/msg-1')

    expect(res.status).toBe(200)
    expect(hubtel.map((r) => r.auth)).toEqual(['Basic ZW52LWlkOmVudi1zZWNyZXQ=']) // env-id:env-secret
  })

  it('does not call Hubtel when neither place has keys', async () => {
    const hubtel = stubHubtel()

    const res = await makeApp().request('/api/sms/status/msg-1')

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Hubtel not configured' })
    expect(hubtel).toHaveLength(0)
  })
})
