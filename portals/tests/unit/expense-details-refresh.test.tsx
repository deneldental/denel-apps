/**
 * Expenses → an expense's details. The sheet used to keep the copy of the
 * expense it was opened with, so after the list refreshed its attachment
 * button still opened the old (eventually expired) link. It now reads the
 * current copy of the same expense.
 */
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))
vi.mock('@/shared/hooks/use-permissions', () => ({
  usePermissions: () => ({
    permissions: {},
    menuItems: [],
    isAdmin: false,
    roleId: 'receptionist',
    roleName: 'Receptionist',
    isLoading: false,
    error: null,
    hasPermission: () => true,
    canAccess: () => true,
    refetch: async () => {},
  }),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { ExpensesClient } from '@/features/expenses/pages/expenses-client'
import { api } from '@/lib/api-client'
import { renderWithRouter } from './_test-utils'

beforeEach(() => vi.mocked(api.get).mockResolvedValue({ success: true, data: [] }))
afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

const link = (window: string) =>
  `https://denel-private.acct.r2.cloudflarestorage.com/expenses/2026/SEPTEMBER/receipt.pdf?X-Amz-Date=20260927T${window}00Z&X-Amz-Signature=${window}`

const expenses = (window: string) =>
  [
    {
      id: 'e-1',
      category: 'Supplies',
      paymentMethod: 'cash',
      amount: 5000,
      date: '2026-09-20',
      paidTo: 'Kofi Store',
      description: 'Gloves',
      attachmentUrl: link(window),
      createdAt: '2026-09-20T10:00:00Z',
      updatedAt: '2026-09-20T10:00:00Z',
    },
  ] as never[]

describe('Expense details after a refresh', () => {
  it('opens the current attachment link', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { rerender } = renderWithRouter(<ExpensesClient expenses={expenses('1000')} />)
    fireEvent.click(screen.getByText('Kofi Store'))

    rerender(<ExpensesClient expenses={expenses('1100')} />)
    fireEvent.click(screen.getByRole('button', { name: /receipt\.pdf/i }))

    expect(open).toHaveBeenCalledWith(link('1100'), '_blank', 'noopener,noreferrer')
  })
})
