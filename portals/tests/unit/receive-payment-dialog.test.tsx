/**
 * G05 — Receive Payment: what an invoice is for, what the patient owes, the receipt, the balance slip.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (G05) and step-10-handover.md.
 *
 * The dialog is real. Its network calls are stubbed, and so are the method picker and the two print
 * helpers (the receipt itself is drawn by the real receipt dialog). What these tests hold the dialog to:
 *
 *  • Each invoice being paid lists the services it is for: from its invoice lines, else from the
 *    treatments recorded on a legacy invoice; and it SAYS when the services could not be loaded,
 *    instead of saying there are none.
 *  • The patient's total outstanding balance is the SERVER's figure (the ledger's), across every
 *    open invoice, and a query that failed is never shown as zero: not the invoices, not the
 *    outstanding total, not the wallet credit.
 *  • A payment smaller than the invoice leaves it partly paid; a split across sources and invoices
 *    hands the money out in order.
 *  • After a payment the receipt shows by itself and the dialog finishes when it is dismissed, except
 *    at check-in, where the check-in must not wait for a receipt to be closed.
 *  • The outstanding-balance slip is separate from the receipt, printed only when asked, from the
 *    server's balances, and never as a slip of zeros.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/actions/invoices-v2', () => ({
  listPatientInvoices: vi.fn(),
  listPlanInvoices: vi.fn(),
  listInvoiceLines: vi.fn(),
}))
vi.mock('@/lib/actions/payments-v2', () => ({
  createDraftPayment: vi.fn(),
  postDraftPayment: vi.fn(),
}))
vi.mock('@/lib/api-client', () => ({ api: { get: vi.fn() } }))
vi.mock('@/shared/components/payment-method-select', () => ({
  PaymentMethodSelect: ({
    value,
    onValueChange,
  }: {
    value: string
    onValueChange: (v: string) => void
  }) => (
    <button type="button" onClick={() => onValueChange('wallet')}>
      {`method ${value}`}
    </button>
  ),
}))
vi.mock('@/shared/utils/receipt', () => ({
  openReceiptWindow: vi.fn(),
  printOutstandingBalanceSlip: vi.fn(),
}))
const { printReceipt } = vi.hoisted(() => ({ printReceipt: vi.fn() }))
vi.mock('react-to-print', () => ({ useReactToPrint: () => printReceipt }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import {
  deriveInvoiceDisplayItems,
  ReceivePaymentDialog,
} from '@/features/payments/components/receive-payment-dialog'
import { listInvoiceLines, listPatientInvoices, listPlanInvoices } from '@/lib/actions/invoices-v2'
import { createDraftPayment, postDraftPayment } from '@/lib/actions/payments-v2'
import { api } from '@/lib/api-client'
import { formatCurrency } from '@/shared/utils/currency'
import { openReceiptWindow, printOutstandingBalanceSlip } from '@/shared/utils/receipt'
import { renderWithRouter } from './_test-utils'

const { toast } = await import('sonner')

// ── Data the server would answer with ────────────────────────────────────────

interface Inv {
  id: string
  invoiceNumber: string
  status: string
  balance: number
  dueDate: string | null
  treatments?: Array<{ treatmentId?: string; name: string; amount: number }> | null
}

const inv = (over: Partial<Inv> & Pick<Inv, 'id' | 'invoiceNumber' | 'balance'>): Inv => ({
  status: 'issued',
  dueDate: null,
  treatments: null,
  ...over,
})
const A = inv({ id: 'inv-a', invoiceNumber: 'INV-A', balance: 50000, dueDate: '2026-10-01' })
const B = inv({ id: 'inv-b', invoiceNumber: 'INV-B', balance: 50000, dueDate: '2026-11-01' })

const line = (description: string, lineTotal: number) => ({
  id: `l-${description}`,
  description,
  lineTotal,
})

interface Ledger {
  walletBalance: number
  outstandingBalance: number
  outstandingInvoices: Array<{
    id: string
    invoiceNumber: string
    balance: number
    dueDate: string | null
  }>
}
const ledgerOf = (invoices: Inv[], walletBalance = 0): Ledger => ({
  walletBalance,
  outstandingBalance: invoices.reduce((s, i) => s + i.balance, 0),
  outstandingInvoices: invoices.map((i) => ({
    id: i.id,
    invoiceNumber: i.invoiceNumber,
    balance: i.balance,
    dueDate: i.dueDate,
  })),
})

const RECEIPT = {
  patientName: 'Ama Mensah',
  amountPaid: 10000,
  paymentType: 'cash',
  paymentFor: 'Scaling',
  clinicName: 'Denel Dental Clinic',
  generatedAt: '2026-10-27T10:00:00Z',
}

/** What each URL answers; a test replaces an entry to make that call fail. */
const answers: Record<'ledger' | 'ledgerAfter' | 'receipt' | 'patient', unknown> = {
  ledger: null,
  ledgerAfter: null,
  receipt: null,
  patient: null,
}
const ok = (data: unknown) => ({ success: true, data })
const failed = (error = 'nope') => ({ success: false, error })
let ledgerCalls = 0

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

