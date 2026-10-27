/**
 * G02 — the shared service-line editor, as a person uses it.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (G02) and step-10-handover.md.
 *
 * The editor is real. Only the network is stubbed. The price arithmetic itself is pinned in
 * `service-lines-editor.test.ts`; this file covers what the controls do with it: adding a service,
 * bringing in its pricing options, choosing a variant and a quantity, and what happens when the
 * pricing options cannot be loaded (the line must say so, not pass its catalogue price off as the
 * whole price).
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/actions/services', () => ({ getServices: vi.fn(), getServiceMatrix: vi.fn() }))

import { getServiceMatrix, getServices } from '@/lib/actions/services'
import {
  computeServiceLinesTotal,
  type ServiceCatalogOption,
  type ServiceLine,
  ServiceLinesEditor,
  useServiceCatalog,
} from '@/shared/components/service-lines-editor'
import { formatCurrency } from '@/shared/utils/currency'
import {
  addService,
  CATALOGUE,
  choose,
  group,
  installRadixPolyfills,
  matrixFor,
  NIGHT_GUARD,
} from './_service-lines-kit'
import { renderWithRouter } from './_test-utils'

beforeAll(installRadixPolyfills)

beforeEach(() => {
  vi.mocked(getServiceMatrix).mockImplementation(async (id: string) => ({
    success: true,
    data: matrixFor(id),
  }))
})
afterEach(() => vi.resetAllMocks())

/** The editor with the state a parent sheet would hold for it, and the total it would show. */
function Harness({ services = CATALOGUE }: { services?: ServiceCatalogOption[] }) {
  const [lines, setLines] = useState<ServiceLine[]>([])
  return (
    <>
      <ServiceLinesEditor services={services} lines={lines} setLines={setLines} />
      <output data-testid="total">{computeServiceLinesTotal(lines)}</output>
    </>
  )
}

const total = () => Number(screen.getByTestId('total').textContent)

