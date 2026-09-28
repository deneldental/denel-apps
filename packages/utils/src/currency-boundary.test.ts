import { describe, expect, it } from 'vitest'
import { centsToInput, inputToCents } from './currency'

describe('centsToInput()', () => {
  it('formats integer cents into decimal Cedis string without currency symbol', () => {
    expect(centsToInput(15000)).toBe('150.00')
    expect(centsToInput(100)).toBe('1.00')
    expect(centsToInput(50)).toBe('0.50')
    expect(centsToInput(5)).toBe('0.05')
    expect(centsToInput(0)).toBe('0.00')
    expect(centsToInput(-15000)).toBe('-150.00')
  })

  it('handles string numeric cents from database or JSON', () => {
    expect(centsToInput('15000')).toBe('150.00')
    expect(centsToInput('250')).toBe('2.50')
  })

  it('returns empty string for nullish or invalid values', () => {
    expect(centsToInput(null)).toBe('')
    expect(centsToInput(undefined)).toBe('')
    expect(centsToInput('')).toBe('')
    expect(centsToInput(NaN)).toBe('')
  })
})

describe('inputToCents()', () => {
  it('converts decimal Cedis string to integer cents', () => {
    expect(inputToCents('150')).toBe(15000)
    expect(inputToCents('150.00')).toBe(15000)
    expect(inputToCents('150.50')).toBe(15050)
    expect(inputToCents('0.75')).toBe(75)
    expect(inputToCents('.25')).toBe(25)
  })

  it('converts numbers to integer cents', () => {
    expect(inputToCents(150)).toBe(15000)
    expect(inputToCents(150.5)).toBe(15050)
    expect(inputToCents(0.01)).toBe(1)
  })

  it('handles strings with currency symbols and comma separators', () => {
    expect(inputToCents('GHS 150.00')).toBe(15000)
    expect(inputToCents('GH₵ 1,250.00')).toBe(125000)
    expect(inputToCents('₵ 50.00')).toBe(5000)
  })

  it('handles negative inputs', () => {
    expect(inputToCents('-150.00')).toBe(-15000)
    expect(inputToCents(-150)).toBe(-15000)
  })

  it('returns 0 for empty or invalid input', () => {
    expect(inputToCents('')).toBe(0)
    expect(inputToCents(null)).toBe(0)
    expect(inputToCents(undefined)).toBe(0)
    expect(inputToCents('abc')).toBe(0)
  })

  it('rounds half-even or rounds accurately to avoid float drift', () => {
    // 0.1 + 0.2 in JS is 0.30000000000000004
    expect(inputToCents(0.1 + 0.2)).toBe(30)
  })
})
