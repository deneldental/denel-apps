/**
 * G04 — `GET /api/payments/:id/receipt` for a one-time payment that paid no invoice, a split group,
 * and a reversal. See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (G04) and step-10-handover.md.
 *
 * A receipt normally lists the invoice lines of the invoices a payment was allocated to. A one-time
 * payment pays no invoice (it posts as patient credit), so the only itemisation it has is
 * `payments.treatments`; the receipt lists those items WITHOUT inventing an invoice. A split lists
 * its methods in the order they were taken, once. A reversal is reported (`status`,
 * `reversedAmount`, each method's own status) and no longer counts as paid.
 *
 * Real route, real database, `sendSMS` captured.
 *
 * ── Safety ── commits fixtures; local Postgres only; the patient is named `IT …` so
 * `sweepLeakedFixtures` also removes its payments, wallet rows and journal entries.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/payment-receipt.test.ts
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
import { patients, walletTransactions } from '../../src/db/schema'
import { issueInvoice } from '../../src/lib/invoice-service'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { paymentsApp } from '../../src/routes/payments'
import { accountIdByCode, makeDraftInvoice, sweepLeakedFixtures } from './_fixtures'

const TAG = `receipt-${Date.now()}`

interface Row {
  id: string
  paymentNumber: string | null
}
interface Receipt {
  patientName: string
  amountPaid: number
  totalAmount?: number
  balance?: number
  paymentType: string
  paymentFor: string
  notes: string | null
  status?: string
  reversedAmount?: number
  methods?: Array<{
    method: string
    amount: number
    reference: string | null
    paymentNumber: string | null
    status?: string
  }>
  paymentNumbers?: string[]
  invoiceNumbers?: string[]
  unallocatedAmount?: number
  allocations?: Array<{
    invoiceNumber: string
    invoiceTotal: number | null
    invoiceSubtotal: number | null
    invoiceTaxTotal: number | null
    amountApplied: number
    remainingBalance: number | null
    status: string | null
    treatments: string[]
    items: Array<{ name: string; cost: number }>
  }>
}

let db: DB
let app: Hono<HonoEnv>
let adminUserId: string
let patientId: string
let patientCount = 0

async function newPatient() {
  const [p] = await db
    .insert(patients)
    .values({
      name: `IT Receipt ${TAG}-${++patientCount}`,
      dob: new Date('1990-01-01'),
      gender: 'other',
    })
    .returning({ id: patients.id })
  patientId = p.id
}

async function call(method: 'GET' | 'POST', path: string, payload?: Record<string, unknown>) {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  })
  let body: Record<string, unknown> | null = null
  try {
    body = await res.json()
  } catch {
    /* empty */
  }
  return { status: res.status, body }
}

async function pay(extra: Record<string, unknown>) {
  const { status, body } = await call('POST', '/api/payments', { patientId, ...extra })
  expect(status, JSON.stringify(body)).toBe(200)
  return body as unknown as { data: Row; payments: Row[]; paymentGroupId: string | null }
}

async function receiptOf(id: string, query = ''): Promise<Receipt> {
  const { status, body } = await call('GET', `/api/payments/${id}/receipt${query}`)
  expect(status, JSON.stringify(body)).toBe(200)
  return (body as { data: Receipt }).data
}

const TREATMENTS = [
  { treatmentId: 'svc-1', name: 'Scaling', amount: 15000 },
  { treatmentId: 'svc-2', name: 'Fluoride', amount: 5000 },
]
const ITEMS = [
  { name: 'Scaling', cost: 15000 },
  { name: 'Fluoride', cost: 5000 },
]

