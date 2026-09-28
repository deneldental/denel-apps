import { describe, expect, it } from 'vitest'
import {
  BIRTHDAY_LOOKUP_DAYS,
  CACHE_TTL,
  CURRENCY,
  DEFAULT_COUNTRY_CODE,
  DEFAULT_PAGE_SIZE,
  DEFAULT_SMS_TEMPLATES,
  MAX_PAGE_SIZE,
  PATIENT_ID_LENGTH,
  PATIENT_ID_PREFIX,
  PHONE_NUMBER_REGEX,
} from '../../src/lib/constants'

describe('Constants', () => {
  it('should have correct currency', () => {
    expect(CURRENCY).toBe('GHS')
  })

  it('should have Ghana as default country code', () => {
    expect(DEFAULT_COUNTRY_CODE).toBe('233')
  })

  it('should have a valid phone regex that matches 10+ digit numbers', () => {
    expect(PHONE_NUMBER_REGEX.test('0241234567')).toBe(true)
    expect(PHONE_NUMBER_REGEX.test('233241234567')).toBe(true)
    expect(PHONE_NUMBER_REGEX.test('123456789')).toBe(false) // 9 digits
    expect(PHONE_NUMBER_REGEX.test('abc')).toBe(false)
  })

  it('should have a 30-day birthday lookup window', () => {
    expect(BIRTHDAY_LOOKUP_DAYS).toBe(30)
  })

  it('should have correct PATIENT_ID_PREFIX', () => {
    expect(PATIENT_ID_PREFIX).toBe('FD')
    expect(PATIENT_ID_LENGTH).toBe(6)
  })

  it('should have sensible pagination defaults', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(50)
    expect(MAX_PAGE_SIZE).toBe(100)
    expect(MAX_PAGE_SIZE).toBeGreaterThan(DEFAULT_PAGE_SIZE)
  })

  describe('CACHE_TTL', () => {
    it('should have SHORT < MEDIUM < LONG < DAY', () => {
      expect(CACHE_TTL.SHORT).toBeLessThan(CACHE_TTL.MEDIUM)
      expect(CACHE_TTL.MEDIUM).toBeLessThan(CACHE_TTL.LONG)
      expect(CACHE_TTL.LONG).toBeLessThan(CACHE_TTL.DAY)
    })

    it('should have correct values in seconds', () => {
      expect(CACHE_TTL.SHORT).toBe(60)
      expect(CACHE_TTL.MEDIUM).toBe(300)
      expect(CACHE_TTL.LONG).toBe(3600)
      expect(CACHE_TTL.DAY).toBe(86400)
    })
  })

  describe('DEFAULT_SMS_TEMPLATES', () => {
    it('should contain appointment, payment, and paymentPlan templates', () => {
      expect(DEFAULT_SMS_TEMPLATES).toHaveProperty('appointment')
      expect(DEFAULT_SMS_TEMPLATES).toHaveProperty('payment')
      expect(DEFAULT_SMS_TEMPLATES).toHaveProperty('paymentPlan')
    })

    it('should include placeholder tokens in each template', () => {
      expect(DEFAULT_SMS_TEMPLATES.appointment).toContain('{Patientname}')
      expect(DEFAULT_SMS_TEMPLATES.appointment).toContain('{date}')
      expect(DEFAULT_SMS_TEMPLATES.payment).toContain('{amount}')
      expect(DEFAULT_SMS_TEMPLATES.paymentPlan).toContain('{balance}')
    })
  })
})
