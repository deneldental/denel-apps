// §10.3 — Period rollup of the frozen per-module digest blocks.
//
// Each daily report freezes every module's §10.1 digest block onto
// `dailyReports.moduleSummaries`. The backend's /api/reports/period-rollup
// AGGREGATES those frozen blocks across all days in the week/month/quarter: per
// module, per metric, numeric values are summed (money re-emitted as "GHS …").
//
// This renders the aggregated per-module blocks exactly like the daily digest's
// ModuleDigestCard (report-detail-content.tsx), plus the GL-reconciled period
// revenue/expense/net (§10.2) so the rollup reconciles with the statements.

import { Loader2 } from 'lucide-react'
import { getPeriodRollup, type PeriodRollup } from '@/lib/actions/reports'
import { useApiQuery } from '@/lib/query'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { formatCurrency } from '@/shared/utils/currency'

interface Props {
  /** Inclusive start date in YYYY-MM-DD. */
  from: string
  /** Inclusive end date in YYYY-MM-DD. */
  to: string
}

export function PeriodModuleRollup({ from, to }: Props) {
  const rollupQuery = useApiQuery<PeriodRollup>(
    ['reports', 'period-rollup', from, to] as const,
    () => getPeriodRollup(from, to)
  )
  const data = rollupQuery.data ?? null
  const loading = rollupQuery.isLoading
  const error = rollupQuery.isError
    ? rollupQuery.error.message || 'Failed to load period rollup'
    : null

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading module rollup…
      </div>
    )
  }

  // A failed rollup shouldn't blank the whole period report — the rest of the
  // page (PeriodReport sections) still renders. Surface a quiet inline notice.
  if (error || !data) {
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Module rollup</h2>
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error ?? 'No rollup data'}
        </div>
      </section>
    )
  }

  const hasModules = data.modules.length > 0

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Module rollup</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Per-module digest metrics summed across {data.dayCount}{' '}
          {data.dayCount === 1 ? 'daily report' : 'daily reports'} in this period.
        </p>
      </div>

      {/* GL-reconciled period totals (§10.2) — the books the P&L uses. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">GL-reconciled totals</CardTitle>
          <CardDescription>
            Sourced from the general ledger for the same window as the daily statements.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Revenue</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-600">
              {formatCurrency(data.glReconciled.revenue)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Expenses</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-rose-600">
              {formatCurrency(data.glReconciled.expenses)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Net income</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {formatCurrency(data.glReconciled.netIncome)}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Aggregated per-module blocks — mirrors the daily ModuleDigestCard. */}
      {hasModules ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Module digest (period total)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.modules.map((block) => (
              <div key={block.module} className="rounded-lg border p-3">
                <p className="text-sm font-semibold">{block.title}</p>
                <dl className="mt-2 space-y-1">
                  {block.metrics.map((m) => (
                    <div key={m.label} className="flex items-center justify-between gap-3 text-sm">
                      <dt className="text-muted-foreground">{m.label}</dt>
                      <dd className="flex items-center gap-1.5 font-medium tabular-nums">
                        <span>{m.value}</span>
                        {/* A non-numeric metric was carried through, not summed. */}
                        {m.aggregated === false && (
                          <span
                            title="Latest value — not summable across days"
                            className="rounded border border-amber-300 bg-amber-50 px-1 text-[10px] font-medium uppercase text-amber-700"
                          >
                            latest
                          </span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex items-center justify-center py-10 text-center text-sm text-muted-foreground">
            No module digests were frozen for this period yet. Submit daily reports to populate the
            rollup.
          </CardContent>
        </Card>
      )}
    </section>
  )
}
