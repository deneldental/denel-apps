/**
 * G04 — the decisions a payment receipt makes, shared by the on-screen slip and the printed one.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (G04) and step-10-handover.md.
 *
 * Two receipts print from the same data, so what they show about an invoice, a reversal and
 * untrusted text is decided once, here.
 */
import { describe, expect, it } from 'vitest'
import {
  escapeHtml,
  hasInvoiceTotals,
  methodStatusSuffix,
  reversalBanner,
} from '@/shared/utils/receipt-display'

const invoiceAllocation = {
  invoiceNumber: 'INV-2026-000001',
  invoiceTotal: 50000,
  invoiceSubtotal: 50000,
  invoiceTaxTotal: 0,
}
/** What the server builds for a one-time payment: items, but no invoice behind them. */
const itemisedOnly = {
  invoiceNumber: '',
  invoiceTotal: null,
  invoiceSubtotal: null,
  invoiceTaxTotal: null,
}

describe('hasInvoiceTotals', () => {
  it('is true for a receipt of a real invoice', () => {
    expect(hasInvoiceTotals([invoiceAllocation])).toBe(true)
  })

  it('is false for an itemised one-time payment, which has no invoice to total', () => {
    expect(hasInvoiceTotals([itemisedOnly])).toBe(false)
  })

  it('is true when any one of several allocations is a real invoice', () => {
    expect(hasInvoiceTotals([itemisedOnly, invoiceAllocation])).toBe(true)
  })

  it('is true for an invoice that totals nothing, because there is still an invoice', () => {
    expect(
      hasInvoiceTotals([
        { ...itemisedOnly, invoiceTotal: 0, invoiceSubtotal: 0, invoiceTaxTotal: 0 },
      ])
    ).toBe(true)
  })

  it.each([
    ['no allocations', []],
    ['nothing', undefined],
  ])('is false for %s', (_what, allocations) => {
    expect(hasInvoiceTotals(allocations)).toBe(false)
  })
})

describe('reversalBanner', () => {
  it('names a payment that has been reversed', () => {
    expect(reversalBanner('reversed')).toBe('REVERSED')
  })

  it('names a split of which some methods have been reversed', () => {
    expect(reversalBanner('partly_reversed')).toBe('PART REVERSED')
  })

  it.each([
    ['a payment still in force', 'posted'],
    ['an older server that does not say', undefined],
    ['something else', 'draft'],
  ])('says nothing for %s', (_what, status) => {
    expect(reversalBanner(status)).toBeNull()
  })
})

describe('methodStatusSuffix', () => {
  it('marks a method that has been reversed', () => {
    expect(methodStatusSuffix('reversed')).toBe(' (reversed)')
  })

  it.each([['posted'], [undefined], ['draft']])('marks nothing for %s', (status) => {
    expect(methodStatusSuffix(status)).toBe('')
  })
})

describe('escapeHtml', () => {
  it('turns the characters that make markup into plain text', () => {
    expect(escapeHtml(`<b onclick="x()">Tom & 'Jerry'</b>`)).toBe(
      '&lt;b onclick=&quot;x()&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/b&gt;'
    )
  })

  it('leaves ordinary text alone', () => {
    expect(escapeHtml('Scaling (Standard), Crown - paid in full')).toBe(
      'Scaling (Standard), Crown - paid in full'
    )
  })

  it('escapes an ampersand first, so an escape is not escaped twice', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
  })

  it('treats nothing as an empty string', () => {
    expect(escapeHtml(undefined)).toBe('')
    expect(escapeHtml(null)).toBe('')
  })
})
