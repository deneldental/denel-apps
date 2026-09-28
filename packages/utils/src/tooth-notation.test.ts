import { describe, expect, it } from 'vitest'
import {
  fdiToPalmer,
  fdiToUniversal,
  formatTeeth,
  formatTooth,
  isPermanentFdi,
} from './tooth-notation'

/**
 * settings-domain-audit S5-B (clinical): every table stores FDI; the clinic
 * chooses how tooth numbers are displayed. This is the one mapping.
 */
describe('isPermanentFdi', () => {
  it('accepts quadrants 1–4, positions 1–8 only', () => {
    expect(isPermanentFdi(11)).toBe(true)
    expect(isPermanentFdi(48)).toBe(true)
    expect(isPermanentFdi(19)).toBe(false)
    expect(isPermanentFdi(50)).toBe(false)
    expect(isPermanentFdi(55)).toBe(false) // deciduous
    expect(isPermanentFdi(0)).toBe(false)
    expect(isPermanentFdi(1.5)).toBe(false)
  })
})

describe('fdiToUniversal', () => {
  it('numbers 1–32 clockwise from the upper-right third molar', () => {
    expect(fdiToUniversal(18)).toBe(1)
    expect(fdiToUniversal(11)).toBe(8)
    expect(fdiToUniversal(21)).toBe(9)
    expect(fdiToUniversal(28)).toBe(16)
    expect(fdiToUniversal(38)).toBe(17)
    expect(fdiToUniversal(31)).toBe(24)
    expect(fdiToUniversal(41)).toBe(25)
    expect(fdiToUniversal(48)).toBe(32)
  })

  it('covers all 32 teeth exactly once', () => {
    const all = [1, 2, 3, 4].flatMap((q) => [1, 2, 3, 4, 5, 6, 7, 8].map((p) => q * 10 + p))
    const universal = all.map((t) => fdiToUniversal(t))
    expect([...new Set(universal)].length).toBe(32)
    expect(Math.min(...(universal as number[]))).toBe(1)
    expect(Math.max(...(universal as number[]))).toBe(32)
  })

  it('is null for anything that is not a permanent FDI number', () => {
    expect(fdiToUniversal(55)).toBeNull()
  })
})

describe('fdiToPalmer', () => {
  it('writes quadrant + position from the midline', () => {
    expect(fdiToPalmer(16)).toBe('UR6')
    expect(fdiToPalmer(21)).toBe('UL1')
    expect(fdiToPalmer(36)).toBe('LL6')
    expect(fdiToPalmer(47)).toBe('LR7')
    expect(fdiToPalmer(64)).toBeNull()
  })
})

describe('formatTooth / formatTeeth', () => {
  it('formats by notation and passes FDI through', () => {
    expect(formatTooth(16)).toBe('16')
    expect(formatTooth(16, 'fdi')).toBe('16')
    expect(formatTooth(16, 'universal')).toBe('3')
    expect(formatTooth(16, 'palmer')).toBe('UR6')
  })

  it('shows non-permanent or free-text values as they are', () => {
    expect(formatTooth(55, 'universal')).toBe('55')
    expect(formatTooth('x', 'palmer')).toBe('x')
    expect(formatTooth(null)).toBe('')
    expect(formatTooth(undefined, 'universal')).toBe('')
  })

  it('joins lists', () => {
    expect(formatTeeth([16, 26], 'universal')).toBe('3, 14')
    expect(formatTeeth([16, 26], 'palmer', ' / ')).toBe('UR6 / UL6')
  })
})