describe('ServiceLinesEditor', () => {
  it('says nothing has been added until a service is', () => {
    renderWithRouter(<Harness />)
    expect(screen.getByText('No services added yet.')).toBeInTheDocument()
    expect(total()).toBe(0)
  })

  it('adds a chosen service as a line at its catalogue price, then brings in its pricing options', async () => {
    renderWithRouter(<Harness />)
    await addService(/^Acrylic Denture/)

    // The line is there at once, at the catalogue price, before the options arrive.
    expect(screen.getByText('Acrylic Denture')).toBeInTheDocument()
    expect(total()).toBe(70000)

    // The options bring the variant and the quantity controls (with the type's maximum).
    expect(await screen.findByText('Variant')).toBeInTheDocument()
    expect(screen.getByText('Qty (max 4)')).toBeInTheDocument()
    expect(getServiceMatrix).toHaveBeenCalledWith('svc-denture')
  })

  it('prices the line by the variant chosen and the quantity typed', async () => {
    renderWithRouter(<Harness />)
    await addService(/^Acrylic Denture/)
    await choose('Variant', 'Standard')
    fireEvent.change(
      await screen.findByRole('spinbutton', { name: 'Quantity of Acrylic Denture' }),
      { target: { value: '3' } }
    )

    // 3 x 800.00 (the Standard variant, not the 700.00 catalogue price).
    expect(total()).toBe(240000)
    expect(
      screen.getByText(`${formatCurrency(80000)} × 3 = ${formatCurrency(240000)}`)
    ).toBeInTheDocument()
  })

  describe('a service billed in steps (first unit / additional unit)', () => {
    const withGuard = [...CATALOGUE, NIGHT_GUARD]

    it('shows the first unit and the further units as the sum they are, and totals them', async () => {
      renderWithRouter(<Harness services={withGuard} />)
      await addService(/^Night Guard/)
      fireEvent.change(await screen.findByRole('spinbutton', { name: 'Quantity of Night Guard' }), {
        target: { value: '3' },
      })

      // 100.00 for the first, 60.00 for each of the other two: not 3 × 100.00.
      expect(total()).toBe(22000)
      expect(
        screen.getByText(
          `${formatCurrency(10000)} + 2 × ${formatCurrency(6000)} = ${formatCurrency(22000)}`
        )
      ).toBeInTheDocument()
    })

    it('reads like any other line while only one unit is billed', async () => {
      renderWithRouter(<Harness services={withGuard} />)
      await addService(/^Night Guard/)
      await screen.findByRole('spinbutton', { name: 'Quantity of Night Guard' })

      expect(total()).toBe(10000)
      expect(
        screen.getByText(`${formatCurrency(10000)} × 1 = ${formatCurrency(10000)}`)
      ).toBeInTheDocument()
    })

    it('keeps the flat reading for a service that is not stepped', async () => {
      renderWithRouter(<Harness services={withGuard} />)
      await addService(/^Acrylic Denture/)
      await choose('Variant', 'Standard')
      fireEvent.change(
        await screen.findByRole('spinbutton', { name: 'Quantity of Acrylic Denture' }),
        { target: { value: '2' } }
      )

      expect(
        screen.getByText(`${formatCurrency(80000)} × 2 = ${formatCurrency(160000)}`)
      ).toBeInTheDocument()
    })
  })

  it('goes back to the catalogue price when the variant is set back to Default', async () => {
    renderWithRouter(<Harness />)
    await addService(/^Acrylic Denture/)
    await choose('Variant', 'Standard')
    expect(total()).toBe(80000)

    await choose('Variant', 'Default')
    expect(total()).toBe(70000)
  })

  it('prices a service by the tooth class chosen, and by the flat price when it is set back to Any', async () => {
    renderWithRouter(<Harness />)
    await addService(/^Crown/)
    // Nothing chosen yet: the flat price.
    expect(await screen.findByText('Tooth class')).toBeInTheDocument()
    expect(total()).toBe(60000)

    await choose('Tooth class', 'Molar')
    expect(total()).toBe(90000)

    await choose('Tooth class', 'Any')
    expect(total()).toBe(60000)
  })

  it('stops the typed quantity at the type’s maximum', async () => {
    renderWithRouter(<Harness />)
    await addService(/^Acrylic Denture/)
    const qty = await screen.findByRole('spinbutton', { name: 'Quantity of Acrylic Denture' })
    expect(qty).toHaveAttribute('max', '4')

    fireEvent.change(qty, { target: { value: '9' } })
    expect(total()).toBe(70000 * 4)
  })

  it('shows a surcharge and a discount in the line’s breakdown', async () => {
    renderWithRouter(<Harness />)
    await addService(/^Scaling/)
    await choose('Surcharge Type', 'Percent (%)')
    fireEvent.change(within(await group('Surcharge Type')).getByRole('spinbutton'), {
      target: { value: '10' },
    })
    await choose('Discount Type', 'Amount (GHS)')
    fireEvent.change(within(await group('Discount Type')).getAllByRole('spinbutton')[0], {
      target: { value: '5' },
    })

    expect(screen.getByText(`· surcharge: +${formatCurrency(1500)}`)).toBeInTheDocument()
    expect(screen.getByText(`· discount: -${formatCurrency(500)}`)).toBeInTheDocument()
    expect(total()).toBe(15000 + 1500 - 500)
  })

  it('does not let a service that is already on a line be added again', async () => {
    renderWithRouter(<Harness />)
    await addService(/^Scaling/)

    fireEvent.click(screen.getByText(/add a service from the catalog/i))
    expect(await screen.findByRole('option', { name: /^Scaling/ })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(await screen.findByRole('option', { name: /^Acrylic Denture/ })).not.toHaveAttribute(
      'aria-disabled',
      'true'
    )
  })

  it('takes a line away when it is removed', async () => {
    renderWithRouter(<Harness />)
    await addService(/^Scaling/)
    expect(total()).toBe(15000)

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.getByText('No services added yet.')).toBeInTheDocument()
    expect(total()).toBe(0)
  })

  describe('when the pricing options cannot be loaded', () => {
    it.each([
      [
        'the server refuses',
        () => vi.mocked(getServiceMatrix).mockResolvedValue({ success: false, error: 'nope' }),
      ],
      [
        'the request fails outright',
        () => vi.mocked(getServiceMatrix).mockRejectedValue(new Error('offline')),
      ],
    ])('says so on the line when %s, and keeps the catalogue price', async (_how, fail) => {
      fail()
      renderWithRouter(<Harness />)
      await addService(/^Acrylic Denture/)

      expect(await screen.findByRole('alert')).toHaveTextContent(/pricing options/i)
      // No variant or quantity to choose without the options; the price is the catalogue price.
      expect(screen.queryByText('Variant')).not.toBeInTheDocument()
      expect(total()).toBe(70000)
    })

    it('does not warn about a line whose options did load', async () => {
      renderWithRouter(<Harness />)
      await addService(/^Scaling/)
      await waitFor(() => expect(getServiceMatrix).toHaveBeenCalled())
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })
})

function CatalogProbe({ enabled }: { enabled?: boolean }) {
  const services = useServiceCatalog(enabled)
  return (
    <ul>
      {services.map((s) => (
        <li key={s.id}>{s.name}</li>
      ))}
    </ul>
  )
}

describe('useServiceCatalog', () => {
  it('lists the services that can be sold today, by name, without insurance services', async () => {
    vi.mocked(getServices).mockResolvedValue({
      success: true,
      data: [
        { id: 'a', name: 'Zirconia crown', amount: 1, category: 'prosthetic' },
        { id: 'b', name: 'Insurer claim', amount: 1, category: 'insurance' },
        { id: 'c', name: 'Bleaching', amount: 1, category: 'cosmetic' },
      ],
    })
    renderWithRouter(<CatalogProbe />)

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Bleaching',
      'Zirconia crown',
    ])
    // "Sold today" is the server's own filter, not something the picker works out.
    expect(getServices).toHaveBeenCalledWith({ activeOnly: true })
  })

  it('asks for nothing until it is enabled', async () => {
    renderWithRouter(<CatalogProbe enabled={false} />)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(getServices).not.toHaveBeenCalled()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })
})
