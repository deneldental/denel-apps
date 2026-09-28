/**
 * The display name of a stored file: the last part of its link's path, decoded.
 * Private files arrive as signed links (`…/receipt%20(1).pdf?X-Amz-…`), so the
 * query string must never be mistaken for part of the name.
 */
export function fileNameFromUrl(url: string): string {
  try {
    const { protocol, pathname } = new URL(url)
    if (protocol === 'http:' || protocol === 'https:') {
      return decodeURIComponent(pathname.split('/').pop() ?? '') || url
    }
  } catch {
    // not a URL — fall through
  }
  return url.split(/[?#]/)[0].split('/').pop() || url
}

/**
 * Whether two links point at the same stored file. A private file's link is
 * re-signed every 15 minutes, so two links to one file differ only in their
 * query string; anything that is not an http(s) link is compared as it is.
 */
export function isSameStoredFile(a: string, b: string): boolean {
  if (a === b) return true
  try {
    const first = new URL(a)
    const second = new URL(b)
    if (!/^https?:$/.test(first.protocol) || !/^https?:$/.test(second.protocol)) return false
    return first.origin === second.origin && first.pathname === second.pathname
  } catch {
    return false
  }
}

/**
 * Whether a file field still holds the same file: both empty, or links to the
 * same stored file (a re-signed link is not a change). For "unsaved changes"
 * checks that compare a form's file field with the record.
 */
export function isSameStoredFileValue(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (!a || !b) return !a && !b
  return isSameStoredFile(a, b)
}
