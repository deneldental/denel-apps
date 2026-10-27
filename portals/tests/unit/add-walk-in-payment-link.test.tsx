/**
 * F33 — the payment taken after recording a walk-in names the walk-in's visit.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md.
 *
 * The walk-in sheet records the visit (already checked in) and then opens the
 * Accept Payment sheet with the patient only, so the payment named no visit. It now
 * hands over the visit to NAME — not the check-in visit, because the check-in request
 * would refuse a visit that is already checked in and take no money.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const seen = vi.hoisted(() => ({ accept: null as null | Record<string, unknown> }))

vi.mock('@/features/appointments/hooks/use-appointment-pickers', () => ({
  useAppointmentPickers: () => ({
    doctors: [{ id: 'doc-1', user: { name: 'Dr. Mensah' } }],
    refresh: vi.fn(),
  }),
  invalidateAppointmentPickerCache: vi.fn(),
}))
vi.mock('@/features/patients/components/add-patient-sheet', () => ({ AddPatientSheet: () => null }))
vi.mock('@/features/payments/components/accept-payment-sheet', () => ({
  AcceptPaymentSheet: (props: Record<string, unknown>) => {
    seen.accept = props
    return null
  },
}))
vi.mock('@/lib/actions/services', () => ({
  getServices: vi.fn().mockResolvedValue({
    success: true,
    data: [{ id: 'svc-1', name: 'Scaling', amount: '150.00', isActive: true, status: 'active' }],
  }),
}))
vi.mock('@/lib/actions/walk-in', () => ({ createWalkIn: vi.fn() }))
vi.mock('@/lib/actions/appointments', () => ({ createAppointment: vi.fn() }))
vi.mock('@/lib/actions/medical-records', () => ({ createPendingMedicalRecord: vi.fn() }))
vi.mock('@/lib/actions/doctor-availability', () => ({
  getDoctorUnavailability: vi.fn().mockResolvedValue({ success: true, data: [] }),
}))
vi.mock('@/shared/components/patient-picker', () => ({
  PatientPicker: ({ onChange }: { onChange: (id: string) => void }) => (
    <button type="button" onClick={() => onChange('pat-1')}>
      Pick patient
    </button>
  ),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import { AddWalkInSheet } from '@/features/appointments/components/add-walk-in-sheet'
import { createWalkIn } from '@/lib/actions/walk-in'
import { renderWithRouter } from './_test-utils'

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
  seen.accept = null
  vi.clearAllMocks()
})

async function recordWalkIn() {
  vi.mocked(createWalkIn).mockResolvedValue({
    success: true,
    data: {
      appointment: { id: 'walk-1' },
      invoice: { id: 'inv-1', total: 15000, balance: 15000, status: 'issued' },
      payment: null,
    },
  } as never)
  const user = userEvent.setup()
  renderWithRouter(<AddWalkInSheet trigger={<button type="button">Walk-in</button>} />)
  // The parent uses the sheet with its own trigger (uncontrolled); open it that way.
  await user.click(await screen.findByRole('button', { name: /walk-in/i }))
  await user.click(await screen.findByText('Pick patient'))
  fireEvent.click(screen.getByText('Select doctor'))
  fireEvent.click(await screen.findByRole('option', { name: 'Dr. Mensah' }))
  fireEvent.click(screen.getByText(/add a treatment from the catalog/i))
  fireEvent.click(await screen.findByRole('option', { name: /scaling/i }))
  await user.click(screen.getByRole('button', { name: /record walk-in/i }))
  await waitFor(() => expect(createWalkIn).toHaveBeenCalled())
}

describe('walk-in → Accept Payment', () => {
  // F39: recording the walk-in set the hand-off and then cleared it in the same
  // render (the form reset wiped it), so the payment sheet never opened.
  it('opens the payment sheet for the walk-in patient once the walk-in is recorded', async () => {
    await recordWalkIn()
    await waitFor(() => expect(seen.accept).not.toBeNull())
    expect(seen.accept).toMatchObject({ open: true, presetPatientId: 'pat-1' })
  })

  // F33: and the payment names the visit, without going through check-in.
  it('hands it the walk-in visit to name, not a visit to check in', async () => {
    await recordWalkIn()
    await waitFor(() => expect(seen.accept).not.toBeNull())
    expect(seen.accept).toMatchObject({ linkAppointmentId: 'walk-1' })
    expect(seen.accept?.appointmentId).toBeUndefined()
  })
})
