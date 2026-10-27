/**
 * F01 — a message that carries a login/reset/registration code (or any bearer
 * credential) must never be stored in `sms_messages`, printed to the console, or
 * written to the log in clear text, on ANY of the six paths `sendSMS` can take.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (F01 / G10).
 *
 * The recipient still receives the real text; only what Denel keeps changes.
 *
 * Same harness as sms-delivery.test.ts: the real `sendSMS` against the real env
 * schema, Hubtel is a `fetch` stub, the database is a recorder.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type HubtelCard = { clientId: string; clientSecret: string; senderId: string }

const state = vi.hoisted(() => ({
  card: null as HubtelCard | null,
  rows: [] as Array<Record<string, unknown>>,
  logged: [] as string[],
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
vi.mock('../../src/lib/logger', () => {
  const record =
    (level: string) =>
    (...args: unknown[]) => {
      state.logged.push(`${level} ${JSON.stringify(args)}`)
    }
  return {
    logError: (...args: unknown[]) => record('logError')(...args),
    logger: {
      info: record('info'),
      error: record('error'),
      warn: record('warn'),
      debug: record('debug'),
    },
  }
})

const BASE_ENV: Record<string, string | undefined> = {
  DATABASE_URL: 'postgresql://localhost:5432/test',
  BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
  BETTER_AUTH_URL: 'http://localhost:3000',
  NODE_ENV: undefined,
  APP_ENV: undefined,
  TRUSTED_IP_MODE: undefined,
  PRIVATE_FILE_REF_SECRET: undefined,
  PORTAL_URL: undefined,
  PATIENT_PORTAL_URL: undefined,
  SMS_REDIRECT_PHONE: undefined,
  SMS_STUB_FILE: undefined,
  HUBTEL_CLIENT_ID: undefined,
  HUBTEL_CLIENT_SECRET: undefined,
  HUBTEL_SENDER_ID: undefined,
}
const PRODUCTION = {
  APP_ENV: 'production',
  TRUSTED_IP_MODE: 'off',
  PRIVATE_FILE_REF_SECRET: 'test-file-ref-secret-at-least-32-characters',
  PORTAL_URL: 'https://portal.deneldental.com',
  PATIENT_PORTAL_URL: 'https://app.deneldental.com',
}
const CARD: HubtelCard = {
  clientId: 'card-id',
  clientSecret: 'card-secret',
  senderId: 'CardSender',
}

/** Recognisable on purpose: if it shows up anywhere we keep, the test says so. */
const CODE = '482913'
const OTP_TEXT = `Denel: your staff portal login code is ${CODE}. Valid for 10 minutes.`
const REDACTED = '[sensitive message redacted]'

async function loadSms(overrides: Record<string, string | undefined> = {}) {
  vi.resetModules()
  for (const [name, value] of Object.entries({ ...BASE_ENV, ...overrides })) {
    vi.stubEnv(name, value)
  }
  const { validateBackendEnv } = await import('../../src/config/env')
  validateBackendEnv()
  return import('../../src/lib/sms')
}

type Sent = { url: string; body: Record<string, unknown> }

