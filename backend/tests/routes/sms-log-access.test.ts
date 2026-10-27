/**
 * F01 — the SMS log routes. `/messages`, `/followup-appointments`, `/status/:id`
 * and `/retry/:id` only checked that SOMEONE was signed in, so every staff
 * session from every app (Team-app staff and lab technicians, HR trainers,
 * doctors) could read the log and resend any message at the clinic's expense.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (F01).
 *
 * Permission granularity is tested here with a mocked RBAC; the same routes are
 * driven with REAL sessions and roles in integration/sms-log-exposure.test.ts.
 */
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

const state = vi.hoisted(() => ({
  messagesArgs: [] as Array<Record<string, unknown>>,
  messagesRows: [] as Array<Record<string, unknown>>,
  followupCalls: 0,
  retryRow: null as null | Record<string, unknown>,
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
vi.mock('../../src/lib/rbac')
vi.mock('../../src/db', () => ({
  getDb: vi.fn(() => ({
    query: {
      smsMessages: {
        findMany: vi.fn(async (args: Record<string, unknown>) => {
          state.messagesArgs.push(args)
          return state.messagesRows
        }),
      },
      appointments: {
        findMany: vi.fn(async () => {
          state.followupCalls++
          return []
        }),
      },
    },
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (state.retryRow ? [state.retryRow] : []) }),
      }),
    }),
  })),
}))
vi.mock('../../src/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('../../src/lib/comms-cost', () => ({ recordCommsCost: vi.fn() }))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../src/lib/sms', () => ({
  sendSMS: vi.fn(async () => ({ success: true })),
  getHubtelCredentials: vi.fn(async () => ({ clientId: 'id', clientSecret: 'secret' })),
}))

import { recordCommsCost } from '../../src/lib/comms-cost'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { getHubtelCredentials, sendSMS } from '../../src/lib/sms'
import { smsApp } from '../../src/routes/sms'

const app = new Hono<HonoEnv>()
app.route('/api/sms', smsApp)

const USER = { id: 'u-1', email: 'u@x.test', name: 'U', role: null, roleId: 'receptionist' }
const ORDINARY_ROW = {
  id: 'row-1',
  recipient: '0240000001',
  content: 'Your appointment is tomorrow',
  patientId: null,
  from: 'Denel',
  type: 'appointment',
}

/** Grants exactly the (module, action) pairs listed. */
function grant(...pairs: Array<[string, string]>) {
  vi.mocked(checkPermission).mockImplementation(async (_c, _id, module, action) =>
    pairs.some(([m, a]) => m === module && a === action)
  )
}

let hubtelCalls = 0

beforeEach(() => {
  vi.clearAllMocks()
  state.messagesArgs.length = 0
  state.messagesRows = []
  state.followupCalls = 0
  state.retryRow = null
  hubtelCalls = 0
  vi.mocked(getCurrentUser).mockResolvedValue(USER as never)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      hubtelCalls++
      return new Response(JSON.stringify({ status: 'Delivered' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const READ_ROUTES: Array<[string, string]> = [
  ['GET', '/api/sms/followup-appointments'],
  ['GET', '/api/sms/messages'],
  ['GET', '/api/sms/status/msg-1'],
]

describe('F01 — the SMS log routes require a messaging permission', () => {
  it.each(READ_ROUTES)('%s %s: no session → 401', async (method, path) => {
    vi.mocked(getCurrentUser).mockResolvedValue(null as never)
    expect((await app.request(path, { method })).status).toBe(401)
  })

  it.each(
    READ_ROUTES
  )('%s %s: a session without messaging:read → 403 and nothing is touched', async (method, path) => {
    grant() // holds nothing
    const res = await app.request(path, { method })

    expect(res.status).toBe(403)
    expect(state.messagesArgs).toHaveLength(0)
    expect(state.followupCalls).toBe(0)
    expect(hubtelCalls).toBe(0)
    expect(getHubtelCredentials).not.toHaveBeenCalled()
  })

  it.each(READ_ROUTES)('%s %s: asks for messaging:read specifically', async (method, path) => {
    grant(['messaging', 'read'])
    const res = await app.request(path, { method })

    expect(res.status).toBe(200)
    expect(vi.mocked(checkPermission)).toHaveBeenCalledWith(
      expect.anything(),
      USER.id,
      'messaging',
      'read'
    )
  })

  it('POST /retry/:id: no session → 401', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null as never)
    expect((await app.request('/api/sms/retry/row-1', { method: 'POST' })).status).toBe(401)
  })

  it('POST /retry/:id: messaging:read alone is not enough → 403, nothing is sent', async () => {
    grant(['messaging', 'read'])
    state.retryRow = ORDINARY_ROW
    const res = await app.request('/api/sms/retry/row-1', { method: 'POST' })

    expect(res.status).toBe(403)
    expect(sendSMS).not.toHaveBeenCalled()
    expect(recordCommsCost).not.toHaveBeenCalled()
  })

  it('POST /retry/:id: with messaging:create an ordinary message is resent (control)', async () => {
    grant(['messaging', 'create'])
    state.retryRow = ORDINARY_ROW
    const res = await app.request('/api/sms/retry/row-1', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(sendSMS).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendSMS).mock.calls[0][0][0]).toMatchObject({
      phone: ORDINARY_ROW.recipient,
      message: ORDINARY_ROW.content,
    })
  })

  it('POST /retry/:id: an unknown id is a 404, not a send', async () => {
    grant(['messaging', 'create'])
    const res = await app.request('/api/sms/retry/nope', { method: 'POST' })
    expect(res.status).toBe(404)
    expect(sendSMS).not.toHaveBeenCalled()
  })
})

describe('F01 — a redacted message cannot be resent', () => {
  it.each([
    ['a redacted one-time code', '[sensitive message redacted]'],
    ['a message with its link token cut out', 'Hi Ama, confirm: https://x.test/c/[token redacted]'],
  ])('retrying %s → 400, nothing is sent or booked to the ledger', async (_label, content) => {
    grant(['messaging', 'create'])
    state.retryRow = { ...ORDINARY_ROW, content }
    const res = await app.request('/api/sms/retry/row-1', { method: 'POST' })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'SMS_REDACTED_NOT_RETRYABLE' })
    expect(sendSMS).not.toHaveBeenCalled()
    expect(recordCommsCost).not.toHaveBeenCalled()
  })
})

