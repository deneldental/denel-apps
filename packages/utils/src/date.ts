// Date formatting — locale-agnostic, used for receipts, PDFs, and UI labels.
//
// R1: formatting is pinned to the clinic's timezone (Africa/Accra, UTC+0) via
// `Intl.DateTimeFormat`, NOT the runtime's local time. The previous version
// used `Date.getDate()/getHours()` etc. — local-timezone getters — so a
// backend-issued UTC timestamp near midnight could render as a different
// *day* on a non-UTC dev/staging machine (code-report-v1.md L8).

export const CLINIC_TIME_ZONE = 'Africa/Accra'

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

/** `date`'s wall-clock reading (Y/M/D/H/M/S) as it appears in `timeZone`. */
function readInZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

/** `timeZone`'s UTC offset, in ms, at the instant `date` represents. */
function utcOffsetMs(date: Date, timeZone: string): number {
  const z = readInZone(date, timeZone)
  const asIfUTC = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second)
  return asIfUTC - date.getTime()
}

/**
 * Midnight of `date`'s calendar day *in `timeZone`* (default: clinic time),
 * as an absolute instant — not the server process's local midnight, and not
 * the caller's. Scheduling's "is this appointment in the past" checks used
 * `new Date(); setHours(0,0,0,0)`, which answers "midnight where this Node
 * process happens to be running" — silently wrong the moment the host (or a
 * test's `TZ`) isn't the clinic's. Exact for any fixed-offset zone (Accra
 * has no DST); a DST-observing zone could be off by the transition's delta
 * for a `date` that falls exactly on transition day, which doesn't apply
 * here.
 */
export function zonedStartOfDay(
  date: Date = new Date(),
  timeZone: string = CLINIC_TIME_ZONE
): Date {
  const { year, month, day } = readInZone(date, timeZone)
  const utcMidnightOfThatCalendarDay = Date.UTC(year, month - 1, day)
  return new Date(utcMidnightOfThatCalendarDay - utcOffsetMs(date, timeZone))
}
