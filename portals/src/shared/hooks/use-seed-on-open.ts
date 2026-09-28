import { useEffect, useRef } from 'react'

/**
 * Fill an edit form once each time it opens for a record — and not again when a
 * background refetch hands the same record back as a new object.
 *
 * Seeding on every new object (`useEffect(seed, [record, open])`) wiped the
 * user's unsaved typing whenever the record was refetched with any change — and
 * a record holding a private file changes every 15 minutes, because the file's
 * link is re-signed. Closing and reopening the sheet, or opening another record,
 * seeds again with the latest data.
 *
 * `seed` runs in a microtask, so its state updates never land mid-render.
 */
export function useSeedOnOpen(open: boolean, recordKey: string | undefined, seed: () => void) {
  const seededFor = useRef<string | null>(null)
  const latestSeed = useRef(seed)
  latestSeed.current = seed

  useEffect(() => {
    if (!open) {
      seededFor.current = null
      return
    }
    const key = recordKey ?? ''
    if (seededFor.current === key) return
    let active = true
    Promise.resolve().then(() => {
      if (!active) return
      seededFor.current = key
      latestSeed.current()
    })
    return () => {
      active = false
    }
  }, [open, recordKey])
}
