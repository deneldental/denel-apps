import { describe, expect, it } from 'vitest'
import { computeLine } from '../../src/lib/invoice-service'

// Amounts are integer CENTS in and out: `computeLine` reads its inputs through
// `Money.from` (a number is a cent count since migration 0209) and its results
// land on `invoice_lines` integer columns.
describe('computeLine — invoice line math', () => {
  it('computes a plain line with quantity and unit price', () => {
    const r = computeLine({ quantity: 2, unitPrice: 25000 })
    expect(r.lineSubtotal).toBe(50000)
    expect(r.discountAmount).toBe(0)
    expect(r.lineAfterDiscount).toBe(50000)
    expect(r.taxAmount).toBe(0)
    expect(r.lineTotal).toBe(50000)
  })

  it('applies a percentage discount and tax — example from spec §6.1', () => {
    // 1500 endo line, 10% discount, 12.5% VAT → 1518.75 total
    const r = computeLine({
      quantity: 1,
      unitPrice: 150000,
      discountType: 'percent',
      discountValue: 10,
      taxRate: 12.5,
    })
    expect(r.lineSubtotal).toBe(150000)
    expect(r.discountAmount).toBe(15000)
    expect(r.lineAfterDiscount).toBe(135000)
    expect(r.taxAmount).toBe(16875)
    expect(r.lineTotal).toBe(151875)
  })

  it('applies a fixed-amount discount', () => {
    const r = computeLine({
      quantity: 1,
      unitPrice: 100000,
      discountType: 'amount',
      discountValue: 10000,
    })
    expect(r.discountAmount).toBe(10000)
    expect(r.lineAfterDiscount).toBe(90000)
    expect(r.lineTotal).toBe(90000)
  })

  it('caps discount at subtotal so the line never goes negative', () => {
    const r = computeLine({
      quantity: 1,
      unitPrice: 10000,
      discountType: 'amount',
      discountValue: 99900,
    })
    expect(r.discountAmount).toBe(10000)
    expect(r.lineAfterDiscount).toBe(0)
    expect(r.lineTotal).toBe(0)
  })

  it('rounds tax at the line level, not the invoice level (spec §11.1)', () => {
    // 1499.95 × 12.5% = 187.49375 → 187.49 banker's rounding (half-even, even
    // digit is 9, so round to the closest even: ...49 stays, ...50 would be next).
    const r = computeLine({ quantity: 1, unitPrice: 149995, taxRate: 12.5 })
    expect(r.taxAmount).toBe(18749)
    expect(r.lineTotal).toBe(168744)
  })
})
