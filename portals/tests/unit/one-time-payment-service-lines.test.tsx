/**
 * G02 — the one-time payment sheet builds its lines with the shared service-line editor.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (G02) and step-10-handover.md.
 *
 * The sheet used to take a free amount for each "treatment". It now prices each line from the
 * catalogue and pricing matrix, with an optional surcharge or discount, exactly as an estimate does,
 * and records what the lines come to. The payment the sheet sends is the only record of that price
 * (nothing on the server re-prices a one-time payment), so these tests pin the amount, the
 * itemisation and the guards on it. How the sheet takes a payment at check-in is pinned in
 * `one-time-payment-check-in.test.tsx`.
 *
 * The sheet and the editor are real. Only the network, the payment-method lookup and the receipt
 * are stubbed.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
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
import { getPatient } from '@/lib/actions/patients'
import { createPayment } from '@/lib/actions/payments'
import { getServiceMatrix, getServices } from '@/lib/actions/services'
import { formatCurrency } from '@/shared/utils/currency'
import { generatePaymentReceipt } from '@/shared/utils/receipt'
import {
  addService,
  choose,
  group,
  installRadixPolyfills,
  matrixFor,
  CATALOGUE as SERVICES,
} from './_service-lines-kit'
import { renderWithRouter } from './_test-utils'

const { toast } = await import('sonner')

/** A consultation that costs nothing: it can be on an estimate, but there is nothing to take for it. */
const FREE_REVIEW = { id: 'svc-free', name: 'Free review', amount: 0, category: 'preventive' }
const CATALOGUE = [...SERVICES, FREE_REVIEW]

beforeAll(installRadixPolyfills)

beforeEach(() => {
  lookup.methods = [{ id: 'm1', name: 'cash', displayName: 'Cash', isActive: true }]
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

async function record() {
  await waitFor(() => expect(recordButton()).toBeEnabled())
  fireEvent.click(recordButton())
}

describe('what the sheet records', () => {
  it('records the amount the lines come to, and each line as a treatment named with its variant', async () => {
    mount()
    await addService(/^Acrylic Denture/)
    await choose('Variant', 'Standard')
    fireEvent.change(
      await screen.findByRole('spinbutton', { name: 'Quantity of Acrylic Denture' }),
      {
        target: { value: '2' },
      }
    )
    await record()

    await waitFor(() => expect(createPayment).toHaveBeenCalledTimes(1))
    // 2 x 800.00 (the Standard variant, not the 700.00 catalogue price).
    expect(createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 'pat-1',
        sources: [{ method: 'cash', amount: 160000 }],
        description: 'Acrylic Denture (Standard)',
        sendNotification: true,
        treatments: [
          { treatmentId: 'svc-denture', name: 'Acrylic Denture (Standard)', amount: 160000 },
        ],
      })
    )
    expect(generatePaymentReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'pay-1',
        amountPaid: 160000,
        description: 'Acrylic Denture (Standard)',
      })
    )
  })

  it('names the tooth class on the line as well as the variant', async () => {
    mount()
    await addService(/^Crown/)
    await choose('Tooth class', 'Molar')
    await record()

    await waitFor(() => expect(createPayment).toHaveBeenCalledTimes(1))
    expect(createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: [{ method: 'cash', amount: 90000 }],
        description: 'Crown (Molar)',
        treatments: [{ treatmentId: 'svc-crown', name: 'Crown (Molar)', amount: 90000 }],
      })
    )
  })

  it('names a line by its service alone once its variant and tooth class are put back', async () => {
    mount()
    await addService(/^Acrylic Denture/)
    await choose('Variant', 'Standard')
    await choose('Variant', 'Default')
    await addService(/^Crown/)
    await choose('Tooth class', 'Molar')
    await choose('Tooth class', 'Any')
    await record()

    await waitFor(() => expect(createPayment).toHaveBeenCalledTimes(1))
    // Back at the catalogue prices, with nothing but the service names on the receipt.
    expect(createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: [{ method: 'cash', amount: 70000 + 60000 }],
        description: 'Acrylic Denture, Crown',
        treatments: [
          { treatmentId: 'svc-denture', name: 'Acrylic Denture', amount: 70000 },
          { treatmentId: 'svc-crown', name: 'Crown', amount: 60000 },
        ],
      })
    )
  })

  it('puts the notes after the service names in the description', async () => {
    mount()
    await addService(/^Scaling/)
    await addService(/^Acrylic Denture/)
    fireEvent.change(screen.getByLabelText(/additional notes/i), {
      target: { value: 'Paid in full' },
    })
    await record()

    await waitFor(() => expect(createPayment).toHaveBeenCalledTimes(1))
    expect(createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: [{ method: 'cash', amount: 15000 + 70000 }],
        description: 'Scaling, Acrylic Denture - Paid in full',
        treatments: [
          { treatmentId: 'svc-scale', name: 'Scaling', amount: 15000 },
          { treatmentId: 'svc-denture', name: 'Acrylic Denture', amount: 70000 },
        ],
      })
    )
  })

  it('takes a surcharge and a discount into the amount and into the line it is recorded on', async () => {
    mount()
    await addService(/^Scaling/)
    await choose('Surcharge Type', 'Percent (%)')
    fireEvent.change(
      (await group('Surcharge Type')).querySelector('input[type="number"]') as HTMLElement,
      { target: { value: '10' } }
    )
    await choose('Discount Type', 'Amount (GHS)')
    fireEvent.change(
      (await group('Discount Type')).querySelector('input[type="number"]') as HTMLElement,
      { target: { value: '5' } }
    )
    await record()

    // 150.00 + 10% surcharge (15.00) - 5.00 discount.
    await waitFor(() => expect(createPayment).toHaveBeenCalledTimes(1))
    expect(createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: [{ method: 'cash', amount: 16000 }],
        treatments: [{ treatmentId: 'svc-scale', name: 'Scaling', amount: 16000 }],
      })
    )
  })

  it('shows the total of the lines before anything is recorded', async () => {
    mount()
    await addService(/^Scaling/)
    await addService(/^Acrylic Denture/)

    expect(screen.getByText('Total').nextElementSibling).toHaveTextContent(formatCurrency(85000))
    expect(createPayment).not.toHaveBeenCalled()
  })

  it('names the visit when told which one, as before', async () => {
    mount({ linkAppointmentId: 'walk-1' })
    await addService(/^Scaling/)
    await record()

    await waitFor(() => expect(createPayment).toHaveBeenCalledTimes(1))
    expect(createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 'pat-1',
        appointmentId: 'walk-1',
        sources: [{ method: 'cash', amount: 15000 }],
      })
    )
  })
})

