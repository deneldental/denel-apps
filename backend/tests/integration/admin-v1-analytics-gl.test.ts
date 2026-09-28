/**
 * admin-v1 §20.1 — Analytics ↔ GL consistency smoke test.
 *
 * Proves the financial-analytics revenue figure is GL-sourced and therefore
 * reconciles with the financial statements (single source of truth). The
 * `monthly-trend` / `multi-year` endpoints now read revenue from `journal_lines`
 * over `revenue`-type accounts — the SAME query the Reports P&L
 * (generateProfitLoss) sums. This test posts one invoice and asserts the three
 * numbers agree:
 *
 *   analytics revenue Δ  ==  GL revenue Δ  ==  the invoice's net revenue credit
 *
 * Run with `doppler run -- pnpm --filter backend test admin-v1-analytics-gl`
 * (gated on DATABASE_URL). Every test runs inside `withRollback` — the shared
 * dev DB is never mutated — so we assert on the BEFORE/AFTER delta to stay
 * deterministic regardless of pre-existing ledger data.
 */

import { randomUUID } from 'node:crypto'
import { Money } from '@denel/utils'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import { doctors, services, treatmentTypes } from '../../src/db/schema'
import { generateProfitLoss } from '../../src/lib/financial-reports'
import { getOrCreatePeriodFor } from '../../src/lib/period-service'
import { createWalkIn } from '../../src/lib/walk-in-service'
import { anyUserId, makePatient, makeSpecialist } from './_fixtures'
import { noDb, withRollback } from './_setup'

/** withRollback + an OPEN accounting period covering today (issue needs one). */
async function withPostingRollback(fn: (tx: DB) => Promise<void>) {
  await withRollback(async (tx) => {
    await getOrCreatePeriodFor(tx, new Date())
    await fn(tx)
  })
}

/** A `doctors` row sourced from a specialist (satisfies the source-XOR check). */
async function makeDoctor(tx: DB, specialistId: string): Promise<string> {
  const [d] = await tx
    .insert(doctors)
    .values({ specialistId, specialty: 'IT Dentistry' })
    .returning()
  return d.id
}

/** A priced, exempt (no tax noise) catalog service under an ADA-grouped type. */
async function makeService(tx: DB, userId: string, amount: number): Promise<string> {
  const [tt] = await tx
    .insert(treatmentTypes)
    .values({ name: `it-${randomUUID().slice(0, 10)}`, adaGroup: 'Restorative' })
    .returning()
  const [svc] = await tx
    .insert(services)
    .values({
      category: 'clinic',
      name: `IT Service ${randomUUID().slice(0, 6)}`,
      amount,
      treatmentTypeId: tt.id,
      taxStatus: 'exempt',
      status: 'active',
      createdById: userId,
    })
    .returning()
  return svc.id
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10)

/**
 * GL revenue total over [start, end) — the EXACT shape the financial-analytics
 * monthly-trend / multi-year endpoints now use: SUM(credit − debit) over
 * `revenue`-type accounts, keyed off journal_entries.entry_date.
 */
async function analyticsGlRevenue(tx: DB, startIso: string, endIso: string): Promise<number> {
  const res = await tx.execute<{ revenue: string }>(sql`
    SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::text AS revenue
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE a.type = 'revenue'
      AND je.entry_date >= ${startIso}::date
      AND je.entry_date <  ${endIso}::date
  `)
  return Number(res.rows[0]?.revenue ?? 0)
}

describe.skipIf(noDb)('admin-v1 §20.1 — analytics revenue reconciles with the GL', () => {
  it('analytics revenue total == GL P&L revenue total for a posted invoice', async () => {
    await withPostingRollback(async (tx) => {
      const now = new Date()
      const year = now.getUTCFullYear()
      const startIso = isoDate(new Date(Date.UTC(year, 0, 1)))
      const endIso = isoDate(new Date(Date.UTC(year + 1, 0, 1))) // exclusive
      const toIso = isoDate(new Date(Date.UTC(year, 11, 31)))

      // Baseline: analytics-shaped GL revenue and the canonical P&L revenue must
      // already agree on the same ledger (same source query).
      const analyticsBefore = await analyticsGlRevenue(tx, startIso, endIso)
      const plBefore = await generateProfitLoss(tx, startIso, toIso)
      expect(Money.from(analyticsBefore).eq(Money.from(plBefore.totalRevenue))).toBe(true)

      // Post one invoice (issue-only — no payment, so revenue is the only mover).
      const userId = await anyUserId(tx)
      const patientId = await makePatient(tx)
      const specId = await makeSpecialist(tx)
      const doctorId = await makeDoctor(tx, specId)
      // Cents (migration 0209): GHS 437.50 — deliberately not a round cedi.
      const AMOUNT = 43750
      const serviceId = await makeService(tx, userId, AMOUNT)

      const res = await createWalkIn(
        tx,
        { patientId, appointment: { doctorId }, lines: [{ serviceId }] },
        userId
      )
      expect(res.invoice.status).toBe('issued')

      // After: analytics revenue and the P&L revenue both rose by exactly the
      // invoice's net revenue credit — and still equal each other.
      const analyticsAfter = await analyticsGlRevenue(tx, startIso, endIso)
      const plAfter = await generateProfitLoss(tx, startIso, toIso)

      expect(Money.from(analyticsAfter).eq(Money.from(plAfter.totalRevenue))).toBe(true)

      const analyticsDelta = Money.from(analyticsAfter).sub(Money.from(analyticsBefore))
      const plDelta = Money.from(plAfter.totalRevenue).sub(Money.from(plBefore.totalRevenue))
      expect(analyticsDelta.eq(plDelta)).toBe(true)

      // Exempt service → the whole amount is revenue (no tax split).
      expect(analyticsDelta.eq(Money.from(AMOUNT))).toBe(true)
    })
  })
})
