// Pure unit tests for plan math. Integration tests cover the DB write paths.

import { Money } from '@denel/utils'
import { describe, expect, it } from 'vitest'

describe('plan installment distribution', () => {
  it('splits 12-month plan exactly — no remainder', () => {
    const total = Money.fromString('6000.00')
    const parts = total.distribute(12)
    expect(parts.length).toBe(12)
    expect(Money.sum(parts).toString()).toBe('6000.00')
    // 6000 / 12 = 500 exactly, no remainder
    expect(parts.every((p) => p.toString() === '500.00')).toBe(true)
  })

  it('handles GHS 100 split into 3 — leading slice gets the cent', () => {
    const total = Money.fromString('100.00')
    const parts = total.distribute(3)
    expect(parts.map((p) => p.toString())).toEqual(['33.34', '33.33', '33.33'])
    expect(Money.sum(parts).eq(total)).toBe(true)
  })

  it('handles GHS 1500.05 split into 7 — never loses a cent', () => {
    const total = Money.fromString('1500.05')
    const parts = total.distribute(7)
    expect(Money.sum(parts).eq(total)).toBe(true)
    // 1500.05 / 7 = 214.293...; base = 214.29, remainder 0.02 spread to the
    // first two slices.
    expect(parts.slice(0, 2).every((p) => p.toString() === '214.30')).toBe(true)
    expect(parts.slice(2).every((p) => p.toString() === '214.29')).toBe(true)
  })
})

describe('payment-plan percent discounts', () => {
  it('uses exact Money percent math for fractional discounts', () => {
    const subtotal = Money.fromString('1499.95')
    const discount = subtotal.percent(12.5)
    expect(discount.toString()).toBe('187.49')
    expect(subtotal.sub(discount).toString()).toBe('1312.46')
  })
})

describe('schedule-item status derivation logic (algorithm sketch)', () => {
  // Mirrors the in-service algorithm so we can prove the math without a DB.
  type Status = 'pending' | 'paid' | 'partial' | 'overdue'
  function deriveStatus(
    expected: number,
    received: number,
    expectedDate: string,
    today: string
  ): Status {
    if (received >= expected) return 'paid'
    if (received > 0) return 'partial'
    if (expectedDate < today) return 'overdue'
    return 'pending'
  }

  it('paid when received >= expected', () => {
    expect(deriveStatus(500, 500, '2026-05-01', '2026-05-12')).toBe('paid')
    expect(deriveStatus(500, 501, '2026-05-01', '2026-05-12')).toBe('paid')
  })

  it('partial when 0 < received < expected', () => {
    expect(deriveStatus(500, 200, '2026-06-01', '2026-05-12')).toBe('partial')
  })

  it('overdue when received==0 and expected_date is in the past', () => {
    expect(deriveStatus(500, 0, '2026-04-01', '2026-05-12')).toBe('overdue')
  })

  it('pending when received==0 and expected_date is in the future', () => {
    expect(deriveStatus(500, 0, '2026-06-01', '2026-05-12')).toBe('pending')
  })

  it('walks a 3-installment plan paid 1.5x the first installment', () => {
    const installments = [500, 500, 500]
    let pool = 750
    const results: Status[] = []
    for (const expected of installments) {
      const received = Math.min(pool, expected)
      pool -= received
      results.push(received >= expected ? 'paid' : received > 0 ? 'partial' : 'pending')
    }
    // pool drains 500 into item 1 (paid), then 250 into item 2 (partial),
    // then 0 into item 3 (pending).
    expect(results).toEqual(['paid', 'partial', 'pending'])
  })
})
