/**
 * R17 regression guard (second caller) — `GET /performance/monthly` must score
 * attendance against HR clock-time overrides, not the raw device punch.
 *
 * `routes/staff-performance.ts` used to call `dailySummaries()` without
 * `overrides`, so the Performance datatable reported `daysLate` for days HR had
 * already corrected. It now fetches them via `lib/attendance-overrides.ts`.
 *
 *   control — late punch, no override        → daysLate 1, daysPresent 0
 *   guard   — same punch, corrected clock-in → daysLate 0, daysPresent 1
 *
 * Removing the `overrides:` argument (or the fetch) flips the guard back to
 * daysLate 1 and the test fails. No DB — the drizzle client is a fake.
 */

import { getTableName } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

// ── Module mocks (must precede the SUT import) ────────────────────────────────

vi.mock('../../src/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    BETTER_AUTH_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
  },
  validateBackendEnv: vi.fn(),
}))

vi.mock('../../src/lib/rbac')

const mockGetDb = vi.fn()
vi.mock('../../src/db', () => ({ getDb: (...args: unknown[]) => mockGetDb(...args) }))

vi.mock('../../src/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

// ── Imports (after the mocks) ────────────────────────────────────────────────

import * as schema from '../../src/db/schema'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { staffPerformanceApp } from '../../src/routes/staff-performance'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const STAFF_ID = 'staff-perf-1'
const MONTH = '2026-05'
/** Tuesday 2026-05-05, punched in at 09:10 → `late` under the default config. */
const LATE_DAY = '2026-05-05'
const LATE_PUNCH = new Date(`${LATE_DAY}T09:10:00.000Z`)

const AUTH_USER = {
  id: 'u-admin',
  email: 'admin@framada.app',
  name: 'Admin',
  role: 'user',
  roleId: 'admin',
}

// ── Fake drizzle db ──────────────────────────────────────────────────────────

type Rows = Record<string, unknown[]>

/**
 * `select().from(t)` — through any chain of `.leftJoin/.innerJoin/.where/...` —
 * resolves to `rows[getTableName(t)] ?? []`. The route only ever reads, so no
 * insert/update surface is needed.
 */
function makeFakeDb(rows: Rows) {
  const resultOf = (table: unknown) => {
    const data = rows[getTableName(table as never)] ?? []
    const chain: Record<string, unknown> = {
      leftJoin: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      limit: () => chain,
      orderBy: () => chain,
      // biome-ignore lint/suspicious/noThenProperty: fake Drizzle query builder — it must be awaitable as well as chainable, or `await db.select()...` never resolves.
      then: (res: (v: unknown[]) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(data).then(res, rej),
    }
    return chain
  }
  return { select: () => ({ from: (table: unknown) => resultOf(table) }) }
}

function rowsWith(overrideRows: unknown[]): Rows {
  return {
    [getTableName(schema.staff)]: [
      { id: STAFF_ID, fullName: 'Test Staff', role: 'user', staffType: 'internal' },
    ],
    [getTableName(schema.attendanceTimeOverrides)]: overrideRows,
    [getTableName(schema.staffTrainingProgress)]: [],
    [getTableName(schema.attendanceEvents)]: [
      {
        staffId: STAFF_ID,
        eventTimestamp: LATE_PUNCH,
        createdAt: LATE_PUNCH,
        sourceFile: null,
        deviceUserId: 'D-1',
        deviceUserName: 'Test Staff',
      },
    ],
    [getTableName(schema.attendanceExceptions)]: [],
    [getTableName(schema.staffRequests)]: [],
    [getTableName(schema.trainingAttempts)]: [],
  }
}

function makeApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/staff', staffPerformanceApp)
  return app
}

async function fetchMonthly() {
  const res = await makeApp().request(
    `/api/staff/performance/monthly?month=${MONTH}&staffId=${STAFF_ID}`
  )
  return { status: res.status, body: (await res.json()) as any }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /performance/monthly — HR clock-time overrides', () => {
  beforeEach(() => {
    process.env.DATABASE_URL ??= 'postgresql://localhost:5432/test'
    vi.mocked(getCurrentUser).mockResolvedValue(AUTH_USER)
    vi.mocked(checkPermission).mockResolvedValue(true)
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('control: an uncorrected 09:10 punch counts as a late day', async () => {
    mockGetDb.mockReturnValue(makeFakeDb(rowsWith([])))
    const { status, body } = await fetchMonthly()
    expect(status).toBe(200)
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({ staffId: STAFF_ID, daysLate: 1, daysPresent: 0 })
  })

  it('an HR override on that day removes the late day', async () => {
    mockGetDb.mockReturnValue(
      makeFakeDb(
        rowsWith([{ staffId: STAFF_ID, date: LATE_DAY, clockIn: '08:05', clockOut: '17:00' }])
      )
    )
    const { status, body } = await fetchMonthly()
    expect(status).toBe(200)
    expect(body.data[0]).toMatchObject({ staffId: STAFF_ID, daysLate: 0, daysPresent: 1 })
  })
})
