import { Loader2 } from 'lucide-react'
import { getPeriodSummary, type PeriodSummary } from '@/lib/actions/period-report'
import { useApiQuery } from '@/lib/query'
import { PeriodModuleRollup } from './period-module-rollup'
import { buildSamplePeriodSummary, isPeriodEmpty } from './sample-period-summary'
import { ClinicalSection } from './sections/clinical-section'
import { ExecutiveSummarySection } from './sections/executive-summary-section'
import { FinanceSection } from './sections/finance-section'
import { PatientsOpsSection } from './sections/patients-ops-section'

interface Props {
  /** Inclusive start date in YYYY-MM-DD. */
  from: string
  /** Inclusive end date in YYYY-MM-DD. */
  to: string
}

export function PeriodReport({ from, to }: Props) {
  const summaryQuery = useApiQuery<PeriodSummary>(
    ['reports', 'period-summary', from, to] as const,
    () => getPeriodSummary(from, to)
  )
  const data = summaryQuery.data ?? null
  const loading = summaryQuery.isLoading
  const error = summaryQuery.isError ? summaryQuery.error.message || 'Failed to load report' : null

  // If the period has no real activity, fall back to deterministic sample data
  // so the UI is previewable. The sample is seeded by the date range, so a
  // given week/month/quarter always renders the same numbers.
  const usingSample = data ? isPeriodEmpty(data) : false
  const effective = data ? (usingSample ? buildSamplePeriodSummary(from, to) : data) : null

  return (
    <div className="space-y-8">
      {/* §10.3 — period rollup of the frozen per-module digest blocks +
          GL-reconciled totals. Fetches independently, so it renders the real
          frozen-digest data even while the (separate) period-summary sections
          load, error, or fall back to sample data. */}
      <PeriodModuleRollup from={from} to={to} />

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading report…
        </div>
      ) : error || !effective ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error ?? 'No data'}
        </div>
      ) : (
        <>
          {usingSample && (
            <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <span className="rounded-md border border-amber-300 bg-amber-100 px-2 py-0.5 font-semibold">
                Sample data
              </span>
              <span>
                No real activity recorded in this period yet — showing deterministic sample numbers
                so you can preview the layout.
              </span>
            </div>
          )}
          <ExecutiveSummarySection data={effective.executive} />
          <FinanceSection data={effective.finance} />
          <PatientsOpsSection data={effective.ops} />
          <ClinicalSection data={effective.clinical} />
        </>
      )}
    </div>
  )
}