beforeEach(() => {
  ledgerCalls = 0
  answers.ledger = ok(ledgerOf([A, B]))
  answers.ledgerAfter = null
  answers.receipt = ok(RECEIPT)
  answers.patient = ok({ name: 'Ama Mensah' })

  vi.mocked(api.get).mockImplementation((async (url: string) => {
    if (url.includes('/ledger')) {
      ledgerCalls += 1
      // The first read is the form's; later reads are after a posting, when a test wants them to differ.
      return ledgerCalls > 1 && answers.ledgerAfter ? answers.ledgerAfter : answers.ledger
    }
    if (url.includes('/receipt')) return answers.receipt
    return answers.patient
  }) as never)
  vi.mocked(listPatientInvoices).mockResolvedValue({ success: true, data: [A, B] as never })
  vi.mocked(listPlanInvoices).mockResolvedValue({ success: true, data: [A, B] as never })
  vi.mocked(listInvoiceLines).mockResolvedValue({ success: true, data: [] })
  vi.mocked(createDraftPayment).mockResolvedValue({ success: true, data: { id: 'pay-1' } } as never)
  vi.mocked(postDraftPayment).mockResolvedValue({ success: true, data: {} } as never)
  vi.mocked(openReceiptWindow).mockReturnValue({ close: vi.fn() } as unknown as Window)
})
afterEach(() => vi.resetAllMocks())

// ── Driving the dialog ───────────────────────────────────────────────────────

function mount(extra: Record<string, unknown> = {}) {
  const onPosted = vi.fn()
  const onOpenChange = vi.fn()
  const element = (open: boolean) => (
    <ReceivePaymentDialog
      open={open}
      onOpenChange={onOpenChange}
      patientId="pat-1"
      onPosted={onPosted}
      {...extra}
    />
  )
  const view = renderWithRouter(element(true))
  return { onPosted, onOpenChange, setOpen: (open: boolean) => view.rerender(element(open)) }
}

const postButton = () => screen.getByRole('button', { name: /post (payment|\d+ payments)/i })
const amountBoxes = () => screen.getAllByPlaceholderText('0.00')

/** Wait for the invoices and the ledger to have answered: the patient's debt row says "Loading…"
 *  until both have. (The services of each invoice load after that, and a test may hold them up.) */
async function loaded() {
  await screen.findByText(/invoices being paid/i)
  await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())
}

async function typeAmount(text: string, n = 0) {
  await waitFor(() => expect(amountBoxes().length).toBeGreaterThan(n))
  fireEvent.change(amountBoxes()[n], { target: { value: text } })
}

async function post() {
  await waitFor(() => expect(postButton()).toBeEnabled())
  fireEvent.click(postButton())
}

// ═════════════════════════════════════════════════════════════════════════════

describe('what each invoice is for', () => {
  it('lists the services on the invoice, each with its amount', async () => {
    vi.mocked(listInvoiceLines).mockResolvedValue({
      success: true,
      data: [line('Scaling and Polishing', 15000), line('Fluoride Treatment', 5000)] as never,
    })
    mount({ invoiceId: 'inv-a' })

    expect(await screen.findByText('Scaling and Polishing')).toBeInTheDocument()
    expect(screen.getByText(formatCurrency(15000))).toBeInTheDocument()
    expect(screen.getByText('Fluoride Treatment')).toBeInTheDocument()
    expect(screen.getByText(formatCurrency(5000))).toBeInTheDocument()
    expect(listInvoiceLines).toHaveBeenCalledWith('inv-a')
  })

  it('lists the treatments recorded on a legacy invoice that has no lines', async () => {
    const legacy = inv({
      id: 'inv-a',
      invoiceNumber: 'INV-A',
      balance: 50000,
      treatments: [
        { treatmentId: 't1', name: 'Root Canal', amount: 120000 },
        { treatmentId: 't2', name: 'Crown Fitting', amount: 180000 },
      ],
    })
    vi.mocked(listPatientInvoices).mockResolvedValue({ success: true, data: [legacy] as never })
    mount({ invoiceId: 'inv-a' })

    expect(await screen.findByText('Root Canal')).toBeInTheDocument()
    expect(screen.getByText('Crown Fitting')).toBeInTheDocument()
  })

  it('says it has no line items only when it really has none', async () => {
    mount({ invoiceId: 'inv-a' })

    expect(await screen.findByText('No line items on this invoice')).toBeInTheDocument()
  })

  it('says the services could not be loaded, rather than that there are none', async () => {
    vi.mocked(listInvoiceLines).mockResolvedValue({ success: false, data: [], error: 'nope' })
    mount({ invoiceId: 'inv-a' })

    expect(await screen.findByText(/couldn.t load this invoice.s services/i)).toBeInTheDocument()
    expect(screen.queryByText('No line items on this invoice')).not.toBeInTheDocument()
  })

  it('still lists the recorded treatments when only the lines could not be loaded', async () => {
    const legacy = inv({
      id: 'inv-a',
      invoiceNumber: 'INV-A',
      balance: 50000,
      treatments: [{ treatmentId: 't1', name: 'Root Canal', amount: 120000 }],
    })
    vi.mocked(listPatientInvoices).mockResolvedValue({ success: true, data: [legacy] as never })
    vi.mocked(listInvoiceLines).mockResolvedValue({ success: false, data: [], error: 'nope' })
    mount({ invoiceId: 'inv-a' })

    expect(await screen.findByText('Root Canal')).toBeInTheDocument()
    expect(screen.queryByText(/couldn.t load/i)).not.toBeInTheDocument()
  })

  it('does not hold up the payment while the services are still loading', async () => {
    vi.mocked(listInvoiceLines).mockReturnValue(new Promise(() => {}))
    mount({ invoiceId: 'inv-a' })
    await loaded()

    expect(await screen.findByText('Loading treatments…')).toBeInTheDocument()
    await typeAmount('100.00')
    await waitFor(() => expect(postButton()).toBeEnabled())
  })
})

