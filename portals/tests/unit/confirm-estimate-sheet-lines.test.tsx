/**
 * Review of Step 10 (§8.16), F88 — the confirm-estimate sheet sends the lines reception ticked.
 *
 * The sheet lets reception untick estimate lines and says "Unchecked items split into a new draft
 * estimate", but it never sent the selection, so the server issued every line and the patient was
 * invoiced for the unticked ones. It now sends `acceptedLineItemIds` (the server's split is pinned
 * in backend `worklist-confirm-split.test.ts`).
 *
 * The sheet is real; its network calls, the method picker and the receipt printer are stubbed.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/actions/worklist', () => ({ confirmEstimate: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ api: { get: vi.fn() } }))
vi.mock('@/shared/components/payment-method-select', () => ({
  PaymentMethodSelect: ({ value }: { value: string }) => <span>{`method ${value}`}</span>,
}))
vi.mock('@/shared/utils/receipt', () => ({ generatePaymentReceipt: vi.fn() }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import { ConfirmEstimateSheet } from '@/features/activity/components/confirm-estimate-sheet'
import { confirmEstimate } from '@/lib/actions/worklist'
import { api } from '@/lib/api-client'
import { installRadixPolyfills } from './_service-lines-kit'
import { renderWithRouter } from './_test-utils'

beforeAll(installRadixPolyfills)

beforeEach(() => {
  vi.mocked(api.get).mockImplementation((async (url: string) =>
    url.includes('/ledger')
      ? { success: true, data: { walletBalance: 0 } }
      : {
          success: true,
          data: {
            lines: [
              { id: 'l1', description: 'Scaling', quantity: 1, lineTotal: 30000 },
              { id: 'l2', description: 'Whitening', quantity: 1, lineTotal: 20000 },
            ],
          },
        }) as never)
  vi.mocked(confirmEstimate).mockResolvedValue({
    success: true,
    data: { invoiceId: 'inv-1', paymentId: 'pay-1' },
  })
})
afterEach(() => vi.resetAllMocks())

function mount() {
  renderWithRouter(
    <ConfirmEstimateSheet
      appointmentId="appt-1"
      patientId="pat-1"
      patientName="Ama Mensah"
      estimateTotal={50000}
      estimateInvoiceId="inv-1"
      open
      onOpenChange={() => {}}
      onConfirmed={() => {}}
    />
  )
}

const lineBox = (name: string) =>
  within(screen.getByText(name).closest('label') as HTMLElement).getByRole('checkbox')

async function submit() {
  const button = screen.getByRole('button', { name: /confirm & accept payment/i })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
}

describe('the lines reception ticked', () => {
  it('are sent, so an unticked line is not invoiced', async () => {
    mount()
    await screen.findByText('Whitening')
    fireEvent.click(lineBox('Whitening'))
    await submit()

    await waitFor(() => expect(confirmEstimate).toHaveBeenCalledTimes(1))
    const [, payments, opts] = vi.mocked(confirmEstimate).mock.calls[0]
    expect(opts).toMatchObject({ acceptedLineItemIds: ['l1'] })
    // The payment offered is the ticked lines' total.
    expect(payments).toEqual([expect.objectContaining({ amount: 30000 })])
  })

  it('leave an amount reception typed alone', async () => {
    mount()
    await screen.findByText('Whitening')
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '100' } })
    fireEvent.click(lineBox('Whitening'))
    await submit()

    await waitFor(() => expect(confirmEstimate).toHaveBeenCalledTimes(1))
    expect(vi.mocked(confirmEstimate).mock.calls[0][1]).toEqual([
      expect.objectContaining({ amount: 10000 }),
    ])
  })

  it('are all sent when every line is ticked', async () => {
    mount()
    await screen.findByText('Whitening')
    await submit()

    await waitFor(() => expect(confirmEstimate).toHaveBeenCalledTimes(1))
    expect(vi.mocked(confirmEstimate).mock.calls[0][2]).toMatchObject({
      acceptedLineItemIds: ['l1', 'l2'],
    })
  })
})
