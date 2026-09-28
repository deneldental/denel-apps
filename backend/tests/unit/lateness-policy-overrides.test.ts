/**
 * R17 regression guard — HR clock-time overrides must suppress lateness queries.
 *
 * Background: `lib/cron/jobs/lateness-policy.ts` and `routes/staff-performance.ts`
 * both used to call `dailySummaries()` WITHOUT fetching
 * `attendance_time_overrides`, so a clock-in HR had already corrected still
 * scored as `late` and the weekly cron issued a lateness query for it. Both now
 * fetch via `lib/attendance-overrides.ts` and pass `overrides` through.
 *
 * These tests pin that wiring end-to-end for the cron job:
 *
 *   1. control  — a late punch with NO override  → a lateness query IS inserted.
 *   2. guard    — the same late punch WITH an override → NOTHING is inserted.
 *
 * If the `fetchOverridesByStaff` call or the `overrides:` argument is removed
 * from the job, test (2) fails: the job flags the staff member again. Test (1)
 * exists so a mock that silently returns nothing can't make (2) pass vacuously.
 *
 * The DB is a hand-rolled fake keyed on drizzle's table name — no network.
 */

import { getTableName } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

const mockGetDb = vi.fn()
vi.mock('../../src/db', () => ({ getDb: (...args: unknown[]) => mockGetDb(...args) }))

vi.mock('../../src/lib/attendance-config', () => ({
  ATTENDANCE_CONFIG_KEY: 'hr.attendance_config',
  getAttendanceConfig: vi.fn(),
}))