describe('what an invoice is for, worked out', () => {
  type Lines = Parameters<typeof deriveInvoiceDisplayItems>[0]

  it('prefers the invoice’s own lines to the treatments recorded on it', () => {
    const items = deriveInvoiceDisplayItems([line('Scaling', 15000)] as Lines, [
      { name: 'Root Canal', amount: 90000 },
    ])

    expect(items).toEqual([{ name: 'Scaling', cost: 15000 }])
  })

  it('falls back to the recorded treatments when there are no lines', () => {
    const items = deriveInvoiceDisplayItems(
      [],
      [
        { name: 'Root Canal', amount: 90000 },
        { name: 'Crown', amount: 60000 },
      ]
    )

    expect(items).toEqual([
      { name: 'Root Canal', cost: 90000 },
      { name: 'Crown', cost: 60000 },
    ])
  })

  it('keeps a recorded treatment when its lines could not be read at all', () => {
    expect(deriveInvoiceDisplayItems(undefined, [{ name: 'Crown', amount: 60000 }])).toEqual([
      { name: 'Crown', cost: 60000 },
    ])
  })

  it('trims names, and drops an entry that has none', () => {
    expect(
      deriveInvoiceDisplayItems(
        [line('  Scaling  ', 100), line('   ', 200), line('', 300)] as Lines,
        null
      )
    ).toEqual([{ name: 'Scaling', cost: 100 }])
    expect(
      deriveInvoiceDisplayItems(undefined, [
        { name: '  Crown ', amount: 100 },
        { name: ' ', amount: 200 },
      ])
    ).toEqual([{ name: 'Crown', cost: 100 }])
  })

  it('drops a recorded treatment whose amount is not a number', () => {
    expect(
      deriveInvoiceDisplayItems(undefined, [
        { name: 'Crown', amount: Number.NaN },
        { name: 'Scaling', amount: 100 },
      ])
    ).toEqual([{ name: 'Scaling', cost: 100 }])
  })

  it('is nothing for nothing', () => {
    expect(deriveInvoiceDisplayItems(undefined, undefined)).toEqual([])
    expect(deriveInvoiceDisplayItems([], null)).toEqual([])
  })
})

