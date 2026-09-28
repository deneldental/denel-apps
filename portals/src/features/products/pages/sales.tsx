import { format, subDays } from 'date-fns'
import { ArrowUpDown, Eye } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { getSales } from '@/lib/actions/sales'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { formatCurrency } from '@/shared/utils/currency'

type DailySummary = {
  date: string // yyyy-mm-dd
  totalAmount: number
  totalProfit: number
  totalItems: number
  transactionCount: number
}

/** The fields this page reads off each `getSales()` row — the action itself
 *  is loosely typed (`ApiResponse<any[]>`), so narrow it here instead of
 *  threading `any` through the grouping logic below. */
type SaleRow = {
  sale: { saleDate: string; totalAmount: number; profit: number; quantity: number }
}

type SortKey = 'date' | 'totalAmount' | 'totalProfit' | 'totalItems' | 'transactionCount'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 10
const WINDOW_DAYS = 30

const fmt = formatCurrency

export default function SalesReportsPage() {
  const navigate = useNavigate()
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(1)

  // Stable for the life of the page — recomputing on every render would
  // change the query key and refetch on every keystroke/sort click.
  const { start, end } = useMemo(() => {
    const end = new Date()
    return { start: subDays(end, WINDOW_DAYS - 1), end }
  }, [])

  const salesQuery = useApiQuery(
    queryKeys.sales.range(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)),
    () => getSales(start, end)
  )
  const isLoading = salesQuery.isLoading

  useEffect(() => {
    if (salesQuery.isError) {
      toast.error(salesQuery.error.message || 'Failed to load sales reports')
    }
  }, [salesQuery.isError, salesQuery.error])

  // Group by yyyy-mm-dd
  const summaries = useMemo<DailySummary[]>(() => {
    const byDay = new Map<string, DailySummary>()
    for (const item of (salesQuery.data ?? []) as SaleRow[]) {
      const day = format(new Date(item.sale.saleDate), 'yyyy-MM-dd')
      const cur =
        byDay.get(day) ??
        ({
          date: day,
          totalAmount: 0,
          totalProfit: 0,
          totalItems: 0,
          transactionCount: 0,
        } as DailySummary)
      cur.totalAmount += item.sale.totalAmount || 0
      cur.totalProfit += item.sale.profit || 0
      cur.totalItems += item.sale.quantity || 0
      cur.transactionCount += 1
      byDay.set(day, cur)
    }
    return Array.from(byDay.values())
  }, [salesQuery.data])

  const sorted = useMemo(() => {
    const copy = [...summaries]
    copy.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'date') cmp = a.date.localeCompare(b.date)
      else cmp = (a[sortKey] as number) - (b[sortKey] as number)
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [summaries, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const clampedPage = Math.min(page, totalPages)
  const pageRows = sorted.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE)

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('desc')
    }
    setPage(1)
  }

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Sales Reports</h1>
        <p className="text-sm text-muted-foreground">
          Daily product sales totals from the last {WINDOW_DAYS} days. Click a row to view that
          day's report.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily Reports</CardTitle>
          <CardDescription>Showing the last {WINDOW_DAYS} days of product sales.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-ml-3 h-8"
                      onClick={() => toggleSort('date')}
                    >
                      Date
                      <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
                    </Button>
                  </TableHead>
                  <TableHead className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-mr-3 h-8"
                      onClick={() => toggleSort('totalAmount')}
                    >
                      Total
                      <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
                    </Button>
                  </TableHead>
                  <TableHead className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-mr-3 h-8"
                      onClick={() => toggleSort('totalProfit')}
                    >
                      Profit
                      <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
                    </Button>
                  </TableHead>
                  <TableHead className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-mr-3 h-8"
                      onClick={() => toggleSort('totalItems')}
                    >
                      Items
                      <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
                    </Button>
                  </TableHead>
                  <TableHead className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-mr-3 h-8"
                      onClick={() => toggleSort('transactionCount')}
                    >
                      Transactions
                      <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
                    </Button>
                  </TableHead>
                  <TableHead className="w-[96px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">
                      Loading reports…
                    </TableCell>
                  </TableRow>
                ) : pageRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">
                      No sales recorded in the last {WINDOW_DAYS} days.
                    </TableCell>
                  </TableRow>
                ) : (
                  pageRows.map((day) => (
                    <TableRow
                      key={day.date}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => navigate(`/store/sales/${day.date}`)}
                    >
                      <TableCell className="font-medium">
                        {format(new Date(day.date), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {fmt(day.totalAmount)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium ${day.totalProfit >= 0 ? 'text-green-600' : 'text-destructive'}`}
                      >
                        {fmt(day.totalProfit)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {day.totalItems}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {day.transactionCount}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            navigate(`/store/sales/${day.date}`)
                          }}
                        >
                          <Eye className="mr-1.5 h-3.5 w-3.5" />
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {sorted.length > PAGE_SIZE && (
            <div className="mt-4 flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Showing {(clampedPage - 1) * PAGE_SIZE + 1}–
                {Math.min(clampedPage * PAGE_SIZE, sorted.length)} of {sorted.length}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={clampedPage <= 1}
                >
                  Previous
                </Button>
                <div className="text-sm text-muted-foreground">
                  Page {clampedPage} of {totalPages}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={clampedPage >= totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
