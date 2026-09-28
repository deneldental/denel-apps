import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Shape every report action returns: `{ success, data?, error? }`.
 * Mirrors the `ApiResponse`-derived return of the `lib/actions/*` helpers.
 */
export type ReportResult<T> = {
  success: boolean
  data?: T | null
  error?: string
}

export type UseReportState<T> = {
  /** Last successfully-loaded payload. Kept across a failed/in-flight refresh. */
  data: T | null
  /** True only on the very first load (no data yet) — render a skeleton. */
  loading: boolean
  /** True whenever a fetch is in flight after the first load — show a stale cue. */
  isRefreshing: boolean
  /** Error from the most recent fetch; `data` is preserved alongside it. */
  error: string | null
  /** Wall-clock time `data` was last successfully loaded. */
  lastLoadedAt: Date | null
  /** Manually trigger a refetch (e.g. a Refresh button). */
  refresh: () => void
}

const DEBOUNCE_MS = 400

/**
 * Owns the `data / loading / error / refresh` lifecycle for a single report.
 *
 * - `fetcher` MUST be wrapped in `useCallback` by the caller (its identity is
 *   the dependency that drives auto-refetch). The hook does NOT need an
 *   `eslint-disable` — `fetcher` is a real, declared dependency.
 * - On mount it loads immediately. When `fetcher` changes (date range, tab,
 *   etc.) it auto-refetches after a short debounce so rapid date typing
 *   collapses into one request.
 * - On error the last good `data` is preserved (H24 stale-data gate) — the
 *   page shows a "stale" banner instead of blanking.
 * - All state writes are guarded by a per-fetch token so an out-of-order or
 *   post-unmount response can never clobber fresher state.
 */
export function useReport<T>(fetcher: () => Promise<ReportResult<T>>): UseReportState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null)

  // Monotonic token: only the most-recent fetch is allowed to write state.
  const fetchToken = useRef(0)
  // Tracks whether we've ever loaded, so we know skeleton vs. refresh.
  const hasLoadedRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const run = useCallback(async () => {
    const token = ++fetchToken.current
    if (hasLoadedRef.current) {
      setIsRefreshing(true)
    } else {
      setLoading(true)
    }

    let result: ReportResult<T>
    try {
      result = await fetcher()
    } catch (err) {
      result = {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to load report',
      }
    }

    // A newer fetch started (or we unmounted) — discard this stale response.
    if (token !== fetchToken.current || !mountedRef.current) return

    setLoading(false)
    setIsRefreshing(false)

    if (!result.success) {
      setError(result.error ?? 'Failed to load report')
      // Deliberately keep `data` — never blank the page on a failed refresh.
      return
    }

    setError(null)
    setData(result.data ?? null)
    setLastLoadedAt(new Date())
    hasLoadedRef.current = true
  }, [fetcher])

  // Auto-load on mount and whenever `fetcher` changes (debounced so rapid
  // date-input edits collapse into a single request).
  useEffect(() => {
    const handle = setTimeout(() => {
      void run()
    }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [run])

  const refresh = useCallback(() => {
    void run()
  }, [run])

  return { data, loading, isRefreshing, error, lastLoadedAt, refresh }
}
