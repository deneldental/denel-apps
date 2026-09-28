// TODO(backend-wiring): replace with api.get('/api/reports/quarterly') filtered by date range.
// In-memory mock data for the Reports module (M9) quarterly tier UI pass.
// Quarter ranges are computed relative to `new Date()` using date-fns so the
// list always reflects the last ~4 quarters.

import {
  addMonths,
  addQuarters,
  endOfQuarter,
  formatISO,
  startOfMonth,
  startOfQuarter,
} from 'date-fns'

export interface MockQuarterlySummary {
  /** ISO date (YYYY-MM-DD) of the 1st of the quarter's first month. */
  quarterStart: string
  /** ISO date (YYYY-MM-DD) of the last day of the quarter's last month. */
  quarterEnd: string
  totals: {
    revenue: number
    expenses: number
    payments: number
    insurance: number
    labs: number
    xrays: number
    productSales: number
  }
  monthlyBreakdown: Array<{
    /** ISO date (YYYY-MM-DD) of the 1st of the contained month. */
    monthStart: string
    /** ISO date (YYYY-MM-DD) of the last day of the contained month. */
    monthEnd: string
    revenue: number
    patientCount: number
  }>
  /** Comparison vs prior quarter: % change per metric. */
  vsPrior: {
    revenuePct: number
    expensesPct: number
    patientCountPct: number
  }
}

const THIS_QUARTER_START = startOfQuarter(new Date())

function seeded(offset: number, salt: number): number {
  const x = Math.sin((offset + 1) * 5381 + salt * 27701) * 65537
  return x - Math.floor(x)
}

function buildQuarter(quarterOffset: number): MockQuarterlySummary {
  const quarterStart = addQuarters(THIS_QUARTER_START, quarterOffset)
  const quarterEnd = endOfQuarter(quarterStart)

  const monthlyBreakdown = Array.from({ length: 3 }, (_, m) => {
    const monthStart = startOfMonth(addMonths(quarterStart, m))
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0)
    const revenue = 35000 + Math.floor(seeded(quarterOffset * 10 + m, 1) * 55000)
    const patientCount = 140 + Math.floor(seeded(quarterOffset * 10 + m, 2) * 180)
    return {
      monthStart: formatISO(monthStart, { representation: 'date' }),
      monthEnd: formatISO(monthEnd, { representation: 'date' }),
      revenue,
      patientCount,
    }
  })

  const revenue = monthlyBreakdown.reduce((sum, m) => sum + m.revenue, 0)
  const expenses = Math.floor(revenue * (0.3 + seeded(quarterOffset, 3) * 0.1))
  const payments = Math.floor(revenue * (0.75 + seeded(quarterOffset, 4) * 0.2))
  const insurance = Math.floor(revenue * (0.12 + seeded(quarterOffset, 5) * 0.08))
  const labs = Math.floor(revenue * (0.08 + seeded(quarterOffset, 6) * 0.04))
  const xrays = Math.floor(revenue * (0.05 + seeded(quarterOffset, 7) * 0.03))
  const productSales = Math.floor(revenue * (0.1 + seeded(quarterOffset, 8) * 0.05))

  return {
    quarterStart: formatISO(quarterStart, { representation: 'date' }),
    quarterEnd: formatISO(quarterEnd, { representation: 'date' }),
    totals: { revenue, expenses, payments, insurance, labs, xrays, productSales },
    monthlyBreakdown,
    vsPrior: {
      revenuePct: Math.round((seeded(quarterOffset, 20) - 0.4) * 40),
      expensesPct: Math.round((seeded(quarterOffset, 21) - 0.4) * 30),
      patientCountPct: Math.round((seeded(quarterOffset, 22) - 0.4) * 35),
    },
  }
}

/** Most recent first: current quarter (offset 0), then -1, -2, -3. */
export const MOCK_QUARTERLY_SUMMARIES: MockQuarterlySummary[] = Array.from({ length: 4 }, (_, i) =>
  buildQuarter(-i)
)
