/**
 * G01 — the application-type admin tab: the switch that bills a type in steps (the first unit at the
 * service's price, each further unit at the service's own additional-unit price).
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (G01) and step-10-handover.md.
 *
 * The tab and its form sheet are real; the network is stubbed. The switch only means something for a
 * type billed per unit, so it is offered only then, starts off for a new type, starts as the type has
 * it when editing, and is sent as off when the type is made billed-once.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/actions/services', () => ({
  getApplicationScopes: vi.fn(),
  createApplicationScope: vi.fn(),
  updateApplicationScope: vi.fn(),
  deleteApplicationScope: vi.fn(),
  restoreApplicationScope: vi.fn(),
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import { ApplicationScopeTab } from '@/features/services/components/application-scope-tab'
import {
  type ApplicationScope,
  createApplicationScope,
  getApplicationScopes,
  updateApplicationScope,
} from '@/lib/actions/services'
import { installRadixPolyfills } from './_service-lines-kit'
import { renderWithRouter } from './_test-utils'

beforeAll(installRadixPolyfills)

const scope = (over: Partial<ApplicationScope>): ApplicationScope => ({
  id: 'sc-1',
  name: 'per_tooth',
  displayName: 'Per tooth',
  quantityMode: 'multi',
  maxQuantity: 32,
  additionalUnitPriceEnabled: false,
  variantType: 'none',
  sortOrder: 0,
  isActive: true,
  ...over,
})

const PER_TOOTH = scope({})
const STEPPED = scope({
  id: 'sc-2',
  name: 'per_arch',
  displayName: 'Per arch',
  maxQuantity: 2,
  additionalUnitPriceEnabled: true,
})
const WHOLE_MOUTH = scope({
  id: 'sc-3',
  name: 'whole_mouth',
  displayName: 'Whole mouth',
  quantityMode: 'single',
  maxQuantity: null,
})

beforeEach(() => {
  vi.mocked(getApplicationScopes).mockResolvedValue({
    success: true,
    data: [PER_TOOTH, STEPPED, WHOLE_MOUTH],
  })
  vi.mocked(createApplicationScope).mockResolvedValue({ success: true, data: PER_TOOTH })
  vi.mocked(updateApplicationScope).mockResolvedValue({ success: true, data: PER_TOOTH })
})
afterEach(() => vi.resetAllMocks())

const switchBox = () => screen.getByRole('switch', { name: 'Price additional units differently' })
const maybeSwitchBox = () =>
  screen.queryByRole('switch', { name: 'Price additional units differently' })

/** Change the Radix Select that sits under the label `label` in the form sheet. */
async function choose(label: string, option: string) {
  const field = screen.getByText(label).parentElement as HTMLElement
  fireEvent.click(within(field).getByRole('combobox'))
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(`^${option}`) }))
}

async function openEditor(rowName: string) {
  const row = (await screen.findByText(rowName)).closest('tr') as HTMLElement
  fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
}

describe('the application-type list', () => {
  it('marks a type that is billed in steps, and no other', async () => {
    renderWithRouter(<ApplicationScopeTab isAdmin />)

    const stepped = (await screen.findByText('Per arch')).closest('tr') as HTMLElement
    expect(within(stepped).getByText('Stepped')).toBeInTheDocument()
    const plain = (await screen.findByText('Per tooth')).closest('tr') as HTMLElement
    expect(within(plain).queryByText('Stepped')).not.toBeInTheDocument()
    const single = (await screen.findByText('Whole mouth')).closest('tr') as HTMLElement
    expect(within(single).queryByText('Stepped')).not.toBeInTheDocument()
  })
})

