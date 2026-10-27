/**
 * F09 / D6 — what the appointment detail dialog offers, and how Check in behaves.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (F09, F10, F11).
 *
 *  - Check in is offered for scheduled, confirmed AND rescheduled visits (the
 *    handler used to accept only "scheduled"), and never once the patient has
 *    arrived. It opens the shared check-in flow for THIS visit.
 *  - A non-admin looking at YESTERDAY's visit can only close it out (no-show, or
 *    completed if the patient was here); anything older is read-only (D6).
 *  - An admin changing a past visit must give a reason, which is sent with the
 *    change (the server refuses it otherwise).
 *
 * The dialog is real. The check-in flow is real, with the payment sheet stubbed.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
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

vi.mock('@/lib/actions/appointments', () => ({
  updateAppointment: vi.fn().mockResolvedValue({ success: true }),
  checkInAppointment: vi.fn(),
}))
vi.mock('@/lib/actions/doctor-availability', () => ({
  getDoctorUnavailability: vi.fn().mockResolvedValue({ success: true, data: [] }),
}))
vi.mock('@/lib/actions/doctors', () => ({
  getDoctors: vi.fn().mockResolvedValue({ success: true, data: [] }),
}))
vi.mock('@/lib/actions/google-calendar', () => ({
  getAppointmentSyncStatus: vi.fn().mockResolvedValue({ success: true, data: null }),
  resyncAppointmentToGoogle: vi.fn(),
}))
vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))
vi.mock('@/shared/hooks/use-lookup', () => ({
  useLookup: () => ({ rows: [], isLoading: false, error: null }),
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))
vi.mock('@/features/appointments/components/appointment-action-dialogs', () => ({
  SendReminderDialog: () => null,
  NoPaymentCheckInDialog: () => null,
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

import { AppointmentDetailDialog } from '@/features/appointments/components/appointment-detail-dialog'
import { api } from '@/lib/api-client'
import { renderWithRouter } from './_test-utils'

const mockPatch = vi.mocked(api.patch)
const { toast } = await import('sonner')

beforeAll(() => {
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

const DAY = 24 * 60 * 60 * 1000
function at(offsetDays: number): Date {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  return new Date(d.getTime() + offsetDays * DAY)
}
function visit(status: string, date: Date = new Date(Date.now() + 60 * 60 * 1000)) {
  return {
    id: 'appt-1',
    patientId: 'pat-1',
    doctorId: 'doc-1',
    date,
    durationMinutes: 30,
    status,
    type: 'consultation',
    patient: { name: 'Ama Mensah' },
    doctor: { user: { name: 'Dr. Owusu' } },
  }
}
function mount(appointment: ReturnType<typeof visit>, props: Record<string, unknown> = {}) {
  const onOpenChange = vi.fn()
  const onUpdate = vi.fn()
  renderWithRouter(
    <AppointmentDetailDialog
      open
      onOpenChange={onOpenChange}
      appointment={appointment}
      onUpdate={onUpdate}
      {...props}
    />
  )
  return { onOpenChange, onUpdate }
}
const button = (name: string | RegExp) => screen.queryByRole('button', { name })

describe('which actions each status offers today', () => {
  it.each([
    'scheduled',
    'confirmed',
    'rescheduled',
  ])('%s: check in, reminder, reschedule, no-show, cancel', (s) => {
    mount(visit(s))
    for (const name of [
      'Check in',
      'Send reminder',
      'Reschedule',
      'Mark no-show',
      'Cancel appointment',
    ]) {
      expect(button(name), `${name} for ${s}`).toBeInTheDocument()
    }
    expect(button('Seat patient')).not.toBeInTheDocument()
  })

  it('checked_in: seat or cancel, and NO Check in (the second-payment trap)', () => {
    mount(visit('checked_in'))
    expect(button('Seat patient')).toBeInTheDocument()
    expect(button('Cancel appointment')).toBeInTheDocument()
    expect(button('Check in')).not.toBeInTheDocument()
    expect(button('Mark no-show')).not.toBeInTheDocument()
  })

  it('in_chair: only Mark completed', () => {
    mount(visit('in_chair'))
    expect(button('Mark completed')).toBeInTheDocument()
    expect(button('Check in')).not.toBeInTheDocument()
    expect(button('Cancel appointment')).not.toBeInTheDocument()
  })

  it.each(['completed', 'cancelled', 'no_show'])('%s: nothing to do', (s) => {
    mount(visit(s))
    for (const name of [
      'Check in',
      'Seat patient',
      'Mark completed',
      'Mark no-show',
      'Cancel appointment',
    ]) {
      expect(button(name)).not.toBeInTheDocument()
    }
  })
})

describe('Check in opens the shared flow for this visit (F11)', () => {
  it.each([
    'scheduled',
    'confirmed',
    'rescheduled',
  ])('%s → the payment sheet, told the visit', async (s) => {
    mount(visit(s))
    fireEvent.click(screen.getByRole('button', { name: 'Check in' }))

    await waitFor(() => expect(sheet.props?.open).toBe(true))
    expect(sheet.props).toMatchObject({
      presetPatientId: 'pat-1',
      appointmentId: 'appt-1',
      showNoPaymentOption: true,
    })
  })

  it('a finished check-in refreshes the list and closes the dialog', async () => {
    const { onOpenChange, onUpdate } = mount(visit('scheduled'))
    fireEvent.click(screen.getByRole('button', { name: 'Check in' }))
    fireEvent.click(await screen.findByText('stub: payment taken and checked in'))

    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe("yesterday's visit (D6)", () => {
  it('a non-admin can only mark a never-arrived visit as no-show', () => {
    mount(visit('scheduled', at(-1)))

    expect(button('Mark no-show')).toBeInTheDocument()
    for (const name of ['Check in', 'Edit', 'Reschedule', 'Cancel appointment', 'Send reminder']) {
      expect(button(name), `${name} should be hidden`).not.toBeInTheDocument()
    }
  })

  it('a non-admin can only complete a visit that was left checked in', () => {
    mount(visit('checked_in', at(-1)))

    expect(button('Mark completed')).toBeInTheDocument()
    for (const name of ['Seat patient', 'Edit', 'Cancel appointment', 'Check in']) {
      expect(button(name)).not.toBeInTheDocument()
    }
  })

  it('closing it out sends the change with no override reason', async () => {
    mockPatch.mockResolvedValue({ success: true } as never)
    mount(visit('in_chair', at(-1)))
    fireEvent.click(screen.getByRole('button', { name: 'Mark completed' }))

    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1))
    expect(mockPatch).toHaveBeenCalledWith('/api/appointment-workflow/appt-1/transition', {
      action: 'complete',
    })
  })

  it('anything older than yesterday is read-only for a non-admin', () => {
    mount(visit('scheduled', at(-3)))

    expect(screen.getByText(/read-only/i)).toBeInTheDocument()
    for (const name of ['Mark no-show', 'Check in', 'Edit', 'Cancel appointment']) {
      expect(button(name)).not.toBeInTheDocument()
    }
  })
})

describe('an admin changing a past visit must give a reason', () => {
  it('without a reason nothing is sent', async () => {
    mount(visit('scheduled', at(-3)), { isAdmin: true })
    fireEvent.click(screen.getByRole('button', { name: 'Mark no-show' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/reason/i)))
    expect(mockPatch).not.toHaveBeenCalled()
  })

  it('with a reason, it is sent with the change', async () => {
    mockPatch.mockResolvedValue({ success: true } as never)
    mount(visit('scheduled', at(-3)), { isAdmin: true })
    fireEvent.change(screen.getByLabelText(/reason for changing this past appointment/i), {
      target: { value: 'Patient called to say they could not come' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Mark no-show' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1))
    expect(mockPatch).toHaveBeenCalledWith('/api/appointment-workflow/appt-1/transition', {
      action: 'no-show',
      overrideReason: 'Patient called to say they could not come',
    })
  })

  it('a visit from today needs no reason, and the reason box is not shown', async () => {
    mockPatch.mockResolvedValue({ success: true } as never)
    mount(visit('scheduled'), { isAdmin: true })

    expect(
      screen.queryByLabelText(/reason for changing this past appointment/i)
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Mark no-show' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1))
    expect(mockPatch.mock.calls[0][1]).not.toHaveProperty('overrideReason')
  })
})
