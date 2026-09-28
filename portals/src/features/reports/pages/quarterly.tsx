import { format, parseISO } from 'date-fns'
import { ArrowDown, ArrowUp, Loader2, Printer } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PeriodReport } from '@/features/reports/components/period-report'
import { getPeriodList, type PeriodListEntry } from '@/lib/actions/period-report'
import { useApiQuery } from '@/lib/query'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { formatCurrency, formatCurrencyCompact } from '@/shared/utils/currency'

function quarterLabel(isoStart: string): string {
  const d = parseISO(isoStart)
  const q = Math.floor(d.getMonth() / 3) + 1
  return `Q${q} ${d.getFullYear()}`
}

// Local query key — reports has no matching group in `query-keys.ts`.
const QUARTERLY_PERIOD_LIST_KEY = ['reports', 'period-list', 'quarterly', 8] as const

export default function QuarterlySummariesPage() {
  const periodListQuery = useApiQuery<PeriodListEntry[]>(QUARTERLY_PERIOD_LIST_KEY, () =>
    getPeriodList('quarterly', 8)
  )
  const rows = periodListQuery.data ?? []
  const loading = periodListQuery.isLoading

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Quarterly Summaries</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Quarterly rollups. Click a row for the full breakdown.
        </p>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quarter</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">vs prior</TableHead>
                <TableHead className="text-right">Expenses</TableHead>
                <TableHead className="text-right">Patients</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                    No data available.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((q) => (
                  <TableRow key={q.key} className="cursor-pointer hover:bg-muted/40">
                    <TableCell>
                      <Link to={`/reports/quarterly/${q.key}`} className="block">
                        <span className="font-medium">{q.label || quarterLabel(q.start)}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {format(parseISO(q.start), 'MMM d')} –{' '}
                          {format(parseISO(q.end), 'MMM d, yyyy')}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell
                      className="text-right font-semibold tabular-nums"
                      title={formatCurrency(q.revenue)}
                    >
                      {formatCurrencyCompact(q.revenue)}
                    </TableCell>
                    <TableCell className="text-right">
                      <VsPrior pct={q.vsPrior.revenuePct} />
                    </TableCell>
                    <TableCell
                      className="text-right tabular-nums text-muted-foreground"
                      title={formatCurrency(q.expenses)}
                    >
                      {formatCurrencyCompact(q.expenses)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{q.patientCount}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

export function QuarterlyDetailPage() {
  const { quarterStart = '' } = useParams<{ quarterStart: string }>()
  const navigate = useNavigate()

  const start = parseISO(quarterStart)
  if (!quarterStart || Number.isNaN(start.getTime())) {
    return (
      <div className="p-6 space-y-3 text-center">
        <p className="text-lg font-medium">Invalid quarter</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/reports/quarterly')}>
          Back to quarterly summaries
        </Button>
      </div>
    )
  }
  // End of quarter = first day of (start month + 3) - 1 day
  const endOfQuarter = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 0))
  const fromStr = format(start, 'yyyy-MM-dd')
  const toStr = format(endOfQuarter, 'yyyy-MM-dd')
  const label = quarterLabel(quarterStart)

  return (
    <div className="p-6 space-y-6">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <button
          type="button"
          className="hover:text-foreground hover:underline"
          onClick={() => navigate('/reports/quarterly')}
        >
          Quarterly Summaries
        </button>
        <span className="mx-2">›</span>
        <span className="font-medium text-foreground">{label}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{label}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {format(start, 'MMM d')} – {format(endOfQuarter, 'MMM d, yyyy')}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="mr-1.5 h-3.5 w-3.5" />
          Print
        </Button>
      </div>

      <PeriodReport from={fromStr} to={toStr} />
    </div>
  )
}

function VsPrior({ pct }: { pct: number }) {
  if (pct === 0) return <span className="text-xs text-muted-foreground">0%</span>
  const up = pct > 0
  const Icon = up ? ArrowUp : ArrowDown
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${up ? 'text-emerald-600' : 'text-rose-600'}`}
    >
      <Icon className="h-3 w-3" />
      {Math.abs(pct).toFixed(0)}%
    </span>
  )
}
