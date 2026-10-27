/**
 * Review of Step 10 (§8.16) — a payment plan built from an estimate schedules what the server bills.
 *
 * Converting an estimate, the server bills it exactly: the plan's total is what the estimate still
 * owes (`balance`), and the installments are that total divided by the number the sheet sends. The
 * sheet worked the total out again from each line's unit price × quantity, which drops a surcharge,
 * a discount, tax and the first-unit / additional-unit step (G01), and it did not subtract a deposit
 * already paid. So the plan it showed, and the number of installments it sent, disagreed with the
 * plan the server made: the patient's installments were not the amount reception typed.
 *
 * The sheet is real; its network calls are stubbed.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/actions/payment-plans', () => ({
  createPaymentPlanWithLines: vi.fn(),
  updatePaymentPlan: vi.fn(),
}))
vi.mock('@/lib/actions/services', () => ({
  getServices: vi.fn(async () => ({ success: true, data: [] })),
  getServiceDoctors: vi.fn(async () => ({ success: true, data: [] })),
}))
vi.mock('@/lib/actions/specialists', () => ({
  listSpecialistDirectory: vi.fn(async () => ({ success: true, data: [] })),
}))
vi.mock('@/lib/api-client', () => ({ api: { get: vi.fn() } }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import { PaymentPlanSheet } from '@/features/payment-plans/components/payment-plan-sheet'
import { createPaymentPlanWithLines } from '@/lib/actions/payment-plans'
import { api } from '@/lib/api-client'
import { formatAmount, formatCurrency } from '@/shared/utils/currency'
import { installRadixPolyfills } from './_service-lines-kit'
import { renderWithRouter } from './_test-utils'

beforeAll(installRadixPolyfills)

/** A 3-unit stepped line billed 220.00 (100.00 + 2 × 60.00), plus a 100.00 line less 10%. */
const ESTIMATE = {
  total: 31000,
  paidAmount: 0,
  balance: 31000,
  lines: [
    {
      serviceId: null,
      description: 'Night Guard',
      quantity: 3,
      unitPrice: 10000,
      lineTotal: 22000,
    },
    { serviceId: null, description: 'Scaling', quantity: 1, unitPrice: 10000, lineTotal: 9000 },
  ],
}

let estimate: typeof ESTIMATE

beforeEach(() => {
  estimate = structuredClone(ESTIMATE)
  vi.mocked(api.get).mockImplementation((async () => ({ success: true, data: estimate })) as never)
  vi.mocked(createPaymentPlanWithLines).mockResolvedValue({ success: true, data: {} } as never)
})
afterEach(() => vi.resetAllMocks())

function mount() {
  renderWithRouter(
    <PaymentPlanSheet patientId="pat-1" sourceInvoiceId="inv-1" open onOpenChange={() => {}} />
  )
}

/** An amount as the line editor prints it (without the currency), escaped for a pattern. */
const formatAmountIn = (cents: number) => formatAmount(cents).replace(/[.,]/g, '\\$&')

const perInstallment = () => screen.getByLabelText(/per installment/i)
const installments = () => screen.getByLabelText(/no\. of installments/i)

describe('a plan built from an estimate', () => {
  it('shows the estimate’s own total, not unit price × quantity', async () => {
    mount()
    await screen.findByText('Night Guard')

    // 220.00 + 90.00, not 300.00 + 100.00 — in the line editor's footer and the plan's summary.
    const totals = await screen.findAllByText(/plan total/i)
    expect(totals.length).toBeGreaterThan(0)
    for (const t of totals) {
      // The editor prints "GHS 310.00", the summary "GH₵310.00": the amount is what matters.
      expect(t.parentElement).toHaveTextContent(formatAmount(31000))
    }
    expect(screen.queryByText(new RegExp(formatAmountIn(40000)))).not.toBeInTheDocument()
  })

  it('sends the number of installments that the estimate’s total makes', async () => {
    mount()
    await screen.findByText('Night Guard')
    fireEvent.change(perInstallment(), { target: { value: '100' } })

    // 310.00 at 100.00 each is 4 installments (the old 400.00 made it 4 as well, so check 155.00).
    fireEvent.change(perInstallment(), { target: { value: '155' } })
    expect(installments()).toHaveValue(2)
    fireEvent.click(screen.getByRole('button', { name: /create|save/i }))

    await waitFor(() => expect(createPaymentPlanWithLines).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createPaymentPlanWithLines).mock.calls[0][0]).toMatchObject({
      sourceInvoiceId: 'inv-1',
      numberOfInstallments: 2,
    })
  })

  it('schedules only what is still owed when a deposit was paid', async () => {
    estimate.paidAmount = 11000
    estimate.balance = 20000
    mount()
    await screen.findByText('Night Guard')
    fireEvent.change(perInstallment(), { target: { value: '100' } })

    expect(installments()).toHaveValue(2)
    expect(screen.getByText(/plan total/i)).toHaveTextContent(formatCurrency(20000))
  })

  it('refuses an installment above what is still owed', async () => {
    estimate.paidAmount = 11000
    estimate.balance = 20000
    mount()
    await screen.findByText('Night Guard')
    fireEvent.change(perInstallment(), { target: { value: '250' } })
    fireEvent.click(screen.getByRole('button', { name: /create|save/i }))

    const { toast } = await import('sonner')
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/cannot exceed the plan total/i)
      )
    )
    expect(createPaymentPlanWithLines).not.toHaveBeenCalled()
  })
})
