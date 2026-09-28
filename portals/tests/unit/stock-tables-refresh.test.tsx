/**
 * Products and Inventory lists: a background refetch (every 15 minutes a
 * product's image link is re-signed) must not rebuild each row's actions cell —
 * that is where an open Edit or Adjust-stock sheet lives, so rebuilding it
 * closed the sheet and threw the user's edits away.
 */
import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { InventoryClient } from '@/features/inventory/pages/inventory-client'
import { ProductList } from '@/features/products/components/product-list'
import { api } from '@/lib/api-client'
import { renderWithRouter } from './_test-utils'

beforeEach(() => vi.mocked(api.get).mockResolvedValue({ success: true, data: [] }))
afterEach(() => vi.clearAllMocks())

const items = (window: string) =>
  ['Gloves', 'Gauze'].map((name, i) => ({
    id: `item-${i}`,
    name,
    image: `https://denel-private.acct.r2.cloudflarestorage.com/products/${name}.jpg?X-Amz-Date=20260927T${window}00Z`,
    stockQuantity: 5,
    unit: 'pack',
    category: 'Consumables',
    price: 1000,
    costPrice: 800,
  })) as never[]

const onReload = () => {}

describe('Product list', () => {
  it('keeps each row actions cell when a refetch brings fresh image links', () => {
    const { rerender } = renderWithRouter(<ProductList data={items('1000')} onReload={onReload} />)
    const before = screen.getAllByRole('button', { name: /open menu/i })

    rerender(<ProductList data={items('1015')} onReload={onReload} />)

    const after = screen.getAllByRole('button', { name: /open menu/i })
    expect(after).toHaveLength(before.length)
    for (const [i, button] of after.entries()) expect(button).toBe(before[i])
  })
})

describe('Inventory list', () => {
  it('keeps each row actions cell when a refetch brings fresh image links', () => {
    const { rerender } = renderWithRouter(
      <InventoryClient products={items('1000')} onReload={onReload} />
    )
    const before = screen.getAllByRole('button', { name: /open menu/i })

    rerender(<InventoryClient products={items('1015')} onReload={onReload} />)

    const after = screen.getAllByRole('button', { name: /open menu/i })
    expect(after).toHaveLength(before.length)
    for (const [i, button] of after.entries()) expect(button).toBe(before[i])
  })
})
