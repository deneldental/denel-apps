/**
 * fixed-asset-service.ts — admin-v1 §4.F6 (Fixed Asset Register).
 *
 * Straight-line book depreciation + a prepaid-asset amortization engine, both
 * posting to the existing double-entry GL through `postInOpenPeriod`.
 *
 *  - `generateDepreciationSchedule` lays out one `depreciation_schedules` row per
 *    month of the asset's useful life. The monthly slice is
 *    (acquisitionCost - salvageValue) / usefulLifeMonths; the FINAL period absorbs
 *    the rounding remainder so the schedule sums EXACTLY to the depreciable base
 *    (no GHS 0.01 drift that would leave the asset over/under-depreciated). It is
 *    idempotent on the unique (fixedAssetId, periodDate) — re-running fills only
 *    the missing periods.
 *  - `postDepreciationForPeriod` posts DR Depreciation Expense / CR Accumulated
 *    Depreciation for ONE schedule row, sourceDocType 'depreciation',
 *    sourceDocId = scheduleId. It marks the row posted + stamps journalEntryId.
 *    Idempotent: a row already posted (or whose source entry already exists) is a
 *    no-op replay.
 *  - `postPrepaidAmortization` posts ONE monthly slice DR Expense / CR Prepaid
 *    for a prepaid asset, sourceDocType 'depreciation' too (the constraint's
 *    allowed types), keyed per period so it can't double-post a month.
 *
 * Accounts resolve from the asset/prepaid's own *AccountId columns when set,
 * else the seeded CoA defaults by code (see FIXED_ASSET_CODES). Posting reads the
 * STAMPED ids so a later default re-map never corrupts an already-posted entry.
 */

import { createHash } from 'node:crypto'
import { Money } from '@denel/utils'
import { and, asc, eq, sum } from 'drizzle-orm'
import type { DB } from '../db'
import {
  accounts,
  depreciationSchedules,
  fixedAssets,
  journalEntries,
  prepaidAssets,
} from '../db/schema'
import { FINANCE_ACCOUNTS } from './finance-accounts'
import { postInOpenPeriod } from './gl-service'

/** Seeded CoA defaults for F6 (migration 0124 / 0032). */
export const FIXED_ASSET_CODES = {
  /** 1500 Equipment — the asset (capitalization) account. */
  ASSET: '1500',
  /** 1510 Accumulated Depreciation — contra-asset, normal_balance credit. */
  ACCUM_DEP: '1510',
  /** 5500 Depreciation Expense. */
  DEP_EXPENSE: '5500',
  /** 1600 Prepaid Expenses — the prepaid asset account. */
  PREPAID: '1600',
} as const

export type PostScheduleResult =
  | { posted: true; entryId?: string }
  | { posted: false; reason: 'already_posted' | 'closed_period' | 'not_found' | 'out_of_window' }

/** Resolve a GL account id by code, or throw — the caller seeds the CoA. */
async function accountIdByCode(db: DB, code: string): Promise<string> {
  const row = await db.query.accounts.findFirst({ where: eq(accounts.code, code) })
  if (!row) throw new Error(`Account ${code} not found — run migration 0124 to seed the F6 CoA`)
  return row.id
}

/** First day of the calendar month, as an ISO `YYYY-MM-DD` date string. */
function monthStartIso(d: Date): string {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  return `${y.toString().padStart(4, '0')}-${(m + 1).toString().padStart(2, '0')}-01`
}

