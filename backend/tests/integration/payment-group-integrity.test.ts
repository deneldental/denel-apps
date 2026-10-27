/**
 * Review of Step 10 (§8.16) — a payment split across methods is one patient's event, recorded once.
 *
 *  - A payment group (`paymentGroupId`) belongs to one patient. The id comes from the browser on
 *    `POST /api/payments/draft`, so it was possible to put a payment of one patient into another's
 *    group, after which that patient's receipt and payment text named the other patient's money. A
 *    draft may not join a group that holds another patient's payment, and the receipt and the text
 *    count only the patient's own payments of a group (older rows included).
 *  - What a one-time payment was for (`payments.treatments`) is the EVENT's itemisation. G03 copied it
 *    onto every payment of a split, and the yearly revenue-by-treatment figures, which add up those
 *    lists over every posted payment, counted a two-method payment twice. It is stored once, on the
 *    first payment of the split; the receipt of any payment of the group still lists it.
 *
 * Real routes, real database, `sendSMS` captured.
 *
 * ── Safety ── commits fixtures; local Postgres only; every patient is named `IT …`, so
 * `sweepLeakedFixtures` removes it with its payments and journal entries.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/payment-group-integrity.test.ts
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
vi.mock('../../src/lib/analytics-audit', () => ({ logAnalyticsAccess: vi.fn() }))
vi.mock('../../src/lib/sms', () => ({
  sendSMS: vi.fn(async () => ({ success: true })),
}))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { randomUUID } from 'node:crypto'
import { asc, eq, sql } from 'drizzle-orm'
import { type DB, getDb } from '../../src/db'
import { patients, payments } from '../../src/db/schema'
import { getOrCreatePeriodFor } from '../../src/lib/period-service'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { sendSMS } from '../../src/lib/sms'
import { analyticsApp } from '../../src/routes/analytics'
import { paymentsApp } from '../../src/routes/payments'
import { sweepLeakedFixtures } from './_fixtures'

const TAG = `grp-${Date.now()}`
const PHONE = '0240000091'

type Json = Record<string, unknown>

let db: DB
let app: Hono<HonoEnv>
let adminUserId: string
let count = 0

async function newPatient() {
  const [p] = await db
    .insert(patients)
    .values({
      name: `IT Group ${TAG}-${++count}`,
      dob: new Date('1990-01-01'),
      gender: 'other',
      phone: PHONE,
    })
    .returning({ id: patients.id })
  return p.id
}

async function call(method: string, path: string, body?: Json) {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = (await res.json().catch(() => ({}))) as Json & { data?: Json }
  return { status: res.status, body: json, data: json.data as Json }
}

async function postedPayment(patientId: string, amount: number, extra: Json = {}) {
  const drafted = await call('POST', '/api/payments/draft', {
    patientId,
    amount,
    method: 'cash',
    ...extra,
  })
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(200)
  const id = drafted.data.id as string
  const posted = await call('POST', `/api/payments/${id}/post`)
  expect(posted.status, JSON.stringify(posted.body)).toBe(200)
  return id
}

/** An older row put into a group without the draft check, as data written before it could be. */
async function forceIntoGroup(paymentId: string, groupId: string) {
  await db.update(payments).set({ paymentGroupId: groupId }).where(eq(payments.id, paymentId))
}

const textsTo = () =>
  vi.mocked(sendSMS).mock.calls.map((c) => (c[0] as Array<{ message: string }>)[0].message)

