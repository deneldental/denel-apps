/**
 * admin-v1 §10.2 + §10.3 — Reports GL-sourcing + period rollups.
 *
 * §10.2: `glDayReconciliation` sources the day-sheet revenue/expense from the GL
 *        (the same books the P&L uses) so the digest reconciles with the
 *        financial statements instead of drifting as a second source of truth.
 * §10.3: `rollupModuleSummaries` / `getPeriodRollup` aggregate the frozen
 *        per-day `moduleSummaries` JSONB into one period-level summary (sum per
 *        module, per metric, across all days in the window).
 *
 * Run with `doppler run -- pnpm --filter backend test admin-v1-reports-gl`
 * (gated on DATABASE_URL; `pnpm test` alone skips). Every test runs inside
 * `withRollback`, a transaction that is ALWAYS rolled back, so the shared dev DB
 * is never mutated. Far-future dates (2099) isolate fixtures from real data.
 */

import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import { dailyReports } from '../../src/db/schema'
import type { ModuleSummary } from '../../src/lib/digest'
import { generateProfitLoss } from '../../src/lib/financial-reports'
import { postJournalEntry } from '../../src/lib/gl-service'
import { getOrCreatePeriodFor } from '../../src/lib/period-service'
import {
  getPeriodRollup,
  glDayReconciliation,
  rollupModuleSummaries,
} from '../../src/routes/reports'
import { accountIdByCode, anyUserId } from './_fixtures'
import { noDb, withRollback } from './_setup'

// Local-noon future date so `glDayReconciliation`'s local YYYY-MM-DD and the GL's
// UTC `entry_date` agree (no day-boundary TZ skew either way).
function futureDay(dayOfMonth: number): Date {
  return new Date(2099, 5, dayOfMonth, 12, 0, 0) // June 2099, local noon
}
const pad = (n: number) => `${n}`.padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function metric(mod: { metrics: { label: string; value: string | number }[] }, label: string) {
  return mod.metrics.find((m) => m.label === label)?.value
}

// ── §10.2 — GL-sourced day figures ───────────────────────────────────────────

describe.skipIf(noDb)('admin-v1 §10.2 — GL-sourced day reconciliation', () => {
  it('sources revenue/expense from the GL for a single calendar day', async () => {
    await withRollback(async (tx: DB) => {
      const userId = await anyUserId(tx)
      const day = futureDay(15)
      await getOrCreatePeriodFor(tx, day)

      const cash = await accountIdByCode(tx, '1000') // cash (asset)
      const revenue = await accountIdByCode(tx, '4200') // retail revenue
      const expense = await accountIdByCode(tx, '5000') // COGS (expense)

      // GHS 500 revenue: DR cash / CR revenue.
      await postJournalEntry(tx, {
        entryDate: day,
        sourceDocType: 'manual',
        description: 'IT §10.2 revenue',
        createdBy: userId,
        lines: [
          { accountId: cash, debit: 500 },
          { accountId: revenue, credit: 500 },
        ],
      })
      // GHS 120 expense: DR expense / CR cash.
      await postJournalEntry(tx, {
        entryDate: day,
        sourceDocType: 'manual',
        description: 'IT §10.2 expense',
        createdBy: userId,
        lines: [
          { accountId: expense, debit: 120 },
          { accountId: cash, credit: 120 },
        ],
      })

      const recon = await glDayReconciliation(tx, day)
      expect(recon.date).toBe(ymd(day))
      expect(recon.revenue).toBeCloseTo(500, 2)
      expect(recon.expenses).toBeCloseTo(120, 2)
      expect(recon.netIncome).toBeCloseTo(380, 2)
    })
  })

  it('matches generateProfitLoss for the same single-day window (reconciles with the statements)', async () => {
    await withRollback(async (tx: DB) => {
      const userId = await anyUserId(tx)
      const day = futureDay(16)
      await getOrCreatePeriodFor(tx, day)

      const cash = await accountIdByCode(tx, '1000')
      const revenue = await accountIdByCode(tx, '4200')

      await postJournalEntry(tx, {
        entryDate: day,
        sourceDocType: 'manual',
        description: 'IT §10.2 reconcile',
        createdBy: userId,
        // Cents (migration 0209): 33333c = GHS 333.33 — an amount that does not
        // divide evenly, so a rounding slip between the two readers would show.
        lines: [
          { accountId: cash, debit: 33333 },
          { accountId: revenue, credit: 33333 },
        ],
      })

      const recon = await glDayReconciliation(tx, day)
      const pl = await generateProfitLoss(tx, ymd(day), ymd(day))
      // The reconciliation figure is exactly the P&L for that one-day window.
      expect(recon.revenue).toBeCloseTo(pl.totalRevenue, 2)
      expect(recon.expenses).toBeCloseTo(pl.totalExpenses, 2)
      expect(recon.netIncome).toBeCloseTo(pl.netIncome, 2)
    })
  })
})

// ── §10.3 — period rollup over frozen module summaries ────────────────────────

