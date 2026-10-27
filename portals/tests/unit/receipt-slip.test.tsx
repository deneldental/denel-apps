/**
 * G04 — the on-screen payment receipt for a one-time payment with no invoice, a split, and a
 * reversal. See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (G04) and step-10-handover.md.
 *
 * The slip is real; it is drawn from the data `GET /api/payments/:id/receipt` returns. A payment
 * recorded without an invoice carries its items on the payment itself, and the receipt lists them
 * without inventing an invoice (no invoice totals, no invoice number). A split lists every method.
 * A reversed payment says so instead of reading like an ordinary paid receipt.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  type ReceiptDataShape,
  ReceiptViewDialog,
} from '@/features/payments/components/receipt-view-dialog'

const base: ReceiptDataShape = {
  patientName: 'Ama Mensah',
  amountPaid: 20000,
  paymentType: 'cash',
  paymentFor: 'Scaling, Fluoride',
  clinicName: 'Denel Dental Clinic',
  generatedAt: '2026-10-27T10:00:00Z',
  methods: [{ method: 'cash', amount: 20000, reference: null, paymentNumber: 'PMT-2026-000001' }],
  invoiceNumbers: [],
  paymentNumbers: ['PMT-2026-000001'],
}

/** What the server builds for a one-time payment: its items, with no invoice behind them. */
const itemised: NonNullable<ReceiptDataShape['allocations']>[number] = {
  invoiceNumber: '',
  invoiceTotal: null,
  invoiceSubtotal: null,
  invoiceTaxTotal: null,
  amountApplied: 20000,
  remainingBalance: null,
  status: null,
  treatments: ['Scaling', 'Fluoride'],
  items: [
    { name: 'Scaling', cost: 15000 },
    { name: 'Fluoride', cost: 5000 },
  ],
}

function show(data: Partial<ReceiptDataShape>) {
  render(<ReceiptViewDialog open onOpenChange={() => {}} receiptData={{ ...base, ...data }} />)
}

describe('a one-time payment that paid no invoice', () => {
  it('lists the items it recorded, each with its amount', () => {
    show({ allocations: [itemised] })

    expect(screen.getByText('Item')).toBeInTheDocument()
    expect(screen.getByText('Scaling')).toBeInTheDocument()
    expect(screen.getByText('GHS 150.00')).toBeInTheDocument()
    expect(screen.getByText('Fluoride')).toBeInTheDocument()
    expect(screen.getByText('GHS 50.00')).toBeInTheDocument()
    expect(screen.getByText('GHS 200.00')).toBeInTheDocument() // PAID
  })

  it('does not invent an invoice: no subtotal, taxes or total, and no invoice reference', () => {
    show({ allocations: [itemised] })

    expect(screen.queryByText('Subtotal:')).not.toBeInTheDocument()
    expect(screen.queryByText('Taxes:')).not.toBeInTheDocument()
    expect(screen.queryByText('Total:')).not.toBeInTheDocument()
    // The reference is the payment's own number.
    expect(screen.getByText('PMT-2026-000001')).toBeInTheDocument()
  })

  it('keeps the single Service line when the payment recorded no items', () => {
    show({ allocations: [] })

    expect(screen.queryByText('Item')).not.toBeInTheDocument()
    expect(screen.getByText('Service:')).toBeInTheDocument()
  })
})

describe('a receipt for an invoice', () => {
  const invoiced: NonNullable<ReceiptDataShape['allocations']>[number] = {
    invoiceNumber: 'INV-2026-000007',
    invoiceTotal: 25000,
    invoiceSubtotal: 25000,
    invoiceTaxTotal: 0,
    amountApplied: 20000,
    remainingBalance: 5000,
    status: 'partially_paid',
    treatments: ['Crown'],
    items: [{ name: 'Crown', cost: 25000 }],
  }

  it('still shows the invoice’s subtotal, taxes and total, and its number', () => {
    show({ allocations: [invoiced], invoiceNumbers: ['INV-2026-000007'], balance: 5000 })

    expect(screen.getByText('Subtotal:')).toBeInTheDocument()
    expect(screen.getByText('Taxes:')).toBeInTheDocument()
    expect(screen.getByText('Total:')).toBeInTheDocument()
    expect(screen.getByText('INV-2026-000007')).toBeInTheDocument()
    expect(screen.getByText('Balance:')).toBeInTheDocument()
  })
})

describe('a payment split across methods', () => {
  it('lists every method with its amount', () => {
    show({
      allocations: [itemised],
      methods: [
        { method: 'cash', amount: 12000, reference: null, paymentNumber: 'PMT-2026-000001' },
        { method: 'card', amount: 8000, reference: 'POS-77', paymentNumber: 'PMT-2026-000002' },
      ],
      paymentNumbers: ['PMT-2026-000001', 'PMT-2026-000002'],
    })

    expect(screen.getByText('Payment Methods:')).toBeInTheDocument()
    expect(screen.getByText('Cash:')).toBeInTheDocument()
    expect(screen.getByText('GHS 120.00')).toBeInTheDocument()
    expect(screen.getByText('Card (POS-77):')).toBeInTheDocument()
    expect(screen.getByText('GHS 80.00')).toBeInTheDocument()
    expect(screen.queryByText('Method:')).not.toBeInTheDocument()
  })

  it('says nothing about a reversal when nothing was reversed', () => {
    show({ allocations: [itemised], status: 'posted' })

    expect(screen.queryByText(/reversed/i)).not.toBeInTheDocument()
  })
})

describe('a reversed payment', () => {
  it('says REVERSED, shows nothing as paid, and shows what was reversed', () => {
    show({
      allocations: [itemised],
      status: 'reversed',
      amountPaid: 0,
      reversedAmount: 20000,
      methods: [
        {
          method: 'cash',
          amount: 20000,
          reference: null,
          paymentNumber: 'PMT-2026-000001',
          status: 'reversed',
        },
      ],
    })

    expect(screen.getByText('REVERSED')).toBeInTheDocument()
    expect(screen.getByText('PAID:').nextElementSibling).toHaveTextContent('GHS 0.00')
    expect(screen.getByText('Reversed:').nextElementSibling).toHaveTextContent('GHS 200.00')
    expect(screen.getByText('Method:').nextElementSibling).toHaveTextContent('Cash (reversed)')
  })

  it('says PART REVERSED for a split of which one method was reversed, and marks that method', () => {
    show({
      allocations: [itemised],
      status: 'partly_reversed',
      amountPaid: 12000,
      reversedAmount: 8000,
      methods: [
        { method: 'cash', amount: 12000, reference: null, paymentNumber: 'PMT-2026-000001' },
        {
          method: 'card',
          amount: 8000,
          reference: null,
          paymentNumber: 'PMT-2026-000002',
          status: 'reversed',
        },
      ],
    })

    expect(screen.getByText('PART REVERSED')).toBeInTheDocument()
    expect(screen.getByText('PAID:').nextElementSibling).toHaveTextContent('GHS 120.00')
    expect(screen.getByText('Reversed:').nextElementSibling).toHaveTextContent('GHS 80.00')
    expect(screen.getByText('Card (reversed):')).toBeInTheDocument()
    expect(screen.getByText('Cash:')).toBeInTheDocument()
  })
})
