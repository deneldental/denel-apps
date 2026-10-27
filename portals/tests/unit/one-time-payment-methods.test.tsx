/**
 * G03 — the one-time payment sheet takes a payment across more than one method.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (G03) and step-10-handover.md.
 *
 * One method is still the common case and costs no extra clicks: the sheet starts with cash for the
 * whole total. Adding a second method is a deliberate split, so the first amount stops following
 * the total, and the sheet only records the payment once the methods add up to the services EXACTLY.
 * The request carries `sources` in pesewas, never a total of its own. At check-in the payment
 * travels inside the check-in request, which takes one method, so no second method is offered there.
 *
 * The sheet and the editor are real. Only the network, the payment-method lookup and the receipt are
 * stubbed.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/actions/appointments', () => ({ checkInAppointment: vi.fn() }))
vi.mock('@/lib/actions/payments', () => ({ createPayment: vi.fn() }))
vi.mock('@/lib/actions/patients', () => ({ getPatient: vi.fn() }))
vi.mock('@/lib/actions/services', () => ({ getServices: vi.fn(), getServiceMatrix: vi.fn() }))
const lookup = vi.hoisted(() => ({
  methods: [] as Array<{ id: string; name: string; displayName: string; isActive: boolean }>,
}))
vi.mock('@/shared/hooks/use-payment-methods', () => ({
  usePaymentMethods: () => ({ methods: lookup.methods, isLoading: false, error: null }),
}))
vi.mock('@/shared/utils/receipt', () => ({ generatePaymentReceipt: vi.fn() }))
vi.mock('@/shared/components/patient-picker', () => ({
  PatientPicker: () => <div>patient picker</div>,
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import { OneTimePaymentSheet } from '@/features/payments/components/one-time-payment-sheet'
import { checkInAppointment } from '@/lib/actions/appointments'
import { getPatient } from '@/lib/actions/patients'
import { createPayment } from '@/lib/actions/payments'
import { getServiceMatrix, getServices } from '@/lib/actions/services'
import { formatCurrency } from '@/shared/utils/currency'
import { generatePaymentReceipt } from '@/shared/utils/receipt'
import { addService, CATALOGUE, installRadixPolyfills, matrixFor } from './_service-lines-kit'
import { renderWithRouter } from './_test-utils'

const { toast } = await import('sonner')

beforeAll(installRadixPolyfills)

const CASH = { id: 'm1', name: 'cash', displayName: 'Cash', isActive: true }
const CARD = { id: 'm2', name: 'card', displayName: 'Card', isActive: true }
const MOMO = { id: 'm3', name: 'momo', displayName: 'Mobile Money', isActive: true }
const INSURANCE = { id: 'm4', name: 'insurance', displayName: 'Insurance', isActive: true }
const WALLET = { id: 'm5', name: 'wallet', displayName: 'Wallet credit', isActive: true }

beforeEach(() => {
  lookup.methods = [CASH, CARD, MOMO, INSURANCE]
  vi.mocked(getServices).mockResolvedValue({ success: true, data: CATALOGUE })
  vi.mocked(getServiceMatrix).mockImplementation(async (id: string) => ({
    success: true,
    data: matrixFor(id),
  }))
  vi.mocked(getPatient).mockResolvedValue({
    success: true,
    data: { id: 'pat-1', name: 'Ama Mensah', patientId: 'P-001' },
  } as never)
  vi.mocked(createPayment).mockResolvedValue({ success: true, data: { id: 'pay-1' } } as never)
})
afterEach(() => vi.resetAllMocks())

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

const recordButton = () => screen.getByRole('button', { name: /record payment/i })
const methodSelect = (n: number) => screen.getByRole('combobox', { name: `Payment method ${n}` })
const amountBox = (n: number) => screen.getByLabelText(`Amount for payment method ${n}`)
const addMethodButton = () => screen.getByRole('button', { name: /add payment method/i })

/** Put `text` in the amount box of the n-th method. */
function typeAmount(n: number, text: string) {
  fireEvent.change(amountBox(n), { target: { value: text } })
}

/** Add the Scaling service (150.00) and wait for the first method to take its total. */
async function startWithScaling() {
  await addService(/^Scaling/)
  await waitFor(() => expect(amountBox(1)).toHaveValue(150))
}

