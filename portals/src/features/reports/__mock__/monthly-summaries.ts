// TODO(backend-wiring): replace with api.get('/api/reports/monthly') filtered by date range.
// In-memory mock data for the Reports module (M9) monthly tier UI pass. Month
// ranges are computed relative to `new Date()` using date-fns so the list
// always reflects the last ~6 months.

import {
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  formatISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns'

export interface MockMonthlySummary {
  /** ISO date (YYYY-MM-DD) of the 1st of the month. */
  monthStart: string
  /** ISO date (YYYY-MM-DD) of the last day of the month. */
  monthEnd: string
  totals: {
    revenue: number
    expenses: number
    payments: number
    insurance: number
    labs: number
    xrays: number
    productSales: number
  }
  weeklyBreakdown: Array<{
    /** ISO date (YYYY-MM-DD) of the Monday of the contained week. */
    weekStart: string
    /** ISO date (YYYY-MM-DD) of the Sunday of the contained week. */
    weekEnd: string
    revenue: number
    patientCount: number
  }>
  /** Comparison vs prior month: % change per metric. */
  vsPrior: {
    revenuePct: number
    expensesPct: number
    patientCountPct: number
  }
}

const THIS_MONTH_START = startOfMonth(new Date())

function seeded(offset: number, salt: number): number {
  const x = Math.sin((offset + 1) * 6151 + salt * 41719) * 54321
  return x - Math.floor(x)
}

function buildMonth(monthOffset: number): MockMonthlySummary {
  const monthStart = addMonths(THIS_MONTH_START, monthOffset)
  const monthEnd = endOfMonth(monthStart)

  // Roughly 4-5 weeks per month; emit 4 weekly buckets anchored to Mondays
  // within the month.
  const firstMonday = startOfWeek(monthStart, { weekStartsOn: 1 })
  const weeklyBreakdown = Array.from({ length: 4 }, (_, w) => {
    const weekStart = addWeeks(firstMonday, w)
    const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })
    const revenue = 8000 + Math.floor(seeded(monthOffset * 10 + w, 1) * 14000)
    const patientCount = 30 + Math.floor(seeded(monthOffset * 10 + w, 2) * 45)
    return {
      weekStart: formatISO(weekStart, { representation: 'date' }),
      weekEnd: formatISO(weekEnd, { representation: 'date' }),
      revenue,
      patientCount,
    }
  })

  const revenue = weeklyBreakdown.reduce((sum, w) => sum + w.revenue, 0)
  const expenses = Math.floor(revenue * (0.3 + seeded(monthOffset, 3) * 0.1))
  const payments = Math.floor(revenue * (0.75 + seeded(monthOffset, 4) * 0.2))
  const insurance = Math.floor(revenue * (0.12 + seeded(monthOffset, 5) * 0.08))
  const labs = Math.floor(revenue * (0.08 + seeded(monthOffset, 6) * 0.04))
  const xrays = Math.floor(revenue * (0.05 + seeded(monthOffset, 7) * 0.03))
  const productSales = Math.floor(revenue * (0.1 + seeded(monthOffset, 8) * 0.05))

  return {
    monthStart: formatISO(monthStart, { representation: 'date' }),
    monthEnd: formatISO(monthEnd, { representation: 'date' }),
    totals: { revenue, expenses, payments, insurance, labs, xrays, productSales },
    weeklyBreakdown,
    vsPrior: {
      revenuePct: Math.round((seeded(monthOffset, 20) - 0.4) * 40),
      expensesPct: Math.round((seeded(monthOffset, 21) - 0.4) * 30),
      patientCountPct: Math.round((seeded(monthOffset, 22) - 0.4) * 35),
    },
  }
}

/** Most recent first: current month (offset 0), then -1, …, -5. */
export const MOCK_MONTHLY_SUMMARIES: MockMonthlySummary[] = Array.from({ length: 6 }, (_, i) =>
  buildMonth(-i)
)
