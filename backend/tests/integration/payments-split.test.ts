/**
 * G03 — `POST /api/payments` takes one payment across several methods.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (G03) and step-10-handover.md.
 *
 * The body is either the one-method shape (`amount` + `method`) or `sources`, a list of
 * `{ method, amount }`. A list becomes one payment per method, all in one group; the answer says
 * so (`payments`, `paymentGroupId`). The total is worked out on the server from what was recorded:
 * the receipt text and the audit entry carry it, and a client-sent total is never trusted.
 *
 * Real route, real database, `sendSMS` captured. The service-level rules (accounts, allocation
 * order, atomicity, reversal and refund) are pinned in `legacy-payment.test.ts`.
 *
 * ── Safety ── commits fixtures; local Postgres only; the patient is named `IT …` so
 * `sweepLeakedFixtures` also removes its payments and journal entries.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/payments-split.test.ts
 */
import { Hono } from 'hono'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

const RAW_DB_URL = process.env.DATABASE_URL ?? ''
const IS_LOCAL = /@(localhost|127\.0\.0\.1|host\.docker\.internal)([:/]|$)/.test(RAW_DB_URL)
const skip = !IS_LOCAL

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://localhost:5433/framada',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    BETTER_AUTH_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
  },
  validateBackendEnv: vi.fn(),
  isSelfHealEnabled: () => false,
  isDevEnvironment: () => false,
  resolvedEnvironment: () => 'production',
}))
vi.mock('../../src/lib/rbac')
vi.mock('../../src/lib/audit', () => ({
  createAuditLog: vi.fn(),
  recordDiffAudit: vi.fn(),
  computeChangedFields: vi.fn(() => ({})),
  redactForAudit: vi.fn((row: unknown) => row),
  auditMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../src/lib/sms', () => ({
  sendSMS: vi.fn(async () => ({ success: true })),
}))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { asc, eq, sql } from 'drizzle-orm'
import { type DB, getDb } from '../../src/db'
import { patients, payments } from '../../src/db/schema'
import { createAuditLog } from '../../src/lib/audit'
import { issueInvoice } from '../../src/lib/invoice-service'
import { logError } from '../../src/lib/logger'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { sendSMS } from '../../src/lib/sms'
import { paymentsApp } from '../../src/routes/payments'
import { accountIdByCode, makeDraftInvoice, sweepLeakedFixtures } from './_fixtures'

const TAG = `split-${Date.now()}`
const PHONE = '0240000062'

interface PaymentRow {
  id: string
  method: string
  amount: number | string
  status: string
  paymentGroupId: string | null
}
interface PostBody {
  success?: boolean
  error?: string
  smsError?: string
  data?: PaymentRow
  payments?: PaymentRow[]
  paymentGroupId?: string | null
}

let db: DB
let app: Hono<HonoEnv>
let adminUserId: string
let patientId: string
let patientCount = 0

/** A fresh patient, so every test counts its own payments and nobody else's. */
async function newPatient() {
  const [p] = await db
    .insert(patients)
    .values({
      name: `IT Split ${TAG}-${++patientCount}`,
      dob: new Date('1990-01-01'),
      gender: 'other',
      phone: PHONE,
    })
    .returning({ id: patients.id })
  patientId = p.id
}

async function send(method: 'POST' | 'DELETE', path: string, payload?: Record<string, unknown>) {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  })
  let body: PostBody | null = null
  try {
    body = await res.json()
  } catch {
    /* empty */
  }
  return { status: res.status, body }
}

const pay = (extra: Record<string, unknown>) =>
  send('POST', '/api/payments', {
    patientId,
    description: 'Scaling & polish',
    ...extra,
  })

/** An issued invoice of `amount` pesewas for the current patient (committed; swept with it). */
async function issuedInvoiceOf(amount: number) {
  const revenueAccountId = await accountIdByCode(db, '4100')
  const { invoiceId } = await makeDraftInvoice(db, {
    patientId,
    userId: adminUserId,
    amount,
    revenueAccountId,
  })
  await issueInvoice(db, invoiceId, adminUserId)
  return invoiceId
}

