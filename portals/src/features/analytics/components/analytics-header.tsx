import { ChevronLeft, ChevronRight, Download, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAnalyticsPeriod } from '@/features/analytics/period-context'
import { exportAnalyticsPdf } from '@/lib/actions/analytics-export'
import { Button } from '@/shared/components/ui/button'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const QUARTERS = [1, 2, 3, 4] as const

export function AnalyticsHeader() {
  const { period, setGranularity, setAnchorYear, setAnchorMonth, setAnchorQuarter, toQueryString } =
    useAnalyticsPeriod()
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [exportError, setExportError] = useState<string | null>(null)
  const currentYear = new Date().getFullYear()

  useEffect(() => {
    if (!exporting) {
      setExportProgress(0)
      return
    }

    let progress = 1
    setExportProgress(progress)
    const interval = setInterval(() => {
      progress += Math.floor(Math.random() * 5) + 1
      if (progress >= 99) progress = 99
      setExportProgress(progress)
    }, 300)

    return () => clearInterval(interval)
  }, [exporting])

  async function handleExport() {
    setExporting(true)
    setExportError(null)
    try {
      await exportAnalyticsPdf(toQueryString(), period.label)
      setExportProgress(100)
      await new Promise((resolve) => setTimeout(resolve, 500))
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border bg-background p-0.5 text-xs font-medium">
          {(['monthly', 'quarterly', 'yearly'] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGranularity(g)}
              className={
                period.granularity === g
                  ? 'rounded-sm bg-primary px-3 py-1 text-primary-foreground'
                  : 'rounded-sm px-3 py-1 text-muted-foreground hover:text-foreground'
              }
            >
              {g[0].toUpperCase() + g.slice(1)}
            </button>
          ))}
        </div>

        <YearStepper
          year={period.anchorYear}
          onPrev={() => setAnchorYear(period.anchorYear - 1)}
          onNext={() => setAnchorYear(period.anchorYear + 1)}
          maxYear={currentYear}
        />

        {period.granularity === 'monthly' && (
          <div className="flex flex-wrap gap-1">
            {MONTHS.map((m, idx) => (
              <button
                key={m}
                type="button"
                onClick={() => setAnchorMonth(idx)}
                className={
                  period.anchorMonth === idx
                    ? 'rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground'
                    : 'rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted'
                }
              >
                {m}
              </button>
            ))}
          </div>
        )}

        {period.granularity === 'quarterly' && (
          <div className="flex gap-1">
            {QUARTERS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setAnchorQuarter(q)}
                className={
                  period.anchorQuarter === q
                    ? 'rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground'
                    : 'rounded-md border px-3 py-1 text-xs text-muted-foreground hover:bg-muted'
                }
              >
                Q{q}
              </button>
            ))}
          </div>
        )}

        <span className="text-xs text-muted-foreground">
          Showing <span className="font-medium text-foreground">{period.label}</span>
        </span>
      </div>

      <div className="flex items-center gap-2">
        {exportError && <span className="text-xs text-destructive">{exportError}</span>}
        <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
          {exporting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          {exporting ? `Exporting [${exportProgress}%]` : 'Export PDF'}
        </Button>
      </div>
    </div>
  )
}

function YearStepper({
  year,
  onPrev,
  onNext,
  maxYear,
}: {
  year: number
  onPrev: () => void
  onNext: () => void
  maxYear: number
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1">
      <button
        type="button"
        onClick={onPrev}
        disabled={year <= 2020}
        className="rounded p-0.5 hover:bg-muted disabled:opacity-40"
        aria-label="Previous year"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-[3rem] text-center text-sm font-semibold tabular-nums">{year}</span>
      <button
        type="button"
        onClick={onNext}
        disabled={year >= maxYear}
        className="rounded p-0.5 hover:bg-muted disabled:opacity-40"
        aria-label="Next year"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )
}
