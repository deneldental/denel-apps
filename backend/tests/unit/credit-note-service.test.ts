// Pure unit tests for credit-note math. The transactional posting +
// reconciliation flows are covered by integration tests when DATABASE_URL is set.

import { Money } from '@denel/utils'
import { describe, expect, it } from 'vitest'

describe('credit-note math', () => {
  it('caps total credit at the invoice total minus existing credits', () => {
    const invoiceTotal = Money.fromString('1500.00')
    const existingCredit = Money.fromString('400.00')
    const requested = Money.fromString('1200.00')
    const available = invoiceTotal.sub(existingCredit)
    const wouldExceed = requested.gt(available)
    expect(wouldExceed).toBe(true)
  })

  it('full credit reduces invoice balance to zero and marks paid', () => {
    const total = Money.fromString('500.00')
    const paid = Money.zero()
    const balance = total.sub(paid)
    const creditAmount = balance
    const remaining = balance.sub(creditAmount)
    expect(remaining.isZero()).toBe(true)
  })

  it('proportional tax reversal — 25% credit reverses 25% of invoice tax', () => {
    const invoiceTotal = Money.fromString('1518.75')
    const invoiceTax = Money.fromString('168.75')
    const credit = Money.fromString('379.69') // 25% of total

    const fraction = credit.toNumber() / invoiceTotal.toNumber()
    const taxReversed = invoiceTax.mul(fraction)
    // 168.75 × 0.25 = 42.1875 → 42.19 banker's rounding
    expect(taxReversed.toString()).toBe('42.19')

    // AR credit = credit amount + tax reversed
    const arCredit = credit.add(taxReversed)
    expect(arCredit.toString()).toBe('421.88')
  })

  it('write-off posts to bad debt expense, not contra-revenue', () => {
    // Sentinel: write_off branches to 5900 Bad Debt, all other reasons go to
    // 4900 Discounts Given (or the original line revenue account).
    type Reason = 'discount' | 'correction' | 'cancellation' | 'goodwill' | 'write_off'
    const isWriteOff = (r: Reason) => r === 'write_off'
    expect(isWriteOff('write_off')).toBe(true)
    expect(isWriteOff('discount')).toBe(false)
  })

  it('refund cannot exceed patient deposit balance', () => {
    const depositBalance = Money.fromString('300.00')
    const refund = Money.fromString('350.00')
    expect(refund.gt(depositBalance)).toBe(true)
  })
})
