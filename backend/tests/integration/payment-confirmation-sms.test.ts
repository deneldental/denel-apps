/**
 * G08 — the payment-confirmation text from the modern posting paths: Receive Payment's draft → post
 * (`POST /api/payments/:id/post`) and the estimate confirm (`POST /api/worklist/:id/confirm`).
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (G08) and step-10-handover.md.
 *
 * Sent only when asked for (`sendSms: true`). The amount is what was COMMITTED: the posted payments
 * of the event (one payment, or every posted payment of its group), never a figure from the caller.
 * An event is texted at most once: a dedupe key per group (or per payment) is claimed in
 * `payment_sms_sends` before anything is sent, so a replayed post or a second request sends nothing.
 * A plan payment uses the "with balance" wording, the balance being what the plan's invoices still
 * owe. No phone, no text. A text that fails is reported as `smsError` and never fails the payment.
 *
 * Real routes, real database; `sendSMS` is captured, so no provider is called and no SMS cost
 * reaches the ledger.
 *
 * ── Safety ── commits fixtures; local Postgres only; every patient is named `IT …`, so
 * `sweepLeakedFixtures` removes it with its invoices, payments, journal entries and texts.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/payment-confirmation-sms.test.ts
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

import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { type DB, getDb } from '../../src/db'
import { invoices, patients, paymentPlans, paymentSmsSends, payments } from '../../src/db/schema'
import { getOrCreatePeriodFor } from '../../src/lib/period-service'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { sendSMS } from '../../src/lib/sms'
import { paymentsApp } from '../../src/routes/payments'
import { worklistApp } from '../../src/routes/worklist'
import {
  accountIdByCode,
  makeDraftInvoice,
  sweepLeakedFixtures,
  uniqueDocNumber,
} from './_fixtures'

const TAG = `sms-${Date.now()}`
const PHONE = '0240000081'
const GUARDIAN = '0240000082'

type Json = Record<string, unknown>

let db: DB
let app: Hono<HonoEnv>
let adminUserId: string
let patientId: string
let patientCount = 0

async function newPatient(over: Partial<typeof patients.$inferInsert> = {}) {
  const [p] = await db
    .insert(patients)
    .values({
      name: `IT Sms ${TAG}-${++patientCount}`,
      dob: new Date('1990-01-01'),
      gender: 'other',
      phone: PHONE,
      ...over,
    })
    .returning({ id: patients.id })
  patientId = p.id
  return p.id
}

async function call(path: string, body: Json = {}) {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as Json & { data?: Json }
  return { status: res.status, body: json }
}

/** A draft payment through the real route; returns its id. */
async function draft(body: Json) {
  const r = await call('/api/payments/draft', { patientId, method: 'cash', ...body })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  return (r.body.data as Json).id as string
}

const post = (id: string, body: Json = {}) => call(`/api/payments/${id}/post`, body)

const texts = () => vi.mocked(sendSMS).mock.calls
const textOf = (n = 0) => {
  const recipients = texts()[n][0] as Array<{ phone: string; message: string }>
  return recipients[0]
}

async function sends(key: string) {
  return db.select().from(paymentSmsSends).where(eq(paymentSmsSends.dedupeKey, key))
}