describe.skipIf(skip)('G04 — payment receipts (local Postgres)', () => {
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

  describe('a one-time payment that paid no invoice', () => {
    it('lists the items it recorded, without inventing an invoice', async () => {
      const { data } = await pay({
        amount: 20000,
        method: 'cash',
        treatments: TREATMENTS,
        description: 'Scaling, Fluoride - paid in full',
      })

      const receipt = await receiptOf(data.id)

      expect(receipt.allocations).toEqual([
        {
          invoiceNumber: '',
          invoiceTotal: null,
          invoiceSubtotal: null,
          invoiceTaxTotal: null,
          amountApplied: 20000,
          remainingBalance: null,
          status: null,
          treatments: ['Scaling', 'Fluoride'],
          items: ITEMS,
        },
      ])
      // No invoice behind it, so nothing that comes from an invoice is reported.
      expect(receipt.invoiceNumbers).toEqual([])
      expect(receipt.totalAmount).toBeUndefined()
      expect(receipt.balance).toBeUndefined()
      expect(receipt.paymentFor).toBe('Scaling, Fluoride')
      expect(receipt.notes).toBe('Scaling, Fluoride - paid in full')
      expect(receipt.amountPaid).toBe(20000)
      expect(receipt.status).toBe('posted')
      expect(receipt.reversedAmount).toBeUndefined()
      // It all went to the patient's credit.
      expect(receipt.unallocatedAmount).toBe(20000)
      expect(receipt.methods).toEqual([
        expect.objectContaining({ method: 'cash', amount: 20000, status: 'posted' }),
      ])
    })

    it('has no allocations when it recorded no items, as before', async () => {
      const { data } = await pay({ amount: 5000, method: 'cash', description: 'Top-up' })

      const receipt = await receiptOf(data.id)

      expect(receipt.allocations).toEqual([])
      expect(receipt.paymentFor).toBe('Top-up')
    })

    it('drops items that have no usable name or amount', async () => {
      const { data } = await pay({
        amount: 15000,
        method: 'cash',
        treatments: [
          { name: '', amount: 100 },
          { name: 'Crown' },
          { name: 'Scaling', amount: 15000 },
        ],
      })

      const receipt = await receiptOf(data.id)

      expect(receipt.allocations?.[0].items).toEqual([{ name: 'Scaling', cost: 15000 }])
    })
  })

  describe('a payment split across methods', () => {
    it('lists the items once and every method, in the order they were taken', async () => {
      const { payments: rows } = await pay({
        sources: [
          { method: 'cash', amount: 12000 },
          { method: 'card', amount: 8000, externalReference: 'POS-77' },
        ],
        treatments: TREATMENTS,
      })

      const receipt = await receiptOf(rows[1].id)

      expect(receipt.allocations).toHaveLength(1)
      expect(receipt.allocations?.[0].items).toEqual(ITEMS)
      expect(receipt.methods?.map((m) => [m.method, m.amount, m.reference])).toEqual([
        ['cash', 12000, null],
        ['card', 8000, 'POS-77'],
      ])
      expect(receipt.amountPaid).toBe(20000)
      expect(receipt.paymentNumbers).toEqual(rows.map((r) => r.paymentNumber))
    })

    it('is the same receipt whichever of its payments is asked for', async () => {
      const { payments: rows } = await pay({
        sources: [
          { method: 'cash', amount: 12000 },
          { method: 'card', amount: 8000 },
        ],
        treatments: TREATMENTS,
      })

      const first = await receiptOf(rows[0].id)
      const second = await receiptOf(rows[1].id)

      for (const field of [
        'amountPaid',
        'methods',
        'allocations',
        'paymentNumbers',
        'status',
      ] as const) {
        expect(second[field]).toEqual(first[field])
      }
    })

    it('keeps the methods in order when the payments carry the same timestamp', async () => {
      const { payments: rows } = await pay({
        sources: [
          { method: 'cash', amount: 12000 },
          { method: 'card', amount: 8000 },
        ],
      })
      // A split is recorded in one transaction, so its payments share a creation time; the order
      // must then come from the payment numbers. Touching the cash row moves it after the card
      // row in the table, which is the order a query without a tie-break would answer in.
      await db.execute(sql`UPDATE payments SET description = description WHERE id = ${rows[0].id}`)

      const receipt = await receiptOf(rows[1].id)

      expect(receipt.methods?.map((m) => m.method)).toEqual(['cash', 'card'])
    })
  })

  describe('a receipt for an invoice', () => {
    it('is unchanged: the invoice’s lines, its totals and its number', async () => {
      const revenue = await accountIdByCode(db, '4100')
      const { invoiceId, invoiceNumber } = await makeDraftInvoice(db, {
        patientId,
        userId: adminUserId,
        amount: 25000,
        revenueAccountId: revenue,
      })
      await issueInvoice(db, invoiceId, adminUserId)
      const { data } = await pay({ amount: 10000, method: 'cash', invoiceId })

      const receipt = await receiptOf(data.id)

      expect(receipt.invoiceNumbers).toEqual([invoiceNumber])
      expect(receipt.allocations).toHaveLength(1)
      expect(receipt.allocations?.[0]).toMatchObject({
        invoiceNumber,
        invoiceTotal: 25000,
        amountApplied: 10000,
        remainingBalance: 15000,
      })
      expect(receipt.allocations?.[0].items).toEqual([{ name: 'IT line', cost: 25000 }])
      expect(receipt.totalAmount).toBe(25000)
      expect(receipt.balance).toBe(15000)
      expect(receipt.status).toBe('posted')
    })

    it('is not replaced by the payment’s own items when it was allocated', async () => {
      const revenue = await accountIdByCode(db, '4100')
      const { invoiceId } = await makeDraftInvoice(db, {
        patientId,
        userId: adminUserId,
        amount: 25000,
        revenueAccountId: revenue,
      })
      await issueInvoice(db, invoiceId, adminUserId)
      const { data } = await pay({
        amount: 10000,
        method: 'cash',
        invoiceId,
        treatments: TREATMENTS,
      })

      const receipt = await receiptOf(data.id)

      // The invoice's own line, not the two treatments the payment happens to carry.
      expect(receipt.allocations?.[0].items).toEqual([{ name: 'IT line', cost: 25000 }])
    })
  })

  describe('a reversed payment', () => {
    it('says it was reversed, counts nothing as paid, and shows what was reversed', async () => {
      const { data } = await pay({
        amount: 20000,
        method: 'cash',
        treatments: TREATMENTS,
      })
      const reversed = await call('POST', `/api/payments/${data.id}/reverse`, {
        reason: 'keyed in error',
      })
      expect(reversed.status, JSON.stringify(reversed.body)).toBe(200)

      const receipt = await receiptOf(data.id)

      expect(receipt.status).toBe('reversed')
      expect(receipt.amountPaid).toBe(0)
      expect(receipt.reversedAmount).toBe(20000)
      expect(receipt.unallocatedAmount).toBe(0)
      expect(receipt.methods).toEqual([
        expect.objectContaining({ method: 'cash', amount: 20000, status: 'reversed' }),
      ])
      // What the payment was for still shows, so the slip can say what was undone.
      expect(receipt.allocations?.[0].items).toEqual(ITEMS)
    })

    it('says only some methods of a split were reversed, and counts the rest as paid', async () => {
      const { payments: rows } = await pay({
        sources: [
          { method: 'cash', amount: 12000 },
          { method: 'card', amount: 8000 },
        ],
        treatments: TREATMENTS,
      })
      await call('POST', `/api/payments/${rows[1].id}/reverse`, { reason: 'wrong terminal' })

      const receipt = await receiptOf(rows[0].id)

      expect(receipt.status).toBe('partly_reversed')
      expect(receipt.amountPaid).toBe(12000)
      expect(receipt.reversedAmount).toBe(8000)
      expect(receipt.unallocatedAmount).toBe(12000)
      expect(receipt.methods?.map((m) => [m.method, m.status])).toEqual([
        ['cash', 'posted'],
        ['card', 'reversed'],
      ])
    })

    it('says a split is reversed once every method has been', async () => {
      const { payments: rows } = await pay({
        sources: [
          { method: 'cash', amount: 12000 },
          { method: 'card', amount: 8000 },
        ],
      })
      for (const row of rows) {
        await call('POST', `/api/payments/${row.id}/reverse`, { reason: 'cancelled' })
      }

      const receipt = await receiptOf(rows[0].id)

      expect(receipt.status).toBe('reversed')
      expect(receipt.amountPaid).toBe(0)
      expect(receipt.reversedAmount).toBe(20000)
    })
  })

  describe('a wallet receipt', () => {
    it('is unchanged', async () => {
      await pay({ amount: 7000, method: 'cash' })
      const [credit] = await db
        .select()
        .from(walletTransactions)
        .where(eq(walletTransactions.patientId, patientId))

      const receipt = await receiptOf(credit.id, '?source=wallet')

      expect(receipt).toMatchObject({
        paymentType: 'wallet_credit',
        amountPaid: 7000,
        balance: 7000,
      })
      // Nothing from the payment receipt leaks into it.
      expect(receipt).not.toHaveProperty('status')
      expect(receipt).not.toHaveProperty('methods')
      expect(receipt).not.toHaveProperty('allocations')
    })
  })

  describe('when there is no such payment', () => {
    it.each([
      ['a payment', ''],
      ['a wallet transaction', '?source=wallet'],
    ])('answers 404 for %s', async (_what, query) => {
      const res = await call(
        'GET',
        `/api/payments/00000000-0000-0000-0000-000000000000/receipt${query}`
      )
      expect(res.status).toBe(404)
    })
  })
})
