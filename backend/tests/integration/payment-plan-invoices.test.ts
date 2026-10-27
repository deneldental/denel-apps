/**
 * G05 — `GET /api/payment-plans/:id/invoices` carries each invoice's recorded treatments.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (G05) and step-10-handover.md.
 *
 * Receive Payment lists what each invoice being paid is for. Invoices of the legacy payment-plan
 * path never got invoice lines: the services they were raised for live only in the invoice's
 * `treatments` column. The payment dialog needs that column to list them, so the plan's invoice
 * list now carries it (an addition; nothing it already answered with changes).
 *
 * Real route, real database.
 *
 * ── Safety ── commits fixtures; local Postgres only; the patient is named `IT …` so
 * `sweepLeakedFixtures` removes it and everything that hangs off it.
 *
 *   cd backend && node scripts/dev-local.mjs vitest run tests/integration/payment-plan-invoices.test.ts
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

import { sql } from 'drizzle-orm'
import { type DB, getDb } from '../../src/db'
import { invoices, patients, paymentPlans } from '../../src/db/schema'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { paymentPlansApp } from '../../src/routes/payment-plans'
import { sweepLeakedFixtures, uniqueDocNumber } from './_fixtures'

const TAG = `planinv-${Date.now()}`

interface InvoiceRow {
  id: string
  invoiceNumber: string
  type: string
  status: string
  installmentNumber: number | null
  total: number
  paidAmount: number
  balance: number
  description: string | null
  treatments: Array<{ treatmentId?: string; name: string; amount: number }> | null
}

let db: DB
let app: Hono<HonoEnv>
let adminUserId: string
let patientId: string
let planId: string

const LEGACY_TREATMENTS = [
  { treatmentId: 't1', name: 'Root Canal', amount: 120000 },
  { treatmentId: 't2', name: 'Crown Fitting', amount: 180000 },
]

async function listInvoices() {
  const res = await app.request(`/api/payment-plans/${planId}/invoices`)
  const body = (await res.json()) as { data: InvoiceRow[]; error?: string }
  return { status: res.status, rows: body.data, body }
}

describe.skipIf(skip)('G05 — GET /api/payment-plans/:id/invoices (local Postgres)', () => {
  beforeAll(async () => {
    db = getDb(RAW_DB_URL)
    await sweepLeakedFixtures()
    const users = await db.execute<{ id: string }>(
      sql`SELECT id FROM "user" ORDER BY "createdAt" LIMIT 1`
    )
    adminUserId = users.rows[0]?.id
    if (!adminUserId) throw new Error('No rows in "user" — run `pnpm --filter backend seed:admin`')
    app = new Hono<HonoEnv>()
    app.route('/api/payment-plans', paymentPlansApp)
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
        name: `IT PlanInvoices ${TAG}-${Date.now()}`,
        dob: new Date('1990-01-01'),
        gender: 'other',
      })
      .returning({ id: patients.id })
    patientId = p.id
    const [plan] = await db
      .insert(paymentPlans)
      .values({
        patientId,
        type: 'fixed',
        originalAmount: 300000,
        totalAmount: 300000,
        startDate: new Date(),
        status: 'activated',
        scheduleType: 'fixed',
      })
      .returning({ id: paymentPlans.id })
    planId = plan.id
  })

  /** A legacy installment invoice of the plan, the way the old plan path raised them. */
  async function legacyInvoice(opts: {
    installmentNumber: number
    treatments: unknown
    archived?: boolean
  }) {
    const [inv] = await db
      .insert(invoices)
      .values({
        invoiceNumber: uniqueDocNumber('INV'),
        patientId,
        planId,
        type: 'plan_installment',
        status: 'issued',
        installmentNumber: opts.installmentNumber,
        amount: 150000,
        subtotal: 150000,
        taxableAmount: 150000,
        total: 150000,
        balance: 150000,
        paidAmount: 0,
        description: `Installment ${opts.installmentNumber}`,
        treatments: opts.treatments as never,
        archived: opts.archived ?? false,
        createdBy: adminUserId,
      })
      .returning({ id: invoices.id })
    return inv.id
  }

  it('carries the treatments an invoice was raised for', async () => {
    await legacyInvoice({ installmentNumber: 1, treatments: LEGACY_TREATMENTS })

    const { status, rows } = await listInvoices()

    expect(status).toBe(200)
    expect(rows).toHaveLength(1)
    expect(rows[0].treatments).toEqual(LEGACY_TREATMENTS)
  })

  it('reports none for an invoice that has none recorded', async () => {
    await legacyInvoice({ installmentNumber: 1, treatments: null })

    const { rows } = await listInvoices()

    expect(rows[0].treatments).toBeNull()
  })

  it('still answers with everything it always did', async () => {
    await legacyInvoice({ installmentNumber: 2, treatments: LEGACY_TREATMENTS })

    const { rows } = await listInvoices()

    expect(rows[0]).toMatchObject({
      type: 'plan_installment',
      status: 'issued',
      installmentNumber: 2,
      total: 150000,
      paidAmount: 0,
      balance: 150000,
      description: 'Installment 2',
    })
    expect(rows[0].invoiceNumber).toMatch(/^INV-IT-/)
  })

  it('still hides an invoice that was archived, treatments and all', async () => {
    await legacyInvoice({ installmentNumber: 1, treatments: LEGACY_TREATMENTS, archived: true })
    await legacyInvoice({ installmentNumber: 2, treatments: LEGACY_TREATMENTS })

    const { rows } = await listInvoices()

    expect(rows).toHaveLength(1)
    expect(rows[0].installmentNumber).toBe(2)
  })
})
