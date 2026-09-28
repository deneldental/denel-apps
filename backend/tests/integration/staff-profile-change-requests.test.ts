/**
 * HTTP-level tests for the employee self-service (ESS) approval loop, against a
 * REAL Postgres.
 *
 * The defect this covers (B5): the approval handler carried a hard-coded
 * 4-field allowlist and silently fell through for anything else — the request
 * flipped to "approved", nothing was written, and HR believed they'd actioned a
 * change that never happened. Nothing in the response distinguished the two
 * outcomes, and only a DB read reveals it, which is why this test asserts on
 * the staff row rather than the status code alone.
 *
 * Gated on DATABASE_URL like every other integration test.
 */

import { randomUUID } from 'node:crypto'
import { eq, like } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'
import { noDb } from './_setup'

vi.mock('../../src/lib/rbac')
vi.mock('../../src/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { getDb } from '../../src/db'
import * as schema from '../../src/db/schema'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { staffPayrollApp } from '../../src/routes/staff-payroll'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/staff', staffPayrollApp)
  return app
}

const PREFIX = '__it_ess_'
let adminUserId: string
let staffId: string

async function seedRequest(changeType: string, requestedData: Record<string, unknown>) {
  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .insert(schema.staffProfileChangeRequests)
    .values({ staffId, changeType, requestedData: requestedData as any, status: 'pending' })
    .returning()
  return row
}

async function currentStaff() {
  const db = getDb(process.env.DATABASE_URL!)
  return db.query.staff.findFirst({ where: eq(schema.staff.id, staffId) })
}