describe('what the patient owes', () => {
  it('shows the server’s total across every open invoice, even when paying just one', async () => {
    answers.ledger = ok(
      ledgerOf([A, B, inv({ id: 'inv-c', invoiceNumber: 'INV-C', balance: 20000 })])
    )
    mount({ invoiceId: 'inv-a' })

    // 500.00 + 500.00 + 200.00, from the ledger: not the 500.00 of the invoice being paid.
    const row = await screen.findByText(/patient total outstanding \(3 invoices\)/i)
    expect(row.parentElement).toHaveTextContent(formatCurrency(120000))
  })

  it('does not work the total out from a list that might be a page of the whole', async () => {
    // The list the dialog pays from holds one invoice; the server says the patient owes far more.
    vi.mocked(listPatientInvoices).mockResolvedValue({ success: true, data: [A] as never })
    answers.ledger = {
      success: true,
      data: {
        walletBalance: 0,
        outstandingBalance: 999000,
        outstandingInvoices: [{ id: 'x', invoiceNumber: 'X', balance: 999000, dueDate: null }],
      },
    }
    mount({ invoiceId: 'inv-a' })
    await loaded()

    const row = screen.getByText(/patient total outstanding/i)
    expect(row.parentElement).toHaveTextContent(formatCurrency(999000))
  })

  it('does not show zero when the outstanding balance could not be loaded', async () => {
    answers.ledger = failed()
    mount({ invoiceId: 'inv-a' })
    await loaded()

    const row = screen.getByText(/patient total outstanding/i)
    expect(row.parentElement).toHaveTextContent(/couldn.t be loaded/i)
    expect(row.parentElement).not.toHaveTextContent(formatCurrency(0))
  })

  it('does not show zero when the ledger read fails outright, and still lists the invoices', async () => {
    vi.mocked(api.get).mockImplementation((async (url: string) => {
      if (url.includes('/ledger')) throw new Error('network')
      return ok({})
    }) as never)
    mount({ invoiceId: 'inv-a' })
    await loaded()

    const row = screen.getByText(/patient total outstanding/i)
    expect(row.parentElement).toHaveTextContent(/couldn.t be loaded/i)
    expect(row.parentElement).not.toHaveTextContent(formatCurrency(0))
    expect(await screen.findByText('INV-A')).toBeInTheDocument()
  })

  it('does not show zero when the ledger answers without the figures, for the debt or the wallet', async () => {
    answers.ledger = ok({})
    mount({ invoiceId: 'inv-a' })
    await loaded()

    const row = screen.getByText(/patient total outstanding/i)
    expect(row.parentElement).toHaveTextContent(/couldn.t be loaded/i)
    expect(row.parentElement).not.toHaveTextContent(formatCurrency(0))
    expect(screen.getByText(/wallet credit could not be loaded/i)).toBeInTheDocument()
  })

  it('says it is loading, not that it failed, while the ledger has not answered', async () => {
    vi.mocked(api.get).mockImplementation((async (url: string) => {
      if (url.includes('/ledger')) return new Promise(() => {})
      return ok({})
    }) as never)
    mount({ invoiceId: 'inv-a' })

    const row = await screen.findByText(/patient total outstanding/i)
    expect(row.parentElement).toHaveTextContent('Loading…')
    expect(row.parentElement).not.toHaveTextContent(/couldn.t be loaded/i)
  })

  it('counts one invoice as one invoice', async () => {
    answers.ledger = ok(ledgerOf([A]))
    mount({ invoiceId: 'inv-a' })

    expect(await screen.findByText(/patient total outstanding \(1 invoice\)/i)).toBeInTheDocument()
  })

  it('can still take a payment by cash when the ledger could not be loaded', async () => {
    answers.ledger = failed()
    mount({ invoiceId: 'inv-a' })
    await loaded()
    await typeAmount('100.00')
    await post()

    await waitFor(() => expect(createDraftPayment).toHaveBeenCalledTimes(1))
  })

  it('refuses a wallet payment when the wallet credit could not be loaded, saying why', async () => {
    answers.ledger = failed()
    mount({ invoiceId: 'inv-a' })
    await loaded()
    fireEvent.click(screen.getByText('method cash')) // switch the source to the wallet
    await typeAmount('100.00')

    // The screen says so before anything is clicked: the credit it cannot see is not shown as 0.00.
    expect(screen.getByText(/wallet credit could not be loaded/i)).toBeInTheDocument()
    expect(await screen.findByText('unavailable')).toBeInTheDocument()

    await post()

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/wallet credit.*could not be loaded/i)
      )
    )
    expect(createDraftPayment).not.toHaveBeenCalled()
  })

  it('will not post a wallet payment larger than the credit the server reports, and says so', async () => {
    answers.ledger = ok(ledgerOf([A, B], 5000))
    mount({ invoiceId: 'inv-a' })
    await loaded()
    fireEvent.click(screen.getByText('method cash'))
    await typeAmount('100.00')

    expect(await screen.findByText('Wallet credit insufficient')).toBeInTheDocument()
    // The credit it measures against is the server's.
    expect(screen.getByText(formatCurrency(5000))).toBeInTheDocument()
    expect(postButton()).toBeDisabled()
    expect(createDraftPayment).not.toHaveBeenCalled()
  })

  it('takes a wallet payment up to the credit the server reports', async () => {
    answers.ledger = ok(ledgerOf([A, B], 5000))
    mount({ invoiceId: 'inv-a' })
    await loaded()
    fireEvent.click(screen.getByText('method cash'))
    await typeAmount('50.00')
    await post()

    await waitFor(() => expect(createDraftPayment).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createDraftPayment).mock.calls[0][0]).toMatchObject({
      method: 'wallet',
      amount: 5000,
    })
  })
})

// Review §8.16 (F83): the patient's invoice list has no archive filter; an archived invoice with a
// balance was offered for payment, while the ledger's outstanding total leaves it out.
describe('an archived invoice', () => {
  it('is not offered for payment', async () => {
    const archived = inv({
      id: 'inv-z',
      invoiceNumber: 'INV-Z',
      balance: 70000,
      dueDate: '2026-12-01',
    })
    vi.mocked(listPatientInvoices).mockResolvedValue({
      success: true,
      data: [
        { ...A, archived: false },
        { ...B, archived: false },
        { ...archived, archived: true },
      ] as never,
    })
    mount()
    await loaded()

    expect(screen.getByText('INV-A')).toBeInTheDocument()
    expect(screen.queryByText('INV-Z')).not.toBeInTheDocument()
    // Nor in the list of invoices that can be added.
    await userEvent.setup().click(screen.getByRole('button', { name: /add invoice/i }))
    expect(await screen.findByText('INV-B')).toBeInTheDocument()
    expect(screen.queryByText('INV-Z')).not.toBeInTheDocument()
  })
})

