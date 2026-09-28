import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'

// §5.1 — shared paginator for the three Clinical tabs (Cases / Treatments /
// Prescriptions). The backend list endpoints page server-side but do NOT return a
// total row count, so we page off the returned length: "next" is enabled only when
// the current page came back full (i.e. there is very likely another page). This
// keeps a consistent prev/next + "Page N" control across all three tabs without a
// backend change.

interface ClinicalPaginationProps {
  /** 1-based current page. */
  page: number
  /** Page size requested from the server (used to decide if another page exists). */
  pageSize: number
  /** Number of rows returned for the current page. */
  rowCount: number
  onPageChange: (page: number) => void
  /** Hide the control entirely while the first page is loading. */
  loading?: boolean
  /**
   * Exact number of rows across all pages. Only available to callers that hold the
   * whole filtered set client-side (the Estimates / Treatment Plans tabs). When set,
   * the control shows a real "Showing 1–25 of 48" range and knows exactly whether a
   * next page exists; otherwise it falls back to the full-page heuristic above.
   */
  total?: number
}

export function ClinicalPagination({
  page,
  pageSize,
  rowCount,
  onPageChange,
  loading = false,
  total,
}: ClinicalPaginationProps) {
  const hasPrev = page > 1
  // A full page strongly implies a next page exists; a short page means we're at the end.
  const hasNext = total === undefined ? rowCount >= pageSize : page * pageSize < total

  // Nothing to paginate: page 1 with fewer rows than a full page.
  if (!loading && !hasPrev && !hasNext) return null

  const rangeStart = (page - 1) * pageSize + 1
  const rangeEnd = total === undefined ? page * pageSize : Math.min(page * pageSize, total)

  return (
    <div className="flex items-center justify-end gap-3 px-1 pt-1">
      <span className="text-xs text-muted-foreground tabular-nums">
        {total === undefined ? `Page ${page}` : `Showing ${rangeStart}–${rangeEnd} of ${total}`}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => onPageChange(page - 1)}
          disabled={!hasPrev || loading}
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="sr-only">Previous page</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => onPageChange(page + 1)}
          disabled={!hasNext || loading}
        >
          <ChevronRight className="h-4 w-4" />
          <span className="sr-only">Next page</span>
        </Button>
      </div>
    </div>
  )
}
