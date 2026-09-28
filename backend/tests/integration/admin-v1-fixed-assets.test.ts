/**
 * admin-v1 §4.F6 — Fixed Asset register smoke tests.
 *
 * Run with `doppler run -- pnpm --filter backend test admin-v1-fixed-assets`
 * (gated on DATABASE_URL; `pnpm test` alone skips). Every test runs inside
 * `withRollback` — a transaction that is ALWAYS rolled back — so the shared dev DB
 * is never mutated.
 *
 * Self-contained: the test INSERTs the four F6 CoA accounts INLINE (idempotent on
 * code) so it does NOT depend on migration 0124 having been applied. It then drives
 * the real service: creates an asset, generates the straight-line schedule (asserts
 * the period count + monthly amount + an exact total), and posts ONE period
 * (asserts a balanced DR Dep-Expense / CR Accum-Dep entry via the liveEntry helper).
 */

import { randomUUID } from 'node:crypto'
import { Money } from '@denel/utils'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import {
  accounts,
  depreciationSchedules,
  fixedAssets,
  journalEntries,
  prepaidAssets,
} from '../../src/db/schema'
import {
  FIXED_ASSET_CODES,
  generateDepreciationSchedule,
  postDepreciationForPeriod,
  postPrepaidAmortization,
} from '../../src/lib/fixed-asset-service'
import { getOrCreatePeriodFor } from '../../src/lib/period-service'
import { accountIdByCode, anyUserId } from './_fixtures'
import { noDb, withRollback } from './_setup'

type Line = { accountId: string; debit: number | null; credit: number | null }

/** Load the live (non-reversal) posted entry + its lines for a source doc. */
async function liveEntry(tx: DB, sourceDocType: string, sourceDocId: string) {
  const e = await tx.query.journalEntries.findFirst({
    where: and(
      eq(journalEntries.sourceDocType, sourceDocType as never),
      eq(journalEntries.sourceDocId, sourceDocId),
      eq(journalEntries.isReversal, false)
    ),
    with: { lines: true },
  })
  if (!e) return null
  const lines = (e as unknown as { lines: Line[] }).lines
  return { id: e.id, lines }
}

const sumDebit = (lines: Line[]) => lines.reduce((s, l) => s + Number(l.debit ?? 0), 0)
const sumCredit = (lines: Line[]) => lines.reduce((s, l) => s + Number(l.credit ?? 0), 0)
const debitOn = (lines: Line[], accountId: string) =>
  lines.filter((l) => l.accountId === accountId).reduce((s, l) => s + Number(l.debit ?? 0), 0)
const creditOn = (lines: Line[], accountId: string) =>
  lines.filter((l) => l.accountId === accountId).reduce((s, l) => s + Number(l.credit ?? 0), 0)

function expectBalanced(lines: Line[]) {
  expect(Money.from(sumDebit(lines)).eq(Money.from(sumCredit(lines)))).toBe(true)
}

/** Ensure the four F6 CoA accounts exist (idempotent on code) — self-contained. */
async function seedFixedAssetAccounts(tx: DB) {
  await tx
    .insert(accounts)
    .values([
      { code: FIXED_ASSET_CODES.ASSET, name: 'Equipment', type: 'asset', normalBalance: 'debit' },
      {
        code: FIXED_ASSET_CODES.ACCUM_DEP,
        name: 'Accumulated Depreciation',
        type: 'asset',
        normalBalance: 'credit',
      },
      {
        code: FIXED_ASSET_CODES.PREPAID,
        name: 'Prepaid Expenses',
        type: 'asset',
        normalBalance: 'debit',
      },
      {
        code: FIXED_ASSET_CODES.DEP_EXPENSE,
        name: 'Depreciation Expense',
        type: 'expense',
        normalBalance: 'debit',
      },
    ])
    .onConflictDoNothing({ target: accounts.code })
}

async function withPostingRollback(fn: (tx: DB) => Promise<void>) {
  await withRollback(async (tx) => {
    await seedFixedAssetAccounts(tx)
    await getOrCreatePeriodFor(tx, new Date())
    await fn(tx)
  })
}

