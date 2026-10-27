/**
 * Review of Step 10 (§8.16) — how a first-unit / additional-unit line reads (G01).
 *
 * A stepped line stores the FIRST unit's price as `unitPrice` and bills
 * `unitPrice + additionalUnitPrice × (quantity − 1)` as its `lineSubtotal`. Read as "unit price ×
 * quantity" it does not add up (GH₵100.00 × 3 beside GH₵220.00). The further-unit price is not
 * stored on the line, but it is exactly what the line's subtotal and unit price imply.
 */
import { describe, expect, it } from 'vitest'
import { additionalUnitPriceOf, linePriceReading } from '@/shared/utils/invoice-line-display'

const money = (cents: number) => `GH₵${(cents / 100).toFixed(2)}`

describe('additionalUnitPriceOf', () => {
  it('gives back the further-unit price of a stepped line', () => {
    expect(additionalUnitPriceOf({ quantity: 3, unitPrice: 10000, lineSubtotal: 22000 })).toBe(6000)
  })

  it('reads stored values that arrive as strings', () => {
    expect(
      additionalUnitPriceOf({ quantity: '3', unitPrice: '10000', lineSubtotal: '22000' })
    ).toBe(6000)
  })

  it('knows a free further unit', () => {
    expect(additionalUnitPriceOf({ quantity: 4, unitPrice: 10000, lineSubtotal: 10000 })).toBe(0)
  })

  it('is nothing for a line billed flat', () => {
    expect(additionalUnitPriceOf({ quantity: 3, unitPrice: 10000, lineSubtotal: 30000 })).toBeNull()
  })

  it('is nothing for one unit, whatever its subtotal', () => {
    expect(additionalUnitPriceOf({ quantity: 1, unitPrice: 10000, lineSubtotal: 9000 })).toBeNull()
  })

  it('is nothing when the subtotal is not known', () => {
    expect(additionalUnitPriceOf({ quantity: 3, unitPrice: 10000, lineSubtotal: null })).toBeNull()
    expect(additionalUnitPriceOf({ quantity: 3, unitPrice: 10000 })).toBeNull()
  })

  it('is nothing when the subtotal implies no whole further-unit price (not a stepped line)', () => {
    expect(additionalUnitPriceOf({ quantity: 3, unitPrice: 10000, lineSubtotal: 22001 })).toBeNull()
    expect(additionalUnitPriceOf({ quantity: 3, unitPrice: 10000, lineSubtotal: 5000 })).toBeNull()
  })
})

describe('linePriceReading', () => {
  it('reads a stepped line as the first unit plus the further units', () => {
    expect(linePriceReading({ quantity: 3, unitPrice: 10000, lineSubtotal: 22000 }, money)).toBe(
      'GH₵100.00 + 2 × GH₵60.00'
    )
  })

  it('reads a flat line as unit price × quantity', () => {
    expect(linePriceReading({ quantity: 3, unitPrice: 10000, lineSubtotal: 30000 }, money)).toBe(
      'GH₵100.00 × 3'
    )
  })
})
