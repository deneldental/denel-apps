/**
 * "Minor edge cases" (patient-records-and-scheduling-audit.md, LOW): the
 * duplicate-patient-name check was a plain SELECT-then-INSERT with no lock
 * and no unique constraint — two concurrent POST /api/patients requests for
 * the same name could both pass the SELECT before either INSERTs, producing
 * two patients with the name the app already treats as a hard duplicate.
 *
 * Two HTTP-level tests exercise the real route end-to-end against a real
 * database. A third test proves the fix mechanism deterministically: it
 * forces the interleave (an artificial pause between SELECT and INSERT)
 * instead of hoping two `Promise.all`-fired requests happen to race at the
 * DB level, which isn't guaranteed by anything.
 *
 *   DATABASE_URL=postgresql://framada:framada@localhost:5433/framada \
 *     npx vitest run tests/integration/patient-create-name-race.test.ts
 */

import { Hono } from 'hono'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '../../src/lib/types'

const RAW_DB_URL = process.env.DATABASE_URL ?? ''
const IS_LOCAL = /@(localhost|127\.0\.0\.1|host\.docker\.internal)([:/]|$)/.test(RAW_DB_URL)
/** Never run against Neon/production — this suite commits rows. */
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
import { patients } from '../../src/db/schema'
import { checkPermission, getCurrentUser } from '../../src/lib/rbac'
import { patientsApp } from '../../src/routes/patients'
import { sweepLeakedFixtures } from './_fixtures'

const TAG = `race-${Date.now()}`

let db: DB
let app: Hono<HonoEnv>
let adminUserId: string

function makeApp(): Hono<HonoEnv> {
  const a = new Hono<HonoEnv>()
  a.route('/api/patients', patientsApp)
  return a
}

async function send(method: string, path: string, payload?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* empty body */
  }
  return { status: res.status, body }
}

describe.skipIf(skip)('POST /api/patients duplicate-name check is race-proof [Low]', () => {
  beforeAll(async () => {
    db = getDb(RAW_DB_URL)
    await sweepLeakedFixtures()

    const users = await db.execute<{ id: string }>(
      sql`SELECT id FROM "user" ORDER BY "createdAt" LIMIT 1`
    )
    adminUserId = users.rows[0]?.id
    if (!adminUserId) throw new Error('No rows in "user" — run `pnpm --filter backend seed:admin`')

    app = makeApp()
  })

  afterAll(async () => {
    if (skip || !db) return
    await sweepLeakedFixtures()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: adminUserId,
      email: 'admin@framada.app',
      name: 'Admin',
      role: 'admin',
      roleId: 'admin',
    } as never)
    vi.mocked(checkPermission).mockResolvedValue(true)
  })

  it('lets exactly one of two concurrent same-name creates through', async () => {
    const name = `IT Race Patient ${TAG}`
    const body = { name, dob: '1990-01-01', gender: 'other', phone: '0240000010' }

    const [first, second] = await Promise.all([
      send('POST', '/api/patients', body),
      send('POST', '/api/patients', body),
    ])

    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual([200, 400])

    const rejected = first.status === 400 ? first : second
    expect((rejected.body as { error: string }).error).toContain('already exists')

    const rows = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text as count FROM patients WHERE name = ${name}`
    )
    expect(rows.rows[0].count).toBe('1')
  })

  // Manufactures the collision the route's retry exists for: this month's
  // `AAAA` id is already held, and the route's first draw is `AAAA`. (The retry
  // was once silently broken — see lib/patient-id.ts — and a ~1-in-1.2M event
  // is not one a test can wait for.)
  it('assigns a fresh patient ID when the first one drawn is already taken', async () => {
    const now = new Date()
    const yymm = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`
    const colliding = `FD-${yymm}-AAAA`
    await db.insert(patients).values({
      name: `IT Race Holder ${TAG}`,
      dob: new Date('1990-01-01'),
      gender: 'other',
      patientId: colliding,
    })

    // Four draws per attempt: 0 → 'A' (taken), then 0.04 → 'B'.
    const draws = [0, 0, 0, 0, 0.04, 0.04, 0.04, 0.04]
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => draws.shift() ?? 0.5)
    try {
      const { status, body } = await send('POST', '/api/patients', {
        name: `IT Race Collision ${TAG}`,
        dob: '1990-01-01',
        gender: 'other',
        phone: '0240000012',
      })
      expect(status).toBe(200)
      expect((body as { data: { patientId: string } }).data.patientId).toBe(`FD-${yymm}-BBBB`)
    } finally {
      spy.mockRestore()
    }
  })

  it('still allows a different name to succeed right after', async () => {
    const { status } = await send('POST', '/api/patients', {
      name: `IT Race Patient Other ${TAG}`,
      dob: '1990-01-01',
      gender: 'other',
      phone: '0240000011',
    })
    expect(status).toBe(200)
  })

  it('the advisory lock forces a genuinely interleaved attempt to see the first row, not just a lucky-timing one', async () => {
    // The two-concurrent-HTTP-request test above depends on both requests'
    // SELECTs happening to fire close enough together — real, but not
    // guaranteed by anything. This test forces the interleave: an artificial
    // pause between SELECT and INSERT gives a second attempt every chance to
    // run its own SELECT in the gap, mirroring exactly the production
    // route's SQL sequence (same lock, same check, same table).
    const name = `IT Race Direct ${TAG}`

    async function attempt(
      pauseMs: number,
      patientIdSuffix: string
    ): Promise<'inserted' | 'duplicate'> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(LOWER(${name})))`)
        const existing = await tx.execute<{ name: string }>(
          sql`SELECT name FROM patients WHERE LOWER(name) = LOWER(${name})`
        )
        if (existing.rows.length > 0) return 'duplicate'
        // Without the lock above, a concurrent attempt's SELECT could run
        // (and also see zero rows) during this pause. With the lock, the
        // other attempt's own pg_advisory_xact_lock call blocks for this
        // entire transaction's lifetime, so it can't reach its SELECT yet.
        await new Promise((resolve) => setTimeout(resolve, pauseMs))
        await tx.insert(patients).values({
          name,
          dob: new Date('1990-01-01'),
          gender: 'other',
          patientId: `FD-RACE-${patientIdSuffix}`,
        })
        return 'inserted'
      })
    }

    const [r1, r2] = await Promise.all([attempt(80, 'a'), attempt(0, 'b')])
    expect([r1, r2].sort()).toEqual(['duplicate', 'inserted'])

    const rows = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text as count FROM patients WHERE name = ${name}`
    )
    expect(rows.rows[0].count).toBe('1')
  })
})
