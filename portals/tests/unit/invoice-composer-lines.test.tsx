/**
 * Review of Step 10 (§8.16) — a first-unit / additional-unit line in the invoice composer (G01).
 *
 * The composer lists each line's quantity, unit price and total. A stepped line stores the first
 * unit's price, so "3 × GH₵100.00 = GH₵220.00" did not add up. The unit price cell now says what
 * each further unit cost. The page is real; its network calls are stubbed.
 */
import { screen, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/actions/invoices-v2', () => ({
  getInvoice: vi.fn(),
  listInvoiceLines: vi.fn(),
  addInvoiceLine: vi.fn(),
  removeInvoiceLine: vi.fn(),
  issueInvoice: vi.fn(),
  voidInvoice: vi.fn(),
  applyInvoiceCredit: vi.fn(),
}))
vi.mock('@/lib/actions/accounting', () => ({
  listAccounts: vi.fn(async () => ({ success: true, data: [] })),
}))
vi.mock('@/lib/actions/credit-notes', () => ({
  listCreditNotes: vi.fn(async () => ({ success: true, data: [] })),
}))
vi.mock('@/lib/actions/payments-v2', () => ({
  getPatientCredit: vi.fn(async () => ({ success: true, data: { depositBalance: 0 } })),
}))
vi.mock('@/lib/actions/specialists', () => ({
  listSpecialists: vi.fn(async () => ({ success: true, data: [] })),
}))
vi.mock('@/lib/permissions-context', () => ({ usePermissions: () => ({ isAdmin: false }) }))
vi.mock('@/features/audit-logs/components/view-audit-history-link', () => ({
  ViewAuditHistoryLink: () => null,
}))
vi.mock('@/features/payments/components/receive-payment-dialog', () => ({
  ReceivePaymentDialog: () => null,
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import InvoiceComposerPage from '@/features/invoices/pages/invoice-composer'
import { getInvoice, listInvoiceLines } from '@/lib/actions/invoices-v2'
import { formatCurrency } from '@/shared/utils/currency'
import { installRadixPolyfills } from './_service-lines-kit'
import { renderWithRouter } from './_test-utils'

beforeAll(installRadixPolyfills)

const line = (over: Record<string, unknown>) => ({
  id: 'l1',
  invoiceId: 'inv-1',
  lineNumber: 1,
  description: 'Night guard',
  quantity: 3,
  unitPrice: 10000,
  discountType: 'none',
  discountValue: 0,
  discountAmount: 0,
  lineSubtotal: 22000,
  lineAfterDiscount: 22000,
  taxRate: 0,
  taxAmount: 0,
  lineTotal: 22000,
  revenueAccountId: 'acc-1',
  deferRevenue: false,
  ...over,
})

beforeEach(() => {
  vi.mocked(getInvoice).mockResolvedValue({
    success: true,
    data: {
      id: 'inv-1',
      invoiceNumber: 'INV-0042',
      patientId: 'pat-1',
      status: 'draft',
      currency: 'GHS',
      subtotal: 22000,
      discountTotal: 0,
      taxableAmount: 22000,
      taxTotal: 0,
      total: 22000,
      balance: 0,
    },
  } as never)
})
afterEach(() => vi.resetAllMocks())

function mount() {
  renderWithRouter(
    <Routes>
      <Route path="/invoices/:id" element={<InvoiceComposerPage />} />
    </Routes>,
    { initialRoute: '/invoices/inv-1' }
  )
}

async function rowOf(description: string) {
  return (await screen.findByText(description)).closest('tr') as HTMLElement
}

describe('the invoice composer', () => {
  it('says what each further unit of a stepped line cost', async () => {
    vi.mocked(listInvoiceLines).mockResolvedValue({ success: true, data: [line({})] } as never)
    mount()

    const row = await rowOf('Night guard')
    expect(within(row).getByText(`then ${formatCurrency(6000)} each`)).toBeInTheDocument()
  })

  it('reads a flat line as before', async () => {
    vi.mocked(listInvoiceLines).mockResolvedValue({
      success: true,
      data: [line({ description: 'Scaling', lineSubtotal: 30000, lineTotal: 30000 })],
    } as never)
    mount()

    const row = await rowOf('Scaling')
    expect(within(row).queryByText(/each/)).not.toBeInTheDocument()
  })
})
