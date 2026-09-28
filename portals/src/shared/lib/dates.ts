/**
 * Date helpers that avoid the audit-wide UTC/local confusion.
 *
 * `new Date().toISOString().slice(0,10)` returns the **UTC** calendar date, which
 * drifts by a day for users behind/ahead of UTC (e.g. blocking a valid same-day
 * booking, or allowing a past date the backend then rejects). And
 * `new Date('YYYY-MM-DD')` parses as UTC midnight, shifting stored dates a day
 * for users west of UTC. These helpers operate in the user's local timezone.
 */

/** Local `YYYY-MM-DD` for a date (defaults to now) — use for date-input `min`/defaults. */
export function localDateISO(d: Date = new Date()): string {
  const offsetMs = d.getTimezoneOffset() * 60_000
  return new Date(d.getTime() - offsetMs).toISOString().slice(0, 10)
}

/** Parse a bare `YYYY-MM-DD` as **local** midnight (not UTC midnight). */
export function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

/** True if two dates fall on the same local calendar day. */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}
