// Pure unit tests for deferred-revenue math.

import { Money } from '@denel/utils'
import { describe, expect, it } from 'vitest'

describe('deferred revenue math', () => {
  it('remaining = line_after_discount - sum(events)', () => {
    const lineAmount = Money.fromString('6000.00')
    const events = ['500.00', '500.00', '500.00'].map((s) => Money.fromString(s))
    const recognised = Money.sum(events)
    const remaining = lineAmount.sub(recognised)
    expect(recognised.toString()).toBe('1500.00')
    expect(remaining.toString()).toBe('4500.00')
  })

  it('caps recognition at remaining (cannot over-recognise)', () => {
    const lineAmount = Money.fromString('1000.00')
    const recognisedSoFar = Money.fromString('800.00')
    const requested = Money.fromString('300.00')
    const remaining = lineAmount.sub(recognisedSoFar)
    const applied = requested.gt(remaining) ? remaining : requested
    expect(applied.toString()).toBe('200.00')
  })

  it('full recognition zeros out the deferred balance', () => {
    const lineAmount = Money.fromString('1500.00')
    const recognised = lineAmount
    const remaining = lineAmount.sub(recognised)
    expect(remaining.isZero()).toBe(true)
  })

  it('monthly ortho recognition over 12 months sums exactly to line total', () => {
    // 6000 / 12 = 500 per month — cleanly divisible
    const lineAmount = Money.fromString('6000.00')
    const monthly = lineAmount.distribute(12)
    expect(Money.sum(monthly).eq(lineAmount)).toBe(true)
    expect(monthly.every((m) => m.toString() === '500.00')).toBe(true)
  })

  it('uneven ortho recognition (e.g. 5500 / 12) spreads the remainder cents', () => {
    const lineAmount = Money.fromString('5500.00')
    const monthly = lineAmount.distribute(12)
    expect(Money.sum(monthly).eq(lineAmount)).toBe(true)
    // base = 458.33, remainder 0.04 → first four months get 458.34
    expect(monthly.slice(0, 4).every((m) => m.toString() === '458.34')).toBe(true)
    expect(monthly.slice(4).every((m) => m.toString() === '458.33')).toBe(true)
  })

  it('reversal subtracts the event amount back from recognised total', () => {
    const lineAmount = Money.fromString('1000.00')
    const events = ['400.00', '300.00'].map((s) => Money.fromString(s))
    const recognisedBefore = Money.sum(events)
    // Reverse the first event
    const reversed = events[0]
    const recognisedAfter = recognisedBefore.sub(reversed)
    expect(recognisedAfter.toString()).toBe('300.00')
    expect(lineAmount.sub(recognisedAfter).toString()).toBe('700.00')
  })
})