describe('one method, the common case', () => {
  it('starts with cash for the whole total, which cannot be typed over', async () => {
    mount()
    await startWithScaling()

    expect(methodSelect(1)).toHaveTextContent('Cash')
    expect(amountBox(1)).toBeDisabled()
    expect(screen.queryByLabelText('Amount for payment method 2')).not.toBeInTheDocument()
  })

  it('prefers cash when it is set up, wherever it sits in the list', async () => {
    lookup.methods = [CARD, CASH, MOMO]
    mount()
    await addService(/^Scaling/)
    await waitFor(() => expect(amountBox(1)).toHaveValue(150))

    expect(methodSelect(1)).toHaveTextContent('Cash')
  })

  it('starts with the first method a desk can take when cash is not set up, never insurance', async () => {
    lookup.methods = [INSURANCE, CARD, MOMO]
    mount()
    await addService(/^Scaling/)
    await waitFor(() => expect(amountBox(1)).toHaveValue(150))

    expect(methodSelect(1)).toHaveTextContent('Card')
  })

  it('follows the total as services are added', async () => {
    mount()
    await startWithScaling()
    await addService(/^Acrylic Denture/)

    await waitFor(() => expect(amountBox(1)).toHaveValue(850))
  })

  it('records it as one method with the whole total, in pesewas', async () => {
    mount()
    await startWithScaling()
    await waitFor(() => expect(recordButton()).toBeEnabled())
    fireEvent.click(recordButton())

    await waitFor(() => expect(createPayment).toHaveBeenCalledTimes(1))
    const sent = vi.mocked(createPayment).mock.calls[0][0] as unknown as Record<string, unknown>
    expect(sent.sources).toEqual([{ method: 'cash', amount: 15000 }])
    // The methods ARE the amount: no total of its own for the server to disagree with.
    expect(sent).not.toHaveProperty('amount')
    expect(sent).not.toHaveProperty('method')
  })
})

describe('adding a second method', () => {
  it('offers the next method that is free, never insurance, and each method once', async () => {
    mount()
    await startWithScaling()

    fireEvent.click(addMethodButton())
    expect(methodSelect(2)).toHaveTextContent('Card')

    // The first row can switch to a method nobody else has, but not to Card (taken) or Insurance.
    fireEvent.click(methodSelect(1))
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent)
    expect(options).toEqual(['Cash', 'Mobile Money'])
  })

  // Review §8.16: a one-time payment pays no invoice, so wallet credit would pay nothing (the
  // server refuses it); the desk is not offered it.
  it('never offers the wallet, and never starts with it', async () => {
    lookup.methods = [WALLET, CARD, MOMO]
    mount()
    await startWithScaling()
    expect(methodSelect(1)).toHaveTextContent('Card')

    fireEvent.click(addMethodButton())
    expect(methodSelect(2)).toHaveTextContent('Mobile Money')
    fireEvent.click(methodSelect(1))
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent)
    expect(options).not.toContain('Wallet credit')
  })

  it('stops the first amount following the total, and says what is left or over', async () => {
    mount()
    await startWithScaling()
    fireEvent.click(addMethodButton())

    expect(amountBox(1)).toBeEnabled()
    typeAmount(1, '100')
    expect(screen.getByText(`${formatCurrency(5000)} remaining`)).toBeInTheDocument()

    typeAmount(2, '30')
    expect(screen.getByText(`${formatCurrency(2000)} remaining`)).toBeInTheDocument()

    typeAmount(2, '60')
    expect(screen.getByText(`${formatCurrency(1000)} over`)).toBeInTheDocument()

    typeAmount(2, '50')
    expect(screen.getByText('Fully allocated')).toBeInTheDocument()

    // A service added later does not rewrite what the cashier typed.
    await addService(/^Crown/)
    expect(amountBox(1)).toHaveValue(100)
    expect(amountBox(2)).toHaveValue(50)
  })

  it('stops offering new methods once every one is in use', async () => {
    mount()
    await startWithScaling()

    fireEvent.click(addMethodButton())
    fireEvent.click(addMethodButton())

    // Cash, Card and Mobile Money; Insurance is never a method of a desk payment.
    expect(addMethodButton()).toBeDisabled()
  })

  it('goes back to one method that follows the total when the second is put away', async () => {
    mount()
    await startWithScaling()
    fireEvent.click(addMethodButton())
    typeAmount(1, '100')

    fireEvent.click(screen.getByRole('button', { name: 'Remove payment method 2' }))

    await waitFor(() => expect(amountBox(1)).toBeDisabled())
    expect(amountBox(1)).toHaveValue(150)
    expect(screen.queryByLabelText('Amount for payment method 2')).not.toBeInTheDocument()
  })

  it('offers no way to put the only method away', async () => {
    mount()
    await startWithScaling()
    expect(screen.queryByRole('button', { name: /remove payment method/i })).not.toBeInTheDocument()
  })
})