describe('when the invoices could not be loaded', () => {
  it('says so and offers another try, instead of saying the patient has no open invoices', async () => {
    vi.mocked(listPatientInvoices).mockResolvedValue({ success: false, data: [], error: 'down' })
    mount()

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t load/i)
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.queryByText('No open invoices for this patient.')).not.toBeInTheDocument()
    expect(postButton()).toBeDisabled()
  })

  it('loads again when asked to', async () => {
    vi.mocked(listPatientInvoices).mockResolvedValueOnce({
      success: false,
      data: [],
      error: 'down',
    })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /try again/i }))

    expect(await screen.findByText('INV-A')).toBeInTheDocument()
  })

  it('stops taking payments when a refresh of the invoices fails, rather than pay against old ones', async () => {
    mount({ invoiceId: 'inv-a' })
    await loaded()
    await typeAmount('100.00')
    await waitFor(() => expect(postButton()).toBeEnabled())

    // The tab comes back into view and the refresh of the invoices fails.
    vi.mocked(listPatientInvoices).mockResolvedValue({ success: false, data: [], error: 'down' })
    window.dispatchEvent(new Event('visibilitychange'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t load/i)
    expect(postButton()).toBeDisabled()
  })

  it('still says there are no open invoices when there really are none', async () => {
    vi.mocked(listPatientInvoices).mockResolvedValue({ success: true, data: [] })
    answers.ledger = ok(ledgerOf([]))
    mount()

    expect(await screen.findByText('No open invoices for this patient.')).toBeInTheDocument()
  })
})

describe('a payment smaller than the invoice, and one split across sources', () => {
  it('leaves the invoice partly paid, and says what will be left', async () => {
    mount({ invoiceId: 'inv-a' })
    await loaded()
    await typeAmount('200.00')

    const card = (await screen.findByText('INV-A')).closest('div.grid') as HTMLElement
    await waitFor(() =>
      expect(card).toHaveTextContent(`After this payment: ${formatCurrency(30000)}`)
    )
    expect(screen.queryByText('Will be paid')).not.toBeInTheDocument()
  })

  it('marks the invoice as paid in full when the payment covers it', async () => {
    mount({ invoiceId: 'inv-a' })
    await loaded()
    await typeAmount('500.00')

    expect(await screen.findByText('Will be paid')).toBeInTheDocument()
  })

  it('refuses more than the invoices owe, and says how much too much', async () => {
    mount({ invoiceId: 'inv-a' })
    await loaded()
    await typeAmount('600.00')

    expect(
      await screen.findByText(new RegExp(`exceed invoice balance by ${formatCurrency(10000)}`))
    ).toBeInTheDocument()
    expect(postButton()).toBeDisabled()
  })

  it('hands the money out in order: each source takes what is left of the oldest invoice first', async () => {
    mount({ planId: 'plan-1' })
    await loaded()
    fireEvent.click(await screen.findByRole('button', { name: /add source/i }))
    await typeAmount('700.00', 0)
    await typeAmount('300.00', 1)
    await post()

    await waitFor(() => expect(createDraftPayment).toHaveBeenCalledTimes(2))
    const [first, second] = vi.mocked(createDraftPayment).mock.calls.map((c) => c[0])
    expect(first).toMatchObject({
      amount: 70000,
      allocations: [
        { targetId: 'inv-a', amount: 50000 },
        { targetId: 'inv-b', amount: 20000 },
      ],
    })
    expect(second).toMatchObject({
      amount: 30000,
      allocations: [{ targetId: 'inv-b', amount: 30000 }],
    })
    // Two sources are one payment event: the drafts share a group so the receipt can show both.
    expect(first.paymentGroupId).toBeTruthy()
    expect(second.paymentGroupId).toBe(first.paymentGroupId)
  })
})