describe('F01 — GET /messages is bounded and returns only what the screens use', () => {
  beforeEach(() => grant(['messaging', 'read']))

  it('defaults to 200 rows (fetching one extra to know if there are more)', async () => {
    await app.request('/api/sms/messages')
    expect(state.messagesArgs[0]).toMatchObject({ limit: 201, offset: 0 })
  })

  it('honours limit and offset', async () => {
    await app.request('/api/sms/messages?limit=5&offset=10')
    expect(state.messagesArgs[0]).toMatchObject({ limit: 6, offset: 10 })
  })

  it('caps limit at 500', async () => {
    await app.request('/api/sms/messages?limit=99999')
    expect(state.messagesArgs[0].limit).toBe(501)
  })

  it.each([
    'abc',
    '0',
    '-4',
    '1.5',
  ])('ignores a bad limit (%s) and uses the default', async (bad) => {
    await app.request(`/api/sms/messages?limit=${bad}`)
    expect(state.messagesArgs[0].limit).toBe(201)
  })

  it('treats a negative or bad offset as 0', async () => {
    await app.request('/api/sms/messages?offset=-9')
    expect(state.messagesArgs[0].offset).toBe(0)
  })

  it('joins only the patient columns the screens use, not the whole patient record', async () => {
    await app.request('/api/sms/messages')
    expect(state.messagesArgs[0].with).toEqual({ patient: { columns: { id: true, name: true } } })
  })

  it('reports whether there is another page, and returns no more than the limit', async () => {
    state.messagesRows = Array.from({ length: 4 }, (_, i) => ({ id: `r${i}` }))
    const res = await app.request('/api/sms/messages?limit=3')
    const body = (await res.json()) as { data: unknown[]; pagination: Record<string, unknown> }

    expect(body.data).toHaveLength(3)
    expect(body.pagination).toEqual({ limit: 3, offset: 0, hasMore: true })
  })

  it('still filters by status (the Failed tab depends on it)', async () => {
    await app.request('/api/sms/messages?status=failed')
    expect(state.messagesArgs[0].where).toBeDefined()
  })
})

describe('F01 — GET /status/:id', () => {
  beforeEach(() => grant(['messaging', 'read']))

  it('encodes the id into the Hubtel URL so it cannot add path or query parts', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(String(url))
        return new Response(JSON.stringify({ status: 'Delivered' }), { status: 200 })
      })
    )
    await app.request('/api/sms/status/a%2Fb%3Fx%3D1')
    await app.request('/api/sms/status/a%2Fb%3Fx%3D1?isBatch=true')

    expect(urls).toEqual([
      'https://sms.hubtel.com/v1/messages/a%2Fb%3Fx%3D1',
      'https://sms.hubtel.com/v1/messages/batch/a%2Fb%3Fx%3D1',
    ])
  })

  it('a plain id is unchanged (control)', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(String(url))
        return new Response(JSON.stringify({ status: 'Delivered' }), { status: 200 })
      })
    )
    await app.request('/api/sms/status/msg-1')
    expect(urls).toEqual(['https://sms.hubtel.com/v1/messages/msg-1'])
  })
})
