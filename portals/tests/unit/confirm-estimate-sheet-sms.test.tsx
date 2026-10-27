/**
 * G08 — the payment-confirmation text when reception confirms an estimate and takes a payment.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (G08) and step-10-handover.md.
 *
 * The sheet is real; its network calls, the method picker and the receipt printer are stubbed. The
 * server texts what was posted, once (`POST /api/worklist/:id/confirm` with `sendSms`). The sheet
 * offers the text only while a payment is being taken, on by default; a confirm with no payment asks
 * for none; a text that failed is said, and the confirm still counts.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
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

const { toast } = await import('sonner')

beforeAll(installRadixPolyfills)

beforeEach(() => {
  vi.mocked(api.get).mockImplementation((async (url: string) =>
    url.includes('/ledger')
      ? { success: true, data: { walletBalance: 0 } }
      : {
          success: true,
          data: { lines: [{ id: 'l1', description: 'Scaling', quantity: 1, lineTotal: 30000 }] },
        }) as never)
  vi.mocked(confirmEstimate).mockResolvedValue({
    success: true,
    data: { invoiceId: 'inv-1', paymentId: 'pay-1' },
  })
})
afterEach(() => vi.resetAllMocks())

function mount() {
  const onConfirmed = vi.fn()
  renderWithRouter(
    <ConfirmEstimateSheet
      appointmentId="appt-1"
      patientId="pat-1"
      patientName="Ama Mensah"
      estimateTotal={30000}
      estimateInvoiceId="inv-1"
      open
      onOpenChange={() => {}}
      onConfirmed={onConfirmed}
    />
  )
  return { onConfirmed }
}

const smsBox = () => screen.getByLabelText(/text the patient a payment confirmation/i)
const maybeSmsBox = () => screen.queryByLabelText(/text the patient a payment confirmation/i)

async function loaded() {
  await screen.findByText('Scaling')
}

async function submit(label: RegExp) {
  const button = screen.getByRole('button', { name: label })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
}

describe('the payment-confirmation text on confirming an estimate', () => {
  it('is offered while a payment is taken, and on by default', async () => {
    mount()
    await loaded()

    expect(smsBox()).toBeChecked()
  })

  it('is asked for with the payment', async () => {
    mount()
    await loaded()
    await submit(/confirm & accept payment/i)

    await waitFor(() => expect(confirmEstimate).toHaveBeenCalledTimes(1))
    expect(confirmEstimate).toHaveBeenCalledWith(
      'appt-1',
      [expect.objectContaining({ method: 'cash', amount: 30000 })],
      expect.objectContaining({ sendSms: true })
    )
  })

  it('is not asked for when it was switched off', async () => {
    mount()
    await loaded()
    fireEvent.click(smsBox())
    await submit(/confirm & accept payment/i)

    await waitFor(() => expect(confirmEstimate).toHaveBeenCalledTimes(1))
    expect(vi.mocked(confirmEstimate).mock.calls[0][2]).toMatchObject({ sendSms: false })
  })

  it('is neither offered nor asked for when no payment is taken', async () => {
    mount()
    await loaded()
    fireEvent.click(screen.getByText('Take payment now'))

    expect(maybeSmsBox()).not.toBeInTheDocument()
    await submit(/confirm \(issue\)/i)

    await waitFor(() => expect(confirmEstimate).toHaveBeenCalledTimes(1))
    expect(vi.mocked(confirmEstimate).mock.calls[0][2]).toMatchObject({ sendSms: false })
  })

  it('says so when the text failed, and the confirm still counts', async () => {
    vi.mocked(confirmEstimate).mockResolvedValue({
      success: true,
      data: { invoiceId: 'inv-1', paymentId: 'pay-1' },
      smsError: 'Gateway down',
    })
    const { onConfirmed } = mount()
    await loaded()
    await submit(/confirm & accept payment/i)

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/text.*Gateway down/i))
    )
    expect(toast.error).not.toHaveBeenCalled()
    expect(onConfirmed).toHaveBeenCalledTimes(1)
  })
})
