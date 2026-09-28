// Deterministic "random" accent border colours for record cards / accordions.
//
// A stable hash of the supplied key (a row/stage id) selects one palette entry,
// so a given card keeps the SAME colour across re-renders — no flicker — while
// the list as a whole looks randomly varied. Full literal class strings are used
// (not constructed) so Tailwind's source scanner picks them up.

const ACCENT_BORDERS = [
  'border-sky-300 dark:border-sky-700',
  'border-violet-300 dark:border-violet-700',
  'border-amber-300 dark:border-amber-700',
  'border-emerald-300 dark:border-emerald-700',
  'border-rose-300 dark:border-rose-700',
  'border-indigo-300 dark:border-indigo-700',
  'border-teal-300 dark:border-teal-700',
  'border-fuchsia-300 dark:border-fuchsia-700',
  'border-orange-300 dark:border-orange-700',
  'border-cyan-300 dark:border-cyan-700',
  'border-lime-300 dark:border-lime-700',
  'border-pink-300 dark:border-pink-700',
] as const

/** Pick a stable accent border-colour class for a card keyed by `key`. */
export function accentBorder(key: string | number): string {
  const s = String(key)
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return ACCENT_BORDERS[Math.abs(h) % ACCENT_BORDERS.length]
}
