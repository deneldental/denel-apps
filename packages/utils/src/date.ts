// Date formatting — locale-agnostic, used for receipts, PDFs, and UI labels.
//
// R1: formatting is pinned to the clinic's timezone (Africa/Accra, UTC+0) via
// `Intl.DateTimeFormat`, NOT the runtime's local time. The previous version
// used `Date.getDate()/getHours()` etc. — local-timezone getters — so a
// backend-issued UTC timestamp near midnight could render as a different
// *day* on a non-UTC dev/staging machine (code-report-v1.md L8).

const CLINIC_TIME_ZONE = 'Africa/Accra'

const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: CLINIC_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

const DATE_TIME_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: CLINIC_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value == null || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Format a date as `'15 Mar 2026'` in clinic time. Returns '' for invalid input.
 */
export function formatDate(value: Date | string | number | null | undefined): string {
  const d = toDate(value)
  if (!d) return ''
  return DATE_FMT.format(d)
}

/**
 * Format a date with time as `'15 Mar 2026, 14:32'` (24-hour) in clinic time.
 */
export function formatDateTime(value: Date | string | number | null | undefined): string {
  const d = toDate(value)
  if (!d) return ''
  // en-GB renders this as "15 Mar 2026, 14:32".
  return DATE_TIME_FMT.format(d)
}
