/**
 * G02 — the create-estimate sheet builds its lines with the shared service-line editor.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (G02) and step-10-handover.md.
 *
 * The sheet had no test of its own. These pin what it sends to the server and how it gates, so that
 * moving its line editor into `shared/components/service-lines-editor` changes nothing a doctor sees:
 * the quantity, variant, tooth class, surcharge and discount reach the server in the units it expects
 * (pesewas), a surcharge that more than doubles a line is confirmed first, and a refusal is shown.
 *
 * The sheet and the editor are real. Only the network and the patient lookup are stubbed.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addService,
  choose,
  group,
  installRadixPolyfills,
  matrixFor,
  CATALOGUE as SERVICES,
} from './_service-lines-kit'

vi.mock('@/lib/actions/services', () => ({ getServices: vi.fn(), getServiceMatrix: vi.fn() }))
vi.mock('@/lib/actions/worklist', () => ({
  createEstimate: vi.fn(),
  createStandaloneEstimate: vi.fn(),
}))
vi.mock('@/shared/components/patient-picker', () => ({
  PatientPicker: ({ onChange }: { onChange: (id: string) => void }) => (
    <button type="button" onClick={() => onChange('pat-9')}>
      Pick patient
    </button>
  ),
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import { CreateEstimateSheet } from '@/features/activity/components/create-estimate-sheet'
import { getServiceMatrix, getServices } from '@/lib/actions/services'
import { createEstimate, createStandaloneEstimate } from '@/lib/actions/worklist'
import { formatCurrency } from '@/shared/utils/currency'
import { renderWithRouter } from './_test-utils'

const { toast } = await import('sonner')

/** The catalogue as the server lists it: an insurance service is among it, and is never offered. */
const CATALOGUE = [
  ...SERVICES,
  { id: 'svc-claim', name: 'Insurer claim', amount: 1, category: 'insurance' },
]

beforeAll(installRadixPolyfills)

beforeEach(() => {
  vi.mocked(getServices).mockResolvedValue({ success: true, data: CATALOGUE })
  vi.mocked(getServiceMatrix).mockImplementation(async (id: string) => ({
    success: true,
    data: matrixFor(id),
  }))
})
afterEach(() => vi.resetAllMocks())

function mount(extra: Record<string, unknown> = {}) {
  const onOpenChange = vi.fn()
  const onCreated = vi.fn()
  renderWithRouter(
    <CreateEstimateSheet
      open
      onOpenChange={onOpenChange}
      onCreated={onCreated}
      appointmentId="appt-1"
      patientId="pat-1"
      patientName="Ama Mensah"
      {...extra}
    />
  )
  return { onOpenChange, onCreated }
}

describe('what the sheet offers', () => {
  it('lists the active catalogue by name and leaves out insurance services', async () => {
    mount()
    fireEvent.click(await screen.findByText(/add a service from the catalog/i))

    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual([
      `Acrylic Denture · ${formatCurrency(70000)}`,
      `Crown · ${formatCurrency(60000)}`,
      `Scaling · ${formatCurrency(15000)}`,
    ])
  })

  it('does not let the same service be added twice', async () => {
    mount()
    await addService(/^Scaling/)

    fireEvent.click(screen.getByText(/add a service from the catalog/i))
    expect(await screen.findByRole('option', { name: /^Scaling/ })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
  })

  it('waits for a service before it can create anything, then totals the lines', async () => {
    mount()
    const create = await screen.findByRole('button', { name: /create estimate/i })
    expect(create).toBeDisabled()

    await addService(/^Scaling/)
    await waitFor(() => expect(create).toBeEnabled())
    // The total sits in the "Estimated total" row.
    expect(screen.getByText('Estimated total').nextElementSibling).toHaveTextContent(
      formatCurrency(15000)
    )
  })
})

describe('starting clean', () => {
  it('has no services or note left over when it is opened again', async () => {
    const props = {
      onOpenChange: vi.fn(),
      onCreated: vi.fn(),
      appointmentId: 'appt-1',
      patientId: 'pat-1',
    }
    const { rerender } = renderWithRouter(<CreateEstimateSheet open {...props} />)
    await addService(/^Scaling/)
    fireEvent.change(screen.getByPlaceholderText(/anything reception should know/i), {
      target: { value: 'Left over' },
    })

    rerender(<CreateEstimateSheet open={false} {...props} />)
    rerender(<CreateEstimateSheet open {...props} />)

    expect(await screen.findByText('No services added yet.')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/anything reception should know/i)).toHaveValue('')
  })
})

