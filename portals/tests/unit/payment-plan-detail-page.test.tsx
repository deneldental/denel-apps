/**
 * The payment-plan page (F05) — see project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (§8.11).
 *
 * Opening a plan from the payments table asked the API for a route that did not exist, and the page
 * answered by rendering nothing at all (no plan, no error, no way back). It now shows a loading
 * state, a "not found" state, a "no access" state and an error state with a retry, and for a plan
 * that loads it shows the totals the SERVER worked out (money received comes from posted
 * allocations, which a sum over the rows on screen could not know) and each payment once, labelled
 * Posted or Reversed, with a receipt button.
 *
 * The backend rule for what is counted is pinned in
 * backend/tests/integration/payment-plan-detail.test.ts.
 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PaymentPlanPage from '@/features/payment-plans/pages/detail'
import type { PaymentPlanDetail } from '@/lib/actions/payment-plans'
import { formatCurrency } from '@/shared/utils/currency'
import { renderWithRouter } from './_test-utils'

vi.mock('@/lib/actions/payment-plans', () => ({ getPaymentPlanDetails: vi.fn() }))
vi.mock('@/lib/actions/payment-plans-v2', () => ({
  getPlanSchedule: vi.fn(async () => ({ success: true, data: [] })),
  recomputePlanSchedule: vi.fn(),
}))
vi.mock('@/lib/api-client', () => ({ api: { get: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/features/payments/components/receipt-view-dialog', () => ({
  ReceiptViewDialog: ({
    open,
    receiptData,
  }: {
    open: boolean
    receiptData: { patientName: string }
  }) => (open ? <div role="dialog">Receipt for {receiptData.patientName}</div> : null),
}))

import { toast } from 'sonner'
import { getPaymentPlanDetails } from '@/lib/actions/payment-plans'
import { api } from '@/lib/api-client'

const load = vi.mocked(getPaymentPlanDetails)
const getReceipt = vi.mocked(api.get)

const plan = (over: Partial<PaymentPlanDetail> = {}): PaymentPlanDetail => ({
  id: 'plan-1',
  planNumber: 'PP-0001',
  patientId: 'pat-1',
  type: 'flexible',
  scheduleType: 'flexible',
  status: 'activated',
  archived: false,
  startDate: '2026-10-01T00:00:00.000Z',
  endDate: null,
  notes: null,
  originalAmount: 100_000,
  discountAmount: 0,
  totalAmount: 100_000,
  amountPerInstallment: null,
  numberOfInstallments: null,
  paymentFrequency: null,
  installmentPeriod: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  patient: {
    id: 'pat-1',
    name: 'Ama Mensah',
    phone: '0240000001',
    email: 'ama@example.test',
    patientId: 'P-001',
    isChild: false,
    guardianPhone: null,
  },
  invoice: {
    id: 'inv-1',
    invoiceNumber: 'INV-2026-00001',
    status: 'partially_paid',
    total: 100_000,
    paidAmount: 30_000,
    balance: 70_000,
  },
  totals: { total: 100_000, paid: 30_000, balance: 70_000 },
  payments: [
    {
      id: 'pay-posted',
      paymentNumber: 'PAY-0001',
      paymentDate: '2026-10-10',
      createdAt: '2026-10-10T09:00:00.000Z',
      method: 'cash',
      status: 'posted',
      amount: 30_000,
      appliedToPlan: 30_000,
      description: null,
      paymentGroupId: null,
    },
    {
      id: 'pay-reversed',
      paymentNumber: 'PAY-0002',
      paymentDate: '2026-10-11',
      createdAt: '2026-10-11T09:00:00.000Z',
      method: 'momo',
      status: 'reversed',
      amount: 20_000,
      appliedToPlan: 20_000,
      description: null,
      paymentGroupId: null,
    },
  ],
  ...over,
})

function renderPage(id = 'plan-1') {
  return renderWithRouter(
    <Routes>
      <Route path="/payment-plans/:id" element={<PaymentPlanPage />} />
    </Routes>,
    { initialRoute: `/payment-plans/${id}` }
  )
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('while it loads', () => {
  it('shows a loading state, not a blank page', () => {
    load.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByLabelText('Loading payment plan')).toBeInTheDocument()
  })
})

describe('when the plan loads', () => {
  it('shows the totals the server worked out, not a sum of the rows on screen', async () => {
    load.mockResolvedValue({ success: true, data: plan() })
    renderPage()

    await waitFor(() => expect(screen.getByTestId('plan-total')).toBeInTheDocument())
    expect(screen.getByTestId('plan-total')).toHaveTextContent(formatCurrency(100_000))
    // The two rows add up to 50 000, but the reversed one was not received.
    expect(screen.getByTestId('plan-paid')).toHaveTextContent(formatCurrency(30_000))
    expect(screen.getByTestId('plan-paid')).not.toHaveTextContent(formatCurrency(50_000))
    expect(screen.getByTestId('plan-balance')).toHaveTextContent(formatCurrency(70_000))
  })

  it('lists each payment once, labelled Posted or Reversed', async () => {
    load.mockResolvedValue({ success: true, data: plan() })
    renderPage()

    const posted = await screen.findByTestId('payment-pay-posted')
    const reversed = screen.getByTestId('payment-pay-reversed')
    expect(within(posted).getByText('Posted')).toBeInTheDocument()
    expect(within(reversed).getByText('Reversed')).toBeInTheDocument()
    expect(screen.getAllByTestId(/^payment-pay-/)).toHaveLength(2)
  })

  it('says so when there are no payments yet', async () => {
    load.mockResolvedValue({
      success: true,
      data: plan({ payments: [], totals: { total: 100_000, paid: 0, balance: 100_000 } }),
    })
    renderPage()
    expect(await screen.findByText('No payments have been made yet.')).toBeInTheDocument()
  })

  it('asks for the plan that is in the address', async () => {
    load.mockResolvedValue({ success: true, data: plan({ id: 'plan-42' }) })
    renderPage('plan-42')
    await screen.findByTestId('plan-total')
    expect(load).toHaveBeenCalledWith('plan-42')
  })

  it('shows the patient, the master invoice and the contact details', async () => {
    load.mockResolvedValue({ success: true, data: plan() })
    renderPage()
    expect(await screen.findByText('Ama Mensah')).toBeInTheDocument()
    expect(screen.getByText(/INV-2026-00001/)).toBeInTheDocument()
    expect(screen.getByText('0240000001')).toBeInTheDocument()
    expect(screen.getByText('ama@example.test')).toBeInTheDocument()
  })
})

describe('when it cannot be shown', () => {
  it('says the plan was not found', async () => {
    load.mockResolvedValue({ success: false, error: 'Payment plan not found' })
    renderPage()
    expect(await screen.findByText('Payment plan not found')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to payments' })).toBeInTheDocument()
  })

  it('says the same for an address that is not a plan id', async () => {
    load.mockResolvedValue({ success: false, error: 'Invalid payment plan id' })
    renderPage('nonsense')
    expect(await screen.findByText('Payment plan not found')).toBeInTheDocument()
  })

  it('says the role has no access', async () => {
    load.mockResolvedValue({ success: false, error: 'Unauthorized' })
    renderPage()
    expect(await screen.findByText("You don't have access to payment plans")).toBeInTheDocument()
  })

  it('shows an error with a way to try again, and tries again', async () => {
    load.mockResolvedValueOnce({ success: false, error: 'Failed to load payment plan' })
    renderPage()
    expect(await screen.findByText('Could not load this payment plan')).toBeInTheDocument()
    expect(screen.getByText('Failed to load payment plan')).toBeInTheDocument()

    load.mockResolvedValueOnce({ success: true, data: plan() })
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByTestId('plan-total')).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('the receipt button', () => {
  it('offers a receipt for a posted payment only, not for a reversed one', async () => {
    load.mockResolvedValue({ success: true, data: plan() })
    renderPage()

    await screen.findByTestId('payment-pay-posted')
    expect(screen.getByRole('button', { name: 'View receipt for PAY-0001' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'View receipt for PAY-0002' })
    ).not.toBeInTheDocument()
  })

  it("fetches that payment's receipt and opens it", async () => {
    load.mockResolvedValue({ success: true, data: plan() })
    getReceipt.mockResolvedValue({
      success: true,
      data: { patientName: 'Ama Mensah', amountPaid: 30_000 },
    } as never)
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'View receipt for PAY-0001' }))
    expect(getReceipt).toHaveBeenCalledWith('/api/payments/pay-posted/receipt')
    expect(await screen.findByRole('dialog')).toHaveTextContent('Receipt for Ama Mensah')
  })

  it('reports a receipt that could not be loaded and opens nothing', async () => {
    load.mockResolvedValue({ success: true, data: plan() })
    getReceipt.mockResolvedValue({ success: false, error: 'boom' } as never)
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'View receipt for PAY-0001' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to load receipt'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
