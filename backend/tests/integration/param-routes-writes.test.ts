/**
 * R10 / T28 — parameterised (`/:id`) routes and write paths.
 *
 * Two acknowledged blind spots in the 2026-08-29 audit and its re-audit:
 *   • `/:id`-style routes were EXCLUDED from the smoke sweep, so any defect that
 *     needs a real entity id to reach never surfaced.
 *   • No write path was ever executed. Mutations were probed with deliberately
 *     empty bodies to prove routing (400 vs 404) — routing is confirmed,
 *     BEHAVIOUR is not.
 *
 * This suite seeds a small committed fixture set and then drives, per module,
 * a real write followed by a real parameterised read of what the write produced,
 * plus the unknown-id case (which must be a clean 404, not a 500).
 *
 * ── Safety ──────────────────────────────────────────────────────────────────
 * It COMMITS rows, so unlike the `withRollback` suites it cannot run against a
 * shared database. It therefore refuses anything but a LOCAL Postgres and skips
 * otherwise — the shared Neon dev branch is used concurrently and must not be
 * mutated. Everything it creates is deleted in `afterAll`, tracked by id.
 *
 *   pnpm --filter backend db:local:up
 *   pnpm --filter backend db:local:setup
 *   DATABASE_URL=postgresql://framada:framada@localhost:5433/framada \
 *     npx vitest run tests/integration/param-routes-writes.test.ts
 */

import { Hono } from 'hono'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

// ── Gate ─────────────────────────────────────────────────────────────────────

const RAW_DB_URL = process.env.DATABASE_URL ?? ''
const IS_LOCAL = /@(localhost|127\.0\.0\.1|host\.docker\.internal)([:/]|$)/.test(RAW_DB_URL)
/** Never run against Neon/production — this suite commits rows. */
const skip = !IS_LOCAL

// ── Module mocks (must precede the SUT imports) ──────────────────────────────

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://localhost:5433/framada',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    BETTER_AUTH_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
  },
  validateBackendEnv: vi.fn(),
  isSelfHealEnabled: () => false,
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
  DEFAULT_SMS_TEMPLATES: { welcome: 'welcome {Patientname}' },
}))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

// ── Imports (after the mocks) ────────────────────────────────────────────────

import { and, eq, inArray, sql } from 'drizzle-orm'
import { type DB, getDb } from '../../src/db'
import {
  appointments,
  doctors,
  expenses,
  invoices,
  journalEntries,
  journalLines,
  patients,
  staff,
  staffAttendanceSubmissions,
} from '../../src/db/schema'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { appointmentsApp } from '../../src/routes/appointments'
import { expensesApp } from '../../src/routes/expenses'
import { invoicesApp } from '../../src/routes/invoices'
import { patientsApp } from '../../src/routes/patients'
import { paymentPlansApp } from '../../src/routes/payment-plans'
import { staffAttendanceApp } from '../../src/routes/staff-attendance'

// ── Harness ──────────────────────────────────────────────────────────────────

const MISSING_UUID = '00000000-0000-0000-0000-000000000000'
/** Tag every fixture so a crashed run is trivially identifiable in the DB. */
const TAG = `r10-${Date.now()}`

let db: DB
let app: Hono<HonoEnv>
let adminUserId: string
/** True when this run created the doctors fixture (so cleanup may delete it). */
let createdDoctorIsOurs = false
/** A seeded Chart-of-Accounts revenue account — required on every invoice line. */
let revenueAccountId: string

const created = {
  patients: [] as string[],
  appointments: [] as string[],
  expenses: [] as string[],
  invoices: [] as string[],
  doctors: [] as string[],
  staff: [] as string[],
  submissions: [] as string[],
}

function makeApp(): Hono<HonoEnv> {
  const a = new Hono<HonoEnv>()
  a.route('/api/patients', patientsApp)
  a.route('/api/appointments', appointmentsApp)
  a.route('/api/expenses', expensesApp)
  a.route('/api/invoices', invoicesApp)
  a.route('/api/payment-plans', paymentPlansApp)
  a.route('/api/staff', staffAttendanceApp)
  return a
}

