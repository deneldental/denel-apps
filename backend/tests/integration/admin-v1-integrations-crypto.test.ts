/**
 * admin-v1 §21.2 + §21.3 — integration-secret encryption + Resend email gateway.
 *
 * Two concerns, no real DB or network required (this file is unit-style; it runs
 * under `pnpm --filter backend test` even WITHOUT Doppler):
 *
 *   §21.2 — AES-256-GCM envelope crypto (lib/crypto.ts) and the integrations KV
 *           layer (lib/integrations.ts): encrypt-on-write / decrypt-on-read with
 *           a decrypt-or-passthrough read so legacy PLAINTEXT rows keep working
 *           pre-backfill, plus the masked-read (maskTail / mergeSecrets) contract.
 *
 *   §21.3 — lib/email.ts actually POSTs to Resend when RESEND_API_KEY is set;
 *           `global.fetch` is stubbed so we assert the request shape + the
 *           success/failure result shaping without sending mail.
 *
 * Strategy mirrors tests/routes/analytics.test.ts: `vi.mock` the env + db + side
 * modules (hoisted before imports) so the units under test get a deterministic
 * key and an in-memory KV instead of touching Postgres.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Module mocks (hoisted before any import of the units under test) ──────────

// Deterministic secret so crypto derives a stable key without Doppler/validate.
vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    BETTER_AUTH_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
  },
  validateBackendEnv: vi.fn(),
}))

// In-memory KV standing in for clinic_settings. The integrations layer calls
// getDb(...).select()/insert() — we hand it a tiny fake whose chained builders
// resolve against this Map, so encrypt-on-write / decrypt-on-read is exercised
// end-to-end against the REAL crypto without a database.
const kvStore = new Map<string, unknown>()

vi.mock('../../src/db', () => {
  const makeSelect = () => ({
    from: () => ({
      where: (predicate: { key: string }) => ({
        limit: () => {
          const key = predicate.key
          const value = kvStore.get(key)
          return value === undefined ? [] : [{ key, value }]
        },
      }),
    }),
  })
  const makeInsert = () => ({
    values: (row: { key: string; value: unknown }) => ({
      // setter path: onConflictDoUpdate writes the (possibly encrypted) blob.
      onConflictDoUpdate: ({ set }: { set: { value: unknown } }) => {
        kvStore.set(row.key, set.value)
        return Promise.resolve()
      },
    }),
  })
  const fakeDb = {
    select: makeSelect,
    insert: makeInsert,
  }
  return { getDb: vi.fn(() => fakeDb) }
})

// `eq(col, val)` → a plain predicate the fake `where` can read `.key` off of.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  return {
    ...actual,
    eq: (_col: unknown, val: string) => ({ key: val }),
  }
})

// Schema is referenced only for table identity; a stub shape is enough here.
vi.mock('../../src/db/schema', () => ({
  clinicSettings: { key: 'key', value: 'value' },
  emailMessages: {},
}))

vi.mock('../../src/lib/branding', () => ({
  getEmailFrom: vi.fn(async () => 'Denel Dental <info@deneldental.com>'),
}))

vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

// ── Imports (after mocks are hoisted) ─────────────────────────────────────────

import {
  decryptJson,
  decryptSecret,
  encryptJson,
  encryptSecret,
  isEncryptedBlob,
} from '../../src/lib/crypto'
import { sendEmail } from '../../src/lib/email'
import {
  getHubtelConfig,
  type HubtelConfig,
  maskTail,
  mergeSecrets,
  SECRET_SENTINEL,
  setHubtelConfig,
} from '../../src/lib/integrations'

beforeEach(() => {
  kvStore.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── §21.2 — AES-256-GCM envelope round-trip ───────────────────────────────────

describe('admin-v1 §21.2 — crypto envelope round-trip', () => {
  it('encryptSecret → decryptSecret recovers the exact plaintext', () => {
    const plaintext = 'sk_live_super-secret-resend-key-1234567890'
    const blob = encryptSecret(plaintext)

    expect(isEncryptedBlob(blob)).toBe(true)
    expect(blob.v).toBe(1)
    // Ciphertext must NOT contain the plaintext anywhere on the wire.
    expect(blob.ct).not.toContain('resend')
    expect(JSON.stringify(blob)).not.toContain('super-secret')

    expect(decryptSecret(blob)).toBe(plaintext)
  })

  it('encryptJson → decryptJson round-trips a structured config object', () => {
    const cfg = { clientId: 'cid-1', clientSecret: 'cs-9', senderId: 'FRAMADA' }
    const blob = encryptJson(cfg)
    expect(decryptJson<typeof cfg>(blob)).toEqual(cfg)
  })

  it('a fresh IV per call makes two encryptions of the same plaintext differ', () => {
    const a = encryptSecret('same-input')
    const b = encryptSecret('same-input')
    expect(a.ct).not.toBe(b.ct)
    expect(a.iv).not.toBe(b.iv)
    // …yet both decrypt back to the same value.
    expect(decryptSecret(a)).toBe('same-input')
    expect(decryptSecret(b)).toBe('same-input')
  })

  it('tamper detection: a flipped auth tag fails closed (returns null, never throws)', () => {
    const blob = encryptSecret('do-not-tamper')
    const tampered = { ...blob, tag: blob.tag.replace(/.$/, (ch) => (ch === '0' ? '1' : '0')) }
    expect(decryptSecret(tampered)).toBeNull()
    expect(decryptJson(tampered)).toBeNull()
  })

  it('isEncryptedBlob distinguishes envelopes from plaintext/garbage', () => {
    expect(isEncryptedBlob(encryptSecret('x'))).toBe(true)
    expect(isEncryptedBlob('plaintext')).toBe(false)
    expect(isEncryptedBlob({ foo: 'bar' })).toBe(false)
    expect(isEncryptedBlob(null)).toBe(false)
    expect(isEncryptedBlob(undefined)).toBe(false)
    // Wrong version is not accepted by the current codec.
    expect(isEncryptedBlob({ v: 2, iv: 'a', ct: 'b', tag: 'c' })).toBe(false)
  })
})

// ── §21.2 — integrations KV: encrypt-on-write / decrypt-on-read + legacy ───────

describe('admin-v1 §21.2 — integrations KV encryption at rest', () => {
  it('setHubtelConfig stores an ENCRYPTED envelope; getHubtelConfig decrypts it', async () => {
    const cfg: HubtelConfig = {
      clientId: 'hub-client-id',
      clientSecret: 'hub-client-secret-xyz',
      senderId: 'FRAMADA',
    }
    await setHubtelConfig(cfg, 'user-1')

    // On disk: an envelope, NOT cleartext — the secret never sits in the KV raw.
    const stored = kvStore.get('integration_hubtel')
    expect(isEncryptedBlob(stored)).toBe(true)
    expect(JSON.stringify(stored)).not.toContain('hub-client-secret-xyz')

    // Read path decrypts transparently.
    const read = await getHubtelConfig()
    expect(read).toEqual(cfg)
  })

  it('legacy plaintext rows pass through unchanged (decrypt-or-passthrough)', async () => {
    // Simulate a row written before encryption shipped: a raw JSON object.
    const legacy: HubtelConfig = {
      clientId: 'legacy-id',
      clientSecret: 'legacy-secret',
      senderId: 'OLD',
    }
    kvStore.set('integration_hubtel', legacy)

    const read = await getHubtelConfig()
    expect(read).toEqual(legacy)
  })

  it('a row encrypted under a DIFFERENT key reads as null (treated as not-configured)', async () => {
    // Hand-roll an envelope shape whose tag cannot validate under the test key.
    kvStore.set('integration_hubtel', {
      v: 1,
      iv: '00000000000000000000000000',
      ct: 'deadbeef',
      tag: '00000000000000000000000000000000',
    })
    expect(await getHubtelConfig()).toBeNull()
  })

  it('missing key reads as null', async () => {
    expect(await getHubtelConfig()).toBeNull()
  })
})

// ── §21.2 — masked-read contract (unchanged by encryption) ────────────────────

describe('admin-v1 §21.2 — masked-read contract', () => {
  it('maskTail shows only the last 4 chars (or full mask for short secrets)', () => {
    expect(maskTail('sk_live_abcdwxyz')).toBe('••••wxyz')
    expect(maskTail('ab')).toBe('••••')
    expect(maskTail('')).toBeNull()
    expect(maskTail(null)).toBeNull()
    expect(maskTail(undefined)).toBeNull()
  })

  it('mergeSecrets keeps the existing secret when the sentinel comes back', () => {
    const existing: HubtelConfig = {
      clientId: 'keep-id',
      clientSecret: 'KEEP-THIS-SECRET',
      senderId: 'OLD',
    }
    // Frontend re-sends the sentinel for the untouched secret, changes senderId.
    const merged = mergeSecrets<HubtelConfig>(
      { clientSecret: SECRET_SENTINEL, senderId: 'NEW' },
      existing,
      ['clientSecret']
    )
    expect(merged.clientSecret).toBe('KEEP-THIS-SECRET')
    expect(merged.senderId).toBe('NEW')
    expect(merged.clientId).toBe('keep-id')
  })

  it('mergeSecrets accepts a genuinely new secret value', () => {
    const existing: HubtelConfig = {
      clientId: 'id',
      clientSecret: 'OLD-SECRET',
      senderId: 'X',
    }
    const merged = mergeSecrets<HubtelConfig>({ clientSecret: 'BRAND-NEW-SECRET' }, existing, [
      'clientSecret',
    ])
    expect(merged.clientSecret).toBe('BRAND-NEW-SECRET')
  })
})

// ── §21.3 — Resend email gateway ──────────────────────────────────────────────

const ENV = { RESEND_API_KEY: 're_test_key_123', DATABASE_URL: 'postgresql://localhost/test' }

describe('admin-v1 §21.3 — Resend email send', () => {
  it('POSTs a single email to the Resend /emails endpoint with the bearer key', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 'resend-msg-1' }),
    })) as unknown as typeof fetch
    vi.stubGlobal('fetch', fetchMock)

    const res = await sendEmail(
      ENV,
      [{ to: 'pat@example.com', subject: 'Hi', html: '<p>Hello</p>' }],
      'Framada <clinic@framada.app>',
      'custom',
      'user-1'
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer re_test_key_123')
    const sent = JSON.parse(init.body)
    expect(sent.to).toEqual(['pat@example.com'])
    expect(sent.subject).toBe('Hi')

    expect(res.success).toBe(true)
    expect(res.sent).toBe(1)
    expect(res.failed).toBe(0)
  })

  it('uses the batch endpoint when sending more than one recipient', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 'b1' }, { id: 'b2' }] }),
    })) as unknown as typeof fetch
    vi.stubGlobal('fetch', fetchMock)

    const res = await sendEmail(
      ENV,
      [
        { to: 'a@example.com', subject: 'S', html: '<p>a</p>' },
        { to: 'b@example.com', subject: 'S', html: '<p>b</p>' },
      ],
      'Framada <clinic@framada.app>',
      'bulk',
      'user-1'
    )

    const [url] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails/batch')
    expect(res.success).toBe(true)
    expect(res.sent).toBe(2)
  })

  it('surfaces a per-recipient failure (non-OK Resend response) without throwing', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 422,
      text: async () => 'invalid recipient',
    })) as unknown as typeof fetch
    vi.stubGlobal('fetch', fetchMock)

    const res = await sendEmail(
      ENV,
      [{ to: 'bad', subject: 'S', html: '<p>x</p>' }],
      'Framada <clinic@framada.app>',
      'custom',
      'user-1'
    )

    expect(res.success).toBe(false)
    expect(res.failed).toBe(1)
    expect(res.sent).toBe(0)
    expect(res.results[0].error).toContain('invalid recipient')
  })

  it('throws when RESEND_API_KEY is missing (clean skip is the caller route 503)', async () => {
    await expect(
      sendEmail({ RESEND_API_KEY: '', DATABASE_URL: ENV.DATABASE_URL }, [
        { to: 'x@example.com', subject: 'S', html: '<p>x</p>' },
      ])
    ).rejects.toThrow(/RESEND_API_KEY/)
  })
})
