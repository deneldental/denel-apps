import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Result shape every portal `lib/actions/*` mutation/query returns.
 * The fetcher passed to `useAsyncResource` must resolve to this.
 */
export type ActionResult<T> = {
  success: boolean
  data?: T
  error?: string
}

export type AsyncResource<T> = {
  /** The last successfully-loaded value, or `null` before the first success. */
  data: T | null
  /** True while the very first load is in flight (no `data` yet). */
  loading: boolean
  /** True while any refresh after the first load is in flight. */
  isRefreshing: boolean
  /** The error from the most recent failed load, cleared on the next success. */
  error: string | null
  /** Re-run the fetcher. Safe to call repeatedly — stale responses are dropped. */
  refresh: () => Promise<void>
  /** Imperatively patch `data` (targeted state update — avoids a full refetch). */
  setData: (updater: T | ((prev: T | null) => T | null)) => void
}

/**
 * Shared async-list/resource hook (remediation D5 — keep useEffect+useState
 * behind one hook instead of adopting TanStack Query).
 *
 * Owns `data / loading / isRefreshing / error / refresh` for any portal action
 * fetcher. Every refresh is guarded: an `epoch` counter drops responses from a
 * superseded call, so fast filter-toggling can never apply stale data, and a
 * late response after unmount is ignored.
 *
 * @param fetcher  An async fn returning `{ success, data, error }`. Wrap it in
 *                 `useCallback` at the call site if it closes over props/state.
 * @param options.immediate  Run the fetcher on mount (default `true`).
 */
export function useAsyncResource<T>(
  fetcher: () => Promise<ActionResult<T>>,
  options: { immediate?: boolean } = {}
): AsyncResource<T> {
  const { immediate = true } = options

  const [data, setDataState] = useState<T | null>(null)
  const [loading, setLoading] = useState(immediate)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Bumped on every refresh + on unmount; a response only "wins" if its epoch
  // still matches the latest one. This is the race / AbortController guard.
  const epochRef = useRef(0)
  const hasLoadedRef = useRef(false)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const refresh = useCallback(async () => {
    const epoch = ++epochRef.current
    if (hasLoadedRef.current) setIsRefreshing(true)
    else setLoading(true)

    let result: ActionResult<T>
    try {
      result = await fetcherRef.current()
    } catch (err) {
      result = { success: false, error: err instanceof Error ? err.message : 'Request failed' }
    }

    // A newer refresh (or an unmount) superseded this call — drop the result.
    if (epoch !== epochRef.current) return

    if (result.success) {
      setError(null)
      setDataState(result.data ?? null)
      hasLoadedRef.current = true
    } else {
      setError(result.error ?? 'Failed to load')
    }
    setLoading(false)
    setIsRefreshing(false)
  }, [])

  const setData = useCallback((updater: T | ((prev: T | null) => T | null)) => {
    setDataState((prev) =>
      typeof updater === 'function' ? (updater as (p: T | null) => T | null)(prev) : updater
    )
  }, [])

  useEffect(() => {
    if (immediate) refresh()
    return () => {
      // Invalidate any in-flight response so it can't setState after unmount.
      epochRef.current++
    }
  }, [immediate, refresh])

  return { data, loading, isRefreshing, error, refresh, setData }
}
