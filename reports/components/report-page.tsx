import { formatCurrency } from '@denel/utils'
import { format } from 'date-fns'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import type { UseReportState } from '@/hooks/useReport'

/**
 * Shared GHS currency formatter for every report page. Delegates to the
 * canonical `formatCurrency` from `@denel/utils` so the ~11 hand-rolled
 * per-page `fmt` helpers are gone (M32).
 */
export const fmt = formatCurrency

/** A single labelled `<input type="date">`. */
export type DateControl = {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}

type ReportPageProps<T> = {
  /** Page title shown in the header. */
  title: string
  /** One-line description under the title. */
  description: ReactNode
  /** The report lifecycle state from `useReport`. */
  report: UseReportState<T>
  /** Labelled date inputs rendered in the header (0–2). */
  dateControls?: DateControl[]
  /**
   * Optional extra controls (e.g. a Tabs strip) rendered between the header
   * and the content — always visible, not gated by load state.
   */
  controls?: ReactNode
  /**
   * Render the report body. Receives the non-null `data`. Only invoked once
   * `data` exists; the skeleton / stale handling is done by the wrapper.
   */
  children: (data: T) => ReactNode
  /**
   * Decide whether the loaded `data` counts as "empty" — when true the shared
   * "No data" slot is rendered instead of `children` (M35).
   */
  isEmpty?: (data: T) => boolean
  /** Custom empty-state message. */
  emptyMessage?: string
}

/**
 * Layout shell for the finance report pages. Owns:
 *  - the header (title + description + date controls + Refresh button)
 *  - the H24 stale-data gate: a skeleton on first load, a "stale — last loaded"
 *    banner on a failed/in-flight refresh (last good `data` stays on screen)
 *  - the M35 shared "No data" empty state
 *
 * Read-only: it never mutates anything, it only fetches via the passed hook.
 */
export function ReportPage<T>({
  title,
  description,
  report,
  dateControls = [],
  controls,
  children,
  isEmpty,
  emptyMessage = 'No data for the selected range.',
}: ReportPageProps<T>) {
  const { data, loading, isRefreshing, error, lastLoadedAt, refresh } = report

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
        <div className="flex items-end gap-3">
          {dateControls.map((ctrl) => (
            <div key={ctrl.id} className="space-y-1">
              <label htmlFor={ctrl.id} className="text-xs text-muted-foreground">
                {ctrl.label}
              </label>
              <Input
                id={ctrl.id}
                type="date"
                value={ctrl.value}
                onChange={(e) => ctrl.onChange(e.target.value)}
                className="w-44"
              />
            </div>
          ))}
          <Button onClick={refresh} disabled={loading || isRefreshing}>
            {loading || isRefreshing ? 'Loading…' : 'Refresh'}
          </Button>
        </div>
      </header>

      {controls}

      {/*
        Stale-data gate (H24): if a refresh is in flight or failed while we
        still have older data on screen, say so explicitly instead of silently
        showing numbers from a different date range.
      */}
      {error && (
        <p className="text-red-600">
          {error}
          {data && lastLoadedAt
            ? ` — showing stale data last loaded at ${format(lastLoadedAt, 'HH:mm:ss')}`
            : ''}
        </p>
      )}
      {!error && isRefreshing && data && lastLoadedAt && (
        <p className="text-sm text-amber-600">
          Refreshing… showing data from {format(lastLoadedAt, 'HH:mm:ss')}
        </p>
      )}

      {loading && !data ? (
        <Skeleton className="h-72 w-full" />
      ) : data ? (
        <div className={isRefreshing ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {isEmpty?.(data) ? <ReportEmptyState message={emptyMessage} /> : children(data)}
        </div>
      ) : null}
    </div>
  )
}

/** Shared "No data" guard used by `ReportPage` and inline table slots (M35). */
export function ReportEmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
      {message}
    </div>
  )
}
