import { useMemo, useState } from 'react'
import { getPatientCohorts } from '@/lib/actions/financial-analytics'
import { useApiQuery } from '@/lib/query'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { GHS, SectionCard } from './shared'

const PATIENT_COHORTS_KEY = ['analytics', 'financial', 'patient-cohorts'] as const

const COHORT_MONTH_LABELS: Record<string, string> = {
  '01': 'Jan',
  '02': 'Feb',
  '03': 'Mar',
  '04': 'Apr',
  '05': 'May',
  '06': 'Jun',
  '07': 'Jul',
  '08': 'Aug',
  '09': 'Sep',
  '10': 'Oct',
  '11': 'Nov',
  '12': 'Dec',
}

function formatCohortLabel(yyyymm: string): string {
  // "2026-05" → "May '26"
  const [year, month] = yyyymm.split('-')
  return `${COHORT_MONTH_LABELS[month] ?? month} '${year.slice(2)}`
}

function compactCurrency(n: number): string {
  if (n === 0) return ''
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return Number(n).toFixed(0)
}

/**
 * Map a revenue value to a green tint. The scale uses a perceptual square-root
 * curve (sqrt(value / max)) so small-but-non-zero cells aren't visually lost
 * next to one or two giant outliers. Below ~5% of max we use a very pale tint
 * to keep zero cells distinct from "barely anything".
 */
function cellBackground(value: number, max: number): string {
  if (value <= 0 || max <= 0) return 'transparent'
  const intensity = Math.sqrt(value / max) // 0..1
  // Map 0..1 → lightness 95..30 in HSL green
  const lightness = Math.round(95 - intensity * 65)
  return `hsl(150, 60%, ${lightness}%)`
}

function cellTextColour(value: number, max: number): string {
  if (value <= 0 || max <= 0) return 'rgb(100, 116, 139)' // muted
  const intensity = Math.sqrt(value / max)
  return intensity > 0.55 ? 'white' : 'rgb(30, 41, 59)'
}

interface HoverCellInfo {
  cohortMonth: string
  cohortSize: number
  lag: number
  revenue: number
  activePatients: number
}