describe.skipIf(skip)('Review — payment groups and their itemisation (local Postgres)', () => {
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
    app.route('/api/analytics', analyticsApp)
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

  describe('a payment group belongs to one patient', () => {
    it('a draft cannot join a group that holds another patient’s payment, and says why', async () => {
      const ama = await newPatient()
      const kojo = await newPatient()
      const group = randomUUID()
      await postedPayment(ama, 12000, { paymentGroupId: group })

      const r = await call('POST', '/api/payments/draft', {
        patientId: kojo,
        amount: 8000,
        method: 'cash',
        paymentGroupId: group,
      })

      expect(r.status).toBe(400)
      expect(String(r.body.error)).toMatch(/another patient/i)
      const kojos = await db.select().from(payments).where(eq(payments.patientId, kojo))
      expect(kojos).toHaveLength(0)
    })

    it('a draft can join its own patient’s group (one payment in several methods)', async () => {
      const ama = await newPatient()
      const group = randomUUID()
      await postedPayment(ama, 12000, { paymentGroupId: group })

      const r = await call('POST', '/api/payments/draft', {
        patientId: ama,
        amount: 8000,
        method: 'card',
        paymentGroupId: group,
      })

      expect(r.status, JSON.stringify(r.body)).toBe(200)
    })

    it('the receipt names only the patient’s own payments of a group', async () => {
      const ama = await newPatient()
      const kojo = await newPatient()
      const group = randomUUID()
      const a1 = await postedPayment(ama, 12000, { paymentGroupId: group })
      const k1 = await postedPayment(kojo, 8000)
      await forceIntoGroup(k1, group)

      const r = await call('GET', `/api/payments/${a1}/receipt`)

      expect(r.status).toBe(200)
      expect(r.data.amountPaid).toBe(12000)
      expect((r.data.methods as Json[]).map((m) => m.amount)).toEqual([12000])
    })

    it('the payment text names only the patient’s own payments of a group', async () => {
      const ama = await newPatient()
      const kojo = await newPatient()
      const group = randomUUID()
      const k1 = await postedPayment(kojo, 8000)
      await forceIntoGroup(k1, group)
      const drafted = await call('POST', '/api/payments/draft', {
        patientId: ama,
        amount: 12000,
        method: 'cash',
      })
      const a1 = drafted.data.id as string
      await forceIntoGroup(a1, group)

      const r = await call('POST', `/api/payments/${a1}/post`, { sendSms: true })

      expect(r.status, JSON.stringify(r.body)).toBe(200)
      expect(textsTo()).toHaveLength(1)
      expect(textsTo()[0]).toContain('GHS 120.00')
      expect(textsTo()[0]).not.toContain('GHS 200.00')
    })
  })

  describe('what a split one-time payment was for is recorded once', () => {
    const items = (name: string) => [{ treatmentId: 'tt-1', name, amount: 30000 }]

    async function splitFor(patientId: string, name: string) {
      const r = await call('POST', '/api/payments', {
        patientId,
        description: name,
        treatments: items(name),
        sources: [
          { method: 'cash', amount: 20000 },
          { method: 'card', amount: 10000 },
        ],
      })
      expect(r.status, JSON.stringify(r.body)).toBe(200)
      return db
        .select()
        .from(payments)
        .where(eq(payments.patientId, patientId))
        .orderBy(asc(payments.createdAt), asc(payments.paymentNumber))
    }

    it('on the first payment of the split only', async () => {
      const ama = await newPatient()

      const rows = await splitFor(ama, `IT Scaling ${TAG}-a`)

      expect(rows.map((p) => (p.treatments as unknown[] | null)?.length ?? 0)).toEqual([1, 0])
    })

    it('and the receipt of any payment of the split still lists it', async () => {
      const ama = await newPatient()
      const name = `IT Scaling ${TAG}-b`
      const rows = await splitFor(ama, name)

      const r = await call('GET', `/api/payments/${rows[1].id}/receipt`)

      expect(r.status).toBe(200)
      expect(r.data.paymentFor).toBe(name)
      const [itemised] = r.data.allocations as Array<{ items: Array<{ name: string }> }>
      expect(itemised.items.map((i) => i.name)).toEqual([name])
    })

    it('so the revenue-by-treatment figures count the payment once', async () => {
      const ama = await newPatient()
      const name = `IT Scaling ${TAG}-c`
      await splitFor(ama, name)

      const r = await call('GET', `/api/analytics?year=${new Date().getFullYear()}`)

      expect(r.status, JSON.stringify(r.body)).toBe(200)
      const quarters = Object.values(r.data as Record<string, Json>)
      const rows = quarters.flatMap(
        (q) => ((q.revenue as Json)?.byTreatment as Array<{ name: string; amount: number }>) ?? []
      )
      const mine = rows.filter((t) => t.name === name)
      expect(mine).toHaveLength(1)
      expect(mine[0].amount).toBe(30000)
    })
  })
})