describe.skipIf(noDb)('admin-v1 §4.F6 — fixed asset depreciation', () => {
  it('generates a straight-line schedule with the right count, monthly amount, and exact total', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      // (1000 - 100) / 12 = 75.00/mo, 12 periods, total 900 exactly.
      const [asset] = await tx
        .insert(fixedAssets)
        .values({
          name: `IT Asset ${randomUUID().slice(0, 8)}`,
          acquisitionCost: 1000,
          acquisitionDate: '2026-01-01',
          usefulLifeMonths: 12,
          salvageValue: 100,
          createdById: userId,
        })
        .returning()

      const schedule = await generateDepreciationSchedule(tx, asset.id)
      expect(schedule.length).toBe(12)
      expect(Number(schedule[0].amount)).toBe(75)
      const total = schedule.reduce((s, r) => s + Number(r.amount), 0)
      expect(Money.from(total).eq(Money.from(900))).toBe(true)
    })
  })

  it('the final period absorbs the rounding remainder so the total is exact', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      // Amounts are CENTS (migration 0209): GHS 100.00 / 3 = GHS 33.3333 →
      // 3333c for 2 periods, last 3334c, total 10000c = GHS 100.00 exactly.
      const [asset] = await tx
        .insert(fixedAssets)
        .values({
          name: `IT Asset ${randomUUID().slice(0, 8)}`,
          acquisitionCost: 10000,
          acquisitionDate: '2026-02-01',
          usefulLifeMonths: 3,
          salvageValue: 0,
          createdById: userId,
        })
        .returning()

      const schedule = await generateDepreciationSchedule(tx, asset.id)
      expect(schedule.length).toBe(3)
      expect(Number(schedule[0].amount)).toBe(3333)
      expect(Number(schedule[2].amount)).toBe(3334)
      const total = schedule.reduce((s, r) => s + Number(r.amount), 0)
      expect(Money.from(total).eq(Money.from(10000))).toBe(true)
    })
  })

  it('generate is idempotent — re-running yields the same period set', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const [asset] = await tx
        .insert(fixedAssets)
        .values({
          name: `IT Asset ${randomUUID().slice(0, 8)}`,
          acquisitionCost: 600,
          acquisitionDate: '2026-01-01',
          usefulLifeMonths: 6,
          salvageValue: 0,
          createdById: userId,
        })
        .returning()

      const first = await generateDepreciationSchedule(tx, asset.id)
      const second = await generateDepreciationSchedule(tx, asset.id)
      expect(first.length).toBe(6)
      expect(second.length).toBe(6)
    })
  })

  it('posts one period: balanced DR Depreciation Expense / CR Accumulated Depreciation', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const depExpense = await accountIdByCode(tx, FIXED_ASSET_CODES.DEP_EXPENSE)
      const accumDep = await accountIdByCode(tx, FIXED_ASSET_CODES.ACCUM_DEP)

      const [asset] = await tx
        .insert(fixedAssets)
        .values({
          name: `IT Asset ${randomUUID().slice(0, 8)}`,
          acquisitionCost: 1200,
          // Date the asset in the current open period so the post lands cleanly.
          acquisitionDate: new Date().toISOString().slice(0, 10),
          usefulLifeMonths: 12,
          salvageValue: 0,
          createdById: userId,
        })
        .returning()

      const schedule = await generateDepreciationSchedule(tx, asset.id)
      expect(Number(schedule[0].amount)).toBe(100) // 1200 / 12

      const res = await postDepreciationForPeriod(tx, schedule[0].id, userId)
      expect(res.posted).toBe(true)

      const entry = await liveEntry(tx, 'depreciation', schedule[0].id)
      expect(entry).not.toBeNull()
      if (!entry) return
      expectBalanced(entry.lines)
      expect(debitOn(entry.lines, depExpense)).toBe(100)
      expect(creditOn(entry.lines, accumDep)).toBe(100)

      // The schedule row is now stamped posted with its journal entry.
      const [stamped] = await tx
        .select()
        .from(depreciationSchedules)
        .where(eq(depreciationSchedules.id, schedule[0].id))
      expect(stamped.posted).toBe(true)
      expect(stamped.journalEntryId).toBe(entry.id)

      // Idempotent: re-posting the same period is a no-op replay.
      const again = await postDepreciationForPeriod(tx, schedule[0].id, userId)
      expect(again.posted).toBe(false)
      const all = await tx.query.journalEntries.findMany({
        where: and(
          eq(journalEntries.sourceDocType, 'depreciation' as never),
          eq(journalEntries.sourceDocId, schedule[0].id)
        ),
      })
      expect(all.length).toBe(1)
    })
  })
})

describe.skipIf(noDb)('admin-v1 §4.F6 — prepaid amortization', () => {
  it('amortizes over its window with a final-month true-up, closes, and refuses out-of-window posts', async () => {
    await withPostingRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const prepaidAcct = await accountIdByCode(tx, FIXED_ASSET_CODES.PREPAID)
      const expenseAcct = await accountIdByCode(tx, FIXED_ASSET_CODES.DEP_EXPENSE)

      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 12, 0, 0)
      const startIso = `${start.getFullYear()}-${`${start.getMonth() + 1}`.padStart(2, '0')}-01`

      // CENTS: GHS 100.00 over 3 months → 3333, 3333, 3334 (final-month
      // true-up) = 10000c exactly.
      const [prepaid] = await tx
        .insert(prepaidAssets)
        .values({
          name: `IT Prepaid ${randomUUID().slice(0, 8)}`,
          totalAmount: 10000,
          startDate: startIso,
          months: 3,
          monthlyAmount: 3333,
          createdById: userId,
        })
        .returning()

      let recognized = Money.zero()
      for (let i = 0; i < 3; i++) {
        const periodDate = new Date(start.getFullYear(), start.getMonth() + i, 1, 12, 0, 0)
        const r = await postPrepaidAmortization(tx, prepaid.id, periodDate, userId)
        expect(r.posted).toBe(true)
        if (!r.posted || !r.entryId) continue
        const e = await tx.query.journalEntries.findFirst({
          where: eq(journalEntries.id, r.entryId),
          with: { lines: true },
        })
        const lines = (e as unknown as { lines: Line[] }).lines
        expectBalanced(lines)
        // DR Expense / CR Prepaid, equal amounts.
        expect(debitOn(lines, expenseAcct)).toBe(creditOn(lines, prepaidAcct))
        recognized = recognized.add(creditOn(lines, prepaidAcct))
      }
      // Final-month true-up: the slices sum to exactly the total — no stranded cent.
      expect(recognized.eq(Money.from(10000))).toBe(true)

      // The prepaid auto-closes once fully recognized.
      const [reloaded] = await tx
        .select()
        .from(prepaidAssets)
        .where(eq(prepaidAssets.id, prepaid.id))
      expect(reloaded.status).toBe('fully_amortized')

      // A 4th month is outside [startDate, startDate + months) — refused, no over-amortization.
      const over = await postPrepaidAmortization(
        tx,
        prepaid.id,
        new Date(start.getFullYear(), start.getMonth() + 3, 1, 12, 0, 0),
        userId
      )
      expect(over.posted).toBe(false)
      if (!over.posted) expect(over.reason).toBe('out_of_window')
    })
  })
})