describe.skipIf(skip)('G08 — payment-confirmation SMS (local Postgres)', () => {
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
    app.route('/api/worklist', worklistApp)
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

  describe('POST /api/payments/:id/post', () => {
    it('texts the patient the amount that was posted, when asked, and records the text', async () => {
      // Allocated to nothing, so the text names what the payment itself says it was for.
      const id = await draft({ amount: 15000, description: 'Night guard - fitting' })

      const r = await post(id, { sendSms: true })

      expect(r.status, JSON.stringify(r.body)).toBe(200)
      expect(r.body.smsError).toBeUndefined()
      expect(texts()).toHaveLength(1)
      expect(textOf().phone).toBe(PHONE)
      expect(textOf().message).toContain('GHS 150.00')
      expect(textOf().message).toContain('for Night guard')
      const [row] = await sends(`payment:${id}`)
      expect(row).toMatchObject({ paymentId: id, patientId, amount: 15000, status: 'sent' })
    })

    // Review §8.16: a body that parses to `null` made the handler read `null.sendSms` AFTER the
    // posting, so the payment was posted and the answer said it failed (the F31 trap).
    it.each([
      ['null', 'null'],
      ['a number', '5'],
      ['text that is not JSON', 'not json'],
    ])('posts a payment whose body is %s, and says so', async (_what, raw) => {
      const id = await draft({ amount: 15000 })

      const res = await app.request(`/api/payments/${id}/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: raw,
      })

      expect(res.status).toBe(200)
      expect(texts()).toHaveLength(0)
      const [p] = await db.select().from(payments).where(eq(payments.id, id))
      expect(p.status).toBe('posted')
    })

    it('sends nothing when not asked', async () => {
      const id = await draft({ amount: 15000 })

      const r = await post(id)

      expect(r.status).toBe(200)
      expect(texts()).toHaveLength(0)
      expect(await sends(`payment:${id}`)).toHaveLength(0)
    })

    it('texts an event once: a replayed post sends nothing more', async () => {
      const id = await draft({ amount: 15000 })

      await post(id, { sendSms: true })
      const replay = await post(id, { sendSms: true })

      expect(replay.status).toBe(200)
      // Already texted is not a failure: the replay reports nothing wrong.
      expect(replay.body.smsError).toBeUndefined()
      expect(texts()).toHaveLength(1)
      expect(await sends(`payment:${id}`)).toHaveLength(1)
    })

    it('texts once when the same post arrives twice at the same moment', async () => {
      const id = await draft({ amount: 15000 })

      const both = await Promise.all([post(id, { sendSms: true }), post(id, { sendSms: true })])

      expect(both.map((r) => r.status)).toEqual([200, 200])
      expect(texts()).toHaveLength(1)
      expect(await sends(`payment:${id}`)).toHaveLength(1)
    })

    it('takes the amount from what was posted, never from the request', async () => {
      const id = await draft({ amount: 15000 })

      await post(id, { sendSms: true, smsAmountCents: 1, amount: 1 })

      expect(textOf().message).toContain('GHS 150.00')
      expect(textOf().message).not.toContain('GHS 0.01')
    })

    it('texts a split once, for the total of its posted payments', async () => {
      const group = randomUUID()
      const a = await draft({ amount: 12000, paymentGroupId: group })
      await post(a)
      const b = await draft({ amount: 8000, method: 'card', paymentGroupId: group })

      const r = await post(b, { sendSms: true })

      expect(r.status).toBe(200)
      expect(texts()).toHaveLength(1)
      expect(textOf().message).toContain('GHS 200.00')
      const [row] = await sends(`group:${group}`)
      expect(row).toMatchObject({ amount: 20000, status: 'sent' })
    })

    it('counts only the posted payments of a group, not one still a draft', async () => {
      const group = randomUUID()
      const a = await draft({ amount: 12000, paymentGroupId: group })
      await draft({ amount: 8000, method: 'card', paymentGroupId: group })

      await post(a, { sendSms: true })

      expect(textOf().message).toContain('GHS 120.00')
      expect(textOf().message).not.toContain('GHS 200.00')
    })

    it('does not text a payment that has been reversed', async () => {
      const id = await draft({ amount: 15000 })
      await post(id)
      const reversed = await call(`/api/payments/${id}/reverse`, { reason: 'IT keyed twice' })
      expect(reversed.status, JSON.stringify(reversed.body)).toBe(200)

      const replay = await post(id, { sendSms: true })

      expect(replay.status).toBe(200)
      expect(texts()).toHaveLength(0)
    })

    it('tells a plan payment what the plan still owes', async () => {
      const [plan] = await db
        .insert(paymentPlans)
        .values({
          patientId,
          type: 'fixed',
          originalAmount: 50000,
          totalAmount: 50000,
          startDate: new Date(),
          status: 'activated',
          scheduleType: 'fixed',
        })
        .returning({ id: paymentPlans.id })
      const [inv] = await db
        .insert(invoices)
        .values({
          invoiceNumber: uniqueDocNumber('INV'),
          patientId,
          planId: plan.id,
          type: 'plan_installment',
          status: 'issued',
          installmentNumber: 1,
          amount: 50000,
          subtotal: 50000,
          taxableAmount: 50000,
          total: 50000,
          balance: 50000,
          paidAmount: 0,
          createdBy: adminUserId,
        })
        .returning({ id: invoices.id })
      // Neither of these is owed any more: a voided installment and an archived one.
      for (const extra of [
        { status: 'void', archived: false, installmentNumber: 2 },
        { status: 'issued', archived: true, installmentNumber: 3 },
      ]) {
        await db.insert(invoices).values({
          invoiceNumber: uniqueDocNumber('INV'),
          patientId,
          planId: plan.id,
          type: 'plan_installment',
          amount: 10000,
          subtotal: 10000,
          taxableAmount: 10000,
          total: 10000,
          balance: 10000,
          paidAmount: 0,
          createdBy: adminUserId,
          ...extra,
        })
      }
      const id = await draft({
        amount: 20000,
        paymentPlanId: plan.id,
        allocations: [{ targetType: 'invoice', targetId: inv.id, amount: 20000 }],
      })

      const r = await post(id, { sendSms: true })

      expect(r.status, JSON.stringify(r.body)).toBe(200)
      expect(textOf().message).toContain('GHS 200.00')
      expect(textOf().message).toMatch(/balance is GHS 300\.00/)
    })

    it('texts the guardian for a child, who has no phone of their own', async () => {
      await newPatient({ isChild: true, guardianPhone: GUARDIAN, phone: null })
      const id = await draft({ amount: 15000 })

      await post(id, { sendSms: true })

      expect(textOf().phone).toBe(GUARDIAN)
    })

    it('with no phone, texts nobody and still posts', async () => {
      await newPatient({ phone: null })
      const id = await draft({ amount: 15000 })

      const r = await post(id, { sendSms: true })

      expect(r.status).toBe(200)
      expect(texts()).toHaveLength(0)
      // Nothing was claimed either: a phone added later can still be texted for this payment.
      expect(await sends(`payment:${id}`)).toHaveLength(0)
      const [p] = await db.select().from(payments).where(eq(payments.id, id))
      expect(p.status).toBe('posted')
    })

    it('reports a provider refusal, posts all the same, and does not try again on a replay', async () => {
      vi.mocked(sendSMS).mockResolvedValue({ success: false, error: 'Gateway down' } as never)
      const id = await draft({ amount: 15000 })

      const r = await post(id, { sendSms: true })

      expect(r.status).toBe(200)
      expect(r.body.smsError).toBe('Gateway down')
      const [p] = await db.select().from(payments).where(eq(payments.id, id))
      expect(p.status).toBe('posted')
      const [row] = await sends(`payment:${id}`)
      expect(row).toMatchObject({ status: 'failed', error: 'Gateway down' })

      await post(id, { sendSms: true })
      expect(texts()).toHaveLength(1)
    })

    it('reports a provider that throws, and posts all the same', async () => {
      vi.mocked(sendSMS).mockRejectedValue(new Error('socket hang up'))
      const id = await draft({ amount: 15000 })

      const r = await post(id, { sendSms: true })

      expect(r.status).toBe(200)
      expect(r.body.smsError).toBeTruthy()
      const [p] = await db.select().from(payments).where(eq(payments.id, id))
      expect(p.status).toBe('posted')
    })
  })

  describe('POST /api/worklist/:id/confirm', () => {
    /** A standalone draft estimate of 300.00 for the current patient; its id is the visit key. */
    async function estimate() {
      const revenue = await accountIdByCode(db, '4110')
      const { invoiceId } = await makeDraftInvoice(db, {
        patientId,
        userId: adminUserId,
        amount: 30000,
        revenueAccountId: revenue,
      })
      return invoiceId
    }
    const confirm = (id: string, body: Json) => call(`/api/worklist/${id}/confirm`, body)

    it('texts the amount taken, when asked', async () => {
      const id = await estimate()

      const r = await confirm(id, { payment: { method: 'cash', amount: 10000 }, sendSms: true })

      expect(r.status, JSON.stringify(r.body)).toBe(200)
      expect(texts()).toHaveLength(1)
      expect(textOf().message).toContain('GHS 100.00')
      // And says what it paid for: the estimate's own lines.
      expect(textOf().message).toContain('for IT line')
    })

    it('texts once for a payment in two methods, for their total', async () => {
      const id = await estimate()

      const r = await confirm(id, {
        payments: [
          { method: 'cash', amount: 10000 },
          { method: 'card', amount: 5000 },
        ],
        sendSms: true,
      })

      expect(r.status, JSON.stringify(r.body)).toBe(200)
      expect(texts()).toHaveLength(1)
      expect(textOf().message).toContain('GHS 150.00')
    })

    it('texts nothing when no payment was taken', async () => {
      const id = await estimate()

      const r = await confirm(id, { sendSms: true })

      expect(r.status, JSON.stringify(r.body)).toBe(200)
      expect(texts()).toHaveLength(0)
    })

    it('texts nothing when not asked', async () => {
      const id = await estimate()

      const r = await confirm(id, { payment: { method: 'cash', amount: 10000 } })

      expect(r.status).toBe(200)
      expect(texts()).toHaveLength(0)
    })

    it('reports a failed text and still confirms', async () => {
      vi.mocked(sendSMS).mockResolvedValue({ success: false, error: 'Gateway down' } as never)
      const id = await estimate()

      const r = await confirm(id, { payment: { method: 'cash', amount: 10000 }, sendSms: true })

      expect(r.status).toBe(200)
      expect(r.body.smsError).toBe('Gateway down')
      const [inv] = await db.select().from(invoices).where(eq(invoices.id, id))
      expect(inv.status).not.toBe('draft')
    })
  })
})
