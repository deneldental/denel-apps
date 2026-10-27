/**
 * Check-in-with-payment on the Appointment Detail Dialog.
 *
 * AcceptPaymentSheet only records a payment — it has no idea this was a check-in.
 * Nothing else in that call chain transitioned the appointment's status, so it
 * silently stayed 'scheduled' forever and staff could reopen the sheet and take a
 * SECOND payment for the same visit. See
 * project-docs/patient-records-and-scheduling-audit.md C4, and
 * project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md F10/F11.
 *
 * The dialog used to patch the status itself after the payment and never read the
 * result, so a refused update still closed the dialog as a success. It now hands
 * the whole check-in to the shared flow (check-in-flow.tsx): after a plan or
 * insurance payment the check-in is requested and ITS result decides what the
 * receptionist sees. A one-time payment is taken by the check-in request itself
 * (covered in one-time-payment-check-in.test.tsx).
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

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
// Stub that behaves like a plan payment that has just been posted: the real sheet
// closes itself, then reports success.
vi.mock('@/features/payments/components/accept-payment-sheet', () => ({
  AcceptPaymentSheet: ({
    open,
    onOpenChange,
    onSuccess,
  }: {
    open: boolean
    onOpenChange: (o: boolean) => void
    onSuccess?: () => void
  }) =>
    open ? (
      <button
        type="button"
        onClick={() => {
          onOpenChange(false)
          onSuccess?.()
        }}
      >
        simulate successful payment
      </button>
    ) : null,
}))

import { AppointmentDetailDialog } from '@/features/appointments/components/appointment-detail-dialog'
import { checkInAppointment } from '@/lib/actions/appointments'
import { renderWithRouter } from './_test-utils'

const mockCheckIn = vi.mocked(checkInAppointment)

beforeAll(() => {
  // Radix Tooltip/Select rely on pointer-capture, scrolling and
  // ResizeObserver, which jsdom lacks.
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

afterEach(() => vi.clearAllMocks())

// Today, not a literal date: the dialog locks visits before start-of-today for
// non-admins and hides Check in, so a hard-coded date goes stale and fails.
const appointment = {
  id: 'appt-1',
  patientId: 'pat-1',
  doctorId: 'doc-1',
  date: new Date(),
  durationMinutes: 30,
  status: 'scheduled',
  type: 'consultation',
  patient: { name: 'Ama Mensah' },
  doctor: { user: { name: 'Dr. Owusu' } },
}

function mount() {
  const onOpenChange = vi.fn()
  const onUpdate = vi.fn()
  renderWithRouter(
    <AppointmentDetailDialog
      open
      onOpenChange={onOpenChange}
      appointment={appointment}
      onUpdate={onUpdate}
    />
  )
  return { onOpenChange, onUpdate }
}

describe('Check-in with payment', () => {
  it('checks the patient in once the payment succeeds, so the visit cannot stay "scheduled"', async () => {
    mockCheckIn.mockResolvedValue({ success: true, data: { alreadyCheckedIn: false } } as never)
    const { onOpenChange, onUpdate } = mount()

    fireEvent.click(screen.getByRole('button', { name: 'Check in' }))
    fireEvent.click(await screen.findByText('simulate successful payment'))

    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
    expect(mockCheckIn).toHaveBeenCalledTimes(1)
    expect(mockCheckIn).toHaveBeenCalledWith('appt-1', { paymentRecordedElsewhere: true })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('does NOT report success or close when the check-in is refused after the payment (F10)', async () => {
    // e.g. the visit was cancelled while the payment sheet was open.
    mockCheckIn.mockResolvedValue({
      success: false,
      error: 'This appointment is already cancelled and can’t be checked in.',
    } as never)
    const { onOpenChange, onUpdate } = mount()

    fireEvent.click(screen.getByRole('button', { name: 'Check in' }))
    fireEvent.click(await screen.findByText('simulate successful payment'))

    expect(
      await screen.findByRole('heading', { name: /payment recorded.*check-in failed/i })
    ).toBeInTheDocument()
    expect(onUpdate).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
