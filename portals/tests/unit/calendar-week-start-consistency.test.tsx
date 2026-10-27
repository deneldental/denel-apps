/**
 * Pins the fix for the Medium finding "Week-start day is inconsistent on the
 * same page" (project-docs/patient-records-and-scheduling-audit.md): the
 * main Week/Month calendar views defaulted to Sunday-start (date-fns'
 * default), while the sidebar week-strip already used Monday-start
 * (weekStartsOn: 1) — two different definitions of "this week" visible
 * simultaneously. Both grids now match the sidebar.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MonthView } from '@/features/appointments/components/calendar/month-view'
import { WeekView } from '@/features/appointments/components/calendar/week-view'

// A known Wednesday — its Monday-start week begins two days earlier.
const WEDNESDAY = new Date('2026-10-07T00:00:00')
const emptyLookup = new Map<string, { colour?: string }>()

describe('Calendar week-start consistency [Medium]', () => {
  it('WeekView starts the week on Monday, not Sunday', () => {
    render(<WeekView date={WEDNESDAY} events={[]} appointmentTypesLookup={emptyLookup} />)
    // The header's day-of-week labels, in DOM order, should read Mon..Sun.
    const dayLabels = screen.getAllByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/)
    expect(dayLabels[0]).toHaveTextContent('Mon')
    expect(dayLabels[6]).toHaveTextContent('Sun')
  })

  it("MonthView's column headers read Mon..Sun, not Sun..Sat", () => {
    render(<MonthView date={WEDNESDAY} events={[]} appointmentTypesLookup={emptyLookup} />)
    const dayLabels = screen.getAllByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/)
    expect(dayLabels.map((el) => el.textContent)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ])
  })
})
