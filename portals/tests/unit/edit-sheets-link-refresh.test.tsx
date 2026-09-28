/**
 * A private file's link is re-signed every 15 minutes, so a background refetch
 * hands a record back with a new link even though nothing changed. Edit sheets
 * and the alert settings must keep the user's unsaved edits, and must not count
 * a refreshed link as a change.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { EditExpenseSheet } from '@/features/expenses/components/edit-expense-sheet'
import { EditInventorySheet } from '@/features/inventory/components/edit-inventory-sheet'
import { EditProductSheet } from '@/features/products/components/edit-product-sheet'
import { AlertsSection } from '@/features/settings/components/alerts-section'
import { api } from '@/lib/api-client'
import { renderWithRouter } from './_test-utils'

const mockGet = vi.mocked(api.get)

beforeAll(() => {
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
beforeEach(() => mockGet.mockResolvedValue({ success: true, data: [] }))
afterEach(() => vi.clearAllMocks())

/** The same stored file, signed in two different 15-minute windows. */
const link = (window: string) =>
  `https://denel-private.acct.r2.cloudflarestorage.com/products/gloves.jpg?X-Amz-Date=20260927T${window}00Z&X-Amz-Signature=${window}`
const LINK_A = link('1000')
const LINK_B = link('1015')
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('Edit Expense', () => {
  const expense = (attachmentUrl: string) =>
    ({
      id: 'e-1',
      category: 'Supplies',
      paymentMethod: 'cash',
      amount: 5000,
      date: '2026-09-20',
      paidTo: 'Kofi Store',
      description: 'Gloves',
      attachmentUrl,
    }) as never

  it('keeps what the user typed when a refetch brings the expense back', async () => {
    const user = userEvent.setup()
    const { rerender } = renderWithRouter(
      <EditExpenseSheet expense={expense(LINK_A)} open onOpenChange={vi.fn()} />
    )
    const paidTo = await screen.findByLabelText(/^paid to/i)
    await waitFor(() => expect(paidTo).toHaveValue('Kofi Store'))
    await user.clear(paidTo)
    await user.type(paidTo, 'Ama Pharmacy')

    rerender(<EditExpenseSheet expense={expense(LINK_B)} open onOpenChange={vi.fn()} />)
    await tick()

    expect(screen.getByLabelText(/^paid to/i)).toHaveValue('Ama Pharmacy')
  })
})

describe('Edit Product', () => {
  const product = (image: string) =>
    ({
      id: 'pr-1',
      name: 'Gloves',
      image,
      sizeValue: null,
      sizeUnit: '',
      quantityPerPack: 1,
      stockQuantity: 4,
      price: 1000,
      costPrice: 800,
      isLocked: false,
    }) as never

  it('keeps what the user typed when a refetch brings the product back', async () => {
    const user = userEvent.setup()
    const { rerender } = renderWithRouter(
      <EditProductSheet product={product(LINK_A)} open onOpenChange={vi.fn()} />
    )
    const name = await screen.findByLabelText(/^product name/i)
    await waitFor(() => expect(name).toHaveValue('Gloves'))
    await user.clear(name)
    await user.type(name, 'Nitrile gloves')

    rerender(<EditProductSheet product={product(LINK_B)} open onOpenChange={vi.fn()} />)
    await tick()

    expect(screen.getByLabelText(/^product name/i)).toHaveValue('Nitrile gloves')
  })

  it('does not count a refreshed image link as an unsaved change', async () => {
    const { rerender } = renderWithRouter(
      <EditProductSheet product={product(LINK_A)} open onOpenChange={vi.fn()} />
    )
    await waitFor(() => expect(screen.getByLabelText(/^product name/i)).toHaveValue('Gloves'))
    rerender(<EditProductSheet product={product(LINK_B)} open onOpenChange={vi.fn()} />)
    await tick()

    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
  })
})

describe('Edit Inventory item', () => {
  const item = (image: string) =>
    ({
      id: 'in-1',
      name: 'Gauze',
      unit: 'pack',
      category: 'Consumables',
      image,
      stockQuantity: 10,
      reorderLevel: 2,
      expiryDate: null,
    }) as never

  it('keeps what the user typed when a refetch brings the item back', async () => {
    const user = userEvent.setup()
    const { rerender } = renderWithRouter(
      <EditInventorySheet product={item(LINK_A)} open onOpenChange={vi.fn()} />
    )
    const name = await screen.findByLabelText(/^item name/i)
    await waitFor(() => expect(name).toHaveValue('Gauze'))
    await user.clear(name)
    await user.type(name, 'Sterile gauze')

    rerender(<EditInventorySheet product={item(LINK_B)} open onOpenChange={vi.fn()} />)
    await tick()

    expect(screen.getByLabelText(/^item name/i)).toHaveValue('Sterile gauze')
  })

  it('does not count a refreshed image link as an unsaved change', async () => {
    const { rerender } = renderWithRouter(
      <EditInventorySheet product={item(LINK_A)} open onOpenChange={vi.fn()} />
    )
    await waitFor(() => expect(screen.getByLabelText(/^item name/i)).toHaveValue('Gauze'))
    rerender(<EditInventorySheet product={item(LINK_B)} open onOpenChange={vi.fn()} />)
    await tick()

    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
  })
})

describe('Alert settings', () => {
  const config = (soundDataUrl: string) => ({
    success: true,
    data: { enabled: true, durationMinutes: 30, soundDataUrl, soundName: 'chime.mp3' },
  })

  function renderAlerts() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AlertsSection />
        </MemoryRouter>
      </QueryClientProvider>
    )
    return queryClient
  }

  it('keeps an unsaved duration when the settings are refetched with a fresh sound link', async () => {
    const user = userEvent.setup()
    mockGet.mockResolvedValue(config(LINK_A))
    const queryClient = renderAlerts()
    const duration = await screen.findByLabelText(/notify how many minutes/i)
    await waitFor(() => expect(duration).toHaveValue(30))
    await user.clear(duration)
    await user.type(duration, '45')

    // The always-mounted alarm monitor polls this same config every 5 minutes.
    mockGet.mockResolvedValue(config(LINK_B))
    await queryClient.refetchQueries()
    // The refreshed data has arrived once the sound preview carries the new link.
    await waitFor(() => expect(document.querySelector('audio')?.getAttribute('src')).toBe(LINK_B))

    expect(screen.getByLabelText(/notify how many minutes/i)).toHaveValue(45)
  })
})
