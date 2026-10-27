/**
 * G04 — the PRINTED payment receipt, for a one-time payment with no invoice, a split, a reversal,
 * and text people typed. See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (G04) and
 * step-10-handover.md.
 *
 * `generateReceipt` writes an HTML document into a window. It is handed a stand-in window here, and
 * the document it wrote is read back as text. The on-screen slip draws from the same data and is
 * pinned in `receipt-slip.test.tsx`; what both decide is pinned in `receipt-display.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/actions/branding', () => ({
  getBranding: vi.fn(async () => ({
    success: true,
    data: {
      name: 'Denel Dental Clinic',
      phones: ['0302 000 000'],
      address: '12 Oxford St, Accra',
      website: 'https://deneldental.com/',
    },
  })),
}))

import { generatePaymentReceipt, generateReceipt } from '@/shared/utils/receipt'

type ReceiptData = Parameters<typeof generateReceipt>[0]

const base: ReceiptData = {
  patientName: 'Ama Mensah',
  amountPaid: 20000,
  paymentType: 'cash',
  paymentFor: 'Scaling, Fluoride',
  clinicName: 'Denel Dental Clinic',
  generatedAt: '2026-10-27T10:00:00Z',
  methods: [{ method: 'cash', amount: 20000, reference: null, paymentNumber: 'PMT-2026-000001' }],
}

const itemised = {
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

/** Print `data` into a stand-in window and return the document it wrote. */
function printed(data: Partial<ReceiptData>, autoPrint = false): string {
  let html = ''
  const win = {
    document: { open: vi.fn(), write: (s: string) => (html += s), close: vi.fn() },
  } as unknown as Window
  generateReceipt({ ...base, ...data }, autoPrint, win)
  return html
}

describe('a one-time payment that paid no invoice', () => {
  it('lists the items it recorded, each with its amount', () => {
    const html = printed({ allocations: [itemised] })

    expect(html).toContain('>Item</th>')
    expect(html).toContain('>Scaling</td>')
    expect(html).toContain('GHS 150.00')
    expect(html).toContain('>Fluoride</td>')
    expect(html).toContain('GHS 50.00')
  })

  it('does not invent an invoice: no subtotal, taxes or total', () => {
    const html = printed({ allocations: [itemised] })

    expect(html).not.toContain('Subtotal:')
    expect(html).not.toContain('Taxes:')
    expect(html).not.toMatch(/class="label">Total:/)
  })

  it('keeps the single Service line when the payment recorded no items', () => {
    const html = printed({ allocations: [] })

    expect(html).toContain('Service:')
    expect(html).not.toContain('>Item</th>')
  })
})

describe('a receipt for an invoice', () => {
  it('still shows the invoice’s subtotal, taxes and total', () => {
    const html = printed({
      allocations: [
        {
          invoiceNumber: 'INV-2026-000007',
          invoiceTotal: 25000,
          invoiceSubtotal: 25000,
          invoiceTaxTotal: 0,
          amountApplied: 20000,
          remainingBalance: 5000,
          status: 'partially_paid',
          treatments: ['Crown'],
          items: [{ name: 'Crown', cost: 25000 }],
        },
      ],
    })

    expect(html).toContain('Subtotal:')
    expect(html).toContain('Taxes:')
    expect(html).toContain('Total:')
  })
})

describe('a payment split across methods', () => {
  it('lists every method with its amount', () => {
    const html = printed({
      allocations: [itemised],
      methods: [
        { method: 'cash', amount: 12000, reference: null, paymentNumber: 'PMT-2026-000001' },
        { method: 'card', amount: 8000, reference: 'POS-77', paymentNumber: 'PMT-2026-000002' },
      ],
    })

    expect(html).toContain('Payment Methods:')
    expect(html).toContain('Cash:')
    expect(html).toContain('GHS 120.00')
    expect(html).toContain('Card (POS-77):')
    expect(html).toContain('GHS 80.00')
  })

  it('says nothing about a reversal when nothing was reversed', () => {
    expect(printed({ allocations: [itemised], status: 'posted' })).not.toMatch(/reversed/i)
  })
})

describe('a reversed payment', () => {
  it('says REVERSED, shows nothing as paid, and shows what was reversed', () => {
    const html = printed({
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

    expect(html).toContain('REVERSED')
    expect(html).toMatch(/PAID:<\/span>\s*<span>GHS 0\.00/)
    expect(html).toMatch(/Reversed:<\/span>\s*<span>GHS 200\.00/)
    expect(html).toContain('Cash (reversed)')
  })

  it('says PART REVERSED for a split of which one method was reversed, and marks that method', () => {
    const html = printed({
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

    expect(html).toContain('PART REVERSED')
    expect(html).toContain('Card (reversed):')
    expect(html).toContain('Cash:')
  })
})

describe('text people typed', () => {
  const hostile = '<img src=x onerror=alert(1)>'

  it('is printed as text, never as markup', () => {
    const html = printed({
      patientName: hostile,
      notes: `${hostile} & more`,
      clinicName: hostile,
      clinicWebsite: hostile,
      clinicPhone: hostile,
      clinicAddress: hostile,
      appointmentDate: hostile,
      generatedAt: hostile,
      allocations: [
        {
          ...itemised,
          items: [{ name: `<script>alert('x')</script>`, cost: 100 }],
        },
      ],
      methods: [{ method: 'card', amount: 20000, reference: hostile, paymentNumber: null }],
    })

    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;')
    expect(html).toContain('&amp; more')
  })

  it('is printed as text for a single method’s name too', () => {
    const html = printed({
      methods: [{ method: '<b>x</b>', amount: 20000, reference: null, paymentNumber: null }],
    })

    // The label capitalises each word, so the tag comes out upper-case; either way it is text.
    expect(html).not.toContain('<B>')
    expect(html).toContain('&lt;B&gt;X&lt;/B&gt;')
  })

  it('is printed as text in a split, for each method’s name and reference', () => {
    const html = printed({
      methods: [
        { method: '<b>x</b>', amount: 12000, reference: null, paymentNumber: null },
        { method: 'card', amount: 8000, reference: hostile, paymentNumber: null },
      ],
    })

    expect(html).not.toContain('<B>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;B&gt;X&lt;/B&gt;')
    expect(html).toContain('(&lt;img src=x onerror=alert(1)&gt;)')
  })

  it('is printed as text on the Service line too, when there are no items to list', () => {
    const html = printed({ paymentFor: hostile, allocations: [] })

    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })

  it('still prints names that merely contain an ampersand or an apostrophe, readably', () => {
    const html = printed({ patientName: "Kofi O'Brien & Sons" })
    expect(html).toContain('Kofi O&#39;Brien &amp; Sons')
  })
})

describe('printing', () => {
  it('asks the browser to print only when told to', () => {
    expect(printed({}, true)).toContain('window.print()')
    expect(printed({}, false)).not.toContain('window.print()')
  })
})

describe('the receipt printed for a payment', () => {
  afterEach(() => vi.restoreAllMocks())

  it('carries the clinic’s details from its branding', async () => {
    let html = ''
    const win = {
      document: { open: vi.fn(), write: (s: string) => (html += s), close: vi.fn() },
    } as unknown as Window
    vi.spyOn(window, 'open').mockReturnValue(win)

    await generatePaymentReceipt({
      patientName: 'Ama Mensah',
      amountPaid: 20000,
      paymentMethod: 'cash',
      autoPrint: false,
    })

    expect(html).toContain('Denel Dental Clinic')
    expect(html).toContain('0302 000 000')
    expect(html).toContain('12 Oxford St, Accra')
    expect(html).toContain('>deneldental.com</div>')
  })
})