describe.skipIf(noDb)('PATCH /profile-change-requests/:id — auto-apply', () => {
  beforeAll(async () => {
    const db = getDb(process.env.DATABASE_URL!)
    const admin = await db.query.user.findFirst({
      where: eq(schema.user.roleId, 'admin'),
      columns: { id: true },
    })
    if (!admin) throw new Error('no seeded admin user — run seed:rbac / seed:admin')
    adminUserId = admin.id

    // A dedicated staff row so we never mutate real records.
    const [s] = await db
      .insert(schema.staff)
      .values({
        staffId: `${PREFIX}${randomUUID().slice(0, 6)}`,
        fullName: 'ESS Subject',
        email: `${PREFIX}${randomUUID().slice(0, 8)}@it.local`,
        employmentType: 'permanent',
        emergencyContactName: 'Old Contact',
        bankAccountNumber: '0000000000',
      })
      .returning()
    staffId = s.id
  })

  // The seeded staff row outlives each test, so it needs its own teardown —
  // afterEach only clears the requests. Without this the row leaked on every
  // run and quietly accumulated in the dev DB.
  afterAll(async () => {
    const db = getDb(process.env.DATABASE_URL!)
    await db
      .delete(schema.staffProfileChangeRequests)
      .where(eq(schema.staffProfileChangeRequests.staffId, staffId))
    await db.delete(schema.staff).where(eq(schema.staff.id, staffId))
    // Sweep any rows earlier runs leaked before this hook existed.
    await db.delete(schema.staff).where(like(schema.staff.staffId, `${PREFIX}%`))
  })

  afterEach(async () => {
    const db = getDb(process.env.DATABASE_URL!)
    await db
      .delete(schema.staffProfileChangeRequests)
      .where(eq(schema.staffProfileChangeRequests.staffId, staffId))
    vi.clearAllMocks()
  })

  function authAs({ payroll = true }: { payroll?: boolean } = {}) {
    mockGetCurrentUser.mockResolvedValue({ id: adminUserId, email: 'admin@it.local' } as any)
    mockCheckPermission.mockImplementation(async (_c: any, _u: any, mod: any, act: any) =>
      mod === 'payroll' && act === 'update' ? payroll : true
    )
  }

  async function review(id: string, status = 'approved') {
    return makeApp().request(`/api/staff/profile-change-requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
  }

  // ── The four fields the staff app offers must keep working ────────────────

  it('applies an approved emergency-contact change', async () => {
    authAs()
    const req = await seedRequest('emergency_contact', {
      field: 'emergencyContactName',
      requestedValue: 'New Contact',
    })

    expect((await review(req.id)).status).toBe(200)
    expect((await currentStaff())?.emergencyContactName).toBe('New Contact')
  })

  // ── B5: the silent no-op ──────────────────────────────────────────────────

  /**
   * The core regression. Before, this returned 200, marked the request
   * approved, and wrote NOTHING.
   */
  it('refuses to approve a field it cannot auto-apply, instead of silently no-opping', async () => {
    authAs()
    const req = await seedRequest('bio', {
      field: 'ghanaCardPin',
      requestedValue: 'GHA-999999999-9',
    })

    const res = await review(req.id)
    expect(res.status).toBe(422)
    const json = (await res.json()) as any
    expect(json.code).toBe('CHANGE_NOT_AUTO_APPLIABLE')

    // And crucially the request must NOT be left marked approved.
    const db = getDb(process.env.DATABASE_URL!)
    const after = await db.query.staffProfileChangeRequests.findFirst({
      where: eq(schema.staffProfileChangeRequests.id, req.id),
    })
    expect(after?.status).toBe('pending')
    expect((await currentStaff())?.ghanaCardPin ?? null).toBeNull()
  })

  it('refuses a field that is valid for a different change type', async () => {
    authAs()
    // Bank field smuggled in on a `contact` request.
    const req = await seedRequest('contact', {
      field: 'bankAccountNumber',
      requestedValue: '9999999999',
    })

    expect((await review(req.id)).status).toBe(422)
    expect((await currentStaff())?.bankAccountNumber).toBe('0000000000')
  })

  // ── Free-text is a legitimate no-op ───────────────────────────────────────

  /**
   * `other` has no field — the staffer describes the change and HR applies it
   * by hand. Approving one legitimately writes nothing, so it must NOT trip the
   * guard above.
   */
  it('approves a free-text request without writing anything', async () => {
    authAs()
    const req = await seedRequest('other', { notes: 'Please correct my job title.' })

    expect((await review(req.id)).status).toBe(200)

    const db = getDb(process.env.DATABASE_URL!)
    const after = await db.query.staffProfileChangeRequests.findFirst({
      where: eq(schema.staffProfileChangeRequests.id, req.id),
    })
    expect(after?.status).toBe('approved')
  })

  // ── HR-L9 tier ────────────────────────────────────────────────────────────

  it('requires payroll:update to approve a bank-details change', async () => {
    authAs({ payroll: false })
    const req = await seedRequest('bank_details', {
      field: 'bankAccountNumber',
      requestedValue: '5555555555',
    })

    const res = await review(req.id)
    expect(res.status).toBe(403)
    const json = (await res.json()) as any
    expect(json.code).toBe('PAYROLL_PERMISSION_REQUIRED')
    // Unchanged — an approver without the payroll tier must not rewrite banking
    // details just because a staffer asked them to.
    expect((await currentStaff())?.bankAccountNumber).toBe('0000000000')
  })

  it('applies a bank-details change when the approver has payroll:update', async () => {
    authAs({ payroll: true })
    const req = await seedRequest('bank_details', {
      field: 'bankAccountNumber',
      requestedValue: '5555555555',
    })

    expect((await review(req.id)).status).toBe(200)
    expect((await currentStaff())?.bankAccountNumber).toBe('5555555555')
  })

  // ── Value validation ──────────────────────────────────────────────────────

  /** An approval must not be able to write what the staff editor would reject. */
  it('rejects a value the canonical column contract refuses', async () => {
    authAs()
    const req = await seedRequest('bank_details', {
      field: 'momoNetwork',
      requestedValue: 'vodafone', // retired brand; DB CHECK rejects it since 0176
    })

    expect((await review(req.id)).status).toBe(400)
    expect((await currentStaff())?.momoNetwork ?? null).toBeNull()
  })

  // ── Rejection path is untouched ───────────────────────────────────────────

  it('rejecting never writes, even for an appliable field', async () => {
    authAs()
    const req = await seedRequest('emergency_contact', {
      field: 'emergencyContactName',
      requestedValue: 'Should Not Land',
    })

    expect((await review(req.id, 'rejected')).status).toBe(200)
    expect((await currentStaff())?.emergencyContactName).not.toBe('Should Not Land')
  })
})
