/**
 * Pins the fix for the Medium finding "Calendar events never reflect
 * durationMinutes visually" (project-docs/patient-records-and-scheduling-audit.md):
 * every appointment card in Day/Week view rendered at a fixed pixel height
 * regardless of length — a 15-min and a 2-hour visit looked identical.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DayView } from '@/features/appointments/components/calendar/day-view'
import { WeekView } from '@/features/appointments/components/calendar/week-view'

const DATE = new Date('2026-10-07T09:00:00')
const emptyLookup = new Map<string, { colour?: string }>()

function makeEvent(id: string, durationMinutes: number) {
  return {
    id,
    title: `Patient ${id}`,
    date: DATE,
    type: 'appointment' as const,
    appointment: { id, date: DATE, status: 'scheduled', durationMinutes },
  }
}

describe('Calendar event duration height [Medium]', () => {
  it('WeekView gives a 2-hour visit a taller card than a 15-minute one', () => {
    render(
      <WeekView
        date={DATE}
        events={[makeEvent('short', 15), makeEvent('long', 120)]}
        appointmentTypesLookup={emptyLookup}
      />
    )
    const shortCard = screen.getByText('Patient short').closest('div[style*="height"]')
    const longCard = screen.getByText('Patient long').closest('div[style*="height"]')
    expect(shortCard).toBeTruthy()
    expect(longCard).toBeTruthy()
    const shortHeight = Number((shortCard as HTMLElement).style.height.replace('px', ''))
    const longHeight = Number((longCard as HTMLElement).style.height.replace('px', ''))
    expect(longHeight).toBeGreaterThan(shortHeight)
  })

  it('DayView gives a 2-hour visit a taller card than a 15-minute one', () => {
    render(
      <DayView
        date={DATE}
        events={[makeEvent('short', 15), makeEvent('long', 120)]}
        appointmentTypesLookup={emptyLookup}
      />
    )
    const shortCard = screen.getByText('Patient short').closest('div[style*="height"]')
    const longCard = screen.getByText('Patient long').closest('div[style*="height"]')
    expect(shortCard).toBeTruthy()
    expect(longCard).toBeTruthy()
    const shortHeight = Number((shortCard as HTMLElement).style.height.replace('px', ''))
    const longHeight = Number((longCard as HTMLElement).style.height.replace('px', ''))
    expect(longHeight).toBeGreaterThan(shortHeight)
  })
})
