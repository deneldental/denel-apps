/**
 * HTTP-level tests for HR doctor onboarding (POST /api/specialists/onboard)
 * against a REAL Postgres.
 *
 * The defect this exists to fix: a doctor is an EMPLOYEE and a BILLING
 * PROVIDER, and nothing created both. The portal's add-specialist sheet makes a
 * `specialists` row with no `staff` row, so an "internal" doctor there has no
 * employment record — no payslip, no attendance, no Team app. The live data
 * already shows internal specialists with a null staffId.
 *
 * These assert on the persisted rows and their LINK, because a half-created
 * doctor still returns 200 from a naive implementation — only the database
 * shows whether both halves exist and point at each other.
 *
 * Gated on DATABASE_URL like every other integration test.
 */

import { randomUUID } from 'node:crypto'
import { eq, like } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'
import { noDb } from './_setup'

vi.mock('../../src/lib/rbac')
vi.mock('../../src/lib/audit', () => ({ recordDiffAudit: vi.fn(), createAuditLog: vi.fn() }))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { getDb } from '../../src/db'
import * as schema from '../../src/db/schema'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { specialistsApp } from '../../src/routes/specialists'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/specialists', specialistsApp)
  return app
}

const PREFIX = '__it_doc_'
let adminUserId: string

