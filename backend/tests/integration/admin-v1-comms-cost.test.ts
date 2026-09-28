/**
 * admin-v1 §13.5 — SMS / email cost-tracking smoke tests.
 *
 * Proves the comms-cost service books a send as an expense through the standard
 * pipeline:
 *   - a send records a `Communications` expense with amount == units × rate, and
 *     it posts to the GL (DR 5400 Marketing / CR cash);
 *   - the per-unit rate is read from the `clinic_settings` KV (admin-configurable)
 *     and an explicit override wins;
 *   - failure is SWALLOWED — posting into a date with no open period records the
 *     expense but returns `posted: false` and NEVER throws (so a cost-tracking
 *     gap can't fail an actual send).
 *
 * Run with `doppler run -- pnpm --filter backend test admin-v1-comms-cost`
 * (gated on DATABASE_URL). Every test runs inside `withRollback` (always rolled
 * back; the shared dev DB is never mutated). The Communications category + GL
 * mapping and the rate KV are seeded INSIDE the sandbox tx, so the suite passes
 * whether or not migration 0127 has been applied to dev yet.
 */

import { Money } from '@denel/utils'
import { and, eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import { clinicSettings, expenseCategories, expenses, journalEntries } from '../../src/db/schema'
import { COMMS_EXPENSE_CATEGORY, recordCommsCost } from '../../src/lib/comms-cost'
import { getOrCreatePeriodFor } from '../../src/lib/period-service'
import { EMAIL_COST_PER_UNIT_KEY, SMS_COST_PER_UNIT_KEY } from '../../src/lib/settings-store'
import { accountIdByCode, anyUserId } from './_fixtures'
import { noDb, withRollback } from './_setup'

/** withRollback + an OPEN period covering today (the GL post needs one). */
async function withPostingRollback(fn: (tx: DB) => Promise<void>) {
  await withRollback(async (tx) => {
    await getOrCreatePeriodFor(tx, new Date())
    await fn(tx)
  })
}

type Line = { accountId: string; debit: number | null; credit: number | null }

const n = (v: unknown) => Money.from(v as never).toNumber()
const debitOn = (lines: Line[], id: string) =>
  lines.filter((l) => l.accountId === id).reduce((s, l) => s + Number(l.debit ?? 0), 0)
const creditOn = (lines: Line[], id: string) =>
  lines.filter((l) => l.accountId === id).reduce((s, l) => s + Number(l.credit ?? 0), 0)

/**
 * Ensure the `Communications` category exists and maps to 5400 inside the
 * sandbox tx (idempotent — independent of whether migration 0127 has run).
 */
async function ensureCommsCategory(tx: DB): Promise<void> {
  const accountId = await accountIdByCode(tx, '5400')
  const existing = await tx
    .select({ id: expenseCategories.id, accountId: expenseCategories.accountId })
    .from(expenseCategories)
    .where(eq(expenseCategories.name, COMMS_EXPENSE_CATEGORY))
    .limit(1)
  if (existing.length === 0) {
    await tx.insert(expenseCategories).values({
      name: COMMS_EXPENSE_CATEGORY,
      displayName: 'Communications (SMS / Email)',
      accountId,
    })
  } else if (!existing[0].accountId) {
    await tx
      .update(expenseCategories)
      .set({ accountId })
      .where(eq(expenseCategories.id, existing[0].id))
  }
}

/** Write a per-unit rate into the KV inside the sandbox tx. */
async function setRateKv(tx: DB, key: string, value: number): Promise<void> {
  await tx
    .insert(clinicSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: clinicSettings.key, set: { value } })
}

async function liveExpenseEntry(tx: DB, expenseId: string) {
  const e = await tx.query.journalEntries.findFirst({
    where: and(
      eq(journalEntries.sourceDocType, 'expense' as never),
      eq(journalEntries.sourceDocId, expenseId),
      eq(journalEntries.isReversal, false)
    ),
    with: { lines: true },
  })
  if (!e) return null
  return { id: e.id, lines: (e as unknown as { lines: Line[] }).lines }
}

