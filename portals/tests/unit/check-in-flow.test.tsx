/**
 * F10 / F11 — the check-in flow, end to end from the receptionist's side.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (F10, F11).
 *
 * The old flow closed everything and reported success as soon as the PAYMENT
 * succeeded, then fired a status update whose result nobody read. If the visit had
 * been cancelled in the meantime the update was refused, the screen said "checked
 * in", the money was recorded against nothing, and Check In reappeared. Here:
 *   - the payment sheet is told which visit it is for;
 *   - a one-time payment is taken BY the check-in request, so it is all or nothing;
 *   - after a plan or insurance payment, the check-in is a separate step whose
 *     failure is shown ("payment recorded, check-in failed") with a retry that can
 *     only check in, never charge again.
 *
 * The payment sheet and the no-payment dialog are stubbed; their own behaviour has
 * its own tests. What is real here is the flow's decisions.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@/lib/actions/appointments', () => ({ checkInAppointment: vi.fn() }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))
vi.mock('@/features/payments/components/accept-payment-sheet', () => ({
  AcceptPaymentSheet: (props: StubProps) => {
    sheet.props = props
    return props.open ? (
      <div>
        <span>stub payment sheet</span>
        <button
          type="button"
          onClick={() => {
            // The real one-time sheet closes itself, THEN reports success.
            props.onOpenChange(false)
            props.onSuccess?.({ checkedIn: true })
          }}
        >
          one-time paid and checked in
        </button>
        <button
          type="button"
          onClick={() => {
            props.onOpenChange(false)
            props.onSuccess?.()
          }}
        >
          plan paid
        </button>
        <button type="button" onClick={() => props.onSuccess?.()}>
          insurance claim raised
        </button>
        <button
          type="button"
          onClick={() => {
            // The real card grid closes the sheet, THEN calls onNoPayment.
            props.onOpenChange(false)
            props.onNoPayment?.()
          }}
        >
          choose no payment
        </button>
        <button type="button" onClick={() => props.onOpenChange(false)}>
          close sheet
        </button>
      </div>
    ) : null
  },
}))
vi.mock('@/features/appointments/components/appointment-action-dialogs', () => ({
  NoPaymentCheckInDialog: (props: StubProps) =>
    props.open ? (
      <div>
        <span>stub no-payment dialog</span>
        <button
          type="button"
          onClick={() => {
            props.onOpenChange(false)
            props.onCheckedIn?.()
          }}
        >
          no-payment confirmed
        </button>
        <button type="button" onClick={() => props.onOpenChange(false)}>
          close no-payment
        </button>
      </div>
    ) : null,
}))

import { CheckInFlow } from '@/features/appointments/components/check-in-flow'
import { checkInAppointment } from '@/lib/actions/appointments'

const mockCheckIn = vi.mocked(checkInAppointment)
const APPT = { id: 'appt-1', patientId: 'pat-1', patient: { name: 'Ama Mensah' } }

function mount() {
  const onFinished = vi.fn()
  const utils = render(<CheckInFlow appointment={APPT} onFinished={onFinished} />)
  return { onFinished, ...utils }
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByText(name))

beforeEach(() => {
  mockCheckIn.mockReset()
  sheet.props = null
})
afterEach(() => vi.clearAllMocks())

describe('the payment sheet is told which visit it is for (F11)', () => {
  it('opens for the visit’s patient, carrying the appointment id, with the no-payment card', () => {
    mount()

    expect(screen.getByText('stub payment sheet')).toBeInTheDocument()
    expect(sheet.props).toMatchObject({
      open: true,
      presetPatientId: 'pat-1',
      appointmentId: 'appt-1',
      showNoPaymentOption: true,
    })
  })

  it('renders nothing while no visit is selected', () => {
    render(<CheckInFlow appointment={null} onFinished={vi.fn()} />)
    expect(screen.queryByText('stub payment sheet')).not.toBeInTheDocument()
    expect(sheet.props?.open).toBe(false)
  })
})

describe('a one-time payment is taken by the check-in request itself', () => {
  it('finishes without a second request', async () => {
    const { onFinished } = mount()
    click('one-time paid and checked in')

    await waitFor(() => expect(onFinished).toHaveBeenCalledWith('checked_in'))
    expect(mockCheckIn).not.toHaveBeenCalled()
  })
})

describe('after a plan or insurance payment, checking in is its own step', () => {
  it('checks in without claiming a payment of its own', async () => {
    mockCheckIn.mockResolvedValue({ success: true, data: { alreadyCheckedIn: false } } as never)
    const { onFinished } = mount()
    click('plan paid')

    await waitFor(() => expect(onFinished).toHaveBeenCalledWith('checked_in'))
    expect(mockCheckIn).toHaveBeenCalledTimes(1)
    expect(mockCheckIn).toHaveBeenCalledWith('appt-1', { paymentRecordedElsewhere: true })
  })

  it('an insurance claim (which reports success without closing the sheet) is handled the same', async () => {
    mockCheckIn.mockResolvedValue({ success: true, data: { alreadyCheckedIn: false } } as never)
    const { onFinished } = mount()
    click('insurance claim raised')

    await waitFor(() => expect(onFinished).toHaveBeenCalledWith('checked_in'))
    expect(mockCheckIn).toHaveBeenCalledWith('appt-1', { paymentRecordedElsewhere: true })
  })

  it('an already-checked-in answer still finishes (a colleague got there first)', async () => {
    mockCheckIn.mockResolvedValue({ success: true, data: { alreadyCheckedIn: true } } as never)
    const { onFinished } = mount()
    click('plan paid')

    await waitFor(() => expect(onFinished).toHaveBeenCalledWith('checked_in'))
  })
})

describe('when the payment is recorded but the check-in fails (F10)', () => {
  it('says so, does not claim success, and offers a retry that can never charge again', async () => {
    mockCheckIn.mockResolvedValueOnce({
      success: false,
      error: 'This appointment is already cancelled and can’t be checked in.',
      code: 'APPOINTMENT_TERMINAL',
    } as never)
    const { onFinished } = mount()
    click('plan paid')

    // The failure is shown…
    expect(
      await screen.findByRole('heading', { name: /payment recorded.*check-in failed/i })
    ).toBeInTheDocument()
    expect(screen.getByText(/already cancelled/i)).toBeInTheDocument()
    // …nothing reports success, and the payment sheet is not offered again.
    expect(onFinished).not.toHaveBeenCalled()
    expect(screen.queryByText('stub payment sheet')).not.toBeInTheDocument()

    // Retrying checks in only.
    mockCheckIn.mockResolvedValueOnce({ success: true, data: { alreadyCheckedIn: false } } as never)
    click(/check in again/i)

    await waitFor(() => expect(onFinished).toHaveBeenCalledWith('checked_in'))
    expect(mockCheckIn).toHaveBeenCalledTimes(2)
    for (const [, body] of mockCheckIn.mock.calls) {
      expect(body).toEqual({ paymentRecordedElsewhere: true })
      expect(body).not.toHaveProperty('payment')
    }
  })

  it('a network failure is handled the same way, not left unhandled', async () => {
    mockCheckIn.mockRejectedValueOnce(new Error('Network error'))
    const { onFinished } = mount()
    click('plan paid')

    expect(
      await screen.findByRole('heading', { name: /payment recorded.*check-in failed/i })
    ).toBeInTheDocument()
    expect(onFinished).not.toHaveBeenCalled()
  })

  it('choosing “not now” on the failure notice finishes as “payment only” so the screen refreshes', async () => {
    mockCheckIn.mockResolvedValueOnce({ success: false, error: 'boom' } as never)
    const { onFinished } = mount()
    click('plan paid')
    await screen.findByRole('heading', { name: /payment recorded.*check-in failed/i })

    click(/^not now$/i)
    expect(onFinished).toHaveBeenCalledWith('payment_only')
  })

  it('a double-click on retry sends one request', async () => {
    mockCheckIn.mockResolvedValueOnce({ success: false, error: 'boom' } as never)
    mount()
    click('plan paid')
    await screen.findByRole('heading', { name: /payment recorded.*check-in failed/i })

    let resolveRetry: (v: unknown) => void = () => {}
    mockCheckIn.mockImplementationOnce(
      () => new Promise((resolve) => (resolveRetry = resolve)) as never
    )
    const retry = screen.getByText(/check in again/i)
    fireEvent.click(retry)
    fireEvent.click(retry)
    await act(async () => resolveRetry({ success: true, data: { alreadyCheckedIn: false } }))

    expect(mockCheckIn).toHaveBeenCalledTimes(2) // the first failure + exactly one retry
  })
})

describe('no payment, and walking away', () => {
  it('“no payment” hands over to the reason dialog, which finishes the flow', async () => {
    const { onFinished } = mount()
    click('choose no payment')

    expect(screen.getByText('stub no-payment dialog')).toBeInTheDocument()
    click('no-payment confirmed')
    expect(onFinished).toHaveBeenCalledWith('checked_in')
  })

  it('closing the payment sheet without paying finishes as cancelled and takes no request', async () => {
    const { onFinished } = mount()
    click('close sheet')

    await waitFor(() => expect(onFinished).toHaveBeenCalledWith('cancelled'))
    expect(onFinished).toHaveBeenCalledTimes(1)
    expect(mockCheckIn).not.toHaveBeenCalled()
  })

  it('backing out of the no-payment dialog finishes as cancelled', async () => {
    const { onFinished } = mount()
    click('choose no payment')
    click('close no-payment')

    await waitFor(() => expect(onFinished).toHaveBeenCalledWith('cancelled'))
    expect(onFinished).toHaveBeenCalledTimes(1)
  })

  it('a sheet that closes itself and then reports success is NOT a cancellation', async () => {
    // Regression guard for the order the real sheets use: close, then onSuccess.
    const { onFinished } = mount()
    click('one-time paid and checked in')
    await new Promise((r) => setTimeout(r, 20)) // let any deferred close fire

    expect(onFinished).toHaveBeenCalledTimes(1)
    expect(onFinished).toHaveBeenCalledWith('checked_in')
  })
})
