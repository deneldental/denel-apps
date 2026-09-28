import { format, parseISO } from 'date-fns'
import { ArrowDown, ArrowRight, ArrowUp, Loader2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getPeriodList, type PeriodListEntry } from '@/lib/actions/period-report'
import { useApiQuery } from '@/lib/query'
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

// Local query key — reports has no matching group in `query-keys.ts`.
const WEEKLY_PERIOD_LIST_KEY = ['reports', 'period-list', 'weekly', 8] as const

export default function WeeklySummariesPage() {
  const periodListQuery = useApiQuery<PeriodListEntry[]>(WEEKLY_PERIOD_LIST_KEY, () =>
    getPeriodList('weekly', 8)
  )
  const rows = periodListQuery.data ?? []
  const loading = periodListQuery.isLoading

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Weekly Summaries</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Weekly rollups of daily reports. Click a row for the full breakdown.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Week</TableHead>
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
                rows.map((w) => (
                  <TableRow key={w.key} className="cursor-pointer hover:bg-muted/40">
                    <TableCell>
                      <Link to={`/reports/weekly/${w.key}`} className="block">
                        <div className="font-medium">
                          {format(parseISO(w.start), 'MMM d')} –{' '}
                          {format(parseISO(w.end), 'MMM d, yyyy')}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className="font-semibold tabular-nums"
                        title={formatCurrency(w.revenue)}
                      >
                        {formatCurrencyCompact(w.revenue)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <VsPriorBadge pct={w.vsPrior.revenuePct} />
                    </TableCell>
                    <TableCell
                      className="text-right tabular-nums text-muted-foreground"
                      title={formatCurrency(w.expenses)}
                    >
                      {formatCurrencyCompact(w.expenses)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{w.patientCount}</TableCell>
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

function VsPriorBadge({ pct }: { pct: number }) {
  if (pct === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <ArrowRight className="h-3 w-3" />
        0%
      </span>
    )
  }
  const up = pct > 0
  const Icon = up ? ArrowUp : ArrowDown
  const color = up ? 'text-emerald-600' : 'text-rose-600'
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${color}`}>
      <Icon className="h-3 w-3" />
      {Math.abs(pct).toFixed(0)}%
    </span>
  )
}
