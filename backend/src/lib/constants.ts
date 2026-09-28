// Currency
export const CURRENCY = 'GHS'

// SMS
export const DEFAULT_COUNTRY_CODE = '233'
export const PHONE_NUMBER_REGEX = /^\d{10,}$/

// Birthday lookup window
export const BIRTHDAY_LOOKUP_DAYS = 30

// Date formats
export const DATE_FORMAT = 'yyyy-MM-dd'
export const DATETIME_FORMAT = 'yyyy-MM-dd HH:mm:ss'

// Patient ID
export const PATIENT_ID_PREFIX = 'FD'
export const PATIENT_ID_LENGTH = 6

// Pagination
export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 100

// Request body size limits (bytes)
export const LIMITS = {
  BODY_SIZE_GENERAL: 1 * 1024 * 1024, // 1 MB for JSON/form payloads
  BODY_SIZE_UPLOAD: 25 * 1024 * 1024, // 25 MB for file uploads
} as const

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
  /** Fired (optionally) when a new payment plan is created for the patient.
   *  Token reference:
   *    {Patientname}        Patient's full name
   *    {ClinicName}         Clinic short name (from branding)
   *    {total}              Plan total in GHS, 2dp
   *    {installments}       Number of installments (fixed plans) or 'flexible'
   *    {perInstallment}     Per-installment amount in GHS, 2dp (fixed only)
   *    {treatmenttypes}     Comma-separated treatment names
   *  Override at runtime via `PAYMENT_PLAN_CREATED_SMS` env var. */
  paymentPlanCreated:
    'Dear {Patientname}, a payment plan of GHS {total} has been set up for your treatment ({treatmenttypes}). Payable in {installments} installments of GHS {perInstallment}. Thank you for choosing {ClinicName}.',
  welcome:
    'Welcome to {ClinicName}, {Patientname}! Your Patient ID is {PatientID}. We look forward to providing you with excellent dental care. Thank you!',
} as const