vi.mock('../../src/lib/sms', () => ({ sendSMS: vi.fn(async () => ({ success: true })) }))
vi.mock('../../src/lib/sms-templates', () => ({
  resolveSmsTemplate: vi.fn(async (_db: unknown, _key: string, fallback: string) => fallback),
  renderSms: (t: string) => t,
}))
vi.mock('../../src/lib/logger', () => ({
  logError: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

// ── Imports (after the mocks) ────────────────────────────────────────────────

import * as schema from '../../src/db/schema'
import { DEFAULT_ATTENDANCE_CONFIG, dailySummaries } from '../../src/lib/attendance'
import { getAttendanceConfig } from '../../src/lib/attendance-config'
import { fetchOverridesByStaff } from '../../src/lib/attendance-overrides'
import { runLatenessPolicy } from '../../src/lib/cron/jobs/lateness-policy'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const STAFF_ID = 'staff-late-1'
/** Monday 2026-05-11 → the job scores the prior week, Mon 2026-05-04 … Sun 2026-05-10. */
const FIRED_AT = new Date('2026-05-11T06:00:00.000Z')
const WEEK_START = '2026-05-04'
/** Tuesday of the scored week — the day with the (late) punch. */
const LATE_DAY = '2026-05-05'
/** 09:10 is well past the 08:15 on-time / 08:30 mild cutoffs → `late`. */
const LATE_PUNCH = new Date(`${LATE_DAY}T09:10:00.000Z`)

const CONFIG = {
  ...DEFAULT_ATTENDANCE_CONFIG,
  latenessPolicyEnabled: true,
  // One late day is enough to trip the policy — keeps the fixture to a single punch.
  lateFlagsPerWeek: 1,
}

/** A raw `attendance_events` row as the job selects it. `sourceFile: null` → CSV
 *  semantics, so the effective clock time is the device `eventTimestamp`. */
const LATE_EVENT_ROW = {
  staffId: STAFF_ID,
  deviceUserId: 'D-1',
  deviceUserName: 'Test Staff',
  eventTimestamp: LATE_PUNCH,
  createdAt: LATE_PUNCH,
  sourceFile: null,
}

const STAFF_ROW = {
  id: STAFF_ID,
  fullName: 'Test Staff',
  phone: null, // no phone → the job takes the `no_phone` branch, no SMS to assert on
  userId: 'user-1',
}

// ── Fake drizzle db ──────────────────────────────────────────────────────────

type Rows = Record<string, unknown[]>

interface FakeDb {
  db: unknown
  inserted: Array<{ table: string; values: unknown }>
}

/**
 * Minimal stand-in for the drizzle client. `select().from(t)` (with or without
 * `.where()` / `.limit()`) resolves to `rows[getTableName(t)] ?? []`; inserts and
 * updates are recorded rather than executed.
 */
function makeFakeDb(rows: Rows): FakeDb {
  const inserted: Array<{ table: string; values: unknown }> = []

  const resultOf = (table: unknown) => {
    const name = getTableName(table as never)
    const data = rows[name] ?? []
    const thenable: Record<string, unknown> = {
      where: () => thenable,
      limit: () => thenable,
      orderBy: () => thenable,
      // biome-ignore lint/suspicious/noThenProperty: fake Drizzle query builder — it must be awaitable as well as chainable, or `await db.select()...` never resolves.
      then: (res: (v: unknown[]) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(data).then(res, rej),
    }
    return thenable
  }

  const db = {
    select: () => ({ from: (table: unknown) => resultOf(table) }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserted.push({ table: getTableName(table as never), values })
        const chain: Record<string, unknown> = {
          onConflictDoNothing: () => chain,
          returning: async () => [{ id: `inserted-${inserted.length}` }],
          // biome-ignore lint/suspicious/noThenProperty: fake Drizzle query builder — it must be awaitable as well as chainable, or `await db.select()...` never resolves.
          then: (res: (v: unknown) => unknown) => Promise.resolve(undefined).then(res),
        }
        return chain
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }

  return { db, inserted }
}

function baseRows(overrideRows: unknown[]): Rows {
  return {
    [getTableName(schema.staff)]: [STAFF_ROW],
    [getTableName(schema.attendanceEvents)]: [LATE_EVENT_ROW],
    [getTableName(schema.attendanceExceptions)]: [],
    [getTableName(schema.staffOffDays)]: [],
    [getTableName(schema.clinicHolidays)]: [],
    [getTableName(schema.attendanceTimeOverrides)]: overrideRows,
    [getTableName(schema.user)]: [],
    [getTableName(schema.staffLatenessQueries)]: [], // no prior queries
  }
}

function ctx() {
  return { jobId: 'lateness-policy', firedAt: FIRED_AT, source: 'manual' as const, log: vi.fn() }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('attendance overrides / fetchOverridesByStaff', () => {
  it('groups override rows by staff id', async () => {
    const { db } = makeFakeDb({
      [getTableName(schema.attendanceTimeOverrides)]: [
        { staffId: 'A', date: '2026-05-04', clockIn: '08:00', clockOut: null },
        { staffId: 'A', date: '2026-05-05', clockIn: '08:05', clockOut: '17:00' },
        { staffId: 'B', date: '2026-05-05', clockIn: null, clockOut: '17:30' },
      ],
    })
    const map = await fetchOverridesByStaff(db as never, ['A', 'B'], '2026-05-04', '2026-05-11')
    expect(map.get('A')).toHaveLength(2)
    expect(map.get('B')).toEqual([{ date: '2026-05-05', clockIn: null, clockOut: '17:30' }])
  })

  it('short-circuits (no query) for an empty staff list', async () => {
    const select = vi.fn()
    const map = await fetchOverridesByStaff({ select } as never, [], '2026-05-04', '2026-05-11')
    expect(map.size).toBe(0)
    expect(select).not.toHaveBeenCalled()
  })
})

describe('attendance scoring / an override outranks the device punch', () => {
  const common = {
    month: LATE_DAY.slice(0, 7),
    events: [
      {
        staffId: STAFF_ID,
        deviceUserId: 'D-1',
        deviceUserName: null,
        eventTimestamp: LATE_PUNCH,
      },
    ],
    exceptions: [],
    config: CONFIG,
  }

  it('scores the raw 09:10 punch as late', () => {
    const rec = dailySummaries(common).find((r) => r.date === LATE_DAY)
    expect(rec?.status).toBe('late')
  })

  it('scores the same day as present once HR corrects the clock-in', () => {
    const rec = dailySummaries({
      ...common,
      overrides: [{ date: LATE_DAY, clockIn: '08:05', clockOut: null }],
    }).find((r) => r.date === LATE_DAY)
    expect(rec?.status).toBe('present')
  })
})

describe('lateness-policy cron / HR clock-time overrides', () => {
  beforeEach(() => {
    vi.mocked(getAttendanceConfig).mockResolvedValue(CONFIG)
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('control: a late punch with NO override raises a lateness query', async () => {
    const { db, inserted } = makeFakeDb(baseRows([]))
    mockGetDb.mockReturnValue(db)

    const res = await runLatenessPolicy(ctx())

    expect(res.details).toMatchObject({ flagged: 1, weekStart: WEEK_START })
    const queries = inserted.filter((i) => i.table === getTableName(schema.staffLatenessQueries))
    expect(queries).toHaveLength(1)
    expect(queries[0].values).toMatchObject({ staffId: STAFF_ID, lateCount: 1, level: 1 })
  })

  it('an HR override on the late day suppresses the lateness query', async () => {
    const { db, inserted } = makeFakeDb(
      baseRows([{ staffId: STAFF_ID, date: LATE_DAY, clockIn: '08:05', clockOut: '17:00' }])
    )
    mockGetDb.mockReturnValue(db)

    const res = await runLatenessPolicy(ctx())

    expect(res.details).toMatchObject({ flagged: 0 })
    expect(
      inserted.filter((i) => i.table === getTableName(schema.staffLatenessQueries))
    ).toHaveLength(0)
  })

  it('an override that is still late does NOT suppress the query', async () => {
    // Guards against "any override row wins" — the corrected time is scored,
    // not merely used as a presence flag.
    const { db, inserted } = makeFakeDb(
      baseRows([{ staffId: STAFF_ID, date: LATE_DAY, clockIn: '09:45', clockOut: '17:00' }])
    )
    mockGetDb.mockReturnValue(db)

    const res = await runLatenessPolicy(ctx())

    expect(res.details).toMatchObject({ flagged: 1 })
    expect(
      inserted.filter((i) => i.table === getTableName(schema.staffLatenessQueries))
    ).toHaveLength(1)
  })
})
