/**
 * F11 — a plan payment taken at check-in names its visit.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (F11).
 *
 * The Receive Payment dialog posts one draft payment per source. When it is opened
 * from a check-in, each draft must carry the visit's id, so the payment is tied to
 * the visit and the ledger's cancelled/no-show guard has something to check.
 *
 * The dialog is real; its network calls and the method picker are stubbed.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/actions/invoices-v2', () => ({
  listPlanInvoices: vi.fn(async () => ({
    success: true,
    data: [
      {
        id: 'inv-1',
        invoiceNumber: 'INV-1',
        status: 'issued',
        balance: 100000,
        dueDate: null,
      },
    ],
  })),
  listPatientInvoices: vi.fn(async () => ({ success: true, data: [] })),
}))
vi.mock('@/lib/actions/payments-v2', () => ({
  createDraftPayment: vi.fn(async () => ({ success: true, data: { id: 'draft-1' } })),
  postDraftPayment: vi.fn(async () => ({ success: true, data: {} })),
}))
vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn(async () => ({ success: true, data: { walletBalance: 0 } })) },
}))
vi.mock('@/shared/components/payment-method-select', () => ({
  PaymentMethodSelect: () => <span>method select</span>,
}))
// Outside check-in the receipt shows after a posting and holds `onPosted` until it is closed;
// this file is about the draft, so printing is stubbed out.
vi.mock('react-to-print', () => ({ useReactToPrint: () => vi.fn() }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import { ReceivePaymentDialog } from '@/features/payments/components/receive-payment-dialog'
import { createDraftPayment } from '@/lib/actions/payments-v2'
import { renderWithRouter } from './_test-utils'

const mockDraft = vi.mocked(createDraftPayment)

beforeAll(() => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>
  proto.hasPointerCapture ??= () => false
  proto.setPointerCapture ??= () => {}
  proto.releasePointerCapture ??= () => {}
  proto.scrollIntoView ??= () => {}
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
beforeEach(() => mockDraft.mockClear())
afterEach(() => vi.clearAllMocks())

async function postOne(extra: Record<string, unknown> = {}) {
  const onPosted = vi.fn()
  renderWithRouter(
    <ReceivePaymentDialog
      open
      onOpenChange={() => {}}
      patientId="pat-1"
      planId="plan-1"
      onPosted={onPosted}
      {...extra}
    />
  )
  const amount = await screen.findByPlaceholderText('0.00')
  fireEvent.change(amount, { target: { value: '100.00' } })
  const post = screen.getByRole('button', { name: /post payment/i })
  await waitFor(() => expect(post).toBeEnabled())
  fireEvent.click(post)
  // The draft is what this file is about. (At a visit `onPosted` follows at once; elsewhere it
  // waits for the receipt to be closed, which `receive-payment-dialog.test.tsx` covers.)
  await waitFor(() => expect(mockDraft).toHaveBeenCalledTimes(1))
}

describe('a plan payment taken at check-in', () => {
  it('names the visit on every draft payment it creates', async () => {
    await postOne({ appointmentId: 'appt-1' })

    expect(mockDraft).toHaveBeenCalledTimes(1)
    expect(mockDraft.mock.calls[0][0]).toMatchObject({
      patientId: 'pat-1',
      paymentPlanId: 'plan-1',
      appointmentId: 'appt-1',
      amount: 10000,
    })
  })

  it('outside check-in, the draft names no visit (nothing else changes)', async () => {
    await postOne()

    expect(mockDraft).toHaveBeenCalledTimes(1)
    expect(mockDraft.mock.calls[0][0].appointmentId ?? null).toBeNull()
  })
})
