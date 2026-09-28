import { useState } from 'react'
import { isSameStoredFileValue } from '@/shared/lib/file-name'

/**
 * The link an embedded viewer (PDF iframe, image) should load: the first link
 * it was given for a file, kept while that same file's link is re-signed every
 * 15 minutes — otherwise the viewer reloads and a PDF jumps back to page 1 while
 * it is being read. A different file, or none, switches straight away. Buttons
 * that open or download the file should use the freshest link instead.
 */
export function useStableFileUrl(url: string | null | undefined): string | null {
  const next = url ?? null
  const [stable, setStable] = useState(next)
  const sameFile = isSameStoredFileValue(stable, next)
  // Adjusting state during render (React's pattern for deriving from a prop):
  // only when the file itself changed, so it settles after one pass.
  if (!sameFile) setStable(next)
  return sameFile ? stable : next
}