describe('what the sheet sends', () => {
  it('sends the quantity, variant, surcharge and discount a doctor set, in pesewas', async () => {
    vi.mocked(createEstimate).mockResolvedValue({ success: true, data: {} } as never)
    const { onOpenChange, onCreated } = mount()

    await addService(/^Acrylic Denture/)
    // The matrix arrives after the line is added, and brings the variant and quantity controls.
    await choose('Variant', 'Standard')
    fireEvent.change(
      await screen.findByRole('spinbutton', { name: 'Quantity of Acrylic Denture' }),
      { target: { value: '3' } }
    )
    await choose('Surcharge Type', 'Amount (GHS)')
    fireEvent.change(within(await group('Surcharge Type')).getByRole('spinbutton'), {
      target: { value: '10' },
    })
    await choose('Discount Type', 'Percent (%)')
    const discount = await group('Discount Type')
    fireEvent.change(within(discount).getAllByRole('spinbutton')[0], { target: { value: '10' } })
    fireEvent.change(within(discount).getByPlaceholderText('e.g. VIP'), {
      target: { value: 'VIP' },
    })

    // 3 x 800.00 (Standard) = 2,400.00 + 10.00 surcharge = 2,410.00, less 10% = 2,169.00.
    expect(screen.getByText('Estimated total').nextElementSibling).toHaveTextContent(
      formatCurrency(216900)
    )

    fireEvent.click(screen.getByRole('button', { name: /create estimate/i }))
    await waitFor(() => expect(createEstimate).toHaveBeenCalledTimes(1))
    expect(createEstimate).toHaveBeenCalledWith(
      'appt-1',
      [
        {
          serviceId: 'svc-denture',
          variantName: 'Standard',
          toothClassId: null,
          quantity: 3,
          surcharge: { type: 'amount', value: 1000 },
          discount: { type: 'percent', value: 10, reason: 'VIP' },
        },
      ],
      null,
      'single'
    )
    expect(createStandaloneEstimate).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Estimate ready — sent to reception.')
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onCreated).toHaveBeenCalledTimes(1)
  })

  it('sends the quantity the type allows, not the larger one that was typed', async () => {
    vi.mocked(createEstimate).mockResolvedValue({ success: true, data: {} } as never)
    mount()
    await addService(/^Acrylic Denture/)
    fireEvent.change(
      await screen.findByRole('spinbutton', { name: 'Quantity of Acrylic Denture' }),
      { target: { value: '9' } }
    )

    fireEvent.click(screen.getByRole('button', { name: /create estimate/i }))
    await waitFor(() => expect(createEstimate).toHaveBeenCalledTimes(1))
    // The type allows 4 units; the server would clamp it, and the estimate must say what it priced.
    expect(createEstimate).toHaveBeenCalledWith(
      'appt-1',
      [expect.objectContaining({ serviceId: 'svc-denture', quantity: 4 })],
      null,
      'single'
    )
  })

  it('sends the tooth class chosen, and a discount amount in pesewas', async () => {
    vi.mocked(createEstimate).mockResolvedValue({ success: true, data: {} } as never)
    mount()
    await addService(/^Crown/)
    await choose('Tooth class', 'Molar')
    await choose('Discount Type', 'Amount (GHS)')
    fireEvent.change(within(await group('Discount Type')).getAllByRole('spinbutton')[0], {
      target: { value: '20' },
    })

    fireEvent.click(screen.getByRole('button', { name: /create estimate/i }))
    await waitFor(() => expect(createEstimate).toHaveBeenCalledTimes(1))
    expect(createEstimate).toHaveBeenCalledWith(
      'appt-1',
      [
        {
          serviceId: 'svc-crown',
          variantName: null,
          toothClassId: 'tc-molar',
          quantity: 1,
          surcharge: null,
          discount: { type: 'amount', value: 2000, reason: null },
        },
      ],
      null,
      'single'
    )
  })

  it('sends no variant or tooth class once they are put back to Default and Any', async () => {
    vi.mocked(createEstimate).mockResolvedValue({ success: true, data: {} } as never)
    mount()
    await addService(/^Acrylic Denture/)
    await choose('Variant', 'Standard')
    await choose('Variant', 'Default')
    await addService(/^Crown/)
    await choose('Tooth class', 'Molar')
    await choose('Tooth class', 'Any')

    fireEvent.click(screen.getByRole('button', { name: /create estimate/i }))
    await waitFor(() => expect(createEstimate).toHaveBeenCalledTimes(1))
    expect(createEstimate).toHaveBeenCalledWith(
      'appt-1',
      [
        expect.objectContaining({
          serviceId: 'svc-denture',
          variantName: null,
          toothClassId: null,
        }),
        expect.objectContaining({ serviceId: 'svc-crown', variantName: null, toothClassId: null }),
      ],
      null,
      'single'
    )
  })

  it('sends the note and the visit frequency', async () => {
    vi.mocked(createEstimate).mockResolvedValue({ success: true, data: {} } as never)
    mount()
    await addService(/^Scaling/)

    fireEvent.change(screen.getByPlaceholderText(/anything reception should know/i), {
      target: { value: '  Anxious patient  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Multiple visits' }))
    fireEvent.click(screen.getByRole('button', { name: /create estimate/i }))

    await waitFor(() => expect(createEstimate).toHaveBeenCalledTimes(1))
    expect(createEstimate).toHaveBeenCalledWith(
      'appt-1',
      [expect.objectContaining({ serviceId: 'svc-scale', quantity: 1 })],
      'Anxious patient',
      'multiple'
    )
  })

  it('sends a plan estimate with no visit to the standalone endpoint, with the plan', async () => {
    vi.mocked(createStandaloneEstimate).mockResolvedValue({ success: true, data: {} } as never)
    const { onCreated } = mount({ appointmentId: undefined, planId: 'plan-1' })
    await addService(/^Scaling/)
    fireEvent.change(screen.getByPlaceholderText(/anything reception should know/i), {
      target: { value: 'For the whole plan' },
    })

    fireEvent.click(screen.getByRole('button', { name: /create estimate/i }))

    await waitFor(() => expect(createStandaloneEstimate).toHaveBeenCalledTimes(1))
    expect(createStandaloneEstimate).toHaveBeenCalledWith(
      'pat-1',
      [expect.objectContaining({ serviceId: 'svc-scale' })],
      'For the whole plan',
      'single',
      'plan-1'
    )
    expect(createEstimate).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Estimate created successfully.')
    expect(onCreated).toHaveBeenCalledTimes(1)
  })

  it('asks for a patient when the sheet is opened without one, and uses the one picked', async () => {
    vi.mocked(createStandaloneEstimate).mockResolvedValue({ success: true, data: {} } as never)
    mount({ appointmentId: undefined, patientId: undefined, patientName: undefined })
    await addService(/^Scaling/)

    // No patient yet: nothing to create the estimate for.
    expect(screen.getByRole('button', { name: /create estimate/i })).toBeDisabled()
    fireEvent.click(screen.getByText('Pick patient'))
    const create = screen.getByRole('button', { name: /create estimate/i })
    await waitFor(() => expect(create).toBeEnabled())
    fireEvent.click(create)

    await waitFor(() => expect(createStandaloneEstimate).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createStandaloneEstimate).mock.calls[0][0]).toBe('pat-9')
  })
})

