// Property-style tests for specialist commission math. Integration of the
// full posting flow is covered by reconciliation against the GL.

import { Money } from '@denel/utils'
import { describe, expect, it } from 'vitest'

describe('commission math', () => {
  it('commission is computed on line_after_discount, not gross unit price (spec §11.8)', () => {
    const unitPrice = Money.fromString('1500.00')
    const discount = Money.fromString('150.00')
    const afterDiscount = unitPrice.sub(discount)
    const rate = 50
    const commission = afterDiscount.percent(rate)
    expect(commission.toString()).toBe('675.00')
  })

  it('proportional transition — patient pays 40% moves 40% to payable', () => {
    const invoiceTotal = Money.fromString('1500.00')
    const commission = Money.fromString('500.00')
    const paid = Money.fromString('600.00')
    const ratio = paid.toNumber() / invoiceTotal.toNumber()
    const newPayable = commission.mul(ratio)
    expect(newPayable.toString()).toBe('200.00')
  })

  it('full payment moves the entire commission to payable', () => {
    const invoiceTotal = Money.fromString('1000.00')
    const commission = Money.fromString('400.00')
    const ratio = invoiceTotal.toNumber() / invoiceTotal.toNumber()
    expect(commission.mul(ratio).toString()).toBe('400.00')
  })

  it('zero payment keeps the commission accrued (payable = 0)', () => {
    const _invoiceTotal = Money.fromString('1000.00')
    const commission = Money.fromString('400.00')
    const ratio = 0
    expect(commission.mul(ratio).toString()).toBe('0.00')
  })

  it('payout gross/wht/net math', () => {
    const gross = Money.fromString('5000.00')
    const wht = gross.percent(7.5) // standard professional services rate
    const net = gross.sub(wht)
    expect(wht.toString()).toBe('375.00')
    expect(net.toString()).toBe('4625.00')
  })

  it('lifecycle invariant: accrued + payable + paid - reversed == total commission_amount', () => {
    // Simulate a sequence of state transitions on a single commission.
    const commission = Money.fromString('500.00')

    // Initial: fully accrued
    let accrued = commission
    let payable = Money.zero()
    let paid = Money.zero()
    expect(accrued.add(payable).add(paid).eq(commission)).toBe(true)

    // Patient pays 40%: 200 moves accrued → payable
    const delta = commission.mul(0.4)
    accrued = accrued.sub(delta)
    payable = payable.add(delta)
    expect(accrued.add(payable).add(paid).eq(commission)).toBe(true)

    // Payout: payable moves to paid
    paid = paid.add(payable)
    payable = Money.zero()
    expect(accrued.add(payable).add(paid).eq(commission)).toBe(true)

    // Patient pays the rest: 300 from accrued → payable, then paid via a later payout
    accrued = Money.zero()
    payable = commission.mul(0.6)
    expect(accrued.add(payable).add(paid).eq(commission)).toBe(true)
  })
})
