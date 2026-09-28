import { DEFAULT_COUNTRY_CODE } from '@/lib/constants'

/**
 * Formats a phone number to include country code
 * @param phone - Raw phone number string
 * @param countryCode - Country code (default: 233 for Ghana)
 * @returns Formatted phone number with country code
 */
export function formatPhoneNumber(
  phone: string | null | undefined,
  countryCode = DEFAULT_COUNTRY_CODE
): string {
  if (!phone) return ''

  // Remove all non-digit characters
  const cleaned = phone.replace(/\D/g, '')

  // If already has country code, return as is
  if (cleaned.startsWith(countryCode)) {
    return cleaned
  }

  // If starts with 0, replace with country code
  if (cleaned.startsWith('0')) {
    return `${countryCode}${cleaned.substring(1)}`
  }

  // Otherwise prepend country code
  return `${countryCode}${cleaned}`
}

/**
 * Validates if a phone number is valid
 * @param phone - Phone number to validate
 * @returns true if valid, false otherwise
 */
export function isValidPhoneNumber(phone: string | null | undefined): boolean {
  if (!phone) return false
  const cleaned = phone.replace(/\D/g, '')
  return cleaned.length >= 10
}