describe('recording a split', () => {
  async function splitScaling() {
    await startWithScaling()
    fireEvent.click(addMethodButton())
    typeAmount(1, '100')
    typeAmount(2, '50')
    await waitFor(() => expect(recordButton()).toBeEnabled())
  }

  it('sends one request with each method and its amount in pesewas', async () => {
    mount()
    await splitScaling()
    fireEvent.click(recordButton())

    await waitFor(() => expect(createPayment).toHaveBeenCalledTimes(1))
    const sent = vi.mocked(createPayment).mock.calls[0][0] as unknown as Record<string, unknown>
    expect(sent).toMatchObject({
      patientId: 'pat-1',
      sources: [
        { method: 'cash', amount: 10000 },
        { method: 'card', amount: 5000 },
      ],
      description: 'Scaling',
      treatments: [{ treatmentId: 'svc-scale', name: 'Scaling', amount: 15000 }],
      sendNotification: true,
    })
    expect(sent).not.toHaveProperty('amount')
    expect(sent).not.toHaveProperty('method')
  })

  it('starts again with a single method when it is opened again after being closed mid-split', async () => {
    const props = { onOpenChange: vi.fn(), onSuccess: vi.fn(), presetPatientId: 'pat-1' }
    const { rerender } = renderWithRouter(<OneTimePaymentSheet open {...props} />)
    await startWithScaling()
    fireEvent.click(addMethodButton())
    typeAmount(1, '100')
    expect(amountBox(2)).toBeInTheDocument()

    rerender(<OneTimePaymentSheet open={false} {...props} />)
    rerender(<OneTimePaymentSheet open {...props} />)

    await waitFor(() =>
      expect(screen.queryByLabelText('Amount for payment method 2')).not.toBeInTheDocument()
    )
    expect(amountBox(1)).toBeDisabled()
  })

  it('starts again with a single method once a split has been recorded', async () => {
    mount()
    await splitScaling()
    fireEvent.click(recordButton())

    await waitFor(() => expect(createPayment).toHaveBeenCalledTimes(1))
    // The form is cleared: no services, and one method that follows the (now empty) total.
    expect(await screen.findByText('No services added yet.')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByLabelText('Amount for payment method 2')).not.toBeInTheDocument()
    )
    expect(amountBox(1)).toBeDisabled()
    expect(amountBox(1)).toHaveValue(0)
  })

  it('prints one receipt for the whole payment, naming every method', async () => {
    const { onSuccess } = mount()
    await splitScaling()
    fireEvent.click(recordButton())

    await waitFor(() => expect(generatePaymentReceipt).toHaveBeenCalledTimes(1))
    expect(generatePaymentReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'pay-1',
        amountPaid: 15000,
        paymentMethod: 'Cash + Card',
        paymentType: 'one-time',
      })
    )
    expect(onSuccess).toHaveBeenCalled()
  })

  it('does not record while the methods fall short, and says by how much', async () => {
    mount()
    await startWithScaling()
    fireEvent.click(addMethodButton())
    typeAmount(1, '100')
    typeAmount(2, '30')
    fireEvent.click(recordButton())

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        `Payment methods total ${formatCurrency(13000)} but services total ${formatCurrency(15000)}`
      )
    )
    expect(createPayment).not.toHaveBeenCalled()
  })

  it('does not record while the methods run over', async () => {
    mount()
    await startWithScaling()
    fireEvent.click(addMethodButton())
    typeAmount(1, '100')
    typeAmount(2, '60')
    fireEvent.click(recordButton())

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        `Payment methods total ${formatCurrency(16000)} but services total ${formatCurrency(15000)}`
      )
    )
    expect(createPayment).not.toHaveBeenCalled()
  })

  it('does not record a method that has been left without an amount', async () => {
    mount()
    await startWithScaling()
    fireEvent.click(addMethodButton())
    // The first method covers the whole total, so the sum is right; the second is left empty.
    typeAmount(1, '150')
    fireEvent.click(recordButton())

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Each payment method needs an amount above 0')
    )
    expect(createPayment).not.toHaveBeenCalled()
  })

  it('records a split to the minute: amounts that floating point cannot hold add up exactly', async () => {
    mount()
    await addService(/^Scaling/)
    await waitFor(() => expect(amountBox(1)).toHaveValue(150))
    fireEvent.click(addMethodButton())
    typeAmount(1, '149.9')
    typeAmount(2, '0.10')
    await waitFor(() => expect(recordButton()).toBeEnabled())
    fireEvent.click(recordButton())

    await waitFor(() => expect(createPayment).toHaveBeenCalledTimes(1))
    const sent = vi.mocked(createPayment).mock.calls[0][0] as unknown as {
      sources: Array<{ amount: number }>
    }
    expect(sent.sources.map((s) => s.amount)).toEqual([14990, 10])
  })

  it('names the visit of a walk-in on a split too', async () => {
    mount({ linkAppointmentId: 'walk-1' })
    await splitScaling()
    fireEvent.click(recordButton())

    await waitFor(() => expect(createPayment).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createPayment).mock.calls[0][0]).toMatchObject({
      appointmentId: 'walk-1',
      sources: [
        { method: 'cash', amount: 10000 },
        { method: 'card', amount: 5000 },
      ],
    })
  })
})

