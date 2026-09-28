// TODO(backend-wiring): replace with api.get('/api/reports/weekly') filtered by date range.
// In-memory mock data for the Reports module (M9) weekly tier UI pass. Week
// ranges are computed relative to `new Date()` using date-fns (Mon-Sun ISO
// weeks) so the list always reflects the last ~6 weeks.

import { addDays, addWeeks, endOfWeek, formatISO, startOfWeek } from 'date-fns'

export interface MockWeeklySummary {
  /** ISO date (YYYY-MM-DD) of Monday. */
  weekStart: string
  /** ISO date (YYYY-MM-DD) of Sunday. */
  weekEnd: string
  totals: {
    revenue: number
    expenses: number
    payments: number
    insurance: number
    labs: number
    xrays: number
    productSales: number
  }
  dailyBreakdown: Array<{
    /** ISO date (YYYY-MM-DD). */
    date: string
    revenue: number
    patientCount: number
  }>
  /** Comparison vs prior week: % change per metric. */
  vsPrior: {
    revenuePct: number
    expensesPct: number
    patientCountPct: number
  }
}

const THIS_WEEK_START = startOfWeek(new Date(), { weekStartsOn: 1 })

function seeded(offset: number, salt: number): number {
  const x = Math.sin((offset + 1) * 7919 + salt * 31547) * 98765
  return x - Math.floor(x)
}

function buildWeek(weekOffset: number): MockWeeklySummary {
  const weekStart = addWeeks(THIS_WEEK_START, weekOffset)
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })

  const dailyBreakdown = Array.from({ length: 7 }, (_, d) => {
    const day = addDays(weekStart, d)
    const revenue = 1500 + Math.floor(seeded(weekOffset * 10 + d, 1) * 4500)
    const patientCount = 5 + Math.floor(seeded(weekOffset * 10 + d, 2) * 18)
    return {
      date: formatISO(day, { representation: 'date' }),
      revenue,
      patientCount,
    }
  })

  const revenue = dailyBreakdown.reduce((sum, d) => sum + d.revenue, 0)
  const expenses = Math.floor(revenue * (0.3 + seeded(weekOffset, 3) * 0.1))
  const payments = Math.floor(revenue * (0.75 + seeded(weekOffset, 4) * 0.2))
  const insurance = Math.floor(revenue * (0.12 + seeded(weekOffset, 5) * 0.08))
  const labs = Math.floor(revenue * (0.08 + seeded(weekOffset, 6) * 0.04))
  const xrays = Math.floor(revenue * (0.05 + seeded(weekOffset, 7) * 0.03))
  const productSales = Math.floor(revenue * (0.1 + seeded(weekOffset, 8) * 0.05))

  return {
    weekStart: formatISO(weekStart, { representation: 'date' }),
    weekEnd: formatISO(weekEnd, { representation: 'date' }),
    totals: { revenue, expenses, payments, insurance, labs, xrays, productSales },
    dailyBreakdown,
    vsPrior: {
      revenuePct: Math.round((seeded(weekOffset, 20) - 0.4) * 40),
      expensesPct: Math.round((seeded(weekOffset, 21) - 0.4) * 30),
      patientCountPct: Math.round((seeded(weekOffset, 22) - 0.4) * 35),
    },
  }
}

/** Most recent first: current week (offset 0), then -1, -2, …, -5. */
export const MOCK_WEEKLY_SUMMARIES: MockWeeklySummary[] = Array.from({ length: 6 }, (_, i) =>
  buildWeek(-i)
)
