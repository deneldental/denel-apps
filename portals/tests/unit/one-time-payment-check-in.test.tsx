/**
 * F10 / F11 — a one-time payment taken at check-in goes through the check-in
 * request, so payment, status and the doctor's note are all-or-nothing and the
 * payment names its visit.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (F10, F11).
 *
 * The sheet itself is real. Only its leaves are stubbed: the service-line editor
 * (a catalogue-driven control with its own tests; its price arithmetic stays real),
 * the payment-method lookup, the patient lookup, the receipt and the network.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/actions/appointments', () => ({ checkInAppointment: vi.fn() }))
vi.mock('@/lib/actions/payments', () => ({ createPayment: vi.fn() }))
vi.mock('@/lib/actions/patients', () => ({
  getPatient: vi.fn(async () => ({
    success: true,
    data: { id: 'pat-1', name: 'Ama Mensah', patientId: 'P-001' },
  })),
}))
vi.mock('@/shared/hooks/use-payment-methods', () => ({
  usePaymentMethods: () => ({
    methods: [{ id: 'm1', name: 'cash', displayName: 'Cash', isActive: true }],
    isLoading: false,
    error: null,
  }),
}))
vi.mock('@/shared/utils/receipt', () => ({ generatePaymentReceipt: vi.fn() }))
vi.mock('@/shared/components/service-lines-editor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/components/service-lines-editor')>()
  const scaling: import('@/shared/components/service-lines-editor').ServiceLine = {
    key: 't-1-0',
    serviceId: 't-1',
    name: 'Scaling',
    baseAmount: 15000,
    matrix: null,
    variantName: '',
    toothClassId: '',
    quantity: 1,
    discountEligible: false,
    surchargeType: 'none',
    surchargeValue: 0,
    discountType: 'none',
    discountValue: 0,
    discountReason: '',
  }
  return {
    ...actual,
    useServiceCatalog: () => [],
    ServiceLinesEditor: ({ setLines }: { setLines: (lines: unknown[]) => void }) => (
      <button type="button" onClick={() => setLines([scaling])}>
        add scaling
      </button>
    ),
  }
})
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import { OneTimePaymentSheet } from '@/features/payments/components/one-time-payment-sheet'
import { checkInAppointment } from '@/lib/actions/appointments'
import { createPayment } from '@/lib/actions/payments'
import { generatePaymentReceipt } from '@/shared/utils/receipt'
import { renderWithRouter } from './_test-utils'

const mockCheckIn = vi.mocked(checkInAppointment)
const mockCreatePayment = vi.mocked(createPayment)
const { toast } = await import('sonner')

beforeAll(() => {
  // Radix Select/Sheet lean on pointer-capture, scrolling and ResizeObserver, which jsdom lacks.
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

function mount(extra: Record<string, unknown> = {}) {
  const onSuccess = vi.fn()
  const onOpenChange = vi.fn()
  renderWithRouter(
    <OneTimePaymentSheet
      open
      onOpenChange={onOpenChange}
      onSuccess={onSuccess}
      presetPatientId="pat-1"
      {...extra}
    />
  )
  return { onSuccess, onOpenChange }
}

async function fillAndSubmit() {
  fireEvent.click(await screen.findByText('add scaling'))
  const submit = screen.getByRole('button', { name: /record payment/i })
  await waitFor(() => expect(submit).toBeEnabled())
  fireEvent.click(submit)
}

beforeEach(() => {
  mockCheckIn.mockReset()
  mockCreatePayment.mockReset()
})
afterEach(() => vi.clearAllMocks())

describe('at check-in (the sheet is told the visit)', () => {
  it('sends the payment THROUGH the check-in request and never to /payments directly', async () => {
    mockCheckIn.mockResolvedValue({
      success: true,
      data: { alreadyCheckedIn: false, payment: { id: 'pay-1' }, appointment: {} },
    } as never)
    const { onSuccess, onOpenChange } = mount({ appointmentId: 'appt-1' })
    await fillAndSubmit()

    await waitFor(() => expect(mockCheckIn).toHaveBeenCalledTimes(1))
    expect(mockCreatePayment).not.toHaveBeenCalled()

    const [id, body] = mockCheckIn.mock.calls[0] as [string, { payment: Record<string, unknown> }]
    expect(id).toBe('appt-1')
    expect(body.payment).toMatchObject({
      amount: 15000,
      method: 'cash',
      description: 'Scaling',
      sendNotification: true,
      treatments: [{ treatmentId: 't-1', name: 'Scaling', amount: 15000 }],
    })
    // The patient is the visit's own: the request does not name one.
    expect(body.payment).not.toHaveProperty('patientId')

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ checkedIn: true }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(generatePaymentReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: 'pay-1', amountPaid: 15000 })
    )
  })

  it('a failed check-in request records nothing: the sheet stays open and reports the error', async () => {
    mockCheckIn.mockResolvedValue({
      success: false,
      error: 'This appointment is already cancelled and can’t be checked in.',
    } as never)
    const { onSuccess, onOpenChange } = mount({ appointmentId: 'appt-1' })
    await fillAndSubmit()

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(generatePaymentReceipt).not.toHaveBeenCalled()
  })

  it('a visit that was already checked in takes no payment, says so, and prints no receipt', async () => {
    mockCheckIn.mockResolvedValue({
      success: true,
      data: { alreadyCheckedIn: true, payment: null, appointment: {} },
    } as never)
    const { onSuccess } = mount({ appointmentId: 'appt-1' })
    await fillAndSubmit()

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ checkedIn: true }))
    expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/already checked in/i))
    expect(generatePaymentReceipt).not.toHaveBeenCalled()
  })

  it('a failed receipt SMS is reported next to the success, not as a failure', async () => {
    mockCheckIn.mockResolvedValue({
      success: true,
      smsError: 'Hubtel credentials not configured',
      data: { alreadyCheckedIn: false, payment: { id: 'pay-1' }, appointment: {} },
    } as never)
    const { onSuccess } = mount({ appointmentId: 'appt-1' })
    await fillAndSubmit()

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ checkedIn: true }))
    expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/SMS failed/i))
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('outside check-in (no visit given) nothing changes', () => {
  it('still records an ordinary payment through /payments, and never calls check-in', async () => {
    mockCreatePayment.mockResolvedValue({ success: true, data: { id: 'pay-9' } } as never)
    const { onSuccess } = mount()
    await fillAndSubmit()

    await waitFor(() => expect(mockCreatePayment).toHaveBeenCalledTimes(1))
    expect(mockCheckIn).not.toHaveBeenCalled()
    expect(mockCreatePayment.mock.calls[0][0]).toMatchObject({
      patientId: 'pat-1',
      sources: [{ method: 'cash', amount: 15000 }],
    })
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(onSuccess.mock.calls[0][0]?.checkedIn).toBeFalsy()
  })
})

// F33 — a walk-in is created already checked in, so its payment must not go through
// the check-in request (which would answer "already checked in" and take no money).
// The sheet is told only which visit to NAME, and records an ordinary payment.
describe('for a walk-in already checked in (F33: name the visit, no check-in)', () => {
  it('records an ordinary payment that names the visit, and never calls check-in', async () => {
    mockCreatePayment.mockResolvedValue({ success: true, data: { id: 'pay-7' } } as never)
    const { onSuccess } = mount({ linkAppointmentId: 'walk-1' })
    await fillAndSubmit()

    await waitFor(() => expect(mockCreatePayment).toHaveBeenCalledTimes(1))
    expect(mockCheckIn).not.toHaveBeenCalled()
    expect(mockCreatePayment.mock.calls[0][0]).toMatchObject({
      patientId: 'pat-1',
      appointmentId: 'walk-1',
      sources: [{ method: 'cash', amount: 15000 }],
    })
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    // It was not a check-in, so it must not claim to be one.
    expect(onSuccess.mock.calls[0][0]?.checkedIn).toBeFalsy()
    expect(toast.success).toHaveBeenCalledWith('Payment recorded successfully')
  })

  it('an ordinary payment with no visit still names none', async () => {
    mockCreatePayment.mockResolvedValue({ success: true, data: { id: 'pay-8' } } as never)
    mount()
    await fillAndSubmit()
    await waitFor(() => expect(mockCreatePayment).toHaveBeenCalledTimes(1))
    expect(mockCreatePayment.mock.calls[0][0]).not.toHaveProperty('appointmentId')
  })
})
