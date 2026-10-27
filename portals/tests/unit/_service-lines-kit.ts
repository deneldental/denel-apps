/**
 * Shared fixtures and controls for the tests of the service-line editor and the sheets built on it
 * (the create-estimate sheet and the one-time payment sheet). Tests drive the real editor, so they
 * all need the same small catalogue, the same pricing matrices, and the same way of operating its
 * Radix selects in jsdom.
 */
import { fireEvent, screen, within } from '@testing-library/react'
import type { ServiceMatrix } from '@/lib/actions/services'
import type { ServiceCatalogOption } from '@/shared/components/service-lines-editor'

export const CATALOGUE: ServiceCatalogOption[] = [
  { id: 'svc-scale', name: 'Scaling', amount: 15000, category: 'preventive' },
  { id: 'svc-denture', name: 'Acrylic Denture', amount: 70000, category: 'prosthetic' },
  { id: 'svc-crown', name: 'Crown', amount: 60000, category: 'prosthetic' },
]

/** One unit, one price. */
export const SCALING_MATRIX = {
  service: { id: 'svc-scale', name: 'Scaling', amount: 15000 },
  scope: { id: 'sc-1', quantityMode: 'single', maxQuantity: null },
  cells: [],
  variants: [],
  toothClasses: [],
} as unknown as ServiceMatrix

/** Per unit (up to 4), with a "Standard" variant priced above the 700.00 base amount. */
export const DENTURE_MATRIX = {
  service: { id: 'svc-denture', name: 'Acrylic Denture', amount: 70000 },
  scope: { id: 'sc-2', quantityMode: 'multi', maxQuantity: 4 },
  cells: [
    {
      id: 'cell-1',
      serviceId: 'svc-denture',
      serviceCode: null,
      variantName: 'Standard',
      toothClassId: null,
      price: 80000,
      priceMin: null,
      priceMax: null,
      sortOrder: 0,
      isActive: true,
    },
  ],
  variants: ['Standard'],
  toothClasses: [],
} as unknown as ServiceMatrix

/** One unit, priced by tooth class: a molar costs 900.00, any other tooth the flat 600.00. */
export const CROWN_MATRIX = {
  service: { id: 'svc-crown', name: 'Crown', amount: 60000 },
  scope: { id: 'sc-3', quantityMode: 'single', maxQuantity: null },
  cells: [
    {
      id: 'cell-molar',
      serviceId: 'svc-crown',
      serviceCode: null,
      variantName: null,
      toothClassId: 'tc-molar',
      price: 90000,
      priceMin: null,
      priceMax: null,
      sortOrder: 0,
      isActive: true,
    },
    {
      id: 'cell-flat',
      serviceId: 'svc-crown',
      serviceCode: null,
      variantName: null,
      toothClassId: null,
      price: 60000,
      priceMin: null,
      priceMax: null,
      sortOrder: 1,
      isActive: true,
    },
  ],
  variants: [],
  toothClasses: [
    { id: 'tc-molar', name: 'molar', displayName: 'Molar', sortOrder: 0, isActive: true },
  ],
} as unknown as ServiceMatrix

/** Not in `CATALOGUE`: a service billed in steps (G01). Tests that want it add it themselves. */
export const NIGHT_GUARD: ServiceCatalogOption = {
  id: 'svc-guard',
  name: 'Night Guard',
  amount: 10000,
  category: 'prosthetic',
}

/** Per unit (up to 4): 100.00 for the first unit and 60.00 for each further one. */
export const NIGHT_GUARD_MATRIX = {
  service: { id: 'svc-guard', name: 'Night Guard', amount: 10000, additionalUnitPrice: 6000 },
  scope: { id: 'sc-4', quantityMode: 'multi', maxQuantity: 4, additionalUnitPriceEnabled: true },
  cells: [],
  variants: [],
  toothClasses: [],
} as unknown as ServiceMatrix

/** The matrix `getServiceMatrix` answers with for each catalogue service. */
export const matrixFor = (id: string): ServiceMatrix =>
  id === 'svc-denture'
    ? DENTURE_MATRIX
    : id === 'svc-crown'
      ? CROWN_MATRIX
      : id === 'svc-guard'
        ? NIGHT_GUARD_MATRIX
        : SCALING_MATRIX

/** Radix Select/Sheet lean on pointer-capture, scrolling and ResizeObserver, which jsdom lacks. */
export function installRadixPolyfills() {
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
}

/** Open the editor's "Add service" picker and choose a service by name. */
export async function addService(name: RegExp | string) {
  fireEvent.click(await screen.findByText(/add a service from the catalog/i))
  fireEvent.click(await screen.findByRole('option', { name }))
}

/**
 * The grid that holds a labelled control group on a line (Surcharge Type, Discount Type, Variant…).
 * Waits for the label: a line's matrix arrives after the line is added, and brings its own controls.
 */
export async function group(label: string): Promise<HTMLElement> {
  const grid = (await screen.findByText(label)).closest('.grid')
  if (!grid) throw new Error(`no control group for "${label}"`)
  return grid as HTMLElement
}

/** Choose an option of the Radix Select that sits in the control group labelled `label`. */
export async function choose(label: string, option: string) {
  fireEvent.click(within(await group(label)).getByRole('combobox'))
  fireEvent.click(await screen.findByRole('option', { name: option }))
}
