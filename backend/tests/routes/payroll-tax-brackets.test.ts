/**
 * HTTP-level tests for POST /api/payroll/tax-brackets/seed.
 *
 * The seed endpoint is additive: it fills in only the tax types a year has no
 * rows for. That matters because the destructive alternative is refused while
 * a non-archived payroll run intersects the year (PR-25), and a year is very
 * often part-populated — SSNIT rates present, PAYE table missing. Seeding the
 * whole year was the only route to those PAYE bands, so the guard blocked an
 * operation that would not have deleted anything relevant to the run.
 *
 * The database is mocked at the drizzle-chain level rather than mocked away,
 * since the behaviour under test is precisely which rows get written.
 */
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    BETTER_AUTH_URL: 'http://localhost:3000',
    NODE_ENV: 'development',
  },
  validateBackendEnv: vi.fn(),
}))

vi.mock('../../src/lib/rbac')
vi.mock('../../src/db', () => ({ getDb: vi.fn() }))
vi.mock('../../src/lib/audit', () => ({ createAuditLog: vi.fn(), recordDiffAudit: vi.fn() }))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../src/lib/gl-service', () => ({ postJournalEntry: vi.fn() }))
vi.mock('../../src/lib/payroll-gl-service', () => ({ postPayrollRunToGL: vi.fn() }))
vi.mock('../../src/lib/pdf-handlers', () => ({
  handleGetPayrollRunPdf: vi.fn(),
  handleGetSinglePayslipPdf: vi.fn(),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { getDb } from '../../src/db'
import { payrollRuns, payrollTaxBrackets } from '../../src/db/schema'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { payrollApp } from '../../src/routes/payroll'

const mockGetDb = vi.mocked(getDb)
const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockCheckPermission = vi.mocked(checkPermission)

// ── Helpers ───────────────────────────────────────────────────────────────────

interface SeededRow {
  taxType: string
  bracketYear: number
  ratePercent: string
}

/** A resolved row set that can also be narrowed with `.limit()`, like a real
 *  drizzle query builder. */
type RowsQuery = Promise<unknown[]> & { limit: () => RowsQuery }

const rowsQuery = (rows: unknown[]): RowsQuery =>
  Object.assign(Promise.resolve(rows), { limit: () => rowsQuery(rows) })

/**
 * Minimal drizzle stand-in covering the two shapes the seed route uses: a
 * `select().from().where()` that is awaited directly, and the same chain with
 * a trailing `.limit()`. Which rows come back is keyed off the table handed to
 * `.from()`, so the two queries cannot be confused for one another.
 */
function makeDb(opts: { existingTypes: string[]; activeRuns: Array<{ name: string }> }) {
  const written: { deletedYear: boolean; rows: SeededRow[] } = { deletedYear: false, rows: [] }

  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () =>
          rowsQuery(
            table === payrollTaxBrackets
              ? opts.existingTypes.map((taxType) => ({ taxType }))
              : table === payrollRuns
                ? opts.activeRuns.map((r, i) => ({ id: `run-${i}`, name: r.name, status: 'draft' }))
                : []
          ),
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        delete: () => ({
          where: () => {
            written.deletedYear = true
            return Promise.resolve()
          },
        }),
        insert: () => ({
          values: (rows: SeededRow[]) => ({
            returning: () => {
              written.rows = rows
              return Promise.resolve(rows)
            },
          }),
        }),
      }),
  }

  return { db, written }
}

function buildApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/payroll', payrollApp)
  return app
}

