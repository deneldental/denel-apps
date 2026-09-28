/**
 * Tooth numbering as displayed. Every table stores FDI (11–48); the clinic
 * chooses how numbers are shown (Settings → Clinical → Charting Preferences,
 * `clinical:charting_preferences.notationSystem`; settings-domain-audit S5-B).
 *
 *   fdi        11–18 / 21–28 / 31–38 / 41–48 (quadrant + position)
 *   universal  1–32 clockwise from the upper-right third molar
 *   palmer     quadrant + 1–8 from the midline, written UR6 / UL1 / LL3 / LR8
 *
 * Anything that is not a permanent FDI number (deciduous 51–85, 0, free text
 * from an older record) is shown as it is.
 */

export type ToothNotation = 'fdi' | 'universal' | 'palmer'

export const TOOTH_NOTATIONS: readonly ToothNotation[] = ['fdi', 'universal', 'palmer']

export const TOOTH_NOTATION_LABELS: Record<ToothNotation, string> = {
  fdi: 'FDI',
  universal: 'Universal',
  palmer: 'Palmer',
}

export function isToothNotation(value: unknown): value is ToothNotation {
  return typeof value === 'string' && (TOOTH_NOTATIONS as readonly string[]).includes(value)
}

/** True for a permanent-dentition FDI number (quadrants 1–4, positions 1–8). */
export function isPermanentFdi(tooth: number): boolean {
  if (!Number.isInteger(tooth)) return false
  const quadrant = Math.floor(tooth / 10)
  const position = tooth % 10
  return quadrant >= 1 && quadrant <= 4 && position >= 1 && position <= 8
}

export function fdiToUniversal(tooth: number): number | null {
  if (!isPermanentFdi(tooth)) return null
  const quadrant = Math.floor(tooth / 10)
  const position = tooth % 10
  switch (quadrant) {
    case 1:
      return 9 - position // 18 → 1 … 11 → 8
    case 2:
      return 8 + position // 21 → 9 … 28 → 16
    case 3:
      return 25 - position // 38 → 17 … 31 → 24
    default:
      return 24 + position // 41 → 25 … 48 → 32
  }
}

const PALMER_QUADRANTS: Record<number, string> = { 1: 'UR', 2: 'UL', 3: 'LL', 4: 'LR' }

export function fdiToPalmer(tooth: number): string | null {
  if (!isPermanentFdi(tooth)) return null
  return `${PALMER_QUADRANTS[Math.floor(tooth / 10)]}${tooth % 10}`
}

/** The label to print for a stored FDI number under the chosen notation. */
export function formatTooth(
  tooth: number | string | null | undefined,
  notation: ToothNotation = 'fdi'
): string {
  if (tooth === null || tooth === undefined || tooth === '') return ''
  const n = typeof tooth === 'number' ? tooth : Number(tooth)
  if (!isPermanentFdi(n)) return String(tooth)
  if (notation === 'universal') return String(fdiToUniversal(n))
  if (notation === 'palmer') return fdiToPalmer(n) ?? String(n)
  return String(n)
}

export function formatTeeth(
  teeth: ReadonlyArray<number | string>,
  notation: ToothNotation = 'fdi',
  separator = ', '
): string {
  return teeth.map((t) => formatTooth(t, notation)).join(separator)
}