export function PatientCohortSection() {
  const query = useApiQuery(PATIENT_COHORTS_KEY, getPatientCohorts)
  const data = query.data ?? null
  const loading = query.isLoading
  const error = query.error ? query.error.message : null
  const [hover, setHover] = useState<HoverCellInfo | null>(null)

  // Roll up totals for the summary strip.
  const summary = useMemo(() => {
    if (!data) return null
    let totalCohorts = 0
    let totalPatients = 0
    let totalRevenue = 0
    let totalMonth0Revenue = 0
    for (const cohort of data.cohorts) {
      if (cohort.cohortSize > 0) totalCohorts++
      totalPatients += cohort.cohortSize
      for (const cell of cohort.cells) totalRevenue += cell.revenue
      totalMonth0Revenue += cohort.cells[0]?.revenue ?? 0
    }
    const avgFirstMonth = totalPatients > 0 ? totalMonth0Revenue / totalPatients : 0
    const avgLtv12mo = totalPatients > 0 ? totalRevenue / totalPatients : 0
    return { totalCohorts, totalPatients, totalRevenue, avgFirstMonth, avgLtv12mo }
  }, [data])

  return (
    <SectionCard title="Patient Cohorts — Revenue by Months Since First Payment">
      {loading ? (
        <Skeleton className="h-[520px] w-full" />
      ) : error ? (
        <p className="py-4 text-center text-xs text-destructive">{error}</p>
      ) : !data ? (
        <p className="py-4 text-center text-xs text-muted-foreground">No cohort data</p>
      ) : (
        <div className="space-y-4">
          {/* Summary strip */}
          {summary && (
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs border-b pb-3">
              <div>
                <span className="text-muted-foreground">Active cohorts</span>
                <span className="ml-2 font-semibold">{summary.totalCohorts} / 12</span>
              </div>
              <div>
                <span className="text-muted-foreground">Acquired patients</span>
                <span className="ml-2 font-semibold">{summary.totalPatients}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Total revenue (12mo)</span>
                <span className="ml-2 font-semibold">{GHS(summary.totalRevenue)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Avg first-month revenue / patient</span>
                <span className="ml-2 font-semibold">{GHS(summary.avgFirstMonth)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Avg LTV (so far)</span>
                <span className="ml-2 font-semibold">{GHS(summary.avgLtv12mo)}</span>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Each row is patients whose <strong>first completed payment</strong> fell in that month.
            Columns count months elapsed since that first payment. Cells show revenue collected from
            those patients in that lag-month. Reading right along a row tells you how a vintage is
            monetising over time; reading down a column compares vintages at the same age. Greener =
            higher revenue.
          </p>

          {/* Heat map */}
          <div className="overflow-x-auto">
            <div className="min-w-[820px] relative">
              {/* Column headers */}
              <div className="grid grid-cols-[120px_repeat(12,minmax(48px,1fr))] gap-px text-[10px] text-muted-foreground mb-1">
                <div />
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="text-center font-medium">
                    M{i}
                  </div>
                ))}
              </div>

              {/* Rows */}
              {data.cohorts.map((cohort) => (
                <div
                  key={cohort.month}
                  className="grid grid-cols-[120px_repeat(12,minmax(48px,1fr))] gap-px mb-px"
                >
                  <div className="flex items-center justify-between pr-2 text-xs">
                    <span className="font-medium">{formatCohortLabel(cohort.month)}</span>
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                      {cohort.cohortSize}
                    </span>
                  </div>
                  {cohort.cells.map((cell, lag) => {
                    const bg = cellBackground(cell.revenue, data.maxRevenue)
                    const fg = cellTextColour(cell.revenue, data.maxRevenue)
                    return (
                      <div
                        key={lag}
                        className="relative flex items-center justify-center text-[10px] font-medium rounded-sm border border-transparent transition-colors hover:border-foreground/40 cursor-default"
                        style={{
                          backgroundColor: bg,
                          color: fg,
                          minHeight: 36,
                        }}
                        onMouseEnter={() =>
                          setHover({
                            cohortMonth: cohort.month,
                            cohortSize: cohort.cohortSize,
                            lag,
                            revenue: cell.revenue,
                            activePatients: cell.activePatients,
                          })
                        }
                        onMouseLeave={() => setHover(null)}
                      >
                        {compactCurrency(cell.revenue)}
                      </div>
                    )
                  })}
                </div>
              ))}

              {/* Hover detail */}
              {hover && (
                <div className="mt-3 rounded-md border bg-popover p-2 text-xs shadow-sm inline-flex flex-wrap gap-x-4 gap-y-1">
                  <span>
                    <strong>{formatCohortLabel(hover.cohortMonth)}</strong> cohort ·{' '}
                    {hover.cohortSize} patient{hover.cohortSize === 1 ? '' : 's'}
                  </span>
                  <span>Month {hover.lag} since first payment</span>
                  <span>
                    Revenue: <strong>{GHS(hover.revenue)}</strong>
                  </span>
                  <span>
                    Active that month: {hover.activePatients} (
                    {hover.cohortSize > 0
                      ? Math.round((hover.activePatients / hover.cohortSize) * 100)
                      : 0}
                    % retained)
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>Less</span>
            <div className="flex gap-px">
              {[0.05, 0.2, 0.4, 0.6, 0.8, 1].map((t) => (
                <div
                  key={t}
                  className="h-3 w-6 rounded-sm"
                  style={{ backgroundColor: cellBackground(t * data.maxRevenue, data.maxRevenue) }}
                />
              ))}
            </div>
            <span>More</span>
            <span className="ml-4">
              Max cell: <strong>{GHS(data.maxRevenue)}</strong>
            </span>
          </div>
        </div>
      )}
    </SectionCard>
  )
}
