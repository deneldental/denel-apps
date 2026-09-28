import { describe, expect, it } from 'vitest'
import { computeLeaveSplit } from '../../src/routes/staff-attendance'

// Phase 5 — split-leave allocation. A 30-day annual entitlement halves into
// 15 bulk annual + 15 casual; bulk beyond its half spills into casual.
describe('computeLeaveSplit', () => {
  it('halves the entitlement into bulk + casual (30 → 15/15)', () => {
    const s = computeLeaveSplit(30, 0, 0)
    expect(s.annualQuota).toBe(15)
    expect(s.casualQuota).toBe(15)
    expect(s.annualRemaining).toBe(15)
    expect(s.casualRemaining).toBe(15)
    expect(s.casualExhausted).toBe(false)
  })

  it('rounds an odd entitlement toward annual (25 → 13/12)', () => {
    const s = computeLeaveSplit(25, 0, 0)
    expect(s.totalQuota).toBe(25)
    expect(s.annualQuota).toBe(13)
    expect(s.casualQuota).toBe(12)
  })

  it('draws casual down as casual leave is used', () => {
    const s = computeLeaveSplit(30, 0, 4)
    expect(s.annualRemaining).toBe(15)
    expect(s.casualUsed).toBe(4)
    expect(s.casualRemaining).toBe(11)
    expect(s.casualExhausted).toBe(false)
  })

  it('a full 30-day bulk block zeroes casual (overflow rule)', () => {
    const s = computeLeaveSplit(30, 30, 0)
    expect(s.annualRemaining).toBe(0)
    expect(s.casualRemaining).toBe(0)
    expect(s.casualExhausted).toBe(true)
  })

  it('bulk beyond its half eats partially into casual', () => {
    // 20 bulk used → 5 over the 15 quota → casual 15 − 5 = 10 left.
    const s = computeLeaveSplit(30, 20, 0)
    expect(s.annualRemaining).toBe(0)
    expect(s.casualRemaining).toBe(10)
  })

  it('flags casual exhausted once it hits zero', () => {
    const s = computeLeaveSplit(30, 0, 15)
    expect(s.casualRemaining).toBe(0)
    expect(s.casualExhausted).toBe(true)
  })

  it('honours a configured annual-block size (30 total, 20 block → 20/10)', () => {
    const s = computeLeaveSplit(30, 0, 0, 20)
    expect(s.annualQuota).toBe(20)
    expect(s.casualQuota).toBe(10)
  })

  it('clamps a configured block that exceeds the total', () => {
    const s = computeLeaveSplit(30, 0, 0, 40)
    expect(s.annualQuota).toBe(30)
    expect(s.casualQuota).toBe(0)
  })

  it('a null block falls back to the 50/50 split', () => {
    const s = computeLeaveSplit(30, 0, 0, null)
    expect(s.annualQuota).toBe(15)
    expect(s.casualQuota).toBe(15)
  })
})