async function get(path: string) {
  const res = await app.request(path)
  let body: any = null
  try {
    body = await res.json()
  } catch {
    /* empty body */
  }
  return { status: res.status, body }
}

async function send(method: string, path: string, payload?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  let body: any = null
  try {
    body = await res.json()
  } catch {
    /* empty body */
  }
  return { status: res.status, body }
}

const post = (p: string, b?: unknown) => send('POST', p, b)
const patch = (p: string, b?: unknown) => send('PATCH', p, b)
const del = (p: string) => send('DELETE', p)

// ── Suite ────────────────────────────────────────────────────────────────────

describe.skipIf(skip)('R10 — parameterised routes + write paths (local Postgres)', () => {
  beforeAll(async () => {
    db = getDb(RAW_DB_URL)

    const users = await db.execute<{ id: string }>(
      sql`SELECT id FROM "user" ORDER BY "createdAt" LIMIT 1`
    )
    adminUserId = users.rows[0]?.id
    if (!adminUserId) throw new Error('No rows in "user" — run `pnpm --filter backend seed:admin`')

    app = makeApp()

    // A patient fixture. Inserted directly rather than through POST
    // /api/patients because that endpoint currently rejects the JSON body every
    // client sends — see the "KNOWN DEFECT" test below.
    const [p] = await db
      .insert(patients)
      .values({
        name: `R10 Fixture ${TAG}`,
        patientId: `FD-R10-${TAG.slice(-6)}`,
        dob: new Date('1990-01-01'),
        gender: 'other',
        phone: '0200000111',
        address: 'Test Street',
        occupation: 'Tester',
      })
      .returning({ id: patients.id })
    created.patients.push(p.id)

    // A doctor fixture (`doctors_source_xor` wants exactly one of user/specialist).
    const existingDoctor = await db.select({ id: doctors.id }).from(doctors).limit(1)
    if (existingDoctor.length > 0) {
      created.doctors.push(existingDoctor[0].id) // reuse; do NOT delete in cleanup
    } else {
      const [d] = await db
        .insert(doctors)
        .values({ userId: adminUserId, specialty: 'General' })
        .returning({ id: doctors.id })
      created.doctors.push(d.id)
      createdDoctorIsOurs = true
    }

    const revenue = await db.execute<{ id: string }>(
      sql`SELECT id FROM accounts WHERE type = 'revenue' ORDER BY code LIMIT 1`
    )
    revenueAccountId = revenue.rows[0]?.id
    if (!revenueAccountId)
      throw new Error('No revenue account seeded — run `pnpm --filter backend db:local:setup`')

    // A staff fixture for the attendance module. `staff.employmentType` is an FK
    // into the `employment_types` lookup, so take whatever is actually seeded.
    const empTypes = await db.execute<{ name: string }>(
      sql`SELECT name FROM employment_types ORDER BY name LIMIT 1`
    )
    const employmentType = empTypes.rows[0]?.name
    if (!employmentType)
      throw new Error('employment_types is empty — run `pnpm --filter backend db:local:setup`')

    const [s] = await db
      .insert(staff)
      .values({
        fullName: `R10 Staff ${TAG}`,
        staffId: `R10-${TAG.slice(-6)}`,
        employmentType,
        status: 'active',
      })
      .returning({ id: staff.id })
    created.staff.push(s.id)
  })

  afterAll(async () => {
    if (skip || !db) return
    // Posting an expense books a ledger entry whose source document is the expense, and nothing
    // cascades from the expense to it. Remove that entry (and its lines) for every expense this run
    // made — the ones it tracked and any it made but failed to track (stamped with TAG) — or each
    // run leaves one behind, authored by the seeded admin, which no fixture sweep can see.
    const stamped = await db.execute<{ id: string }>(
      sql`SELECT id FROM expenses WHERE description LIKE ${`%${TAG}%`}`
    )
    const expenseIds = [...new Set([...created.expenses, ...stamped.rows.map((r) => r.id)])]
    if (expenseIds.length) {
      const entries = await db
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.sourceDocType, 'expense'),
            inArray(journalEntries.sourceDocId, expenseIds)
          )
        )
      const entryIds = entries.map((e) => e.id)
      if (entryIds.length) {
        await db.delete(journalLines).where(inArray(journalLines.entryId, entryIds))
        await db.delete(journalEntries).where(inArray(journalEntries.id, entryIds))
      }
    }

    // Reverse dependency order. Patients cascade to their invoices/appointments,
    // but delete explicitly so a partial fixture set still cleans up.
    if (created.submissions.length)
      await db
        .delete(staffAttendanceSubmissions)
        .where(inArray(staffAttendanceSubmissions.id, created.submissions))
    if (created.invoices.length)
      await db.delete(invoices).where(inArray(invoices.id, created.invoices))
    if (created.appointments.length)
      await db.delete(appointments).where(inArray(appointments.id, created.appointments))
    if (created.expenses.length)
      await db.delete(expenses).where(inArray(expenses.id, created.expenses))
    if (created.staff.length) await db.delete(staff).where(inArray(staff.id, created.staff))
    if (created.patients.length)
      await db.delete(patients).where(inArray(patients.id, created.patients))
    if (createdDoctorIsOurs && created.doctors.length)
      await db.delete(doctors).where(eq(doctors.id, created.doctors[0]))

    // Safety net: sweep anything this run created but failed to track (a test
    // that errors before pushing its id). Everything is stamped with TAG.
    await db.execute(sql`DELETE FROM patients WHERE name LIKE ${`%${TAG}%`}`)
    await db.execute(sql`DELETE FROM expenses WHERE description LIKE ${`%${TAG}%`}`)
  })

  beforeEach(() => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: adminUserId,
      email: 'admin@framada.app',
      name: 'Admin',
      role: 'admin',
      roleId: 'admin',
    })
    vi.mocked(checkPermission).mockResolvedValue(true)
  })

  // ── Patients ───────────────────────────────────────────────────────────────

  describe('patients', () => {
    it('GET /api/patients/:id returns the seeded patient', async () => {
      const { status, body } = await get(`/api/patients/${created.patients[0]}`)
      expect(status).toBe(200)
      expect(body.data?.id ?? body.data?.patient?.id ?? body.id).toBeTruthy()
      expect(JSON.stringify(body)).toContain(TAG)
    })

    it('GET /api/patients/:id for an unknown id is a clean 404, not a 500', async () => {
      const { status } = await get(`/api/patients/${MISSING_UUID}`)
      expect(status).toBe(404)
    })

    it('PATCH /api/patients/:id persists the change (write path)', async () => {
      const newOccupation = `Updated ${TAG}`
      const { status } = await patch(`/api/patients/${created.patients[0]}`, {
        occupation: newOccupation,
      })
      expect(status).toBe(200)

      const [row] = await db
        .select({ occupation: patients.occupation })
        .from(patients)
        .where(eq(patients.id, created.patients[0]))
      expect(row.occupation).toBe(newOccupation)
    })

    it('POST /api/patients accepts the ISO date string clients send, then GET /:id reads it back', async () => {
      // Regression guard for the `dob` contract. `createPatientSchema`
      // (backend/src/lib/validation/patients.ts) must coerce the "YYYY-MM-DD"
      // string that every client sends — a plain `z.date()` rejects it, because
      // JSON cannot carry a Date. This test caught exactly that during R10 and
      // now pins the coercion.
      const { status, body } = await post('/api/patients', {
        name: `R10 Created ${TAG}`,
        dob: '1990-01-01',
        gender: 'male',
        phone: '0200000222',
        address: 'Test Street',
        occupation: 'Tester',
      })
      expect(status, JSON.stringify(body)).toBe(200)
      const id = body.data?.id
      expect(id).toBeTruthy()
      created.patients.push(id)

      const read = await get(`/api/patients/${id}`)
      expect(read.status).toBe(200)
      expect(JSON.stringify(read.body)).toContain(`R10 Created ${TAG}`)
    })

    it('PATCH /api/patients/:id saves a child patient the way the Edit sheet sends it', async () => {
      // The Edit sheet clears a child's own phone/address/occupation (and email)
      // by sending null. The update schema rejected null for those fields, so no
      // child patient could be saved from the portal at all — every attempt 400'd.
      const [child] = await db
        .insert(patients)
        .values({
          name: `R10 Child ${TAG}`,
          dob: new Date('2016-05-01'),
          gender: 'female',
          isChild: true,
          phone: '0244123456',
          guardianName: 'R10 Guardian',
          guardianPhone: '0244123456',
          guardianAddress: 'Test Street',
          guardianOccupation: 'Tester',
        })
        .returning({ id: patients.id })
      created.patients.push(child.id)

      const { status, body } = await patch(`/api/patients/${child.id}`, {
        name: `R10 Child ${TAG}`,
        dob: '2016-05-01T00:00:00.000Z',
        gender: 'female',
        tagIds: [],
        isChild: true,
        profileImage: null,
        nationality: 'Ghana',
        howDidYouHear: null,
        howDidYouHearOther: null,
        insuranceProvider: null,
        insurancePolicyNumber: null,
        guardianName: 'R10 Guardian',
        guardianPhone: '0244123456',
        guardianEmail: 'guardian@example.com',
        guardianAddress: 'Test Street',
        guardianOccupation: 'Tester',
        phone: null,
        email: null,
        address: null,
        occupation: null,
      })
      expect(status, JSON.stringify(body)).toBe(200)

      const [row] = await db
        .select({ phone: patients.phone, guardianEmail: patients.guardianEmail })
        .from(patients)
        .where(eq(patients.id, child.id))
      expect(row).toEqual({ phone: null, guardianEmail: 'guardian@example.com' })
    })

    it("PATCH /api/patients/:id sets and clears an adult patient's email", async () => {
      const id = created.patients[0]

      const set = await patch(`/api/patients/${id}`, { email: 'patient@example.com' })
      expect(set.status, JSON.stringify(set.body)).toBe(200)
      const [afterSet] = await db
        .select({ email: patients.email })
        .from(patients)
        .where(eq(patients.id, id))
      expect(afterSet.email).toBe('patient@example.com')

      const cleared = await patch(`/api/patients/${id}`, { email: null })
      expect(cleared.status, JSON.stringify(cleared.body)).toBe(200)
      const [afterClear] = await db
        .select({ email: patients.email })
        .from(patients)
        .where(eq(patients.id, id))
      expect(afterClear.email).toBeNull()
    })
  })

  // ── Appointments ───────────────────────────────────────────────────────────

  describe('appointments', () => {
    it('POST /api/appointments creates, and GET /:id reads it back', async () => {
      const when = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
      when.setUTCHours(10, 0, 0, 0)

      const createRes = await post('/api/appointments', {
        data: {
          patientId: created.patients[0],
          doctorId: created.doctors[0],
          date: when.toISOString(),
          status: 'scheduled',
          type: 'consultation',
          durationMinutes: 30,
          notes: TAG,
        },
        sendSMS: false,
      })
      expect(createRes.status).toBe(200)
      const id = createRes.body.data?.id
      expect(id).toBeTruthy()
      created.appointments.push(id)

      const read = await get(`/api/appointments/${id}`)
      expect(read.status).toBe(200)
      expect(read.body.data.id).toBe(id)
      // The parameterised read joins patient + doctor — the part a smoke sweep
      // with no real id could never reach.
      expect(read.body.data.patient?.id).toBe(created.patients[0])
      expect(read.body.data.doctor?.user?.name).toMatch(/^Dr\.? /)
    })

    it('PATCH /api/appointments/:id persists a status change', async () => {
      const id = created.appointments[0]
      // PATCH takes the same `{ data: {...} }` envelope as POST.
      const res = await patch(`/api/appointments/${id}`, { data: { status: 'confirmed' } })
      expect(res.status).toBe(200)
      const [row] = await db
        .select({ status: appointments.status })
        .from(appointments)
        .where(eq(appointments.id, id))
      expect(row.status).toBe('confirmed')
    })

    it('GET /api/appointments/:id for an unknown id is 404', async () => {
      const { status } = await get(`/api/appointments/${MISSING_UUID}`)
      expect(status).toBe(404)
    })
  })

  // ── Expenses ───────────────────────────────────────────────────────────────

  describe('expenses', () => {
    it('POST /api/expenses creates, and GET /:id reads it back', async () => {
      const res = await post('/api/expenses', {
        category: 'Communications',
        description: `R10 expense ${TAG}`,
        amount: 1250, // cents (0209) — GHS 12.50, the same unit the portal posts
        date: new Date().toISOString().slice(0, 10),
        paidTo: 'R10 Vendor',
      })
      expect(res.status).toBe(200)
      const id = res.body.data?.id
      expect(id).toBeTruthy()
      created.expenses.push(id)

      // R12 context: the response reports whether the expense reached the GL.
      // Recorded rather than asserted — this suite must not encode whichever
      // side of that open finance question is currently true.
      // eslint-disable-next-line no-console
      console.log(
        `[R10] expense GL posting -> glPosted=${res.body.glPosted} reason=${res.body.glReason ?? 'n/a'}`
      )
      expect(res.body).toHaveProperty('glPosted')

      const read = await get(`/api/expenses/${id}`)
      expect(read.status).toBe(200)
      expect(read.body.data.id).toBe(id)
      expect(Number(read.body.data.amount)).toBe(1250)
    })

    it('POST /api/expenses rejects a negative amount', async () => {
      const res = await post('/api/expenses', {
        category: 'Communications',
        description: 'negative',
        amount: -5,
        date: new Date().toISOString().slice(0, 10),
      })
      expect(res.status).toBe(400)
    })

    it('GET /api/expenses/:id for an unknown id is 404', async () => {
      const { status } = await get(`/api/expenses/${MISSING_UUID}`)
      expect(status).toBe(404)
    })
  })

  // ── Invoices ───────────────────────────────────────────────────────────────

  describe('invoices', () => {
    it('POST /api/invoices creates a draft, and GET /:id + /:id/lines read it back', async () => {
      const res = await post('/api/invoices', {
        patientId: created.patients[0],
        description: `R10 invoice ${TAG}`,
      })
      expect([200, 201]).toContain(res.status)
      const id = res.body.data?.id
      expect(id).toBeTruthy()
      created.invoices.push(id)

      const read = await get(`/api/invoices/${id}`)
      expect(read.status).toBe(200)
      expect(read.body.data.id).toBe(id)
      expect(read.body.data.status).toBe('draft')

      // A second parameterised WRITE against the id the first write produced.
      const addLine = await post(`/api/invoices/${id}/lines`, {
        description: 'R10 line',
        quantity: 1,
        unitPrice: 100,
        revenueAccountId,
      })
      expect(addLine.status).toBe(200)

      const lines = await get(`/api/invoices/${id}/lines`)
      expect(lines.status).toBe(200)
      expect(Array.isArray(lines.body.data)).toBe(true)
      expect(lines.body.data).toHaveLength(1)
      expect(Number(lines.body.data[0].lineTotal)).toBe(100)

      // D5 contract: a DRAFT header's money columns always equal the sum of
      // its lines. `POST /:id/lines` recomputes the header through
      // `recomputeInvoiceTotals()` — the same summation `issueInvoice()` uses —
      // so anything reading `invoice.total` on a draft sees the real total, not
      // a stale, authoritative-looking 0.
      const reread = await get(`/api/invoices/${id}`)
      expect(Number(reread.body.data.total)).toBe(100)
      expect(Number(reread.body.data.subtotal)).toBe(100)
      expect(Number(reread.body.data.taxableAmount)).toBe(100)
      expect(Number(reread.body.data.discountTotal)).toBe(0)
      expect(Number(reread.body.data.taxTotal)).toBe(0)
      expect(Number(reread.body.data.balance)).toBe(100)

      // …and the DELETE side of the same contract: removing the only line
      // takes the header back to zero rather than leaving the old total.
      const lineId = lines.body.data[0].id
      const delLine = await del(`/api/invoices/${id}/lines/${lineId}`)
      expect(delLine.status).toBe(200)

      const afterDelete = await get(`/api/invoices/${id}`)
      expect(Number(afterDelete.body.data.total)).toBe(0)
      expect(Number(afterDelete.body.data.subtotal)).toBe(0)
      expect(Number(afterDelete.body.data.balance)).toBe(0)
    })

    it('GET /api/invoices/:id for an unknown id is 404', async () => {
      const { status } = await get(`/api/invoices/${MISSING_UUID}`)
      expect(status).toBe(404)
    })
  })

  // ── Payment plans ──────────────────────────────────────────────────────────

  describe('payment plans', () => {
    it('GET /api/payment-plans/patient/:patientId reads the (empty) list for a real patient', async () => {
      const { status, body } = await get(`/api/payment-plans/patient/${created.patients[0]}`)
      expect(status).toBe(200)
      expect(Array.isArray(body.data ?? body)).toBe(true)
    })

    it('R11 regression — pausing a nonexistent plan is 404, not 200 success', async () => {
      // The re-audit found this returning 200 {"success":true} after updating 0
      // rows, so callers could not tell "paused" from "no such plan".
      const { status } = await patch(`/api/payment-plans/${MISSING_UUID}/pause`)
      expect(status).toBe(404)
    })

    it('R11 regression — unpausing a nonexistent plan is 404 too', async () => {
      const { status } = await patch(`/api/payment-plans/${MISSING_UUID}/unpause`)
      expect(status).toBe(404)
    })
  })

  // ── Staff attendance (ties to R17) ─────────────────────────────────────────

  describe('staff attendance', () => {
    it('POST /api/staff/attendance/overrides writes an HR clock-time correction', async () => {
      const date = '2026-01-07'
      const res = await post('/api/staff/attendance/overrides', {
        staffId: created.staff[0],
        date,
        clockIn: '08:05',
        clockOut: '17:00',
        reason: `R10 ${TAG}`,
      })
      expect(res.status).toBe(200)

      const rows = await db.execute<{ clockIn: string }>(
        sql`SELECT "clockIn" FROM attendance_time_overrides
             WHERE "staffId" = ${created.staff[0]} AND date = ${date}`
      )
      expect(rows.rows).toHaveLength(1)
      expect(String(rows.rows[0].clockIn)).toMatch(/^08:05/)

      // `attendance_time_overrides` is unique on (staffId, date) — a second
      // write for the same day must update, not duplicate or 500.
      const again = await post('/api/staff/attendance/overrides', {
        staffId: created.staff[0],
        date,
        clockIn: '08:10',
        clockOut: '17:00',
        reason: `R10 ${TAG} again`,
      })
      expect(again.status).toBe(200)
      const after = await db.execute<{ clockIn: string }>(
        sql`SELECT "clockIn" FROM attendance_time_overrides
             WHERE "staffId" = ${created.staff[0]} AND date = ${date}`
      )
      expect(after.rows).toHaveLength(1)
      expect(String(after.rows[0].clockIn)).toMatch(/^08:10/)

      await db.execute(
        sql`DELETE FROM attendance_time_overrides WHERE "staffId" = ${created.staff[0]}`
      )
    })

    it('GET /api/staff/attendance/:staffId returns a scored month for a real staff id', async () => {
      const { status, body } = await get(
        `/api/staff/attendance/${created.staff[0]}?month=${new Date().toISOString().slice(0, 7)}`
      )
      expect(status).toBe(200)
      expect(body.success).toBe(true)
    })
  })
})
