/**
 * F09 / F18 — checking in without payment goes through the check-in request, so it
 * gets the same guarantees as a paid check-in: the visit is validated on the
 * server, the doctor's note is queued, and a repeat is harmless.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (F09, F18).
 *
 * It used the generic transition endpoint, which accepted a check-in of an already
 * checked-in patient and queued no note.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/actions/appointments', () => ({
  checkInAppointment: vi.fn(),
  updateAppointment: vi.fn(),
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))
// The module also holds the other action dialogs; they pull in unrelated screens.
vi.mock('@/lib/api-client', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }))

import { NoPaymentCheckInDialog } from '@/features/appointments/components/appointment-action-dialogs'
import { checkInAppointment } from '@/lib/actions/appointments'
import { renderWithRouter } from './_test-utils'

const mockCheckIn = vi.mocked(checkInAppointment)
const { toast } = await import('sonner')
const APPT = { id: 'appt-1', patientId: 'pat-1', patient: { name: 'Ama Mensah' } } as never

function mount() {
  const onOpenChange = vi.fn()
  const onCheckedIn = vi.fn()
  renderWithRouter(
    <NoPaymentCheckInDialog
      open
      onOpenChange={onOpenChange}
      appointment={APPT}
      onCheckedIn={onCheckedIn}
    />
  )
  return { onOpenChange, onCheckedIn }
}
const type = (text: string) =>
  fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: text } })
const confirm = () => fireEvent.click(screen.getByRole('button', { name: /confirm check-in/i }))

beforeEach(() => mockCheckIn.mockReset())
afterEach(() => vi.clearAllMocks())

describe('check in without payment', () => {
  it('needs a real reason (the server wants at least 3 characters)', () => {
    mount()
    const button = screen.getByRole('button', { name: /confirm check-in/i })

    expect(button).toBeDisabled()
    type('ok')
    expect(button).toBeDisabled()
    type('follow-up')
    expect(button).toBeEnabled()
  })

  it('sends the reason through the check-in request and finishes', async () => {
    mockCheckIn.mockResolvedValue({ success: true, data: { alreadyCheckedIn: false } } as never)
    const { onOpenChange, onCheckedIn } = mount()
    type('  follow-up, covered by last visit  ')
    confirm()

    await waitFor(() => expect(onCheckedIn).toHaveBeenCalled())
    expect(mockCheckIn).toHaveBeenCalledTimes(1)
    expect(mockCheckIn).toHaveBeenCalledWith('appt-1', {
      noPaymentReason: 'follow-up, covered by last visit',
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(toast.success).toHaveBeenCalled()
  })

  it('a refusal is shown and nothing is reported as checked in', async () => {
    mockCheckIn.mockResolvedValue({
      success: false,
      error: 'This appointment is already cancelled and can’t be checked in.',
    } as never)
    const { onOpenChange, onCheckedIn } = mount()
    type('courtesy visit')
    confirm()

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(onCheckedIn).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('a patient who was already checked in is acknowledged, not treated as an error', async () => {
    mockCheckIn.mockResolvedValue({ success: true, data: { alreadyCheckedIn: true } } as never)
    const { onCheckedIn } = mount()
    type('courtesy visit')
    confirm()

    await waitFor(() => expect(onCheckedIn).toHaveBeenCalled())
    expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/already checked in/i))
    expect(toast.error).not.toHaveBeenCalled()
  })
})