describe('at check-in', () => {
  it('offers one method only, because the check-in request takes one payment', async () => {
    mount({ appointmentId: 'appt-1' })
    await startWithScaling()

    expect(screen.queryByRole('button', { name: /add payment method/i })).not.toBeInTheDocument()
  })

  it('sends that one method and the whole total inside the check-in request', async () => {
    vi.mocked(checkInAppointment).mockResolvedValue({
      success: true,
      data: { alreadyCheckedIn: false, payment: { id: 'pay-5' }, appointment: {} },
    } as never)
    mount({ appointmentId: 'appt-1' })
    await startWithScaling()
    await waitFor(() => expect(recordButton()).toBeEnabled())
    fireEvent.click(recordButton())

    await waitFor(() => expect(checkInAppointment).toHaveBeenCalledTimes(1))
    const [, body] = vi.mocked(checkInAppointment).mock.calls[0] as unknown as [
      string,
      { payment: Record<string, unknown> },
    ]
    expect(body.payment).toMatchObject({ amount: 15000, method: 'cash' })
    expect(body.payment).not.toHaveProperty('sources')
    expect(createPayment).not.toHaveBeenCalled()
  })
})

describe('the fixed footer', () => {
  it('keeps the total, the line breakdown, the text message choice and the buttons out of the scrolling body', async () => {
    mount()
    await startWithScaling()
    await addService(/^Crown/)

    const body = screen.getByText('Add service').closest('.overflow-y-auto') as HTMLElement
    expect(body).toBeTruthy()
    const footer = recordButton().closest('.border-t') as HTMLElement
    expect(footer).toBeTruthy()
    expect(body).not.toContainElement(footer)

    // The footer carries the grand total and what each line comes to.
    expect(within(footer).getByText('Total').nextElementSibling).toHaveTextContent(
      formatCurrency(75000)
    )
    expect(within(footer).getByText('Scaling')).toBeInTheDocument()
    expect(within(footer).getByText(formatCurrency(15000))).toBeInTheDocument()
    expect(within(footer).getByText('Crown')).toBeInTheDocument()
    expect(within(footer).getByText(formatCurrency(60000))).toBeInTheDocument()
    expect(within(footer).getByLabelText(/send payment notification/i)).toBeInTheDocument()
    expect(within(footer).getByRole('button', { name: /back/i })).toBeInTheDocument()
  })

  it('shows no line breakdown until there is a line to break down', async () => {
    mount()
    const footer = (await screen.findByRole('button', { name: /record payment/i })).closest(
      '.border-t'
    ) as HTMLElement
    expect(within(footer).getByText('Total').nextElementSibling).toHaveTextContent(
      formatCurrency(0)
    )
    expect(footer.querySelector('.max-h-24')).toBeNull()
  })
})
