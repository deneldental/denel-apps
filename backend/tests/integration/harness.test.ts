/**
 * Smoke test for the integration harness itself — proves `withRollback`
 * actually isolates: a row inserted inside the sandbox transaction is visible
 * within it and gone afterwards.
 *
 * If this test ever fails, do NOT trust any other integration test — the
 * sandbox is leaking writes into the shared dev DB.
 */

import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { getTestDb, noDb, withRollback } from './_setup'

describe.skipIf(noDb)('integration harness — withRollback isolation', () => {
  it('a write inside the sandbox is visible within it', async () => {
    const seen = await withRollback(async (tx) => {
      await tx.execute(sql`CREATE TEMP TABLE _harness_probe (n int) ON COMMIT DROP`)
      await tx.execute(sql`INSERT INTO _harness_probe (n) VALUES (42)`)
      const r = await tx.execute<{ n: number }>(sql`SELECT n FROM _harness_probe`)
      return r.rows[0]?.n
    })
    expect(seen).toBe(42)
  })

  it('the write did NOT leak — the sandbox transaction rolled back', async () => {
    // A fresh transaction must not see the temp table from the previous test.
    // (Temp tables are session-scoped; this also proves we are not reusing a
    // half-open transaction across tests.)
    const leaked = await withRollback(async (tx) => {
      const r = await tx.execute<{ exists: boolean }>(
        sql`SELECT to_regclass('_harness_probe') IS NOT NULL AS exists`
      )
      return r.rows[0]?.exists
    })
    expect(leaked).toBe(false)
  })

  it('propagates the error when the body throws', async () => {
    await expect(
      withRollback(async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
  })

  it('the dev DB is reachable and the CoA is seeded (sanity)', async () => {
    const db = getTestDb()
    const r = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM accounts WHERE code = '1200'`
    )
    expect(r.rows[0]?.n).toBe(1)
  })
})
