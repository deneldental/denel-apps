/**
 * Turnaround for a new lab case: the express option, then the vendor offering,
 * then the base service — and, when none carries a usable number, the clinic's
 * configured default (Settings → Clinical → Charting Preferences,
 * `defaultLabTurnaroundDays`; settings-domain-audit S5-B).
 */
export function resolveTurnaroundDays(
  candidates: ReadonlyArray<number | null | undefined>,
  fallback: number
): number {
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) return c
  }
  return fallback
}