describe('the receipt', () => {
  it('shows by itself after the payment is posted, and the dialog finishes when it is dismissed', async () => {
    const { onPosted, onOpenChange } = mount({ invoiceId: 'inv-a' })
    await loaded()
    await typeAmount('100.00')
    await post()

    // The receipt of the payment just posted.
    expect(await screen.findByText('Ama Mensah')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/api/payments/pay-1/receipt')
    // Nothing is finished while the receipt is on screen: the caller would take the dialog away.
    expect(onPosted).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)

    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0])
    await waitFor(() => expect(onPosted).toHaveBeenCalledTimes(1))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('is printed by itself as it shows', async () => {
    mount({ invoiceId: 'inv-a' })
    await loaded()
    await typeAmount('100.00')
    await post()

    expect(await screen.findByText('Ama Mensah')).toBeInTheDocument()
    await waitFor(() => expect(printReceipt).toHaveBeenCalledTimes(1))
  })

  it('says so and finishes when the receipt cannot be loaded, since the payment is posted', async () => {
    answers.receipt = failed()
    const { onPosted, onOpenChange } = mount({ invoiceId: 'inv-a' })
    await loaded()
    await typeAmount('100.00')
    await post()

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Payment posted, but the receipt could not be loaded for printing.'
      )
    )
    await waitFor(() => expect(onPosted).toHaveBeenCalledTimes(1))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('still offers the receipt of what was posted when a later source fails', async () => {
    vi.mocked(createDraftPayment)
      .mockResolvedValueOnce({ success: true, data: { id: 'pay-1' } } as never)
      .mockResolvedValueOnce({ success: false, error: 'Declined' } as never)
    const { onPosted } = mount({ planId: 'plan-1' })
    await loaded()
    fireEvent.click(await screen.findByRole('button', { name: /add source/i }))
    await typeAmount('300.00', 0)
    await typeAmount('200.00', 1)
    await post()

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('1 of 2 payments posted — one failed: Declined')
      )
    )
    expect(await screen.findByText('Ama Mensah')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/api/payments/pay-1/receipt')
    expect(onPosted).not.toHaveBeenCalled()
  })

  it('shows no receipt, and finishes at once, when nothing was posted', async () => {
    vi.mocked(createDraftPayment).mockResolvedValue({ success: false, error: 'Declined' } as never)
    const { onPosted } = mount({ invoiceId: 'inv-a' })
    await loaded()
    await typeAmount('100.00')
    await post()

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Declined'))
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/receipt'))
    expect(onPosted).not.toHaveBeenCalled()
  })

  it('does not hold up a check-in: at a visit it finishes at once and shows no receipt', async () => {
    const { onPosted, onOpenChange } = mount({ planId: 'plan-1', appointmentId: 'appt-1' })
    await loaded()
    await typeAmount('100.00')
    await post()

    await waitFor(() => expect(onPosted).toHaveBeenCalledTimes(1))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/receipt'))
    expect(screen.queryByText('Ama Mensah')).not.toBeInTheDocument()
    expect(printReceipt).not.toHaveBeenCalled()
  })
})

