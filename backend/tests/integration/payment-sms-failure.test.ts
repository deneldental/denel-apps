/**
 * F31 — a payment that is already committed must never be reported as failed
 * because its receipt SMS failed.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (F31, found in Step 3).
 *
 * `POST /api/payments` posts the payment and then texts the patient a receipt,
 * inside one `try`. `sendSMS` can throw (in production it does when Hubtel is not
 * configured), which landed in the catch and answered `500 "Failed to create
 * payment"` for a payment that was in the ledger. The cashier, told it failed,
 * charges again: a double charge caused by a text message. The portal already
 * has a "Payment recorded, but SMS failed" message waiting for a `smsError` the
 * server never sent.
 *
 * Real route, real database, `sendSMS` captured.
 *
 * ── Safety ── commits fixtures; local Postgres only; patients are named `IT …`
 * so `sweepLeakedFixtures` also removes their payments and journal entries.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/payment-sms-failure.test.ts
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

import { eq, sql } from 'drizzle-orm'
import { type DB, getDb } from '../../src/db'
import { patients, payments } from '../../src/db/schema'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { sendSMS } from '../../src/lib/sms'
import { paymentsApp } from '../../src/routes/payments'
import { sweepLeakedFixtures } from './_fixtures'

const TAG = `smsfail-${Date.now()}`
const PHONE = '0240000061'

let db: DB
let app: Hono<HonoEnv>
let adminUserId: string
let patientId: string

async function pay(extra: Record<string, unknown> = {}) {
  const res = await app.request('/api/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      patientId,
      amount: 5000,
      method: 'cash',
      description: 'Scaling & polish',
      sendNotification: true,
      ...extra,
    }),
  })
  let body: { success?: boolean; smsError?: string; data?: { id?: string } } | null = null
  try {
    body = await res.json()
  } catch {
    /* empty */
  }
  return { status: res.status, body }
}

async function paymentCount() {
  const rows = await db.select().from(payments).where(eq(payments.patientId, patientId))
  return rows.length
}

describe.skipIf(skip)(
  'F31 — a failed receipt SMS never turns a recorded payment into an error',
  () => {
    beforeAll(async () => {
      db = getDb(RAW_DB_URL)
      await sweepLeakedFixtures()
      const users = await db.execute<{ id: string }>(
        sql`SELECT id FROM "user" ORDER BY "createdAt" LIMIT 1`
      )
      adminUserId = users.rows[0]?.id
      if (!adminUserId)
        throw new Error('No rows in "user" — run `pnpm --filter backend seed:admin`')
      const [p] = await db
        .insert(patients)
        .values({
          name: `IT SmsFail ${TAG}`,
          dob: new Date('1990-01-01'),
          gender: 'other',
          phone: PHONE,
        })
        .returning({ id: patients.id })
      patientId = p.id
      app = new Hono<HonoEnv>()
      app.route('/api/payments', paymentsApp)
    })

    afterAll(async () => {
      if (!skip && db) await sweepLeakedFixtures()
    })

    beforeEach(() => {
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
    })

    it('control: with a working SMS the payment is recorded and the receipt is sent', async () => {
      const before = await paymentCount()
      const { status, body } = await pay()

      expect(status, JSON.stringify(body)).toBe(200)
      expect(body?.success).toBe(true)
      expect(body?.smsError).toBeUndefined()
      expect(await paymentCount()).toBe(before + 1)
      expect(sendSMS).toHaveBeenCalledTimes(1)
      const [recipients] = vi.mocked(sendSMS).mock.calls[0]
      expect(recipients[0].phone).toBe(PHONE)
      expect(recipients[0].message).toContain('GHS 50.00')
      expect(recipients[0].message).toContain('Scaling & polish')
    })

    it('sendSMS throws: the payment is still recorded and the answer is a success carrying smsError', async () => {
      vi.mocked(sendSMS).mockRejectedValueOnce(new Error('Hubtel credentials not configured'))
      const before = await paymentCount()
      const { status, body } = await pay()

      // The payment is in the ledger either way…
      expect(await paymentCount()).toBe(before + 1)
      // …so the answer must say so.
      expect(status, JSON.stringify(body)).toBe(200)
      expect(body?.success).toBe(true)
      expect(body?.data?.id).toBeTruthy()
      expect(body?.smsError).toContain('Hubtel credentials not configured')
    })

    it('sendSMS reports failure without throwing: still a success, with the reason', async () => {
      vi.mocked(sendSMS).mockResolvedValueOnce({
        success: false,
        error: 'Hubtel API error',
      } as never)
      const { status, body } = await pay()

      expect(status, JSON.stringify(body)).toBe(200)
      expect(body?.smsError).toBe('Hubtel API error')
    })

    it('a real failure before the payment exists is still an error and records nothing', async () => {
      const before = await paymentCount()
      const { status } = await pay({ amount: -5 })

      expect(status).toBe(400)
      expect(await paymentCount()).toBe(before)
    })
  }
)