/** Hubtel stub: records requests; `reply` decides the answer, `reply: 'throw'` simulates a network failure. */
function stubHubtel(reply: 'ok-single' | 'ok-batch' | 'ok-batch-bare' | 'fail' | 'throw'): Sent[] {
  const sent: Sent[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'))
      sent.push({ url: String(url), body })
      if (reply === 'throw') throw new Error('network down')
      if (reply === 'fail') return new Response('upstream said no', { status: 500 })
      const json =
        reply === 'ok-single'
          ? { messageId: 'hubtel-msg-1', status: 0 }
          : reply === 'ok-batch'
            ? {
                batchId: 'b-1',
                messages: (body.personalizedRecipients as unknown[]).map((_, i) => ({
                  messageId: `m-${i}`,
                  status: 'sent',
                })),
              }
            : { batchId: 'b-2' }
      return new Response(JSON.stringify(json), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
  )
  return sent
}

let consoleOut: string[] = []

beforeEach(() => {
  consoleOut = []
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    consoleOut.push(args.map(String).join(' '))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  state.card = null
  state.rows.length = 0
  state.logged.length = 0
})

/** Everything Denel keeps or prints: stored rows, log lines, console output. */
function everythingKept(): string {
  return JSON.stringify(state.rows) + state.logged.join('\n') + consoleOut.join('\n')
}

const SENSITIVE = [{ phone: '0240000001', message: OTP_TEXT, patientId: 'p-1', sensitive: true }]
const SENSITIVE_PAIR = [
  { phone: '0240000001', message: OTP_TEXT, sensitive: true },
  { phone: '0240000002', message: OTP_TEXT, sensitive: true },
]

describe('F01 — a sensitive message is redacted on every path sendSMS can take', () => {
  it('dev-simulated (no Hubtel keys): row, console and log carry no code', async () => {
    const { sendSMS } = await loadSms()
    await sendSMS(SENSITIVE)

    expect(state.rows).toEqual([
      expect.objectContaining({ status: 'dev_simulated', content: REDACTED }),
    ])
    expect(everythingKept()).not.toContain(CODE)
  })

  it('Hubtel rejects the request: the failed row carries no code', async () => {
    state.card = CARD
    const sent = stubHubtel('fail')
    const { sendSMS } = await loadSms(PRODUCTION)
    await sendSMS(SENSITIVE)

    // The recipient still gets the real text.
    expect(sent[0].body.Content).toContain(CODE)
    expect(state.rows).toEqual([expect.objectContaining({ batchId: 'FAILED', content: REDACTED })])
    expect(everythingKept()).not.toContain(CODE)
  })

  it('single send succeeds: the stored row carries no code', async () => {
    state.card = CARD
    const sent = stubHubtel('ok-single')
    const { sendSMS } = await loadSms(PRODUCTION)
    await sendSMS(SENSITIVE)

    expect(sent[0].body.Content).toContain(CODE)
    expect(state.rows).toEqual([expect.objectContaining({ status: 'sent', content: REDACTED })])
    expect(everythingKept()).not.toContain(CODE)
  })

  it('batch send succeeds with per-message ids: no stored row carries the code', async () => {
    state.card = CARD
    const sent = stubHubtel('ok-batch')
    const { sendSMS } = await loadSms(PRODUCTION)
    await sendSMS(SENSITIVE_PAIR)

    expect(JSON.stringify(sent[0].body)).toContain(CODE)
    expect(state.rows).toHaveLength(2)
    for (const row of state.rows) expect(row.content).toBe(REDACTED)
    expect(everythingKept()).not.toContain(CODE)
  })

  it('batch send succeeds without per-message ids (fallback insert): no code stored', async () => {
    state.card = CARD
    stubHubtel('ok-batch-bare')
    const { sendSMS } = await loadSms(PRODUCTION)
    await sendSMS(SENSITIVE_PAIR)

    expect(state.rows).toHaveLength(2)
    for (const row of state.rows) expect(row.content).toBe(REDACTED)
    expect(everythingKept()).not.toContain(CODE)
  })

  it('the request throws (network down): the error row carries no code', async () => {
    state.card = CARD
    stubHubtel('throw')
    const { sendSMS } = await loadSms(PRODUCTION)
    const result = await sendSMS(SENSITIVE)

    expect(result.success).toBe(false)
    expect(state.rows).toEqual([expect.objectContaining({ batchId: 'ERROR', content: REDACTED })])
    expect(everythingKept()).not.toContain(CODE)
  })

  it('dev redirect: the "[Dev redirect from …]" prefix does not bring the code back', async () => {
    state.card = CARD
    const sent = stubHubtel('ok-single')
    const { sendSMS } = await loadSms({ SMS_REDIRECT_PHONE: '0200000009' })
    await sendSMS(SENSITIVE)

    expect(sent[0].body.Content).toContain(CODE)
    expect(state.rows).toEqual([expect.objectContaining({ content: REDACTED })])
    expect(everythingKept()).not.toContain(CODE)
  })
})

describe('F01 — storedMessage: keep the message, drop only the credential inside it', () => {
  const LINK = 'https://app.example.test/c/6b0f2c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f'
  const CONFIRM = {
    phone: '0240000001',
    message: `Hi Ama, confirm or cancel: ${LINK}`,
    storedMessage: 'Hi Ama, confirm or cancel: https://app.example.test/c/[token redacted]',
  }

  it('stores the override and sends the real text', async () => {
    state.card = CARD
    const sent = stubHubtel('ok-single')
    const { sendSMS } = await loadSms(PRODUCTION)
    await sendSMS([CONFIRM], undefined, 'appointment')

    expect(sent[0].body.Content).toContain(LINK)
    expect(state.rows).toEqual([expect.objectContaining({ content: CONFIRM.storedMessage })])
    expect(everythingKept()).not.toContain('6b0f2c1e')
  })

  it('also in dev-simulated mode (console and log)', async () => {
    const { sendSMS } = await loadSms()
    await sendSMS([CONFIRM], undefined, 'appointment')

    expect(state.rows).toEqual([expect.objectContaining({ content: CONFIRM.storedMessage })])
    expect(everythingKept()).not.toContain('6b0f2c1e')
  })
})

describe('F01 — controls: ordinary messages are untouched', () => {
  const PLAIN = { phone: '0240000001', message: 'Your appointment is tomorrow at 9am' }

  it('an ordinary message is stored word for word on every path', async () => {
    state.card = CARD
    stubHubtel('ok-single')
    const { sendSMS } = await loadSms(PRODUCTION)
    await sendSMS([PLAIN])
    expect(state.rows).toEqual([expect.objectContaining({ content: PLAIN.message })])
  })

  it('a mixed batch redacts only the sensitive recipient', async () => {
    state.card = CARD
    stubHubtel('ok-batch')
    const { sendSMS } = await loadSms(PRODUCTION)
    await sendSMS([PLAIN, { phone: '0240000002', message: OTP_TEXT, sensitive: true }])

    expect(state.rows.map((r) => r.content)).toEqual([PLAIN.message, REDACTED])
  })

  it('the redacted body is a single shared constant (retry and purge key off it)', async () => {
    const mod = await import('../../src/lib/sms-redaction')
    expect(mod.REDACTED_SMS_BODY).toBe(REDACTED)
    expect(mod.isRedactedSmsContent(REDACTED)).toBe(true)
    expect(mod.isRedactedSmsContent('Hi Ama, confirm: https://x.test/c/[token redacted]')).toBe(
      true
    )
    expect(mod.isRedactedSmsContent(PLAIN.message)).toBe(false)
  })
})
