/**
 * Who clinic email comes from. Every email — password resets (`src/email.ts`)
 * and portal/digest mail (`lib/email.ts`) alike — must go out as the clinic:
 * the From saved in Integrations → Branding, else RESEND_FROM_EMAIL, else the
 * clinic's real address. Never Resend's test sender (`onboarding@resend.dev`,
 * which only reaches the Resend account owner) or the old template address.
 *
 * Branding runs for real against a faked clinic_settings read; Resend is
 * faked at its SDK (password reset) and HTTP (portal mail) edges.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

type BrandingRow = { emailFromName: string; emailFromAddress: string }

const state = vi.hoisted(() => ({
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
  } as Record<string, string | undefined>,
  branding: null as BrandingRow | null,
  brandingLookupFails: false,
  sdkSends: [] as Array<Record<string, unknown>>,
}))

vi.mock('../../src/config/env', () => ({
  env: state.env,
  validateBackendEnv: vi.fn(),
  isDevEnvironment: () => false,
  resolvedEnvironment: () => 'production',
}))
vi.mock('../../src/db', () => ({
  getDb: vi.fn(() => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            if (state.brandingLookupFails) throw new Error('database unavailable')
            return state.branding ? [{ key: 'integration_branding', value: state.branding }] : []
          },
        }),
      }),
    }),
    insert: () => ({ values: async () => undefined }),
  })),
}))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))
vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (args: Record<string, unknown>) => {
        state.sdkSends.push(args)
        return { data: { id: 'resend-email-1' }, error: null }
      },
    }
  },
}))

import { sendEmail as sendAccountEmail } from '../../src/email'
import { sendEmail as sendClinicEmail } from '../../src/lib/email'

const RESET = { to: 'staff@example.com', subject: 'Reset your password', html: '<p>link</p>' }
const PORTAL_MAIL = [{ to: 'patient@example.com', subject: 'Hello', html: '<p>Hi</p>' }]
const KEYS = { RESEND_API_KEY: 're_test_key', DATABASE_URL: 'postgresql://localhost:5432/test' }

/** Captures the Resend HTTP request lib/email.ts makes. */
function stubResendHttp(): Array<Record<string, unknown>> {
  const bodies: Array<Record<string, unknown>> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify({ id: 'resend-email-2' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
  )
  return bodies
}

afterEach(() => {
  vi.unstubAllGlobals()
  state.env.RESEND_FROM_EMAIL = undefined
  state.branding = null
  state.brandingLookupFails = false
  state.sdkSends.length = 0
})

describe('password-reset email (src/email.ts)', () => {
  it('goes out as the clinic when nothing is configured', async () => {
    await sendAccountEmail(RESET, 're_test_key')

    expect(state.sdkSends.map((s) => s.from)).toEqual(['Denel Dental <info@deneldental.com>'])
  })

  it('uses the From saved in Integrations → Branding', async () => {
    state.branding = {
      emailFromName: 'Denel Dental Clinic',
      emailFromAddress: 'hello@deneldental.com',
    }

    await sendAccountEmail(RESET, 're_test_key')

    expect(state.sdkSends.map((s) => s.from)).toEqual([
      'Denel Dental Clinic <hello@deneldental.com>',
    ])
  })

  it('uses RESEND_FROM_EMAIL when Branding has no saved From', async () => {
    state.env.RESEND_FROM_EMAIL = 'desk@deneldental.com'

    await sendAccountEmail(RESET, 're_test_key')

    expect(state.sdkSends.map((s) => s.from)).toEqual(['Denel Dental <desk@deneldental.com>'])
  })
})

describe('portal and digest email (lib/email.ts)', () => {
  it('goes out as the clinic when nothing is configured', async () => {
    const sent = stubResendHttp()

    await sendClinicEmail(KEYS, PORTAL_MAIL)

    expect(sent.map((b) => b.from)).toEqual(['Denel Dental <info@deneldental.com>'])
  })

  it('still goes out as the clinic when the Branding lookup fails', async () => {
    state.brandingLookupFails = true
    state.env.RESEND_FROM_EMAIL = 'desk@deneldental.com'
    const sent = stubResendHttp()

    await sendClinicEmail(KEYS, PORTAL_MAIL)

    expect(sent.map((b) => b.from)).toEqual(['Denel Dental <desk@deneldental.com>'])
  })

  it('keeps a From the caller chose', async () => {
    const sent = stubResendHttp()

    await sendClinicEmail(KEYS, PORTAL_MAIL, 'Accounts <accounts@deneldental.com>')

    expect(sent.map((b) => b.from)).toEqual(['Accounts <accounts@deneldental.com>'])
  })
})
