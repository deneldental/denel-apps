/**
 * F09 — the Today column's check-in rules.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (F09, F10, F11).
 *
 *  - Check In was offered for EVERY non-terminal status, including a patient already
 *    checked in or in the chair. Clicking it reopened the payment sheet and allowed a
 *    second payment for the same visit.
 *  - The list dropped any visit whose slot time had passed, so a patient who arrived
 *    late vanished from the actionable list. Only visits that have NOT arrived stay.
 *  - Check In runs the shared flow for that visit; a finished check-in reloads the list.
 *
 * The column is real; payment sheets and network calls are stubbed.
 */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/** The props the stubbed payment sheets and dialogs are given, as the tests use them. */
type StubProps = {
  open?: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (info?: { checkedIn?: boolean }) => void
  onNoPayment?: () => void
  onCheckedIn?: () => void
  [key: string]: unknown
}

const sheet = vi.hoisted(() => ({ props: null as null | StubProps }))

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
  BlockTimeSheet: () => null,
}))
vi.mock('@/features/appointments/components/website-bookings-panel', () => ({
  WebsiteBookingsPanel: () => null,
}))
vi.mock('@/features/payments/components/accept-payment-sheet', () => ({
  AcceptPaymentSheet: (props: StubProps) => {
    sheet.props = props
    return props.open ? (
      <button
        type="button"
        onClick={() => {
          props.onOpenChange(false)
          props.onSuccess?.({ checkedIn: true })
        }}
      >
        stub: payment taken and checked in
      </button>
    ) : null
  },
}))
vi.mock('@/lib/actions/appointments', () => ({
  updateAppointment: vi.fn(),
  checkInAppointment: vi.fn(),
}))
vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn().mockResolvedValue({ success: true, data: [] }), patch: vi.fn() },
}))
vi.mock('@/lib/permissions-context', () => ({ useCan: vi.fn(() => true) }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import { UpcomingAppointmentsColumn } from '@/features/appointments/components/upcoming-appointments-column'
import { renderWithRouter } from './_test-utils'

beforeAll(() => {
  // Radix menus lean on pointer-capture, scrolling and ResizeObserver, which jsdom lacks.
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>
  proto.hasPointerCapture ??= () => false
  proto.setPointerCapture ??= () => {}
  proto.releasePointerCapture ??= () => {}
  proto.scrollIntoView ??= () => {}
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
afterEach(() => {
  vi.clearAllMocks()
  sheet.props = null
})

/** Later today, so the slot time has not passed whatever time the suite runs. */
function laterToday(): Date {
  const d = new Date()
  d.setHours(23, 59, 0, 0)
  return d
}
/** Earlier today, always on today's date: half the time since midnight, at most 30 minutes ago. */
function earlierToday(): Date {
  const now = Date.now()
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)
  return new Date(now - Math.min(30 * 60 * 1000, (now - startOfDay.getTime()) / 2))
}

let n = 0
function visit(name: string, status: string, date: Date) {
  n += 1
  return {
    id: `appt-${n}`,
    patientId: `pat-${n}`,
    date,
    status,
    patient: { id: `pat-${n}`, name, phone: '+233201234567' },
    doctor: { id: 'doc-1', user: { name: 'Dr. Mensah' } },
  }
}

function mount(appointments: ReturnType<typeof visit>[]) {
  const onReload = vi.fn()
  renderWithRouter(
    <UpcomingAppointmentsColumn
      appointments={appointments}
      unavailability={[]}
      onReload={onReload}
    />
  )
  return { onReload }
}

describe('who is offered Check In', () => {
  it.each(['scheduled', 'confirmed', 'rescheduled'])('a %s visit', (status) => {
    mount([visit('Ama Mensah', status, laterToday())])
    expect(screen.getByText('Check In')).toBeInTheDocument()
  })

  it.each([
    'checked_in',
    'in_chair',
  ])('a visit that is already %s is NOT (that reopened the payment sheet)', (status) => {
    mount([visit('Ama Mensah', status, laterToday())])
    expect(screen.getByText('Ama Mensah')).toBeInTheDocument()
    expect(screen.queryByText('Check In')).not.toBeInTheDocument()
  })

  it('a checked-in visit still offers Cancel, and none of the pre-arrival actions', async () => {
    mount([visit('Ama Mensah', 'checked_in', laterToday())])
    await userEvent.click(screen.getByRole('button', { name: 'More options' }))

    expect(await screen.findByText('Cancel appointment')).toBeInTheDocument()
    for (const label of ['Mark no-show', 'Reschedule', 'Send reminder']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }
  })

  it('an in-chair visit offers no action at all', () => {
    mount([visit('Ama Mensah', 'in_chair', laterToday())])
    expect(screen.queryByRole('button', { name: 'More options' })).not.toBeInTheDocument()
  })

  it('a scheduled visit still offers the whole menu', async () => {
    mount([visit('Ama Mensah', 'scheduled', laterToday())])
    await userEvent.click(screen.getByRole('button', { name: 'More options' }))

    for (const label of ['Reschedule', 'Send reminder', 'Mark no-show', 'Cancel appointment']) {
      expect(await screen.findByText(label)).toBeInTheDocument()
    }
  })
})

describe('a late arrival does not vanish from the list', () => {
  it('a visit whose slot time has passed but who has not arrived stays', () => {
    mount([visit('Late Patient', 'scheduled', earlierToday())])
    expect(screen.getByText('Late Patient')).toBeInTheDocument()
    expect(screen.getByText('Check In')).toBeInTheDocument()
  })

  it.each(['confirmed', 'rescheduled'])('also when %s', (status) => {
    mount([visit('Late Patient', status, earlierToday())])
    expect(screen.getByText('Late Patient')).toBeInTheDocument()
  })

  it('a visit that has arrived and whose time has passed is still dropped (it is in the clinic flow)', () => {
    mount([visit('Seen Already', 'checked_in', earlierToday())])
    expect(screen.queryByText('Seen Already')).not.toBeInTheDocument()
  })

  it('a finished or cancelled visit is still dropped', () => {
    mount([
      visit('Done Patient', 'completed', laterToday()),
      visit('Gone Patient', 'cancelled', laterToday()),
      visit('Absent Patient', 'no_show', laterToday()),
    ])
    for (const name of ['Done Patient', 'Gone Patient', 'Absent Patient']) {
      expect(screen.queryByText(name)).not.toBeInTheDocument()
    }
  })
})

describe('Check In runs the shared flow for that visit', () => {
  it('opens the payment sheet carrying the visit and its patient', async () => {
    const a = visit('Ama Mensah', 'scheduled', laterToday())
    mount([a])
    await userEvent.click(screen.getByText('Check In'))

    await waitFor(() => expect(sheet.props?.open).toBe(true))
    expect(sheet.props).toMatchObject({
      appointmentId: a.id,
      presetPatientId: a.patientId,
      showNoPaymentOption: true,
    })
  })

  it('a finished check-in reloads the list', async () => {
    const { onReload } = mount([visit('Ama Mensah', 'scheduled', laterToday())])
    await userEvent.click(screen.getByText('Check In'))
    await userEvent.click(await screen.findByText('stub: payment taken and checked in'))

    await waitFor(() => expect(onReload).toHaveBeenCalled())
  })
})