describe.skipIf(noDb)('admin-v1 §10.3 — period rollup aggregation', () => {
  it('rollupModuleSummaries sums counts and money across days (pure)', () => {
    const day1: ModuleSummary[] = [
      {
        module: 'payments',
        title: 'Payments received',
        metrics: [
          { label: 'Count', value: 3 },
          { label: 'Total', value: 'GHS 100.00' },
        ],
      },
      {
        module: 'store',
        title: 'Store sales',
        metrics: [{ label: 'Sales', value: 2 }],
      },
    ]
    const day2: ModuleSummary[] = [
      {
        module: 'payments',
        title: 'Payments received',
        metrics: [
          { label: 'Count', value: 5 },
          { label: 'Total', value: 'GHS 250.50' },
        ],
      },
      // store absent on day2 — should still sum over the day it appeared.
      {
        module: 'labs',
        title: 'Lab cases',
        metrics: [{ label: 'New cases', value: 4 }],
      },
    ]

    const rolled = rollupModuleSummaries([day1, day2])
    const payments = rolled.find((m) => m.module === 'payments')!
    expect(payments).toBeTruthy()
    expect(metric(payments, 'Count')).toBe(8) // 3 + 5, numeric
    expect(metric(payments, 'Total')).toBe('GHS 350.50') // money re-formatted

    const store = rolled.find((m) => m.module === 'store')!
    expect(metric(store, 'Sales')).toBe(2) // only day1 contributed

    const labs = rolled.find((m) => m.module === 'labs')!
    expect(metric(labs, 'New cases')).toBe(4)

    // First-seen module order preserved: payments, store, labs.
    expect(rolled.map((m) => m.module)).toEqual(['payments', 'store', 'labs'])
    // Every aggregated metric is flagged numeric.
    expect(payments.metrics.every((m) => m.aggregated)).toBe(true)
  })

  it('carries a non-numeric metric through unchanged (not summed)', () => {
    const rolled = rollupModuleSummaries([
      [
        {
          module: 'note',
          title: 'Note',
          metrics: [{ label: 'Status', value: 'open' }],
        },
      ],
      [
        {
          module: 'note',
          title: 'Note',
          metrics: [{ label: 'Status', value: 'closed' }],
        },
      ],
    ])
    const note = rolled.find((m) => m.module === 'note')!
    expect(metric(note, 'Status')).toBe('closed') // last-seen carried through
    expect(note.metrics[0].aggregated).toBe(false)
  })

  it('getPeriodRollup aggregates persisted dailyReports.moduleSummaries across the window', async () => {
    await withRollback(async (tx: DB) => {
      const userId = await anyUserId(tx)

      const days = [futureDay(1), futureDay(2), futureDay(3)]
      const summariesPerDay: ModuleSummary[][] = [
        [
          {
            module: 'payments',
            title: 'Payments received',
            metrics: [
              { label: 'Count', value: 2 },
              { label: 'Total', value: 'GHS 80.00' },
            ],
          },
        ],
        [
          {
            module: 'payments',
            title: 'Payments received',
            metrics: [
              { label: 'Count', value: 3 },
              { label: 'Total', value: 'GHS 120.00' },
            ],
          },
          {
            module: 'store',
            title: 'Store sales',
            metrics: [{ label: 'Sales', value: 1 }],
          },
        ],
        [
          {
            module: 'store',
            title: 'Store sales',
            metrics: [{ label: 'Sales', value: 4 }],
          },
        ],
      ]

      for (let i = 0; i < days.length; i++) {
        await tx.insert(dailyReports).values({
          reportDate: days[i],
          checkedInCount: 0,
          newPatientsCount: 0,
          totalPayments: 0,
          totalExpenses: 0,
          balances: {},
          inventoryUsed: [],
          productsSold: [],
          restockedItems: [],
          moduleSummaries: summariesPerDay[i],
          submittedById: userId,
        })
      }

      const rollup = await getPeriodRollup(tx, '2099-06-01', '2099-06-03')
      expect(rollup.dayCount).toBe(3)

      const payments = rollup.modules.find((m) => m.module === 'payments')!
      expect(payments).toBeTruthy()
      expect(metric(payments, 'Count')).toBe(5) // 2 + 3
      expect(metric(payments, 'Total')).toBe('GHS 200.00') // 80 + 120

      const store = rollup.modules.find((m) => m.module === 'store')!
      expect(metric(store, 'Sales')).toBe(5) // 1 + 4 (day1 had no store block)
    })
  })

  it('a daily report dated outside the window does not contribute to the rollup', async () => {
    await withRollback(async (tx: DB) => {
      const userId = await anyUserId(tx)

      const inWindow: ModuleSummary[] = [
        {
          module: 'store',
          title: 'Store sales',
          metrics: [{ label: 'Sales', value: 7 }],
        },
      ]
      const outside: ModuleSummary[] = [
        {
          module: 'store',
          title: 'Store sales',
          metrics: [{ label: 'Sales', value: 99 }],
        },
      ]

      await tx.insert(dailyReports).values([
        {
          reportDate: futureDay(2),
          checkedInCount: 0,
          newPatientsCount: 0,
          totalPayments: 0,
          totalExpenses: 0,
          balances: {},
          inventoryUsed: [],
          productsSold: [],
          restockedItems: [],
          moduleSummaries: inWindow,
          submittedById: userId,
        },
        {
          reportDate: futureDay(20), // outside [01, 03]
          checkedInCount: 0,
          newPatientsCount: 0,
          totalPayments: 0,
          totalExpenses: 0,
          balances: {},
          inventoryUsed: [],
          productsSold: [],
          restockedItems: [],
          moduleSummaries: outside,
          submittedById: userId,
        },
      ])

      const rollup = await getPeriodRollup(tx, '2099-06-01', '2099-06-03')
      expect(rollup.dayCount).toBe(1)
      const store = rollup.modules.find((m) => m.module === 'store')!
      expect(metric(store, 'Sales')).toBe(7) // the 99 from day-20 is excluded
    })
  })
})
