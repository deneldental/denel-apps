// Shared date helpers for the finance report pages. All report date inputs are
// `yyyy-MM-dd` strings; the backend stores/returns either the same shape or a
// full ISO timestamp. These helpers normalise both through `date-fns` with a
// guard so a malformed value renders as an em-dash instead of `Invalid Date`.

import { format, isValid, parseISO, startOfMonth } from 'date-fns'

/** Today as a `yyyy-MM-dd` string. */
export function todayIso(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

/** First day of the current month as a `yyyy-MM-dd` string. */
export function startOfMonthIso(): string {
  return format(startOfMonth(new Date()), 'yyyy-MM-dd')
}

/**
 * Render a backend date/timestamp string for display. Accepts `yyyy-MM-dd` or a
 * full ISO timestamp; returns `fallback` (default `—`) for null/invalid input.
 */
export function formatReportDate(value: string | null | undefined, fallback = '—'): string {
  if (!value) return fallback
  const parsed = parseISO(value)
  if (!isValid(parsed)) return fallback
  return format(parsed, 'dd MMM yyyy')
}