describe('the outstanding-balance slip', () => {
  const slipBox = () => screen.getByLabelText(/print total outstanding balance/i)

  it('is offered, and off by default: asking for nothing prints nothing', async () => {
    mount({ invoiceId: 'inv-a' })
    await loaded()
    expect(slipBox()).not.toBeChecked()
    await typeAmount('100.00')
    await post()

    await waitFor(() => expect(createDraftPayment).toHaveBeenCalled())
    expect(openReceiptWindow).not.toHaveBeenCalled()
    expect(printOutstandingBalanceSlip).not.toHaveBeenCalled()
  })

  it('opens its window before any posting, then prints the slip from the server’s balances', async () => {
    // After the payment of 200.00 to INV-A, the server says the patient owes 300.00 + 500.00, and a
    // new invoice of 40.00 has been raised meanwhile: the slip carries the server's word, not a sum
    // worked out from what the form loaded.
    answers.ledgerAfter = ok(
      ledgerOf([
        inv({ id: 'inv-a', invoiceNumber: 'INV-A', balance: 30000, dueDate: '2026-10-01' }),
        B,
        inv({ id: 'inv-c', invoiceNumber: 'INV-C', balance: 4000, dueDate: '2026-12-01' }),
      ])
    )
    const win = { close: vi.fn() }
    vi.mocked(openReceiptWindow).mockReturnValue(win as unknown as Window)
    mount({ invoiceId: 'inv-a' })
    await loaded()
    fireEvent.click(slipBox())
    await typeAmount('200.00')
    await post()

    await waitFor(() => expect(printOutstandingBalanceSlip).toHaveBeenCalledTimes(1))
    // The window must be opened inside the click, before anything is awaited: a popup opened after
    // the postings is blocked by the browser. It says what it is preparing.
    expect(vi.mocked(openReceiptWindow).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(createDraftPayment).mock.invocationCallOrder[0]
    )
    expect(openReceiptWindow).toHaveBeenCalledWith('balance slip')
    const args = vi.mocked(printOutstandingBalanceSlip).mock.calls[0][0]
    expect(args).toMatchObject({
      patientName: 'Ama Mensah',
      paidNow: 20000,
      balanceDue: 84000,
      invoices: [
        { invoiceNumber: 'INV-A', dueDate: '2026-10-01', balanceBefore: 50000 },
        { invoiceNumber: 'INV-B', dueDate: '2026-11-01', balanceBefore: 50000 },
        { invoiceNumber: 'INV-C', dueDate: '2026-12-01', balanceBefore: 4000 },
      ],
    })
    // The slip is written into the window opened for it, and that window is left for the person.
    expect(args.existingWindow).toBe(win)
    expect(win.close).not.toHaveBeenCalled()
  })

  it('is not printed when it was switched on and then off again', async () => {
    mount({ invoiceId: 'inv-a' })
    await loaded()
    fireEvent.click(slipBox())
    fireEvent.click(slipBox())
    expect(slipBox()).not.toBeChecked()
    await typeAmount('100.00')
    await post()

    await waitFor(() => expect(createDraftPayment).toHaveBeenCalled())
    expect(openReceiptWindow).not.toHaveBeenCalled()
    expect(printOutstandingBalanceSlip).not.toHaveBeenCalled()
  })

  it('cannot be changed while the payment is being posted', async () => {
    vi.mocked(createDraftPayment).mockReturnValue(new Promise(() => {}))
    mount({ invoiceId: 'inv-a' })
    await loaded()
    fireEvent.click(slipBox())
    await typeAmount('100.00')
    await post()

    await waitFor(() => expect(slipBox()).toBeDisabled())
  })

  it('is off again when the dialog is opened afresh', async () => {
    const { setOpen } = mount({ invoiceId: 'inv-a' })
    await loaded()
    fireEvent.click(slipBox())
    expect(slipBox()).toBeChecked()

    setOpen(false)
    setOpen(true)

    await waitFor(() => expect(slipBox()).not.toBeChecked())
  })

  it('uses the patient’s name when it was given, without looking it up', async () => {
    mount({ invoiceId: 'inv-a', patientName: 'Kojo Antwi' })
    await loaded()
    fireEvent.click(slipBox())
    await typeAmount('100.00')
    await post()

    await waitFor(() => expect(printOutstandingBalanceSlip).toHaveBeenCalledTimes(1))
    expect(vi.mocked(printOutstandingBalanceSlip).mock.calls[0][0]).toMatchObject({
      patientName: 'Kojo Antwi',
    })
    expect(api.get).not.toHaveBeenCalledWith('/api/patients/pat-1')
  })

  it('prints “Patient” when the name can be found nowhere, rather than fail', async () => {
    vi.mocked(api.get).mockImplementation((async (url: string) => {
      if (url.includes('/ledger')) return answers.ledger
      if (url.includes('/receipt')) return answers.receipt
      throw new Error('no such patient')
    }) as never)
    mount({ invoiceId: 'inv-a' })
    await loaded()
    fireEvent.click(slipBox())
    await typeAmount('100.00')
    await post()

    await waitFor(() => expect(printOutstandingBalanceSlip).toHaveBeenCalledTimes(1))
    expect(vi.mocked(printOutstandingBalanceSlip).mock.calls[0][0]).toMatchObject({
      patientName: 'Patient',
    })
  })

  it('lists an invoice this payment settled, which the server no longer calls outstanding', async () => {
    answers.ledgerAfter = ok(ledgerOf([B]))
    mount({ invoiceId: 'inv-a' })
    await loaded()
    fireEvent.click(slipBox())
    await typeAmount('500.00')
    await post()

    await waitFor(() => expect(printOutstandingBalanceSlip).toHaveBeenCalledTimes(1))
    expect(vi.mocked(printOutstandingBalanceSlip).mock.calls[0][0]).toMatchObject({
      paidNow: 50000,
      balanceDue: 50000,
      invoices: [
        { invoiceNumber: 'INV-A', balanceBefore: 50000 },
        { invoiceNumber: 'INV-B', balanceBefore: 50000 },
      ],
    })
  })

  it('falls back to the balances loaded with the form when they cannot be read again', async () => {
    answers.ledgerAfter = failed()
    mount({ invoiceId: 'inv-a' })
    await loaded()
    fireEvent.click(slipBox())
    await typeAmount('200.00')
    await post()

    await waitFor(() => expect(printOutstandingBalanceSlip).toHaveBeenCalledTimes(1))
    expect(vi.mocked(printOutstandingBalanceSlip).mock.calls[0][0]).toMatchObject({
      paidNow: 20000,
      balanceDue: 80000,
      invoices: [
        { invoiceNumber: 'INV-A', balanceBefore: 50000 },
        { invoiceNumber: 'INV-B', balanceBefore: 50000 },
      ],
    })
  })

  it('cannot be asked for when the outstanding balance could not be loaded: it would be a slip of zeros', async () => {
    answers.ledger = failed()
    mount({ invoiceId: 'inv-a' })
    await loaded()

    expect(slipBox()).toBeDisabled()
    await typeAmount('100.00')
    await post()
    await waitFor(() => expect(createDraftPayment).toHaveBeenCalled())
    expect(openReceiptWindow).not.toHaveBeenCalled()
  })

  it('closes the window it opened when the payment is refused', async () => {
    const win = { close: vi.fn() }
    vi.mocked(openReceiptWindow).mockReturnValue(win as unknown as Window)
    vi.mocked(createDraftPayment).mockResolvedValue({ success: false, error: 'Declined' } as never)
    mount({ invoiceId: 'inv-a' })
    await loaded()
    fireEvent.click(slipBox())
    await typeAmount('100.00')
    await post()

    await waitFor(() => expect(win.close).toHaveBeenCalledTimes(1))
    expect(printOutstandingBalanceSlip).not.toHaveBeenCalled()
  })

  it('opens no window for a payment that is refused before anything is posted', async () => {
    mount({ invoiceId: 'inv-a' })
    await loaded()
    fireEvent.click(slipBox())
    await typeAmount('100.00')
    fireEvent.change(screen.getByLabelText(/payment date/i), { target: { value: '' } })
    await post()

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Payment date is required'))
    expect(openReceiptWindow).not.toHaveBeenCalled()
    expect(createDraftPayment).not.toHaveBeenCalled()
  })

  it('says so when the browser blocks the slip, and still posts and shows the receipt', async () => {
    vi.mocked(openReceiptWindow).mockReturnValue(null)
    mount({ invoiceId: 'inv-a' })
    await loaded()
    fireEvent.click(slipBox())
    await typeAmount('100.00')
    await post()

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/blocked.*slip/i))
    )
    expect(createDraftPayment).toHaveBeenCalledTimes(1)
    expect(printOutstandingBalanceSlip).not.toHaveBeenCalled()
    expect(await screen.findByText('Ama Mensah')).toBeInTheDocument()
  })

  it('does not call a slip that fails to print a failed payment: it is posted, and its receipt shows', async () => {
    const win = { close: vi.fn() }
    vi.mocked(openReceiptWindow).mockReturnValue(win as unknown as Window)
    vi.mocked(printOutstandingBalanceSlip).mockRejectedValue(new Error('printer'))
    mount({ invoiceId: 'inv-a' })
    await loaded()
    fireEvent.click(slipBox())
    await typeAmount('100.00')
    await post()

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/payment was posted.*slip could not be printed/i)
      )
    )
    expect(win.close).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalledWith(expect.stringMatching(/one failed/i))
    expect(await screen.findByText('Ama Mensah')).toBeInTheDocument()
  })

  it('is separate from the receipt: both are produced, and the receipt is unchanged', async () => {
    mount({ invoiceId: 'inv-a' })
    await loaded()
    fireEvent.click(slipBox())
    await typeAmount('100.00')
    await post()

    await waitFor(() => expect(printOutstandingBalanceSlip).toHaveBeenCalledTimes(1))
    const dialog = await screen.findByText('Ama Mensah')
    expect(
      within(dialog.closest('.receipt-slip') as HTMLElement).queryByText(/outstanding/i)
    ).toBeNull()
  })
})

