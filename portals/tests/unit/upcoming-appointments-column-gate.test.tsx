/**
 * Pins the fix for finding H5 (bullets 1 and 2)
 * (project-docs/patient-records-and-scheduling-audit.md):
 *  - The Today-tab sidebar's AppointmentCard exposed Check-in/Reschedule/Send
 *    reminder/Mark no-show/Cancel with zero permission gating, unlike the
 *    Appointment Detail Dialog's correct `readOnly={isClinicalUser}`.
 *  - "Block Time" was unrestricted in the UI but requires appointments:create
 *    server-side (`POST /api/doctors/unavailability`) — an always-403 trap.
 */
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UpcomingAppointmentsColumn } from '@/features/appointments/components/upcoming-appointments-column'
import { renderWithRouter } from './_test-utils'

vi.mock('@/features/appointments/components/add-appointment-sheet', () => ({
  AddAppointmentSheet: () => null,
}))
vi.mock('@/features/appointments/components/add-walk-in-sheet', () => ({
  AddWalkInSheet: () => null,
}))
vi.mock('@/features/appointments/components/appointment-action-dialogs', () => ({
  NoPaymentCheckInDialog: () => null,
  RescheduleAppointmentDialog: () => null,
  SendReminderDialog: () => null,
}))
vi.mock('@/features/appointments/components/block-time-sheet', () => ({
  BlockTimeSheet: () => <button type="button">Block Time trigger</button>,
}))
vi.mock('@/features/appointments/components/website-bookings-panel', () => ({
  WebsiteBookingsPanel: () => null,
}))
vi.mock('@/features/payments/components/accept-payment-sheet', () => ({
  AcceptPaymentSheet: () => null,
}))
vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn().mockResolvedValue({ success: true, data: [] }) },
}))
vi.mock('@/lib/permissions-context', () => ({ useCan: vi.fn() }))

import { useCan } from '@/lib/permissions-context'

const mockUseCan = vi.mocked(useCan)

// The Today tab drops any item whose time has already passed today. Pin the
// appointment to 23:59 today (real system clock, no fake timers — those
// break RTL's findBy* polling) so it's always still upcoming, without
// depending on how much of today has already elapsed when the test runs.
function todayAt2359(): Date {
  const d = new Date()
  d.setHours(23, 59, 0, 0)
  return d
}
const appointment = {
  id: 'appt-1',
  date: todayAt2359(),
  status: 'scheduled',
  patient: { id: 'p-1', name: 'Ama Mensah', phone: '+233201234567' },
  doctor: { id: 'doc-1', user: { name: 'Dr. Mensah' } },
}

afterEach(() => vi.clearAllMocks())

describe('UpcomingAppointmentsColumn — permission gates [H5]', () => {
  it('hides the appointment card action row for a clinical-only user', () => {
    mockUseCan.mockReturnValue(false)
    renderWithRouter(
      <UpcomingAppointmentsColumn appointments={[appointment]} unavailability={[]} isClinicalUser />
    )
    expect(screen.queryByText('Check In')).not.toBeInTheDocument()
  })

  it('shows the appointment card action row for a non-clinical user', () => {
    mockUseCan.mockReturnValue(true)
    renderWithRouter(
      <UpcomingAppointmentsColumn
        appointments={[appointment]}
        unavailability={[]}
        isClinicalUser={false}
      />
    )
    expect(screen.getByText('Check In')).toBeInTheDocument()
  })

  it('hides the Block Time trigger when the caller lacks appointments:create', async () => {
    mockUseCan.mockReturnValue(false)
    const { findByText } = renderWithRouter(
      <UpcomingAppointmentsColumn appointments={[]} unavailability={[]} />
    )
    // Switch to the "Blocked" tab, where the trigger renders.
    const blockedTab = await findByText(/Blocked|Unavailable/)
    fireEvent.click(blockedTab)
    expect(screen.queryByText('Block Time trigger')).not.toBeInTheDocument()
  })

  it('shows the Block Time trigger when the caller has appointments:create', async () => {
    mockUseCan.mockReturnValue(true)
    const { findByText } = renderWithRouter(
      <UpcomingAppointmentsColumn appointments={[]} unavailability={[]} />
    )
    const blockedTab = await findByText(/Blocked|Unavailable/)
    fireEvent.click(blockedTab)
    expect(await screen.findByText('Block Time trigger')).toBeInTheDocument()
  })
})
