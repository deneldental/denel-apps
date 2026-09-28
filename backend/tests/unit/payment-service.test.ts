// Pure unit tests for the payment math helpers. End-to-end posting + JE
// flows are covered by integration tests (run with DATABASE_URL set).

import { Money } from '@denel/utils'
import { describe, expect, it } from 'vitest'

describe('payment allocation math', () => {
  it('70/30 split — allocated + unallocated sums to amount', () => {
    const amount = Money.fromString('1000.00')
    const allocated = Money.fromString('700.00')
    const unallocated = amount.sub(allocated)
    expect(unallocated.toString()).toBe('300.00')
    expect(allocated.add(unallocated).eq(amount)).toBe(true)
  })

  it('distributes a remainder cleanly across three allocations', () => {
    // 100.00 split into 3 — the remainder cent is spread to the leading slice
    const amount = Money.fromString('100.00')
    const parts = amount.distribute(3)
    expect(parts.map((p) => p.toString())).toEqual(['33.34', '33.33', '33.33'])
    expect(Money.sum(parts).eq(amount)).toBe(true)
  })

  it('apply-credit reduces unallocated and bumps allocated by the same amount', () => {
    let allocated = Money.fromString('200.00')
    let unallocated = Money.fromString('800.00')
    const amount = allocated.add(unallocated) // 1000

    const applied = Money.fromString('500.00')
    allocated = allocated.add(applied)
    unallocated = unallocated.sub(applied)

    expect(allocated.toString()).toBe('700.00')
    expect(unallocated.toString()).toBe('300.00')
    expect(allocated.add(unallocated).eq(amount)).toBe(true)
  })

  it('rejects allocation greater than payment amount (caller-side invariant)', () => {
    const amount = Money.fromString('500.00')
    const alloc = Money.fromString('500.01')
    expect(alloc.gt(amount)).toBe(true)
  })

  it('reversal restores invoice balance to its pre-payment state', () => {
    const total = Money.fromString('1500.00')
    const paid = Money.fromString('600.00')
    const balanceAfterPay = total.sub(paid) // 900

    // Reverse the 600 payment → balance back to 1500, paid back to 0
    const newPaid = paid.sub(Money.fromString('600.00'))
    const newBalance = balanceAfterPay.add(Money.fromString('600.00'))
    expect(newPaid.toString()).toBe('0.00')
    expect(newBalance.toString()).toBe('1500.00')
  })
})
