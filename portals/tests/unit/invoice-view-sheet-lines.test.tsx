/**
 * Review of Step 10 (§8.16) — the printed invoice of a first-unit / additional-unit line (G01).
 *
 * The invoice the patient is handed has a Qty, a Unit price and an Amount column. A stepped line
 * stores the first unit's price, so "3 × GHS 100.00 = GHS 220.00" did not add up on the paper. The
 * unit price cell now says what each further unit cost.
 *
 * The sheet is real; its network calls and the print hook are stubbed.
 */
import { screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/actions/invoices-v2', () => ({
  getInvoice: vi.fn(),
  listInvoiceLines: vi.fn(),
  voidInvoice: vi.fn(),
}))
vi.mock('@/lib/actions/branding', () => ({
  getBranding: vi.fn(async () => ({ success: true, data: { name: 'Denel Dental Clinic' } })),
}))
vi.mock('@/lib/branding-context', () => ({ useBranding: () => ({ name: 'Denel Dental Clinic' }) }))
vi.mock('@/lib/permissions-context', () => ({ usePermissions: () => ({ isAdmin: false }) }))
// One function for every render: the sheet's load effect depends on it, so a new one each render
// would reload the invoice for ever.
const { printNow } = vi.hoisted(() => ({ printNow: vi.fn() }))
vi.mock('react-to-print', () => ({ useReactToPrint: () => printNow }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import { InvoiceViewSheet } from '@/features/payments/components/invoice-view-sheet'
import { getInvoice, listInvoiceLines } from '@/lib/actions/invoices-v2'
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
  discountAmount: 0,
  lineSubtotal: 22000,
  lineTotal: 22000,
  ...over,
})

beforeEach(() => {
  vi.mocked(getInvoice).mockResolvedValue({
    success: true,
    data: {
      id: 'inv-1',
      invoiceNumber: 'INV-0042',
      status: 'issued',
      subtotal: 22000,
      discountTotal: 0,
      taxTotal: 0,
      total: 22000,
      balance: 22000,
    },
  } as never)
})
afterEach(() => vi.resetAllMocks())

function mount() {
  renderWithRouter(
    <InvoiceViewSheet open onOpenChange={() => {}} invoiceId="inv-1" patientName="Ama Mensah" />
  )
}

async function rowOf(description: string) {
  return (await screen.findByText(description)).closest('tr') as HTMLElement
}

describe('the printed invoice', () => {
  it('says what each further unit of a stepped line cost', async () => {
    vi.mocked(listInvoiceLines).mockResolvedValue({ success: true, data: [line({})] } as never)
    mount()

    const row = await rowOf('Night guard')
    expect(within(row).getByText(/then GHS 60\.00 each/)).toBeInTheDocument()
    expect(row).toHaveTextContent('GHS 100.00')
    expect(row).toHaveTextContent('GHS 220.00')
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
