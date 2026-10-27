/**
 * Pins the fix for the Medium finding "Restoring an archived invoice/payment
 * plan doesn't refresh the Ledger tab or Outstanding Balance"
 * (project-docs/patient-records-and-scheduling-audit.md): only this tab's
 * own query key was invalidated, not the sibling ledger query. The reverse
 * direction (archiving) already refreshed correctly.
 */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArchivedTab } from '@/features/patients/components/archived-tab'
import { renderWithRouter } from './_test-utils'

vi.mock('@/lib/actions/invoices-v2', () => ({
  listArchivedInvoices: vi.fn().mockResolvedValue({
    success: true,
    data: [
      {
        id: 'inv-1',
        invoiceNumber: 'INV-0001',
        status: 'issued',
        amount: 100,
        archivedAt: '2026-09-01T00:00:00Z',
        archivedBy: 'u-1',
      },
    ],
  }),
  unarchiveInvoice: vi.fn().mockResolvedValue({ success: true, data: {} }),
  permanentlyDeleteInvoice: vi.fn(),
}))
vi.mock('@/lib/actions/payment-plans', () => ({
  getArchivedPaymentPlansByPatient: vi.fn().mockResolvedValue({ success: true, data: [] }),
  unarchivePaymentPlan: vi.fn(),
  permanentlyDeletePaymentPlan: vi.fn(),
}))

afterEach(() => vi.clearAllMocks())

describe('ArchivedTab — restore refreshes the ledger [Medium]', () => {
  it('calls onRefresh after successfully restoring an invoice', async () => {
    const onRefresh = vi.fn()
    const user = userEvent.setup()
    renderWithRouter(<ArchivedTab patientId="p-1" isAdmin={true} onRefresh={onRefresh} />)

    const restoreButton = await screen.findByRole('button', { name: /restore/i })
    await user.click(restoreButton)

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1))
  })
})