describe('the switch on a new application type', () => {
  it('is not offered while the type is billed once', async () => {
    renderWithRouter(<ApplicationScopeTab isAdmin />)
    fireEvent.click(await screen.findByRole('button', { name: /new application type/i }))

    await screen.findByText('Quantity mode')
    expect(maybeSwitchBox()).not.toBeInTheDocument()
  })

  it('is offered once the type is billed per unit, and starts off', async () => {
    renderWithRouter(<ApplicationScopeTab isAdmin />)
    fireEvent.click(await screen.findByRole('button', { name: /new application type/i }))
    await choose('Quantity mode', 'Multi')

    expect(switchBox()).not.toBeChecked()
  })

  it('is sent on when it was switched on', async () => {
    renderWithRouter(<ApplicationScopeTab isAdmin />)
    fireEvent.click(await screen.findByRole('button', { name: /new application type/i }))
    fireEvent.change(await screen.findByPlaceholderText('e.g. Per tooth'), {
      target: { value: 'Per quadrant' },
    })
    await choose('Quantity mode', 'Multi')
    fireEvent.click(switchBox())
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(createApplicationScope).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createApplicationScope).mock.calls[0][0]).toMatchObject({
      displayName: 'Per quadrant',
      quantityMode: 'multi',
      additionalUnitPriceEnabled: true,
    })
  })

  it('is sent off when it was left alone', async () => {
    renderWithRouter(<ApplicationScopeTab isAdmin />)
    fireEvent.click(await screen.findByRole('button', { name: /new application type/i }))
    fireEvent.change(await screen.findByPlaceholderText('e.g. Per tooth'), {
      target: { value: 'Per quadrant' },
    })
    await choose('Quantity mode', 'Multi')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(createApplicationScope).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createApplicationScope).mock.calls[0][0]).toMatchObject({
      additionalUnitPriceEnabled: false,
    })
  })

  it('is sent off for a type billed once', async () => {
    renderWithRouter(<ApplicationScopeTab isAdmin />)
    fireEvent.click(await screen.findByRole('button', { name: /new application type/i }))
    fireEvent.change(await screen.findByPlaceholderText('e.g. Per tooth'), {
      target: { value: 'Session' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(createApplicationScope).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createApplicationScope).mock.calls[0][0]).toMatchObject({
      quantityMode: 'single',
      additionalUnitPriceEnabled: false,
    })
  })
})

describe('the switch when editing an application type', () => {
  it('starts as the type has it', async () => {
    renderWithRouter(<ApplicationScopeTab isAdmin />)
    await openEditor('Per arch')

    expect(switchBox()).toBeChecked()
  })

  it('starts off for a type that is billed per unit but not in steps', async () => {
    renderWithRouter(<ApplicationScopeTab isAdmin />)
    await openEditor('Per tooth')

    expect(switchBox()).not.toBeChecked()
  })

  it('keeps a stepped type stepped when it is saved untouched', async () => {
    renderWithRouter(<ApplicationScopeTab isAdmin />)
    await openEditor('Per arch')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateApplicationScope).toHaveBeenCalledTimes(1))
    expect(updateApplicationScope).toHaveBeenCalledWith(
      'sc-2',
      expect.objectContaining({ additionalUnitPriceEnabled: true })
    )
  })

  it('can be switched off', async () => {
    renderWithRouter(<ApplicationScopeTab isAdmin />)
    await openEditor('Per arch')
    fireEvent.click(switchBox())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateApplicationScope).toHaveBeenCalledTimes(1))
    expect(updateApplicationScope).toHaveBeenCalledWith(
      'sc-2',
      expect.objectContaining({ additionalUnitPriceEnabled: false })
    )
  })

  it('goes with the type being made billed once: the switch disappears and is sent off', async () => {
    renderWithRouter(<ApplicationScopeTab isAdmin />)
    await openEditor('Per arch')
    await choose('Quantity mode', 'Single')

    expect(maybeSwitchBox()).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateApplicationScope).toHaveBeenCalledTimes(1))
    expect(updateApplicationScope).toHaveBeenCalledWith(
      'sc-2',
      expect.objectContaining({ quantityMode: 'single', additionalUnitPriceEnabled: false })
    )
  })
})