describe.skipIf(noDb)('admin-v1 §13.5 — comms cost tracking', () => {
  it('an SMS send books a Communications expense at units × rate and posts to GL', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      await ensureCommsCategory(tx)
      await setRateKv(tx, SMS_COST_PER_UNIT_KEY, 0.05)

      const res = await recordCommsCost(tx, {
        channel: 'sms',
        count: 10,
        createdBy: userId,
        reference: 'IT-batch',
      })

      // 10 × GHS 0.05 = GHS 0.50. The rate stays in cedis (it is admin-set);
      // `amount` is CENTS, matching `expenses.amount` since migration 0209.
      expect(res.unitCost).toBe(0.05)
      expect(res.amount).toBe(50)
      expect(res.posted).toBe(true)
      if (!res.expenseId) throw new Error('expected an expense id')

      const exp = await tx.query.expenses.findFirst({ where: eq(expenses.id, res.expenseId) })
      expect(exp?.category).toBe(COMMS_EXPENSE_CATEGORY)
      // `n()` converts the stored cents to cedis, so this one reads GHS 0.50.
      expect(n(exp?.amount)).toBe(0.5)
      expect(exp?.status).toBe('paid')

      // DR 5400 Marketing / CR 1000 cash.
      const marketing = await accountIdByCode(tx, '5400')
      const cash = await accountIdByCode(tx, '1000')
      const je = await liveExpenseEntry(tx, res.expenseId)
      if (!je) throw new Error('no expense journal entry')
      expect(debitOn(je.lines, marketing)).toBe(50)
      expect(creditOn(je.lines, cash)).toBe(50)
    })
  })

  it('reads the configured rate from settings (no override)', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      await ensureCommsCategory(tx)
      // Admin changes the SMS rate to 0.10/unit.
      await setRateKv(tx, SMS_COST_PER_UNIT_KEY, 0.1)

      const res = await recordCommsCost(tx, { channel: 'sms', count: 3, createdBy: userId })
      expect(res.unitCost).toBe(0.1)
      expect(res.amount).toBe(30) // 3 × GHS 0.10
      expect(res.posted).toBe(true)
    })
  })

  it('an explicit unitCost override wins over the settings rate', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      await ensureCommsCategory(tx)
      await setRateKv(tx, SMS_COST_PER_UNIT_KEY, 0.05) // would be 0.05 if read

      const res = await recordCommsCost(tx, {
        channel: 'sms',
        count: 4,
        createdBy: userId,
        unitCost: 0.25,
      })
      expect(res.unitCost).toBe(0.25)
      expect(res.amount).toBe(100) // 4 × GHS 0.25
    })
  })

  it('email uses the email rate key, billed per accepted message', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      await ensureCommsCategory(tx)
      await setRateKv(tx, EMAIL_COST_PER_UNIT_KEY, 0.002)

      const res = await recordCommsCost(tx, { channel: 'email', count: 50, createdBy: userId })
      expect(res.unitCost).toBe(0.002)
      // A sub-cent rate must survive the multiply: 50 × GHS 0.002 = GHS 0.10.
      expect(res.amount).toBe(10) // 50 × GHS 0.002
      expect(res.posted).toBe(true)
    })
  })

  it('a zero-count send records nothing (no expense, no throw)', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      await ensureCommsCategory(tx)
      const res = await recordCommsCost(tx, { channel: 'sms', count: 0, createdBy: userId })
      expect(res.amount).toBe(0)
      expect(res.posted).toBe(false)
      expect(res.expenseId).toBeUndefined()
      expect(res.reason).toBe('zero_count')
    })
  })

  it('a closed/absent period is SWALLOWED — expense recorded, posted=false, no throw', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      await ensureCommsCategory(tx)
      await setRateKv(tx, SMS_COST_PER_UNIT_KEY, 0.04)

      // A far-future date with no provisioned accounting period: the GL post
      // throws "no period…", which the expense pipeline catches → posted:false.
      const farFuture = new Date('2099-01-15T10:00:00Z')
      const res = await recordCommsCost(tx, {
        channel: 'sms',
        count: 5,
        createdBy: userId,
        date: farFuture,
      })

      expect(res.amount).toBe(20) // 5 × GHS 0.04 — cost is still computed
      expect(res.posted).toBe(false) // but NOT on the GL
      const expenseId = res.expenseId
      expect(expenseId).toBeDefined() // the expense row IS recorded
      if (!expenseId) throw new Error('expected an expense id')

      // Confirm: the expense exists, but has NO live journal entry.
      const [cnt] = await tx
        .select({ n: sql<string>`count(*)` })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.sourceDocType, 'expense' as never),
            eq(journalEntries.sourceDocId, expenseId)
          )
        )
      expect(Number(cnt?.n ?? 0)).toBe(0)
    })
  })
})
