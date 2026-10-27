/**
 * G01 — the service's Price matrix step: the price of each additional unit, for a service whose
 * application type is billed in steps. See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (G01) and
 * step-10-handover.md.
 *
 * The step is real; the network is stubbed. The field is asked for only when the type is billed in
 * steps; it is typed in cedis and saved in pesewas; emptied, it is saved as none (every unit at the
 * full price); a negative price is refused with a reason; and a service of a type that is not stepped
 * never has the field sent at all, so saving its variants cannot wipe it.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/actions/services', () => ({
  getServiceMatrix: vi.fn(),
  getToothClasses: vi.fn(),
  setServiceMatrix: vi.fn(),
  updateService: vi.fn(),
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import { ServicePricingMatrix } from '@/features/services/components/service-pricing-matrix'
import {
  type ApplicationScope,
  getServiceMatrix,
  getToothClasses,
  type ServiceMatrix,
  setServiceMatrix,
  updateService,
} from '@/lib/actions/services'
import { installRadixPolyfills } from './_service-lines-kit'
import { renderWithRouter } from './_test-utils'

const { toast } = await import('sonner')

beforeAll(installRadixPolyfills)

const scopeOf = (over: Partial<ApplicationScope>): ApplicationScope => ({
  id: 'sc-1',
  name: 'per_arch',
  displayName: 'Per arch',
  quantityMode: 'multi',
  maxQuantity: 2,
  additionalUnitPriceEnabled: true,
  variantType: 'none',
  sortOrder: 0,
  isActive: true,
  ...over,
})

function matrixOf(opts: {
  scope: ApplicationScope | null
  additionalUnitPrice?: number | null
}): ServiceMatrix {
  return {
    service: {
      id: 'svc-1',
      name: 'Night Guard',
      amount: 10000,
      serviceCode: 'SVC-000001',
      scopeId: opts.scope?.id ?? null,
      priceMin: null,
      priceMax: null,
      additionalUnitPrice: opts.additionalUnitPrice ?? null,
      variantsEnabled: false,
      priceRangeEnabled: false,
      taxIds: [],
    },
    scope: opts.scope,
    cells: [],
    variants: [],
    toothClasses: [],
  }
}

function serveMatrix(matrix: ServiceMatrix) {
  vi.mocked(getServiceMatrix).mockResolvedValue({ success: true, data: matrix })
}

beforeEach(() => {
  vi.mocked(getToothClasses).mockResolvedValue({ success: true, data: [] })
  vi.mocked(updateService).mockResolvedValue({ success: true, data: {} })
  vi.mocked(setServiceMatrix).mockResolvedValue({ success: true, data: matrixOf({ scope: null }) })
  serveMatrix(matrixOf({ scope: scopeOf({}), additionalUnitPrice: 6000 }))
})
afterEach(() => vi.resetAllMocks())

const field = () => screen.getByLabelText('Price of each additional unit')
const maybeField = () => screen.queryByLabelText('Price of each additional unit')
const saveButton = () => screen.getByRole('button', { name: /save pricing|saved/i })

async function loaded() {
  await screen.findByText('Price matrix')
}

describe('a service that has just loaded', () => {
  // The "nothing changed yet" snapshot must be of what the server sent, not of the empty form the
  // step starts from: otherwise a service is "unsaved" the moment it opens.
  it('has nothing unsaved, even with variants', async () => {
    const base = matrixOf({
      scope: scopeOf({ additionalUnitPriceEnabled: false, variantType: 'plain' }),
    })
    serveMatrix({
      ...base,
      service: { ...base.service, variantsEnabled: true },
      cells: [
        {
          id: 'c1',
          serviceId: 'svc-1',
          serviceCode: null,
          variantName: 'Soft',
          toothClassId: null,
          price: 12000,
          priceMin: null,
          priceMax: null,
          sortOrder: 0,
          isActive: true,
        },
      ],
      variants: ['Soft'],
    })
    const onDirtyChange = vi.fn()
    renderWithRouter(
      <ServicePricingMatrix serviceId="svc-1" isAdmin onDirtyChange={onDirtyChange} />
    )
    await loaded()
    expect(await screen.findByDisplayValue('Soft')).toBeInTheDocument()

    expect(saveButton()).toBeDisabled()
    expect(onDirtyChange).not.toHaveBeenCalledWith(true)
  })

  it('has nothing unsaved when it has an additional-unit price', async () => {
    const onDirtyChange = vi.fn()
    renderWithRouter(
      <ServicePricingMatrix serviceId="svc-1" isAdmin onDirtyChange={onDirtyChange} />
    )
    await loaded()
    expect(field()).toHaveValue(60)

    expect(saveButton()).toBeDisabled()
    expect(onDirtyChange).not.toHaveBeenCalledWith(true)
  })
})

describe('the price of each additional unit', () => {
  it('is asked for when the service’s type is billed in steps, showing what is stored', async () => {
    renderWithRouter(<ServicePricingMatrix serviceId="svc-1" isAdmin />)
    await loaded()

    expect(field()).toHaveValue(60)
  })

  it('is empty when the service has none yet', async () => {
    serveMatrix(matrixOf({ scope: scopeOf({}), additionalUnitPrice: null }))
    renderWithRouter(<ServicePricingMatrix serviceId="svc-1" isAdmin />)
    await loaded()

    expect(field()).toHaveValue(null)
  })

  it('is not asked for when the type is not billed in steps', async () => {
    serveMatrix(
      matrixOf({ scope: scopeOf({ additionalUnitPriceEnabled: false }), additionalUnitPrice: 6000 })
    )
    renderWithRouter(<ServicePricingMatrix serviceId="svc-1" isAdmin />)
    await loaded()

    expect(maybeField()).not.toBeInTheDocument()
  })

  it('is not asked for when the service has no application type', async () => {
    serveMatrix(matrixOf({ scope: null }))
    renderWithRouter(<ServicePricingMatrix serviceId="svc-1" isAdmin />)
    await loaded()

    expect(maybeField()).not.toBeInTheDocument()
  })

  it('is saved in pesewas as typed in cedis', async () => {
    renderWithRouter(<ServicePricingMatrix serviceId="svc-1" isAdmin />)
    await loaded()
    fireEvent.change(field(), { target: { value: '75.50' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(updateService).toHaveBeenCalledTimes(1))
    expect(updateService).toHaveBeenCalledWith(
      'svc-1',
      expect.objectContaining({ additionalUnitPrice: 7550 })
    )
  })

  it('is saved as none when emptied, so every unit costs the full price', async () => {
    renderWithRouter(<ServicePricingMatrix serviceId="svc-1" isAdmin />)
    await loaded()
    fireEvent.change(field(), { target: { value: '' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(updateService).toHaveBeenCalledTimes(1))
    expect(updateService).toHaveBeenCalledWith(
      'svc-1',
      expect.objectContaining({ additionalUnitPrice: null })
    )
  })

  it('can be free (0)', async () => {
    renderWithRouter(<ServicePricingMatrix serviceId="svc-1" isAdmin />)
    await loaded()
    fireEvent.change(field(), { target: { value: '0' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(updateService).toHaveBeenCalledTimes(1))
    expect(updateService).toHaveBeenCalledWith(
      'svc-1',
      expect.objectContaining({ additionalUnitPrice: 0 })
    )
  })

  it('refuses a negative price, says why, and saves nothing', async () => {
    renderWithRouter(<ServicePricingMatrix serviceId="svc-1" isAdmin />)
    await loaded()
    fireEvent.change(field(), { target: { value: '-5' } })
    fireEvent.click(saveButton())

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/additional unit/i))
    )
    expect(updateService).not.toHaveBeenCalled()
    expect(setServiceMatrix).not.toHaveBeenCalled()
  })

  it('counts as an unsaved change', async () => {
    const onDirtyChange = vi.fn()
    renderWithRouter(
      <ServicePricingMatrix serviceId="svc-1" isAdmin onDirtyChange={onDirtyChange} />
    )
    await loaded()
    expect(saveButton()).toBeDisabled()

    fireEvent.change(field(), { target: { value: '70' } })

    expect(saveButton()).toBeEnabled()
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  })

  it('cannot be changed by someone who is not an admin', async () => {
    renderWithRouter(<ServicePricingMatrix serviceId="svc-1" isAdmin={false} />)
    await loaded()

    expect(field()).toBeDisabled()
  })

  it('is never sent for a type that is not stepped, so saving the variants cannot wipe it', async () => {
    serveMatrix(
      matrixOf({
        scope: scopeOf({ additionalUnitPriceEnabled: false, variantType: 'plain' }),
        additionalUnitPrice: 6000,
      })
    )
    renderWithRouter(<ServicePricingMatrix serviceId="svc-1" isAdmin />)
    await loaded()
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.change(await screen.findByPlaceholderText('Variant name'), {
      target: { value: 'Soft' },
    })
    fireEvent.change(screen.getByPlaceholderText('price'), { target: { value: '120' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(updateService).toHaveBeenCalledTimes(1))
    expect(vi.mocked(updateService).mock.calls[0][1]).not.toHaveProperty('additionalUnitPrice')
  })
})
