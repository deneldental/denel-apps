import { describe, expect, it } from 'vitest'

describe('Basic Tests', () => {
  it('should correctly add numbers', () => {
    expect(2 + 2).toBe(4)
  })

  it('should correctly subtract numbers', () => {
    expect(5 - 3).toBe(2)
  })

  it('should correctly multiply numbers', () => {
    expect(3 * 4).toBe(12)
  })

  it('should correctly divide numbers', () => {
    expect(10 / 2).toBe(5)
  })
})