describe('what the sheet refuses to record', () => {
  const formOfSheet = () => recordButton().closest('form') as HTMLFormElement

  it('records nothing for no services', async () => {
    mount()
    expect(await screen.findByText('No services added yet.')).toBeInTheDocument()
    expect(recordButton()).toBeDisabled()

    // A form can still be submitted from the keyboard.
    fireEvent.submit(formOfSheet())
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Please add at least one service'))
    expect(createPayment).not.toHaveBeenCalled()
  })

  it('records nothing for a service that comes to nothing', async () => {
    mount()
    await addService(/^Free review/)
    await record()

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'All services must have a valid amount greater than 0'
      )
    )
    expect(createPayment).not.toHaveBeenCalled()
  })

  it('records nothing when no payment method is available', async () => {
    lookup.methods = []
    mount()
    await addService(/^Scaling/)
    expect(recordButton()).toBeDisabled()

    fireEvent.submit(formOfSheet())
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Please select a payment method'))
    expect(createPayment).not.toHaveBeenCalled()
  })

  it('records nothing for a patient who has not been chosen', async () => {
    mount({ presetPatientId: undefined })
    await addService(/^Scaling/)
    await record()

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Please select a patient'))
    expect(createPayment).not.toHaveBeenCalled()
  })

  it('asks first about a surcharge that more than doubles a line, and records nothing until agreed', async () => {
    mount()
    await addService(/^Scaling/)
    await choose('Surcharge Type', 'Percent (%)')
    // 150% of the line: more than the line itself, so it is probably a mistyped value.
    fireEvent.change(
      (await group('Surcharge Type')).querySelector('input[type="number"]') as HTMLElement,
      { target: { value: '150' } }
    )
    await record()

    expect(await screen.findByText('Large surcharge')).toBeInTheDocument()
    expect(createPayment).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Add anyway' }))
    await waitFor(() => expect(createPayment).toHaveBeenCalledTimes(1))
    expect(createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ sources: [{ method: 'cash', amount: 15000 + 22500 }] })
    )
  })

  it('leaves a payment that the server refused unrecorded: the sheet stays open and says why', async () => {
    vi.mocked(createPayment).mockResolvedValue({
      success: false,
      error: 'No such patient',
    } as never)
    const { onOpenChange, onSuccess } = mount()
    await addService(/^Scaling/)
    await record()

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('No such patient'))
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(onSuccess).not.toHaveBeenCalled()
    expect(generatePaymentReceipt).not.toHaveBeenCalled()
  })
})

describe('starting clean', () => {
  it('has no services left over once a payment has been recorded', async () => {
    mount()
    await addService(/^Scaling/)
    await record()

    await waitFor(() => expect(createPayment).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('No services added yet.')).toBeInTheDocument()
    expect(screen.getByText('Total').nextElementSibling).toHaveTextContent(formatCurrency(0))
  })

  it('has no services left over when it is opened again', async () => {
    const props = { onOpenChange: vi.fn(), onSuccess: vi.fn(), presetPatientId: 'pat-1' }
    const { rerender } = renderWithRouter(<OneTimePaymentSheet open {...props} />)
    await addService(/^Scaling/)

    rerender(<OneTimePaymentSheet open={false} {...props} />)
    rerender(<OneTimePaymentSheet open {...props} />)

    expect(await screen.findByText('No services added yet.')).toBeInTheDocument()
  })
})

describe('closing the sheet', () => {
  it('asks before throwing away services that were added', async () => {
    // No preset patient, so the services are the only thing there is to lose.
    const { onOpenChange } = mount({ presetPatientId: undefined })
    await addService(/^Scaling/)

    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(await screen.findByText('Discard unsaved changes?')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('closes without asking when nothing was chosen or added', async () => {
    // (With a preset patient the form counts as started from the first moment, as it always did.)
    const { onOpenChange } = mount({ presetPatientId: undefined })
    await screen.findByText('No services added yet.')

    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(screen.queryByText('Discard unsaved changes?')).not.toBeInTheDocument()
  })
})
