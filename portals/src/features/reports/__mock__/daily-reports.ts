// TODO(backend-wiring): replace with api.get('/api/reports/daily') filtered by date range.
// In-memory mock data for the Reports module (M9) daily tier UI pass. Dates are
// generated relative to `new Date()` using date-fns so the list always reflects
// the last ~30 days regardless of when the file is imported.

import { addDays, formatISO, setHours, setMinutes, startOfDay } from 'date-fns'

export interface MockDailyReport {
  /** ISO date only (YYYY-MM-DD). */
  date: string
  submittedBy: string
  /** ISO timestamp. */
  submittedAt: string
  totals: {
    revenue: number
    expenses: number
    payments: number
    insurance: number
    labs: number
    xrays: number
    productSales: number
  }
  patientCount: number
  appointmentCount: number
  notes: string | null
}

const TODAY = startOfDay(new Date())
const SUBMITTERS = ['Ama Mensah', 'Kofi Boateng', 'Yaa Owusu', 'Adwoa Asante']

/** Deterministic pseudo-random generator seeded on the day offset so the
 *  same day always produces the same mock numbers across renders. */
function seeded(offset: number, salt: number): number {
  const x = Math.sin((offset + 1) * 9301 + salt * 49297) * 233280
  return x - Math.floor(x)
}

function buildDay(offset: number): MockDailyReport {
  const day = addDays(TODAY, offset)
  const isoDate = formatISO(day, { representation: 'date' })
  const submitTs = formatISO(setMinutes(setHours(day, 18), 30))

  const base = 1800 + Math.floor(seeded(offset, 1) * 4200)
  const revenue = base + Math.floor(seeded(offset, 2) * 1500)
  const expenses = Math.floor(base * (0.25 + seeded(offset, 3) * 0.2))
  const payments = Math.floor(revenue * (0.7 + seeded(offset, 4) * 0.25))
  const insurance = Math.floor(revenue * (0.1 + seeded(offset, 5) * 0.1))
  const labs = Math.floor(base * (0.08 + seeded(offset, 6) * 0.06))
  const xrays = Math.floor(base * (0.05 + seeded(offset, 7) * 0.04))
  const productSales = Math.floor(base * (0.1 + seeded(offset, 8) * 0.08))
  const patientCount = 6 + Math.floor(seeded(offset, 9) * 18)
  const appointmentCount = patientCount + Math.floor(seeded(offset, 10) * 6)

  const notesPool = [
    'Busy morning with three walk-ins.',
    'Slow afternoon; two cancellations.',
    'High-value ortho follow-up completed.',
    null,
    null,
    'Lab delivery delayed until tomorrow.',
    'New patient onboarded.',
  ]
  const note = notesPool[Math.floor(seeded(offset, 11) * notesPool.length)]
  const submitter = SUBMITTERS[Math.floor(seeded(offset, 12) * SUBMITTERS.length)] ?? SUBMITTERS[0]!

  return {
    date: isoDate,
    submittedBy: submitter,
    submittedAt: submitTs,
    totals: {
      revenue,
      expenses,
      payments,
      insurance,
      labs,
      xrays,
      productSales,
    },
    patientCount,
    appointmentCount,
    notes: note ?? null,
  }
}

/** Oldest first → reversed at consumption time if a most-recent ordering is needed. */
export const MOCK_DAILY_REPORTS: MockDailyReport[] = Array.from({ length: 30 }, (_, i) =>
  buildDay(-(29 - i))
)