/** Advance an ISO `YYYY-MM-01` date string by `n` whole months. */
function addMonthsIso(iso: string, n: number): string {
  const [y, m] = iso.split('-').map(Number)
  const total = (y as number) * 12 + ((m as number) - 1) + n
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${ny.toString().padStart(4, '0')}-${nm.toString().padStart(2, '0')}-01`
}

/** Whole-month distance from ISO `YYYY-MM-01` `a` to `b` (b − a). */
function monthsBetweenIso(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  return (by as number) * 12 + ((bm as number) - 1) - ((ay as number) * 12 + ((am as number) - 1))
}

/**
 * Generate (idempotently) the straight-line monthly depreciation schedule for an
 * asset. One row per period; the final period absorbs the rounding remainder so
 * the rows sum EXACTLY to (acquisitionCost - salvageValue). Returns the full set
 * of schedule rows for the asset (existing + newly inserted), ordered by period.
 */
export async function generateDepreciationSchedule(db: DB, assetId: string) {
  const asset = await db.query.fixedAssets.findFirst({ where: eq(fixedAssets.id, assetId) })
  if (!asset) throw new Error(`fixed asset ${assetId} not found`)

  const months = asset.usefulLifeMonths
  if (!months || months <= 0) throw new Error('usefulLifeMonths must be a positive integer')

  const cost = Money.from(asset.acquisitionCost)
  const salvage = Money.from(asset.salvageValue ?? 0)
  const base = cost.sub(salvage)
  if (base.isNegative()) throw new Error('salvageValue cannot exceed acquisitionCost')

  // Per-month slice, rounded to the cent; the last period takes the remainder so
  // SUM(rows) === base exactly.
  const perMonth = base.div(months)
  const firstPeriod = monthStartIso(new Date(asset.acquisitionDate))

  const rows = [] as { fixedAssetId: string; periodDate: string; amount: number }[]
  let accumulated = Money.zero()
  for (let i = 0; i < months; i++) {
    const isLast = i === months - 1
    const amount = isLast ? base.sub(accumulated) : perMonth
    accumulated = accumulated.add(amount)
    rows.push({
      fixedAssetId: assetId,
      periodDate: addMonthsIso(firstPeriod, i),
      amount: amount.toDbValue(),
    })
  }

  // Idempotent: the unique (fixedAssetId, periodDate) index means re-running only
  // inserts the periods that don't exist yet.
  await db
    .insert(depreciationSchedules)
    .values(rows)
    .onConflictDoNothing({
      target: [depreciationSchedules.fixedAssetId, depreciationSchedules.periodDate],
    })

  return db.query.depreciationSchedules.findMany({
    where: eq(depreciationSchedules.fixedAssetId, assetId),
    orderBy: [asc(depreciationSchedules.periodDate)],
  })
}

/**
 * Post ONE depreciation-schedule period to the GL:
 *   DR Depreciation Expense (5500 or asset.expenseAccountId)
 *   CR Accumulated Depreciation (1510 or asset.accumDepAccountId)
 * Marks the row `posted` + stamps `journalEntryId`. Idempotent: an already-posted
 * row (or one whose source entry already exists) is a no-op replay; a closed
 * period that can't fall back returns reason 'closed_period'.
 */
export async function postDepreciationForPeriod(
  db: DB,
  scheduleId: string,
  userId: string
): Promise<PostScheduleResult> {
  const row = await db.query.depreciationSchedules.findFirst({
    where: eq(depreciationSchedules.id, scheduleId),
  })
  if (!row) return { posted: false, reason: 'not_found' }
  if (row.posted) return { posted: false, reason: 'already_posted' }

  const asset = await db.query.fixedAssets.findFirst({
    where: eq(fixedAssets.id, row.fixedAssetId),
  })
  if (!asset) return { posted: false, reason: 'not_found' }

  const expenseId =
    asset.expenseAccountId ?? (await accountIdByCode(db, FIXED_ASSET_CODES.DEP_EXPENSE))
  const accumId =
    asset.accumDepAccountId ?? (await accountIdByCode(db, FIXED_ASSET_CODES.ACCUM_DEP))

  const amount = Money.from(row.amount)
  const outcome = await postInOpenPeriod(
    db,
    {
      sourceDocType: 'depreciation',
      sourceDocId: scheduleId,
      description: `Depreciation: ${asset.name} (${row.periodDate})`,
      createdBy: userId,
      lines: [
        { accountId: expenseId, debit: amount, description: 'Depreciation expense' },
        { accountId: accumId, credit: amount, description: 'Accumulated depreciation' },
      ],
    },
    new Date(row.periodDate)
  )
  if (outcome === 'closed') return { posted: false, reason: 'closed_period' }

  // Stamp the live entry back onto the schedule row.
  const entry = await db.query.journalEntries.findFirst({
    where: and(
      eq(journalEntries.sourceDocType, 'depreciation'),
      eq(journalEntries.sourceDocId, scheduleId),
      eq(journalEntries.isReversal, false)
    ),
  })
  await db
    .update(depreciationSchedules)
    .set({ posted: true, journalEntryId: entry?.id ?? null })
    .where(eq(depreciationSchedules.id, scheduleId))

  return { posted: true, entryId: entry?.id }
}

/**
 * Post ONE monthly slice of a prepaid asset's amortization to the GL:
 *   DR Expense (prepaid.expenseAccountId or 5500 fallback)
 *   CR Prepaid Expenses (prepaid.prepaidAccountId or 1600 fallback)
 * for `periodDate`. Keyed on a deterministic sourceDocId per (prepaid, period) so
 * a month can never double-post. Returns the post result.
 */
export async function postPrepaidAmortization(
  db: DB,
  prepaidId: string,
  periodDate: Date,
  userId: string
): Promise<PostScheduleResult> {
  const prepaid = await db.query.prepaidAssets.findFirst({
    where: eq(prepaidAssets.id, prepaidId),
  })
  if (!prepaid) return { posted: false, reason: 'not_found' }

  // Bound amortization to the asset's [startDate, startDate + months) window. Without
  // this a caller could post unlimited months (each a distinct period key), driving
  // the prepaid asset negative and over-stating expense.
  const startIso = monthStartIso(new Date(prepaid.startDate))
  const periodIso = monthStartIso(periodDate)
  const index = monthsBetweenIso(startIso, periodIso)
  if (index < 0 || index >= prepaid.months) return { posted: false, reason: 'out_of_window' }

  const expenseId =
    prepaid.expenseAccountId ?? (await accountIdByCode(db, FIXED_ASSET_CODES.DEP_EXPENSE))
  const prepaidAccId =
    prepaid.prepaidAccountId ?? (await accountIdByCode(db, FIXED_ASSET_CODES.PREPAID))

  // Deterministic per-period key: prepaidId + month, so re-posting the same month is
  // an idempotent replay (postJournalEntry dedupes on sourceDocType+sourceDocId).
  const sourceDocId = deterministicSourceId(prepaidId, periodIso)

  // The final month absorbs the rounding remainder so SUM(slices) === totalAmount
  // exactly (no stranded sub-cent), mirroring the depreciation engine.
  const monthly = Money.from(prepaid.monthlyAmount)
  const amount =
    index === prepaid.months - 1
      ? Money.from(prepaid.totalAmount).sub(monthly.mul(prepaid.months - 1))
      : monthly
  const outcome = await postInOpenPeriod(
    db,
    {
      sourceDocType: 'depreciation',
      sourceDocId,
      description: `Prepaid amortization: ${prepaid.name} (${periodIso})`,
      createdBy: userId,
      lines: [
        { accountId: expenseId, debit: amount, description: 'Prepaid expense recognized' },
        { accountId: prepaidAccId, credit: amount, description: 'Prepaid asset amortized' },
      ],
    },
    periodDate
  )
  if (outcome === 'closed') return { posted: false, reason: 'closed_period' }

  // Close the prepaid once its final slice is recognized.
  if (index === prepaid.months - 1) {
    await db
      .update(prepaidAssets)
      .set({ status: 'fully_amortized' })
      .where(eq(prepaidAssets.id, prepaidId))
  }

  const entry = await db.query.journalEntries.findFirst({
    where: and(
      eq(journalEntries.sourceDocType, 'depreciation'),
      eq(journalEntries.sourceDocId, sourceDocId),
      eq(journalEntries.isReversal, false)
    ),
  })
  return { posted: true, entryId: entry?.id }
}

export type DisposeAssetResult =
  | { disposed: true }
  | { disposed: false; reason: 'not_found' | 'already_disposed' | 'closed_period' }

/**
 * Dispose a fixed asset, clearing its cost + accumulated depreciation from the
 * books and recording any gain or loss.
 *
 * GL:
 *   DR Accumulated Depreciation  (total posted depreciation)
 *   DR Bank (1010)                (if proceeds > 0)
 *   DR Loss on Disposal (5810)   (if book value > proceeds)
 *   CR Fixed Asset Cost           (acquisitionCost)
 *   CR Gain on Disposal (4810)   (if proceeds > book value)
 */
export async function disposeAsset(
  db: DB,
  assetId: string,
  params: {
    disposalDate: string // YYYY-MM-DD
    proceeds?: number // cash received, default 0
    createdBy: string
  }
): Promise<DisposeAssetResult> {
  const [asset] = await db.select().from(fixedAssets).where(eq(fixedAssets.id, assetId))
  if (!asset) return { disposed: false, reason: 'not_found' }
  if (asset.status === 'disposed') return { disposed: false, reason: 'already_disposed' }

  // Sum only POSTED depreciation rows
  const [accumRow] = await db
    .select({ total: sum(depreciationSchedules.amount) })
    .from(depreciationSchedules)
    .where(
      and(eq(depreciationSchedules.fixedAssetId, assetId), eq(depreciationSchedules.posted, true))
    )

  const accumDep = Money.fromDb(accumRow?.total ?? '0')
  const cost = Money.fromDb(String(asset.acquisitionCost))
  const proceeds = Money.from(params.proceeds ?? 0)
  const bookValue = cost.sub(accumDep)
  const gainLoss = proceeds.sub(bookValue)

  // Resolve account IDs
  const assetAcctCode = asset.assetAccountId ? null : FIXED_ASSET_CODES.ASSET
  const accumDepAcctCode = asset.accumDepAccountId ? null : FIXED_ASSET_CODES.ACCUM_DEP

  const [assetAcct, accumDepAcct, bankAcct, gainAcct, lossAcct] = await Promise.all([
    asset.assetAccountId
      ? db.query.accounts.findFirst({ where: eq(accounts.id, asset.assetAccountId) })
      : db.query.accounts.findFirst({ where: eq(accounts.code, assetAcctCode || '') }),
    asset.accumDepAccountId
      ? db.query.accounts.findFirst({ where: eq(accounts.id, asset.accumDepAccountId) })
      : db.query.accounts.findFirst({ where: eq(accounts.code, accumDepAcctCode || '') }),
    db.query.accounts.findFirst({ where: eq(accounts.code, FINANCE_ACCOUNTS.BANK) }),
    db.query.accounts.findFirst({ where: eq(accounts.code, FINANCE_ACCOUNTS.GAIN_ON_DISPOSAL) }),
    db.query.accounts.findFirst({ where: eq(accounts.code, FINANCE_ACCOUNTS.LOSS_ON_DISPOSAL) }),
  ])

  if (!assetAcct || !accumDepAcct || !bankAcct || !gainAcct || !lossAcct) {
    throw new Error('Missing CoA account for asset disposal — run migration 0139')
  }

  const lines: Array<{ accountId: string; debit?: number; credit?: number }> = []

  // DR Accumulated Depreciation (clear the contra-asset)
  if (accumDep.toDbValue() > 0) {
    lines.push({ accountId: accumDepAcct.id, debit: accumDep.toDbValue() })
  }

  // DR Bank if proceeds
  if (proceeds.toDbValue() > 0) {
    lines.push({ accountId: bankAcct.id, debit: proceeds.toDbValue() })
  }

  // Gain/Loss
  if (gainLoss.toDbValue() > 0) {
    lines.push({ accountId: gainAcct.id, credit: gainLoss.toDbValue() })
  } else if (gainLoss.toDbValue() < 0) {
    lines.push({ accountId: lossAcct.id, debit: Math.abs(gainLoss.toDbValue()) })
  }

  // CR Fixed Asset Cost
  lines.push({ accountId: assetAcct.id, credit: cost.toDbValue() })

  const preferredDate = new Date(params.disposalDate)
  const outcome = await postInOpenPeriod(
    db,
    {
      sourceDocType: 'asset_disposal',
      sourceDocId: assetId,
      description: `Disposal of ${asset.name}`,
      lines,
      createdBy: params.createdBy,
    },
    preferredDate
  )

  if (outcome === 'closed') return { disposed: false, reason: 'closed_period' }

  const entryRow = await db.query.journalEntries.findFirst({
    where: and(
      eq(journalEntries.sourceDocType, 'asset_disposal'),
      eq(journalEntries.sourceDocId, assetId)
    ),
  })

  await db
    .update(fixedAssets)
    .set({
      status: 'disposed',
      disposalDate: params.disposalDate,
      disposalProceeds: proceeds.toDbValue() > 0 ? proceeds.toDbValue() : null,
      disposalJournalEntryId: entryRow?.id ?? null,
      updatedAt: new Date(),
    })
    .where(eq(fixedAssets.id, assetId))

  return { disposed: true }
}

/**
 * Stable UUID derived from a prepaid id + an ISO period, so the prepaid
 * amortization for a given month always maps to the SAME journal-entry source id
 * (the GL idempotency key). Uses the v5-style namespacing pattern: a deterministic
 * hash folded into the UUID layout.
 */
function deterministicSourceId(prepaidId: string, periodIso: string): string {
  // sha256 over (prepaid, period) folded into a UUID layout — a stable, full-entropy
  // GL idempotency key so a given month always maps to the SAME journal-entry source id.
  const bytes = createHash('sha256').update(`${prepaidId}:${periodIso}`).digest().subarray(0, 16)
  const b = Buffer.from(bytes)
  b[6] = (b[6] & 0x0f) | 0x50 // version (deterministic, sha-derived)
  b[8] = (b[8] & 0x3f) | 0x80 // variant
  const hex = b.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
