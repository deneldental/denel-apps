/**
 * Where an outgoing SMS goes, and which Hubtel account and sender it uses.
 *
 * `sendSMS` runs against the REAL env schema (`config/env.ts`), because part of
 * the local-development rule lives in that schema's defaults. Hubtel is a
 * `fetch` stub; the Integrations KV, branding and the database are faked at
 * their module edge.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

type HubtelCard = { clientId: string; clientSecret: string; senderId: string }

const state = vi.hoisted(() => ({
  card: null as HubtelCard | null,
  rows: [] as Array<Record<string, unknown>>,
}))

vi.mock('../../src/lib/integrations', () => ({
  getHubtelConfig: vi.fn(async () => state.card),
}))
vi.mock('../../src/lib/branding', () => ({
  getBranding: vi.fn(async () => ({ smsSenderId: 'BrandSender' })),
}))
vi.mock('../../src/db', () => ({
  getDb: vi.fn(() => ({
    insert: () => ({
      values: async (rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
        state.rows.push(...(Array.isArray(rows) ? rows : [rows]))
      },
    }),
  })),
}))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

/** Every variable that decides routing, pinned so the caller's shell cannot leak in. */
const BASE_ENV: Record<string, string | undefined> = {
  DATABASE_URL: 'postgresql://localhost:5432/test',
  BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
  BETTER_AUTH_URL: 'http://localhost:3000',
  // Local development is "neither variable set" — see resolvedEnvironment().
  NODE_ENV: undefined,
  APP_ENV: undefined,
  TRUSTED_IP_MODE: undefined,
  PRIVATE_FILE_REF_SECRET: undefined,
  SMS_REDIRECT_PHONE: undefined,
  SMS_STUB_FILE: undefined,
  HUBTEL_CLIENT_ID: undefined,
  HUBTEL_CLIENT_SECRET: undefined,
  HUBTEL_SENDER_ID: undefined,
}
// Everything a deployed instance must have to start (config/env.ts).
const PRODUCTION = {
  APP_ENV: 'production',
  TRUSTED_IP_MODE: 'off',
  PRIVATE_FILE_REF_SECRET: 'test-file-ref-secret-at-least-32-characters',
}

const CARD: HubtelCard = {
  clientId: 'card-id',
  clientSecret: 'card-secret',
  senderId: 'CardSender',
}
const PATIENT_SMS = [
  { phone: '0240000001', message: 'Your appointment is tomorrow', patientId: 'p-1' },
]

/** Fresh modules per test: validateBackendEnv() caches the parsed env. */
async function loadSms(overrides: Record<string, string | undefined> = {}) {
  vi.resetModules()
  for (const [name, value] of Object.entries({ ...BASE_ENV, ...overrides })) {
    vi.stubEnv(name, value)
  }
  const { validateBackendEnv } = await import('../../src/config/env')
  validateBackendEnv()
  return import('../../src/lib/sms')
}

type HubtelRequest = { url: string; auth: string | null; body: Record<string, unknown> }

/** Records every request to Hubtel and answers like Hubtel's single-send API. */
function stubHubtel(): HubtelRequest[] {
  const requests: HubtelRequest[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({
        url: String(url),
        auth: new Headers(init?.headers).get('authorization'),
        body: JSON.parse(String(init?.body ?? '{}')),
      })
      return new Response(
        JSON.stringify({
          rate: 0.03,
          messageId: 'hubtel-msg-1',
          status: 0,
          networkId: '62001',
          clientReference: null,
          statusDescription: 'Request successfully processed',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })
  )
  return requests
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  state.card = null
  state.rows.length = 0
})

describe('local development never texts a real recipient', () => {
  it('sends nothing without SMS_REDIRECT_PHONE, even with Hubtel keys saved', async () => {
    state.card = CARD
    const hubtel = stubHubtel()
    const { sendSMS } = await loadSms()

    const result = await sendSMS(PATIENT_SMS)

    expect(hubtel).toHaveLength(0)
    expect(result).toMatchObject({ success: true, data: { simulated: true } })
    // Still visible in the SMS log, addressed to the real recipient.
    expect(state.rows).toEqual([
      expect.objectContaining({ recipient: '0240000001', status: 'dev_simulated' }),
    ])
  })

  it('sends only to SMS_REDIRECT_PHONE when it is set', async () => {
    state.card = CARD
    const hubtel = stubHubtel()
    const { sendSMS } = await loadSms({ SMS_REDIRECT_PHONE: '0200000009' })

    await sendSMS(PATIENT_SMS)

    expect(hubtel).toHaveLength(1)
    expect(hubtel[0].url).toBe('https://sms.hubtel.com/v1/messages/send')
    expect(hubtel[0].body.To).toBe('233200000009')
    expect(hubtel[0].body.Content).toBe(
      '[Dev redirect from 0240000001] Your appointment is tomorrow'
    )
  })
})

describe('staging and production', () => {
  it('text the real recipient, ignoring SMS_REDIRECT_PHONE', async () => {
    state.card = CARD
    const hubtel = stubHubtel()
    const { sendSMS } = await loadSms({ ...PRODUCTION, SMS_REDIRECT_PHONE: '0200000009' })

    await sendSMS(PATIENT_SMS)

    expect(hubtel.map((r) => r.body.To)).toEqual(['233240000001'])
  })
})

describe('which Hubtel account and sender a message uses', () => {
  it('authenticates with the Integrations keys over the environment keys', async () => {
    state.card = CARD
    const hubtel = stubHubtel()
    const { sendSMS } = await loadSms({
      ...PRODUCTION,
      HUBTEL_CLIENT_ID: 'env-id',
      HUBTEL_CLIENT_SECRET: 'env-secret',
    })

    await sendSMS(PATIENT_SMS)

    expect(hubtel[0].auth).toBe('Basic Y2FyZC1pZDpjYXJkLXNlY3JldA==') // card-id:card-secret
  })

  it('falls back to the environment keys when Integrations has none', async () => {
    const hubtel = stubHubtel()
    const { sendSMS } = await loadSms({
      ...PRODUCTION,
      HUBTEL_CLIENT_ID: 'env-id',
      HUBTEL_CLIENT_SECRET: 'env-secret',
    })

    await sendSMS(PATIENT_SMS)

    expect(hubtel[0].auth).toBe('Basic ZW52LWlkOmVudi1zZWNyZXQ=') // env-id:env-secret
  })

  it('sends under the Integrations Sender ID when the caller names none, even with HUBTEL_SENDER_ID set', async () => {
    state.card = CARD
    const hubtel = stubHubtel()
    const { sendSMS } = await loadSms({ ...PRODUCTION, HUBTEL_SENDER_ID: 'EnvSender' })

    await sendSMS(PATIENT_SMS)

    expect(hubtel[0].body.From).toBe('CardSender')
  })
})
