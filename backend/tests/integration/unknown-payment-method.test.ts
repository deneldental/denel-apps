/**
 * Review of Step 10 (§8.16), D23 (decided by the owner 2026-10-27) — a payment method nobody knows
 * is refused, not posted to Cash.
 *
 * The multi-method form (`sources[]`, G03) already refused one. The one-method shape of
 * `POST /api/payments`, the draft step Receive Payment and the estimate confirm go through, and the
 * patient-app confirm quietly resolved any unknown or retired method to the Cash account, so a
 * mistyped or renamed method put the money in Cash without a word. Now each answers with a sentence
 * and records nothing; the patient-app confirm says why instead of failing bare.
 *
 * Real routes, real database.
 *
 * ── Safety ── commits fixtures; local Postgres only; every patient is named `IT …`, so
 * `sweepLeakedFixtures` removes it with its payments, invoices and confirmations. The one lookup
 * row this file touches (`transfer`) is restored in a `finally`.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/unknown-payment-method.test.ts
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
vi.mock('../../src/lib/push', () => ({ sendPushToPatients: vi.fn(async () => undefined) }))
vi.mock('../../src/lib/sms', () => ({
  sendSMS: vi.fn(async () => ({ success: true })),
}))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { eq, sql } from 'drizzle-orm'
import { type DB, getDb } from '../../src/db'
import { patients, paymentConfirmations, paymentMethods, payments } from '../../src/db/schema'
import { issueInvoice } from '../../src/lib/invoice-service'
import { getOrCreatePeriodFor } from '../../src/lib/period-service'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { paymentConfirmationsApp } from '../../src/routes/app-payments'
import { paymentsApp } from '../../src/routes/payments'
import { accountIdByCode, makeDraftInvoice, sweepLeakedFixtures } from './_fixtures'

const TAG = `unk-${Date.now()}`

type Json = Record<string, unknown>

let db: DB
let app: Hono<HonoEnv>
let adminUserId: string
let patientId: string
let count = 0

async function call(path: string, body: Json = {}) {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as Json & { data?: Json }
  return { status: res.status, body: json }
}

const paymentsOfPatient = () => db.select().from(payments).where(eq(payments.patientId, patientId))

describe.skipIf(skip)('D23 — an unknown payment method is refused (local Postgres)', () => {
  beforeAll(async () => {
    db = getDb(RAW_DB_URL)
    await sweepLeakedFixtures()
    await getOrCreatePeriodFor(db, new Date())
    const users = await db.execute<{ id: string }>(
      sql`SELECT id FROM "user" ORDER BY "createdAt" LIMIT 1`
    )
    adminUserId = users.rows[0]?.id
    if (!adminUserId) throw new Error('No rows in "user" — run `pnpm --filter backend seed:admin`')
    app = new Hono<HonoEnv>()
    app.route('/api/payments', paymentsApp)
    app.route('/api/payment-confirmations', paymentConfirmationsApp)
  })

  afterAll(async () => {
    if (!skip && db) await sweepLeakedFixtures()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: adminUserId,
      email: 'admin@deneldental.com',
      name: 'Admin',
      role: 'admin',
      roleId: 'admin',
    } as never)
    vi.mocked(checkPermission).mockResolvedValue(true)
    const [p] = await db
      .insert(patients)
      .values({ name: `IT Method ${TAG}-${++count}`, dob: new Date('1990-01-01'), gender: 'other' })
      .returning({ id: patients.id })
    patientId = p.id
  })

  describe('POST /api/payments, one method', () => {
    it('refuses it with a sentence and records nothing', async () => {
      const r = await call('/api/payments', { patientId, amount: 5000, method: 'banana' })

      expect(r.status, JSON.stringify(r.body)).toBe(400)
      expect(r.body.error).toBe('unknown payment method "banana"')
      expect(await paymentsOfPatient()).toHaveLength(0)
    })

    it('still takes a standard method (control)', async () => {
      const r = await call('/api/payments', { patientId, amount: 5000, method: 'card' })

      expect(r.status, JSON.stringify(r.body)).toBe(200)
      expect(await paymentsOfPatient()).toHaveLength(1)
    })
  })

  describe('POST /api/payments/draft', () => {
    it('refuses it with a sentence and creates no draft', async () => {
      const r = await call('/api/payments/draft', { patientId, amount: 5000, method: 'banana' })

      expect(r.status, JSON.stringify(r.body)).toBe(400)
      expect(r.body.error).toBe('unknown payment method "banana"')
      expect(await paymentsOfPatient()).toHaveLength(0)
    })

    it('still drafts a standard method (control)', async () => {
      const r = await call('/api/payments/draft', { patientId, amount: 5000, method: 'momo' })

      expect(r.status, JSON.stringify(r.body)).toBe(200)
      expect(await paymentsOfPatient()).toHaveLength(1)
    })
  })

  describe('the patient-app confirm', () => {
    async function pendingConfirmation() {
      const revenueAccountId = await accountIdByCode(db, '4100')
      const { invoiceId } = await makeDraftInvoice(db, {
        patientId,
        userId: adminUserId,
        amount: 5000,
        revenueAccountId,
      })
      await issueInvoice(db, invoiceId, adminUserId)
      const [conf] = await db
        .insert(paymentConfirmations)
        .values({ patientId, invoiceId, amount: 5000, status: 'pending' })
        .returning({ id: paymentConfirmations.id })
      return conf.id
    }

    /** Switch the method the app resolves to (`transfer`, for a method of no known type) off, run `fn`, restore. */
    async function withTransferRetired<T>(fn: () => Promise<T>): Promise<T> {
      const [existing] = await db
        .select()
        .from(paymentMethods)
        .where(eq(paymentMethods.name, 'transfer'))
      if (existing) {
        await db
          .update(paymentMethods)
          .set({ isActive: false })
          .where(eq(paymentMethods.name, 'transfer'))
      } else {
        await db.insert(paymentMethods).values({ name: 'transfer', isActive: false })
      }
      try {
        return await fn()
      } finally {
        if (existing) {
          await db
            .update(paymentMethods)
            .set({ isActive: existing.isActive })
            .where(eq(paymentMethods.name, 'transfer'))
        } else {
          await db.delete(paymentMethods).where(eq(paymentMethods.name, 'transfer'))
        }
      }
    }

    it('says why, and records nothing, when its method has been switched off', async () => {
      const id = await pendingConfirmation()

      const r = await withTransferRetired(() => call(`/api/payment-confirmations/${id}/confirm`))

      expect(r.status, JSON.stringify(r.body)).toBe(400)
      expect(r.body.error).toBe('unknown payment method "transfer"')
      expect(await paymentsOfPatient()).toHaveLength(0)
      const [conf] = await db
        .select()
        .from(paymentConfirmations)
        .where(eq(paymentConfirmations.id, id))
      expect(conf.status).toBe('pending')
    })

    it('still confirms with a method that is set up (control)', async () => {
      const id = await pendingConfirmation()

      const r = await call(`/api/payment-confirmations/${id}/confirm`)

      expect(r.status, JSON.stringify(r.body)).toBe(200)
      expect(await paymentsOfPatient()).toHaveLength(1)
    })
  })
})