async function paymentsOfPatient() {
  return db
    .select()
    .from(payments)
    .where(eq(payments.patientId, patientId))
    .orderBy(asc(payments.createdAt), asc(payments.paymentNumber))
}

const TWO_METHODS = [
  { method: 'cash', amount: 30000 },
  { method: 'card', amount: 20000 },
]

describe.skipIf(skip)('G03 — POST /api/payments with sources (local Postgres)', () => {
  beforeAll(async () => {
    db = getDb(RAW_DB_URL)
    await sweepLeakedFixtures()
    const users = await db.execute<{ id: string }>(
      sql`SELECT id FROM "user" ORDER BY "createdAt" LIMIT 1`
    )
    adminUserId = users.rows[0]?.id
    if (!adminUserId) throw new Error('No rows in "user" — run `pnpm --filter backend seed:admin`')
    app = new Hono<HonoEnv>()
    app.route('/api/payments', paymentsApp)
  })

  afterAll(async () => {
    if (!skip && db) await sweepLeakedFixtures()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(sendSMS).mockResolvedValue({ success: true } as never)
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: adminUserId,
      email: 'admin@deneldental.com',
      name: 'Admin',
      role: 'admin',
      roleId: 'admin',
    } as never)
    vi.mocked(checkPermission).mockResolvedValue(true)
    await newPatient()
  })

  describe('the one-method shape is unchanged', () => {
    it('answers with the payment, a list of one and no group', async () => {
      const { status, body } = await pay({ amount: 5000, method: 'cash' })

      expect(status, JSON.stringify(body)).toBe(200)
      expect(body?.success).toBe(true)
      expect(body?.data?.method).toBe('cash')
      expect(body?.payments).toHaveLength(1)
      expect(body?.payments?.[0].id).toBe(body?.data?.id)
      expect(body?.paymentGroupId).toBeNull()
      const stored = await paymentsOfPatient()
      expect(stored).toHaveLength(1)
      expect(stored[0].paymentGroupId).toBeNull()
    })
  })

  describe('a split payment', () => {
    it('records one payment per method, in one group, and says so', async () => {
      const { status, body } = await pay({ sources: TWO_METHODS })

      expect(status, JSON.stringify(body)).toBe(200)
      expect(body?.success).toBe(true)
      expect(body?.payments).toHaveLength(2)
      expect(body?.payments?.map((p) => [p.method, Number(p.amount)])).toEqual([
        ['cash', 30000],
        ['card', 20000],
      ])
      // `data` is the first payment, as the one-method shape's answer always was.
      expect(body?.data?.id).toBe(body?.payments?.[0].id)
      expect(body?.paymentGroupId).toBeTruthy()
      expect(new Set(body?.payments?.map((p) => p.paymentGroupId))).toEqual(
        new Set([body?.paymentGroupId])
      )

      const stored = await paymentsOfPatient()
      expect(stored).toHaveLength(2)
      expect(stored.map((p) => p.status)).toEqual(['posted', 'posted'])
      expect(stored.every((p) => p.paymentGroupId === body?.paymentGroupId)).toBe(true)
    })

    it('texts the patient once, with the combined total worked out on the server', async () => {
      const { status, body } = await pay({ sources: TWO_METHODS, sendNotification: true })

      expect(status, JSON.stringify(body)).toBe(200)
      expect(sendSMS).toHaveBeenCalledTimes(1)
      const [recipients] = vi.mocked(sendSMS).mock.calls[0]
      expect(recipients[0].phone).toBe(PHONE)
      // 300.00 cash + 200.00 card, not either alone.
      expect(recipients[0].message).toContain('GHS 500.00')
      expect(recipients[0].message).toContain('Scaling & polish')
    })

    it('sends no text when none was asked for', async () => {
      const { status, body } = await pay({ sources: TWO_METHODS })

      // (The split itself worked, so the silence is about the text and not about a refusal.)
      expect(status, JSON.stringify(body)).toBe(200)
      expect(sendSMS).not.toHaveBeenCalled()
    })

    it('a failed text still leaves the whole split recorded, as one success carrying smsError', async () => {
      vi.mocked(sendSMS).mockResolvedValueOnce({
        success: false,
        error: 'Hubtel API error',
      } as never)
      const { status, body } = await pay({ sources: TWO_METHODS, sendNotification: true })

      expect(status, JSON.stringify(body)).toBe(200)
      expect(body?.smsError).toBe('Hubtel API error')
      expect(body?.payments).toHaveLength(2)
      expect(await paymentsOfPatient()).toHaveLength(2)
    })

    it('writes one audit entry that names the group, its payments and the total', async () => {
      const { body } = await pay({ sources: TWO_METHODS })

      expect(createAuditLog).toHaveBeenCalledTimes(1)
      const entry = vi.mocked(createAuditLog).mock.calls[0][1] as unknown as {
        entityId: string
        changes: { total: number; paymentGroupId: string; paymentIds: string[] }
      }
      expect(entry.entityId).toBe(body?.data?.id)
      expect(entry.changes.total).toBe(50000)
      expect(entry.changes.paymentGroupId).toBe(body?.paymentGroupId)
      expect(entry.changes.paymentIds).toEqual(body?.payments?.map((p) => p.id))
    })

    it('a single entry in sources is one payment with no group', async () => {
      const { status, body } = await pay({ sources: [{ method: 'card', amount: 7000 }] })

      expect(status, JSON.stringify(body)).toBe(200)
      expect(body?.payments).toHaveLength(1)
      expect(body?.paymentGroupId).toBeNull()
      expect(body?.data?.method).toBe('card')
    })
  })

  describe('what is refused with a 400, recording nothing', () => {
    it.each([
      ['an empty list', { sources: [] }, 'sources must list at least one payment method'],
      [
        'a list that is not a list',
        { sources: 'cash' },
        'sources must list at least one payment method',
      ],
      ['a method with no name', { sources: [{ amount: 100 }] }, 'each payment needs a method'],
      [
        'an amount of nothing',
        { sources: [{ method: 'cash', amount: 0 }] },
        'each payment amount must be positive',
      ],
      [
        'a negative amount',
        { sources: [{ method: 'cash', amount: -5 }] },
        'each payment amount must be positive',
      ],
      [
        'a fraction of a pesewa',
        { sources: [{ method: 'cash', amount: 12.5 }] },
        'each payment amount must be a whole number of pesewas',
      ],
      [
        'an amount sent as text',
        { sources: [{ method: 'cash', amount: '300' }] },
        'each payment amount must be a whole number of pesewas',
      ],
      [
        'a method nobody knows',
        { sources: [{ method: 'banana', amount: 100 }] },
        'unknown payment method "banana"',
      ],
      [
        'a list together with a total',
        { sources: TWO_METHODS, amount: 50000 },
        'send the methods as sources, or one amount and method, not both',
      ],
      [
        'a list together with a method',
        { sources: TWO_METHODS, method: 'cash' },
        'send the methods as sources, or one amount and method, not both',
      ],
      [
        'a visit that does not exist',
        { sources: TWO_METHODS, appointmentId: '00000000-0000-0000-0000-000000000000' },
        'That visit does not exist',
      ],
    ])('%s', async (_what, extra, message) => {
      const { status, body } = await pay(extra)

      expect(status, JSON.stringify(body)).toBe(400)
      expect(body?.error).toBe(message)
      expect(await paymentsOfPatient()).toHaveLength(0)
      expect(sendSMS).not.toHaveBeenCalled()
    })

    it('more methods than a payment can be split across', async () => {
      const tooMany = Array.from({ length: 21 }, () => ({ method: 'cash', amount: 100 }))
      const { status, body } = await pay({ sources: tooMany })

      expect(status, JSON.stringify(body)).toBe(400)
      expect(body?.error).toMatch(/at most 20 methods/)
      expect(await paymentsOfPatient()).toHaveLength(0)
    })

    it('no patient', async () => {
      const { status, body } = await send('POST', '/api/payments', { sources: TWO_METHODS })
      expect(status).toBe(400)
      expect(body?.error).toBe('patientId is required')
    })

    it('still checks the one-method shape: no amount, no method', async () => {
      expect((await pay({ method: 'cash' })).body?.error).toBe('amount must be a positive number')
      expect((await pay({ amount: 100 })).body?.error).toBe('method is required')
      expect(await paymentsOfPatient()).toHaveLength(0)
    })
  })

  describe('a method that cannot be taken after the earlier ones were posted', () => {
    it('records none of the split', async () => {
      // The patient has no credit; the cash pays 100.00 of the invoice, then the wallet asks for
      // 200.00 it does not hold.
      const invoiceId = await issuedInvoiceOf(30000)
      const { status, body } = await pay({
        invoiceId,
        sources: [
          { method: 'cash', amount: 10000 },
          { method: 'wallet', amount: 20000 },
        ],
      })

      expect(status, JSON.stringify(body)).not.toBe(200)
      expect(body?.success).not.toBe(true)
      // The answer is a sentence; the ledger's own reason goes to the log.
      expect(body?.error).toBe('Failed to create payment')
      const logged = vi.mocked(logError).mock.calls.map(([err]) => String((err as Error)?.message))
      expect(logged.some((m) => /exceeds available credit/i.test(m))).toBe(true)
      expect(await paymentsOfPatient()).toHaveLength(0)
    })
  })

  // Review §8.16: payments.amount is a 32-bit integer of pesewas. A larger figure reached the
  // database; the answer is a sentence on every route that takes an amount, and nothing is kept.
  describe('an amount the database cannot hold', () => {
    const TOO_BIG = 2_147_483_648
    const SENTENCE = 'a payment amount must be at most GHS 21,474,836.47'

    it.each([
      ['the one-method shape', '/api/payments', { amount: TOO_BIG, method: 'cash' }],
      [
        'one method of a split',
        '/api/payments',
        {
          sources: [
            { method: 'cash', amount: 100 },
            { method: 'card', amount: TOO_BIG },
          ],
        },
      ],
      ['a draft', '/api/payments/draft', { amount: TOO_BIG, method: 'cash' }],
    ])('is refused in %s, with a sentence and nothing recorded', async (_what, path, extra) => {
      const { status, body } = await send('POST', path, { patientId, ...extra })

      expect(status, JSON.stringify(body)).toBe(400)
      expect(body?.error).toBe(SENTENCE)
      expect(await paymentsOfPatient()).toHaveLength(0)
    })

    it('still drafts the largest amount a payment can hold', async () => {
      const { status, body } = await send('POST', '/api/payments/draft', {
        patientId,
        amount: 2_147_483_647,
        method: 'cash',
      })

      expect(status, JSON.stringify(body)).toBe(200)
      expect(await paymentsOfPatient()).toHaveLength(1)
    })
  })

  describe('reversing one method of a split', () => {
    it('reverses that payment only and leaves the other posted', async () => {
      const { body } = await pay({ sources: TWO_METHODS })
      const [cash, card] = body?.payments ?? []

      const res = await send('POST', `/api/payments/${card.id}/reverse`, {
        reason: 'wrong terminal',
      })

      expect(res.status, JSON.stringify(res.body)).toBe(200)
      const stored = await paymentsOfPatient()
      expect(stored.find((p) => p.id === card.id)?.status).toBe('reversed')
      expect(stored.find((p) => p.id === cash.id)?.status).toBe('posted')
      // The group stays, so the receipt can still show both and say which was reversed.
      expect(stored.every((p) => p.paymentGroupId === body?.paymentGroupId)).toBe(true)
    })
  })
})
