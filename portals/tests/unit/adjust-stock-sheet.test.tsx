/**
 * settings-domain-audit S5-B (inventory): the Adjust stock sheet is the one
 * way to change a quantity — it previews the result, refuses a no-op, and
 * offers the reason codes configured in Settings → Inventory → Store Policies.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}))
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import { AdjustStockSheet } from '@/features/inventory/components/adjust-stock-sheet'
import { api } from '@/lib/api-client'
import { renderWithRouter } from './_test-utils'

const mockApiGet = vi.mocked(api.get)
const mockApiPost = vi.mocked(api.post)

const product = { id: 'item-1', name: 'Gloves', stockQuantity: 10, unit: 'box' }

describe('AdjustStockSheet', () => {
  beforeEach(() => {
    mockApiGet.mockImplementation(async (path: string) =>
      path.includes('inventory:policies')
        ? { success: true, data: { adjustmentReasons: ['Breakage', 'Donation'] } }
        : { success: true, data: [] }
    )
  })
  afterEach(() => vi.clearAllMocks())

  it('shows the current stock and refuses a count that matches it', async () => {
    renderWithRouter(<AdjustStockSheet product={product} open onOpenChange={vi.fn()} />)
    expect(await screen.findByText(/currently 10 box/i)).toBeInTheDocument()

    // "New count" is both the mode radio and the quantity field; the field is the spinbutton.
    fireEvent.change(screen.getByRole('spinbutton', { name: /new count/i }), {
      target: { value: '10' },
    })
    expect(await screen.findByText(/no change/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /record adjustment/i })).toBeDisabled()
    expect(mockApiPost).not.toHaveBeenCalled()
  })

  it('previews the resulting quantity for a difference', async () => {
    renderWithRouter(<AdjustStockSheet product={product} open onOpenChange={vi.fn()} />)
    fireEvent.click(await screen.findByLabelText(/add or remove/i))
    fireEvent.change(screen.getByLabelText(/difference/i), { target: { value: '-3' } })
    expect(await screen.findByText(/10\s*→\s*7/)).toBeInTheDocument()
  })

  it('loads the configured reason codes', async () => {
    renderWithRouter(<AdjustStockSheet product={product} open onOpenChange={vi.fn()} />)
    await waitFor(() =>
      expect(mockApiGet).toHaveBeenCalledWith('/api/settings/kv/inventory:policies')
    )
  })
})
