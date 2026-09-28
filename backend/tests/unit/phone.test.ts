import { describe, expect, it } from 'vitest'
import { formatPhoneNumber, isValidPhoneNumber } from '../../src/lib/utils/phone'

describe('Phone Utilities', () => {
  describe('formatPhoneNumber', () => {
    it('should return empty string for null or undefined', () => {
      expect(formatPhoneNumber(null)).toBe('')
      expect(formatPhoneNumber(undefined)).toBe('')
      expect(formatPhoneNumber('')).toBe('')
    })

    it('should prepend country code when number starts with 0', () => {
      expect(formatPhoneNumber('0241234567')).toBe('233241234567')
      expect(formatPhoneNumber('0501234567')).toBe('233501234567')
    })

    it('should not double-add country code if already present', () => {
      expect(formatPhoneNumber('233241234567')).toBe('233241234567')
      expect(formatPhoneNumber('233501234567')).toBe('233501234567')
    })

    it('should strip non-digit characters before formatting', () => {
      expect(formatPhoneNumber('+233-24-123-4567')).toBe('233241234567')
      expect(formatPhoneNumber('(024) 123-4567')).toBe('233241234567')
    })

    it('should prepend country code to 9-digit number without leading zero', () => {
      expect(formatPhoneNumber('241234567')).toBe('233241234567')
    })

    it('should support custom country code', () => {
      expect(formatPhoneNumber('0241234567', '44')).toBe('44241234567')
    })
  })

  describe('isValidPhoneNumber', () => {
    it('should return false for null, undefined, or empty string', () => {
      expect(isValidPhoneNumber(null)).toBe(false)
      expect(isValidPhoneNumber(undefined)).toBe(false)
      expect(isValidPhoneNumber('')).toBe(false)
    })

    it('should return false for numbers shorter than 10 digits', () => {
      expect(isValidPhoneNumber('12345')).toBe(false)
      expect(isValidPhoneNumber('123456789')).toBe(false)
    })

    it('should return true for 10-digit numbers', () => {
      expect(isValidPhoneNumber('0241234567')).toBe(true)
    })

    it('should return true for numbers longer than 10 digits', () => {
      expect(isValidPhoneNumber('233241234567')).toBe(true)
    })

    it('should count only digit characters', () => {
      expect(isValidPhoneNumber('+233-24-123-4567')).toBe(true)
      expect(isValidPhoneNumber('024 123 456')).toBe(false) // only 9 digits
    })
  })
})
