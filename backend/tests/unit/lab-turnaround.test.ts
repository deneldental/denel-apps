/**
 * settings-domain-audit S5-B (clinical): a lab case's expected return comes
 * from the express option, then the vendor offering, then the base service —
 * and, when none carries a turnaround, from Settings → Clinical
 * (`defaultLabTurnaroundDays`) instead of a hardcoded 7.
 */
import { describe, expect, it } from 'vitest'
import { resolveTurnaroundDays } from '../../src/lib/lab-turnaround'

describe('resolveTurnaroundDays', () => {
  it('takes the first usable candidate in order', () => {
    expect(resolveTurnaroundDays([3, 5, 7], 10)).toBe(3)
    expect(resolveTurnaroundDays([undefined, 5, 7], 10)).toBe(5)
    expect(resolveTurnaroundDays([null, null, 7], 10)).toBe(7)
  })

  it('falls back to the configured default when nothing usable is set', () => {
    expect(resolveTurnaroundDays([null, undefined], 9)).toBe(9)
    expect(resolveTurnaroundDays([], 9)).toBe(9)
  })

  it('skips zero, negative and non-finite values', () => {
    expect(resolveTurnaroundDays([0, -2, Number.NaN, 4], 9)).toBe(4)
  })
})