describe('a surcharge that more than doubles a line', () => {
  it('is confirmed first, and nothing is sent until the doctor agrees', async () => {
    vi.mocked(createEstimate).mockResolvedValue({ success: true, data: {} } as never)
    mount()
    await addService(/^Scaling/)
    await choose('Surcharge Type', 'Percent (%)')
    // 150% of the line: more than the line itself, so it is probably a mistyped value.
    fireEvent.change(within(await group('Surcharge Type')).getByRole('spinbutton'), {
      target: { value: '150' },
    })

    fireEvent.click(screen.getByRole('button', { name: /create estimate/i }))
    expect(await screen.findByText('Large surcharge')).toBeInTheDocument()
    expect(createEstimate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Add anyway' }))
    await waitFor(() => expect(createEstimate).toHaveBeenCalledTimes(1))
    expect(createEstimate).toHaveBeenCalledWith(
      'appt-1',
      [
        expect.objectContaining({
          serviceId: 'svc-scale',
          surcharge: { type: 'percent', value: 150 },
        }),
      ],
      null,
      'single'
    )
  })

  it('does not interrupt a surcharge that stays under the line price', async () => {
    vi.mocked(createEstimate).mockResolvedValue({ success: true, data: {} } as never)
    mount()
    await addService(/^Scaling/)
    await choose('Surcharge Type', 'Percent (%)')
    fireEvent.change(within(await group('Surcharge Type')).getByRole('spinbutton'), {
      target: { value: '100' },
    })

    fireEvent.click(screen.getByRole('button', { name: /create estimate/i }))
    await waitFor(() => expect(createEstimate).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Large surcharge')).not.toBeInTheDocument()
  })
})

describe('when the server refuses', () => {
  it('shows the reason, keeps the sheet open and reports nothing as created', async () => {
    vi.mocked(createEstimate).mockResolvedValue({
      success: false,
      error: 'This visit is already closed',
    } as never)
    const { onOpenChange, onCreated } = mount()
    await addService(/^Scaling/)

    fireEvent.click(screen.getByRole('button', { name: /create estimate/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This visit is already closed'))
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(onCreated).not.toHaveBeenCalled()
  })
})