// G08 — the payment-confirmation text. The server texts what was posted, once per payment event;
// the dialog asks for it with the LAST payment it posts, so a split is texted once, for its total.
describe('the payment-confirmation text', () => {
  const smsBox = () => screen.getByLabelText(/text the patient a payment confirmation/i)
  const postFlags = () => vi.mocked(postDraftPayment).mock.calls.map((c) => c[1])

  it('is offered, and on by default', async () => {
    mount({ invoiceId: 'inv-a' })
    await loaded()

    expect(smsBox()).toBeChecked()
  })

  it('is asked for with the payment the dialog posts', async () => {
    mount({ invoiceId: 'inv-a' })
    await loaded()
    await typeAmount('100.00')
    await post()

    await waitFor(() => expect(postDraftPayment).toHaveBeenCalledTimes(1))
    expect(postFlags()).toEqual([{ sendSms: true }])
  })

  it('is asked for with the last payment of a split only, so it is sent once for the total', async () => {
    mount({ planId: 'plan-1' })
    await loaded()
    fireEvent.click(await screen.findByRole('button', { name: /add source/i }))
    await typeAmount('700.00', 0)
    await typeAmount('300.00', 1)
    await post()

    await waitFor(() => expect(postDraftPayment).toHaveBeenCalledTimes(2))
    expect(postFlags()).toEqual([{ sendSms: false }, { sendSms: true }])
  })

  it('is not asked for when it was switched off', async () => {
    mount({ invoiceId: 'inv-a' })
    await loaded()
    fireEvent.click(smsBox())
    await typeAmount('100.00')
    await post()

    await waitFor(() => expect(postDraftPayment).toHaveBeenCalledTimes(1))
    expect(postFlags()).toEqual([{ sendSms: false }])
  })

  it('is on again when the dialog is opened afresh', async () => {
    const { setOpen } = mount({ invoiceId: 'inv-a' })
    await loaded()
    fireEvent.click(smsBox())
    expect(smsBox()).not.toBeChecked()

    setOpen(false)
    setOpen(true)

    await waitFor(() => expect(smsBox()).toBeChecked())
  })

  it('says so when the text failed, and the payment still counts as posted', async () => {
    vi.mocked(postDraftPayment).mockResolvedValue({
      success: true,
      data: {},
      smsError: 'Gateway down',
    } as never)
    mount({ invoiceId: 'inv-a' })
    await loaded()
    await typeAmount('100.00')
    await post()

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/text.*Gateway down/i))
    )
    expect(toast.error).not.toHaveBeenCalled()
    expect(await screen.findByText('Ama Mensah')).toBeInTheDocument()
  })
})
