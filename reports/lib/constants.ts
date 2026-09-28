// Currency
export const CURRENCY = 'GHS'
export const CENTS_PER_UNIT = 100

// SMS
export const DEFAULT_COUNTRY_CODE = '233'
export const PHONE_NUMBER_REGEX = /^\d{10,}$/

// Birthday lookup window
export const BIRTHDAY_LOOKUP_DAYS = 30

// Date formats
export const DATE_FORMAT = 'yyyy-MM-dd'
export const DATETIME_FORMAT = 'yyyy-MM-dd HH:mm:ss'

// Patient ID
export const PATIENT_ID_PREFIX = 'FDM'
export const PATIENT_ID_LENGTH = 6

// Pagination
export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 100

// Database
export const DEFAULT_POOL_SIZE = 20
export const DEFAULT_IDLE_TIMEOUT = 30000
export const DEFAULT_CONNECTION_TIMEOUT = 10000

// Cache TTL (seconds)
export const CACHE_TTL = {
  SHORT: 60, // 1 minute
  MEDIUM: 300, // 5 minutes
  LONG: 3600, // 1 hour
  DAY: 86400, // 24 hours
} as const

// SMS Templates (defaults)
export const DEFAULT_SMS_TEMPLATES = {
  appointment:
    'Dear {Patientname}, your appointment has been scheduled for {date} at {time}. Please arrive 30 minutes before time',
  payment:
    'Dear {Patientname}, thank you for your payment of GHS {amount} for {treatmenttypes}. Thank you!',
  paymentPlan:
    'Dear {Patientname}, thank you for your payment of GHS {amount} for {treatmenttypes}. Your current balance is GHS {balance}. Thank you!',
} as const
