/**
 * Pins the fix for the Medium finding "add-walk-in-sheet.tsx has no
 * client-side block-time check" (project-docs/patient-records-and-scheduling-audit.md):
 * unlike every other booking surface, this one had no client-side check at
 * all — the backend still rejected it, but only after the whole form was
 * filled in and submitted.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AddWalkInSheet } from '@/features/appointments/components/add-walk-in-sheet'
import { renderWithRouter } from './_test-utils'

beforeAll(() => {
  // Radix Select relies on pointer-capture, scrolling and ResizeObserver,
  // which jsdom lacks.
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

const DOCTOR = { id: 'doc-1', user: { name: 'Dr. Mensah' } }

vi.mock('@/features/appointments/hooks/use-appointment-pickers', () => ({
  useAppointmentPickers: () => ({ doctors: [DOCTOR], refresh: vi.fn() }),
  invalidateAppointmentPickerCache: vi.fn(),
}))
vi.mock('@/features/patients/components/add-patient-sheet', () => ({
  AddPatientSheet: () => null,
}))
vi.mock('@/features/payments/components/accept-payment-sheet', () => ({
  AcceptPaymentSheet: () => null,
}))
vi.mock('@/lib/actions/services', () => ({
  getServices: vi.fn().mockResolvedValue({ success: true, data: [] }),
}))
vi.mock('@/lib/actions/walk-in', () => ({ createWalkIn: vi.fn() }))
vi.mock('@/lib/actions/appointments', () => ({ createAppointment: vi.fn() }))
vi.mock('@/lib/actions/medical-records', () => ({ createPendingMedicalRecord: vi.fn() }))
vi.mock('@/shared/components/patient-picker', () => ({
  PatientPicker: ({ onChange }: { onChange: (id: string) => void }) => (
    <button type="button" onClick={() => onChange('pat-1')}>
      Pick patient
    </button>
  ),
}))

vi.mock('@/lib/actions/doctor-availability', () => ({
  getDoctorUnavailability: vi.fn(),
}))

import { getDoctorUnavailability } from '@/lib/actions/doctor-availability'

const mockGetDoctorUnavailability = vi.mocked(getDoctorUnavailability)

afterEach(() => vi.clearAllMocks())

describe('AddWalkInSheet block-time check [Medium]', () => {
  it('disables submit and warns when the picked doctor is blocked right now', async () => {
    const now = new Date()
    mockGetDoctorUnavailability.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'block-1',
          doctorId: 'doc-1',
          startTime: new Date(now.getTime() - 60_000).toISOString(),
          endTime: new Date(now.getTime() + 60 * 60_000).toISOString(),
          reason: 'Lunch',
        },
      ],
    })

    const user = userEvent.setup()
    renderWithRouter(<AddWalkInSheet open onOpenChange={() => {}} />)

    await user.click(await screen.findByText('Pick patient'))
    fireEvent.click(screen.getByText('Select doctor'))
    fireEvent.click(await screen.findByRole('option', { name: 'Dr. Mensah' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/unavailable right now/i)
    )
    expect(
      screen.getByRole('button', { name: /check in for estimate|record walk-in/i })
    ).toBeDisabled()
  })

  it('leaves submit enabled when the doctor has no conflicting block', async () => {
    mockGetDoctorUnavailability.mockResolvedValue({ success: true, data: [] })

    renderWithRouter(<AddWalkInSheet open onOpenChange={() => {}} />)

    fireEvent.click(screen.getByText('Select doctor'))
    fireEvent.click(await screen.findByRole('option', { name: 'Dr. Mensah' }))

    await waitFor(() => expect(mockGetDoctorUnavailability).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
