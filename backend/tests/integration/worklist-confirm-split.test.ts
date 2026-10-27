/**
 * Review of Step 10 (§8.16), F88 — confirming an estimate with some lines unticked.
 *
 * The confirm-estimate sheet lets reception untick lines and says "Unchecked items split into a new
 * draft estimate", but it never sent the selection, so every line was invoiced. The sheet now sends
 * it (`acceptedLineItemIds`), which makes this server path live for the first time: the ticked lines
 * are issued and paid, and the unticked ones move to a new draft estimate for the same patient and
 * visit, not invoiced and not paid.
 *
 * Real route, real database.
 *
 * ── Safety ── commits fixtures; local Postgres only; every patient is named `IT …`, so
 * `sweepLeakedFixtures` removes it with its invoices, payments, plans and journal entries.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/worklist-confirm-split.test.ts
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

import { and, eq, ne, sql } from 'drizzle-orm'
import { type DB, getDb } from '../../src/db'
import {
  invoiceLines,
  invoices,
  patients,
  payments,
  treatmentPlanItems,
  treatmentPlans,
} from '../../src/db/schema'
import { getOrCreatePeriodFor } from '../../src/lib/period-service'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { worklistApp } from '../../src/routes/worklist'
import { accountIdByCode, makeDraftInvoice, sweepLeakedFixtures } from './_fixtures'

const TAG = `wls-${Date.now()}`

let db: DB
let app: Hono<HonoEnv>
let adminUserId: string
let patientId: string
let count = 0

/** A standalone draft estimate with two lines: Scaling 300.00 and Whitening 200.00. */
async function twoLineEstimate() {
  const revenueAccountId = await accountIdByCode(db, '4110')
  const { invoiceId, invoiceLineId } = await makeDraftInvoice(db, {
    patientId,
    userId: adminUserId,
    amount: 30000,
    revenueAccountId,
  })
  await db
    .update(invoiceLines)
    .set({ description: 'Scaling' })
    .where(eq(invoiceLines.id, invoiceLineId))
  const [second] = await db
    .insert(invoiceLines)
    .values({
      invoiceId,
      lineNumber: 2,
      description: 'Whitening',
      quantity: 1,
      unitPrice: 20000,
      lineSubtotal: 20000,
      lineAfterDiscount: 20000,
      lineTotal: 20000,
      revenueAccountId,
    })
    .returning({ id: invoiceLines.id })
  return { invoiceId, scaling: invoiceLineId, whitening: second.id }
}

async function confirm(id: string, body: Record<string, unknown>) {
  const res = await app.request(`/api/worklist/${id}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return {
    status: res.status,
    body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
  }
}

describe.skipIf(skip)('F88 — confirming an estimate with unticked lines (local Postgres)', () => {
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
    app.route('/api/worklist', worklistApp)
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
      .values({
        name: `IT Confirm ${TAG}-${++count}`,
        dob: new Date('1990-01-01'),
        gender: 'other',
      })
      .returning({ id: patients.id })
    patientId = p.id
  })

  it('issues and charges the ticked lines only', async () => {
    const { invoiceId, scaling } = await twoLineEstimate()

    const r = await confirm(invoiceId, {
      acceptedLineItemIds: [scaling],
      payments: [{ method: 'cash', amount: 30000 }],
    })

    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const [issued] = await db.select().from(invoices).where(eq(invoices.id, invoiceId))
    expect(issued.status).toBe('paid')
    expect(Number(issued.total)).toBe(30000)
    expect(Number(issued.balance)).toBe(0)
    const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId))
    expect(lines.map((l) => l.description)).toEqual(['Scaling'])
    const [paid] = await db.select().from(payments).where(eq(payments.patientId, patientId))
    expect(Number(paid.amount)).toBe(30000)
    expect(Number(paid.unallocatedAmount)).toBe(0)
  })

  it('moves the unticked lines to a new draft estimate, not invoiced', async () => {
    const { invoiceId, scaling } = await twoLineEstimate()

    await confirm(invoiceId, { acceptedLineItemIds: [scaling], payments: [] })

    const others = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.patientId, patientId), ne(invoices.id, invoiceId)))
    expect(others).toHaveLength(1)
    expect(others[0].status).toBe('draft')
    expect(others[0].journalEntryId).toBeNull()
    expect(Number(others[0].total)).toBe(20000)
    const moved = await db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, others[0].id))
    expect(moved.map((l) => l.description)).toEqual(['Whitening'])
  })

  it('plans the treatment of the ticked lines only', async () => {
    const { invoiceId, scaling } = await twoLineEstimate()

    await confirm(invoiceId, { acceptedLineItemIds: [scaling], payments: [] })

    const [plan] = await db
      .select()
      .from(treatmentPlans)
      .where(eq(treatmentPlans.sourceInvoiceId, invoiceId))
    const items = await db
      .select()
      .from(treatmentPlanItems)
      .where(eq(treatmentPlanItems.planId, plan.id))
    expect(items.map((i) => i.procedureName)).toEqual(['Scaling'])
  })

  it('issues every line when every line is ticked (no split)', async () => {
    const { invoiceId, scaling, whitening } = await twoLineEstimate()

    const r = await confirm(invoiceId, { acceptedLineItemIds: [scaling, whitening], payments: [] })

    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const [issued] = await db.select().from(invoices).where(eq(invoices.id, invoiceId))
    expect(Number(issued.total)).toBe(50000)
    const others = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.patientId, patientId), ne(invoices.id, invoiceId)))
    expect(others).toHaveLength(0)
  })
})