async function onboard(body: Record<string, unknown>) {
  const res = await makeApp().request('/api/specialists/onboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { res, json: (await res.json().catch(() => null)) as any }
}

const email = () => `${PREFIX}${randomUUID().slice(0, 8)}@it.local`

describe.skipIf(noDb)('POST /api/specialists/onboard', () => {
  beforeAll(async () => {
    const db = getDb(process.env.DATABASE_URL!)
    const admin = await db.query.user.findFirst({
      where: eq(schema.user.roleId, 'admin'),
      columns: { id: true },
    })
    if (!admin) throw new Error('no seeded admin user — run seed:rbac / seed:admin')
    adminUserId = admin.id
    mockGetCurrentUser.mockResolvedValue({ id: adminUserId, email: 'admin@it.local' } as any)
    mockCheckPermission.mockResolvedValue(true)
  })

  afterEach(async () => {
    const db = getDb(process.env.DATABASE_URL!)
    // Specialists first — staff.specialistId references them.
    const specs = await db
      .select({ id: schema.specialists.id })
      .from(schema.specialists)
      .where(like(schema.specialists.name, `${PREFIX}%`))
    const staffRows = await db
      .select({ id: schema.staff.id, userId: schema.staff.userId })
      .from(schema.staff)
      .where(like(schema.staff.fullName, `${PREFIX}%`))

    if (staffRows.length) {
      await db.delete(schema.staff).where(like(schema.staff.fullName, `${PREFIX}%`))
    }
    if (specs.length) {
      await db.delete(schema.specialists).where(like(schema.specialists.name, `${PREFIX}%`))
    }
    const users = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(like(schema.user.email, `${PREFIX}%`))
    for (const u of users) {
      await db.delete(schema.userScopes).where(eq(schema.userScopes.userId, u.id))
      await db.delete(schema.account).where(eq(schema.account.userId, u.id))
      await db.delete(schema.user).where(eq(schema.user.id, u.id))
    }
    vi.clearAllMocks()
    mockGetCurrentUser.mockResolvedValue({ id: adminUserId, email: 'admin@it.local' } as any)
    mockCheckPermission.mockResolvedValue(true)
  })

  // ── Internal: employee + provider ─────────────────────────────────────────

  /** The whole point: an internal doctor gets BOTH rows, linked both ways. */
  it('creates a linked staff + specialist pair for an internal doctor', async () => {
    const name = `${PREFIX}Dr Kwame`
    const { res, json } = await onboard({
      specialistType: 'internal',
      name,
      specialty: 'orthodontics',
      contactEmail: email(),
      contactPhone: '+233201234567',
      defaultCommissionRate: 15,
      withholdingTaxRate: 7.5,
      employmentType: 'permanent',
    })
    expect(res.status).toBe(200)
    expect(json.data.staffRowId).toBeTruthy()

    const db = getDb(process.env.DATABASE_URL!)
    const spec = await db.query.specialists.findFirst({
      where: eq(schema.specialists.id, json.data.specialistId),
    })
    const staffRow = await db.query.staff.findFirst({
      where: eq(schema.staff.id, json.data.staffRowId),
    })

    expect(spec).toBeTruthy()
    expect(staffRow).toBeTruthy()

    // Linked BOTH ways — a one-directional link means the HR profile can't find
    // the billing record, or invoices can't find the employee.
    expect(spec?.staffId).toBe(staffRow?.id)
    expect(staffRow?.specialistId).toBe(spec?.id)

    // The employee half is real: payslip, attendance, employment type.
    expect(staffRow?.hasPayslip).toBe(true)
    expect(staffRow?.tracksAttendance).toBe(true)
    expect(staffRow?.employmentType).toBe('permanent')
    expect(staffRow?.staffId).toMatch(/^FDM-S\d+$/)

    // Being a clinical practitioner isn't a checkbox — it's what a doctor IS.
    expect(staffRow?.isClinicalPractitioner).toBe(true)
    expect(staffRow?.receivesCommission).toBe(true)
    expect(staffRow?.requiresLicense).toBe(true)

    // The billing half carries the commission plan.
    expect(Number(spec?.defaultCommissionRate)).toBe(15)
    expect(Number(spec?.withholdingTaxRate)).toBe(7.5)
    expect(spec?.specialty).toBe('orthodontics')
    expect(spec?.specialistType).toBe('internal')
  })

  it('creates sign-in credentials and scopes for an internal doctor', async () => {
    const addr = email()
    const { json } = await onboard({
      specialistType: 'internal',
      name: `${PREFIX}Dr Ama`,
      contactEmail: addr,
      password: 'a-long-enough-password',
      employmentType: 'permanent',
    })

    const db = getDb(process.env.DATABASE_URL!)
    const u = await db.query.user.findFirst({ where: eq(schema.user.email, addr) })
    expect(u).toBeTruthy()

    const staffRow = await db.query.staff.findFirst({
      where: eq(schema.staff.id, json.data.staffRowId),
    })
    const spec = await db.query.specialists.findFirst({
      where: eq(schema.specialists.id, json.data.specialistId),
    })
    // The same auth user backs both halves — that's what ties their portal
    // identity to their billing record.
    expect(staffRow?.userId).toBe(u?.id)
    expect(spec?.userId).toBe(u?.id)

    const scopes = await db
      .select()
      .from(schema.userScopes)
      .where(eq(schema.userScopes.userId, u!.id))
    // No 'pwa' row is written by onboarding. `user_scopes` is an OVERRIDE layer
    // consulted BEFORE role scopes, so the unconditional Team grant this used to
    // assert silently defeated the doctor role's portal-only policy for every
    // doctor onboarded through HR (see specialists.ts).
    expect(scopes.find((s) => s.interfaceScope === 'pwa')).toBeUndefined()
    expect(scopes.find((s) => s.interfaceScope === 'portal')?.granted).toBe(true)
  })

  // ── External: provider only ───────────────────────────────────────────────

  /** An external doctor isn't employed, so an employment record would be a lie. */
  it('creates a specialist WITHOUT a staff record for an external doctor', async () => {
    const { res, json } = await onboard({
      specialistType: 'external',
      name: `${PREFIX}Dr Visiting`,
      specialty: 'oral_surgery',
      defaultCommissionRate: 60,
    })
    expect(res.status).toBe(200)
    expect(json.data.staffRowId).toBeNull()

    const db = getDb(process.env.DATABASE_URL!)
    const spec = await db.query.specialists.findFirst({
      where: eq(schema.specialists.id, json.data.specialistId),
    })
    expect(spec?.specialistType).toBe('external')
    expect(spec?.staffId).toBeNull()
    // No employment record anywhere.
    const orphan = await db.query.staff.findFirst({
      where: eq(schema.staff.fullName, `${PREFIX}Dr Visiting`),
    })
    expect(orphan).toBeUndefined()
  })

  // ── Atomicity ─────────────────────────────────────────────────────────────

  /**
   * The reason this endpoint uses a real transaction. A rate the guard rejects
   * fails AFTER the staff insert would have run, so a non-transactional
   * implementation would leave an orphaned staff row (which is exactly what
   * POST /api/staff's compensating-delete approach does).
   */
  it('leaves nothing behind when the commission rate is rejected', async () => {
    const addr = email()
    const { res } = await onboard({
      specialistType: 'internal',
      name: `${PREFIX}Dr Rollback`,
      contactEmail: addr,
      password: 'a-long-enough-password',
      defaultCommissionRate: 150, // > 100
      employmentType: 'permanent',
    })
    expect(res.status).toBe(400)

    const db = getDb(process.env.DATABASE_URL!)
    // No half-created doctor: no staff row, no specialist, no auth user.
    expect(
      await db.query.staff.findFirst({ where: eq(schema.staff.fullName, `${PREFIX}Dr Rollback`) })
    ).toBeUndefined()
    expect(
      await db.query.specialists.findFirst({
        where: eq(schema.specialists.name, `${PREFIX}Dr Rollback`),
      })
    ).toBeUndefined()
    expect(await db.query.user.findFirst({ where: eq(schema.user.email, addr) })).toBeUndefined()
  })

  // ── Validation ────────────────────────────────────────────────────────────

  it('rejects an unknown specialisation with a clean 400', async () => {
    const { res, json } = await onboard({
      specialistType: 'external',
      name: `${PREFIX}Dr Bogus`,
      specialty: 'not_a_real_specialty',
    })
    expect(res.status).toBe(400)
    expect(String(json.error)).toMatch(/specialisation/i)
    // Never the raw FK error underneath.
    expect(String(json.error)).not.toMatch(/foreign key|constraint/i)
  })

  it('rejects a duplicate email before touching anything', async () => {
    const addr = email()
    const first = await onboard({
      specialistType: 'internal',
      name: `${PREFIX}Dr First`,
      contactEmail: addr,
      password: 'a-long-enough-password',
      employmentType: 'permanent',
    })
    expect(first.res.status).toBe(200)

    const dupe = await onboard({
      specialistType: 'internal',
      name: `${PREFIX}Dr Second`,
      contactEmail: addr,
      password: 'a-long-enough-password',
      employmentType: 'permanent',
    })
    expect(dupe.res.status).toBe(409)
  })

  it('rejects a rate above 100', async () => {
    const { res } = await onboard({
      specialistType: 'external',
      name: `${PREFIX}Dr Greedy`,
      withholdingTaxRate: 250,
    })
    expect(res.status).toBe(400)
  })

  it('requires auth and permission', async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null)
    expect((await onboard({ specialistType: 'external', name: 'x' })).res.status).toBe(401)

    mockCheckPermission.mockResolvedValueOnce(false)
    expect((await onboard({ specialistType: 'external', name: 'x' })).res.status).toBe(403)
  })
})