function seed(app: Hono<HonoEnv>, body: Record<string, unknown>) {
  return app.request('/api/payroll/tax-brackets/seed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function allowAll() {
  mockGetCurrentUser.mockResolvedValue({ id: 'user-1' } as never)
  mockCheckPermission.mockResolvedValue(true)
}

afterEach(() => {
  vi.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/payroll/tax-brackets/seed', () => {
  it('seeds every tax type when the year is empty', async () => {
    allowAll()
    const { db, written } = makeDb({ existingTypes: [], activeRuns: [] })
    mockGetDb.mockReturnValue(db as never)

    const res = await seed(buildApp(), { bracketYear: 2026 })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { inserted: number; skipped: string[] } }
    expect(body.data.skipped).toEqual([])
    expect(new Set(written.rows.map((r) => r.taxType))).toEqual(
      new Set(['paye', 'ssnit_employee', 'ssnit_employer'])
    )
    expect(written.deletedYear).toBe(false)
  })

  // The regression this endpoint was failing on: 2026 held SSNIT rates and no
  // PAYE table, and a published July 2026 run made the whole-year replace
  // illegal, leaving no way to add the PAYE bands at all.
  it('adds only the missing type, and is not blocked by an active run', async () => {
    allowAll()
    const { db, written } = makeDb({
      existingTypes: ['ssnit_employee', 'ssnit_employer'],
      activeRuns: [{ name: 'july 2026' }],
    })
    mockGetDb.mockReturnValue(db as never)

    const res = await seed(buildApp(), { bracketYear: 2026 })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { skipped: string[]; seeded: string[] } }
    expect(body.data.seeded).toEqual(['paye'])
    expect(body.data.skipped).toEqual(['ssnit_employee', 'ssnit_employer'])
    // Nothing deleted, and no SSNIT row rewritten under the run's feet.
    expect(written.deletedYear).toBe(false)
    expect(written.rows.every((r) => r.taxType === 'paye')).toBe(true)
    expect(written.rows.every((r) => r.bracketYear === 2026)).toBe(true)
  })

  it('returns YEAR_NOT_EMPTY when every type is already populated', async () => {
    allowAll()
    const { db, written } = makeDb({
      existingTypes: ['paye', 'ssnit_employee', 'ssnit_employer'],
      activeRuns: [],
    })
    mockGetDb.mockReturnValue(db as never)

    const res = await seed(buildApp(), { bracketYear: 2026 })

    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('YEAR_NOT_EMPTY')
    expect(written.rows).toEqual([])
  })

  it('still refuses a replace while a non-archived run intersects the year', async () => {
    allowAll()
    const { db, written } = makeDb({
      existingTypes: ['paye', 'ssnit_employee', 'ssnit_employer'],
      activeRuns: [{ name: 'july 2026' }],
    })
    mockGetDb.mockReturnValue(db as never)

    const res = await seed(buildApp(), { bracketYear: 2026, replace: true })

    expect(res.status).toBe(409)
    const body = (await res.json()) as { code: string; data: { runs: Array<{ name: string }> } }
    expect(body.code).toBe('ACTIVE_RUNS_EXIST')
    expect(body.data.runs[0].name).toBe('july 2026')
    expect(written.deletedYear).toBe(false)
    expect(written.rows).toEqual([])
  })

  it('replaces the whole year once no run stands in the way', async () => {
    allowAll()
    const { db, written } = makeDb({
      existingTypes: ['paye', 'ssnit_employee', 'ssnit_employer'],
      activeRuns: [],
    })
    mockGetDb.mockReturnValue(db as never)

    const res = await seed(buildApp(), { bracketYear: 2026, replace: true })

    expect(res.status).toBe(200)
    expect(written.deletedYear).toBe(true)
    expect(new Set(written.rows.map((r) => r.taxType))).toEqual(
      new Set(['paye', 'ssnit_employee', 'ssnit_employer'])
    )
  })

  it('rejects a year outside 2000–2100', async () => {
    allowAll()
    const { db } = makeDb({ existingTypes: [], activeRuns: [] })
    mockGetDb.mockReturnValue(db as never)

    expect((await seed(buildApp(), { bracketYear: 1999 })).status).toBe(400)
    expect((await seed(buildApp(), { bracketYear: 'nope' })).status).toBe(400)
  })

  it('requires authentication and the payroll create permission', async () => {
    mockGetCurrentUser.mockResolvedValue(null as never)
    expect((await seed(buildApp(), { bracketYear: 2026 })).status).toBe(401)

    mockGetCurrentUser.mockResolvedValue({ id: 'user-1' } as never)
    mockCheckPermission.mockResolvedValue(false)
    expect((await seed(buildApp(), { bracketYear: 2026 })).status).toBe(403)
  })
})
