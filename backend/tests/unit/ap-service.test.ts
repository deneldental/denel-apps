import { describe, expect, it } from 'vitest'
import { computeBillLine } from '../../src/lib/ap-service'

// Amounts are integer CENTS in and out — see the note on computeLine.
describe('computeBillLine — supplier bill line math', () => {
  it('computes a plain line (no tax)', () => {
    const c = computeBillLine({
      description: 'Dental supplies',
      quantity: 5,
      unitPrice: 20000,
      expenseAccountId: '00000000-0000-0000-0000-000000000000',
    })
    expect(c.lineSubtotal).toBe(100000)
    expect(c.taxAmount).toBe(0)
    expect(c.lineTotal).toBe(100000)
  })

  it('applies VAT 15% to a line', () => {
    const c = computeBillLine({
      description: 'Lab work',
      quantity: 1,
      unitPrice: 100000,
      taxRate: 15,
      expenseAccountId: '00000000-0000-0000-0000-000000000000',
    })
    expect(c.lineSubtotal).toBe(100000)
    expect(c.taxAmount).toBe(15000)
    expect(c.lineTotal).toBe(115000)
  })

  it('rounds tax at the line level — odd totals never lose a cent', () => {
    const c = computeBillLine({
      description: 'Imported instrument',
      quantity: 3,
      unitPrice: 33333,
      taxRate: 12.5,
      expenseAccountId: '00000000-0000-0000-0000-000000000000',
    })
    // 333.33 × 3 = 999.99 ; tax = 999.99 × 12.5% = 124.99875 → 125.00 banker's (even)
    expect(c.lineSubtotal).toBe(99999)
    expect(c.taxAmount).toBe(12500)
    expect(c.lineTotal).toBe(112499)
  })

  it('defaults quantity to 1', () => {
    const c = computeBillLine({
      description: 'Utilities — January',
      unitPrice: 45000,
      expenseAccountId: '00000000-0000-0000-0000-000000000000',
    })
    expect(c.quantity).toBe(1)
    expect(c.lineTotal).toBe(45000)
  })
})
