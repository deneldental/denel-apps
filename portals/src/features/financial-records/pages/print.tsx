import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ArrowLeft, Printer } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  type FinancialRecordResponse,
  getDailyTransactions,
  getFinancialRecords,
  type Transaction,
} from '@/lib/actions/financials'
import { useBranding } from '@/lib/branding-context'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/components/ui/button'
import { formatCurrency } from '@/shared/utils/currency'

type View = 'day' | 'week' | 'month' | 'year'

function isView(v: string | null): v is View {
  return v === 'day' || v === 'week' || v === 'month' || v === 'year'
}

function parseDateParam(d: string | null): Date {
  if (!d) return new Date()
  const parsed = new Date(d)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

export default function FinancialRecordsPrintPage() {
  const branding = useBranding()
  const [searchParams] = useSearchParams()

  const view: View = isView(searchParams.get('view')) ? (searchParams.get('view') as View) : 'month'
  const date = useMemo(() => parseDateParam(searchParams.get('date')), [searchParams])
  const dateISO = date.toISOString()

  // We pull a generous page size for print so the report shows the full
  // period in one document. `getDailyTransactions`/`getFinancialRecords`
  // already unwrap `ApiResponse` and resolve the bare payload, so these use
  // plain `useQuery` rather than `useApiQuery`.
  const dailyQuery = useQuery({
    queryKey: ['financial-records-print', 'daily', dateISO, 500] as const,
    queryFn: () => getDailyTransactions(dateISO, 1, 500),
    enabled: view === 'day',
  })
  const breakdownQuery = useQuery({
    queryKey: ['financial-records-print', view === 'day' ? 'month' : view, dateISO, 500] as const,
    queryFn: () => getFinancialRecords(view === 'day' ? 'month' : view, dateISO, 1, 500),
    enabled: view !== 'day',
  })

  const activeQuery = view === 'day' ? dailyQuery : breakdownQuery
  const transactions: Transaction[] = view === 'day' ? (dailyQuery.data?.transactions ?? []) : []
  const data: FinancialRecordResponse | null = view === 'day' ? null : (breakdownQuery.data ?? null)
  const isLoading = activeQuery.isFetching

  // Auto-trigger the print dialog once data is on the page. Small timeout
  // gives the layout a tick to settle so the preview renders correctly.
  useEffect(() => {
    if (!activeQuery.isFetched || activeQuery.isFetching) return
    const id = window.setTimeout(() => window.print(), 300)
    return () => window.clearTimeout(id)
  }, [activeQuery.isFetched, activeQuery.isFetching])

  const formatPeriodLabel = () => {
    if (view === 'day') return format(date, 'EEEE, MMM dd, yyyy')
    if (view === 'week') return `Week of ${format(date, 'MMM dd, yyyy')}`
    if (view === 'month') return format(date, 'MMMM yyyy')
    return format(date, 'yyyy')
  }

  const totals = useMemo(() => {
    if (view === 'day') {
      const income = transactions
        .filter((t) => t.type === 'income')
        .reduce((sum, t) => sum + t.amount, 0)
      const expenses = transactions
        .filter((t) => t.type === 'expense')
        .reduce((sum, t) => sum + t.amount, 0)
      return { income, expenses, balance: income - expenses }
    }
    return {
      income: data?.totalIncome ?? 0,
      expenses: data?.totalExpenses ?? 0,
      balance: data?.netBalance ?? 0,
    }
  }, [view, transactions, data])

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Print stylesheet — A4 with comfortable margins, hide screen-only chrome */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
 @page { size: A4; margin: 18mm; }
 @media print {
 .no-print { display: none !important; }
 body { background: white !important; }
 }
 `,
        }}
      />

      {/* Screen-only header (hidden from print) */}
      <div className="no-print border-b bg-muted/40 px-6 py-3">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <Button asChild variant="outline" size="sm">
            <Link to="/financial-records">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Link>
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-6 py-8 print:px-0 print:py-0">
        {/* Clinic header */}
        <header className="mb-8 border-b pb-4 text-center">
          <h1 className="text-2xl font-bold tracking-tight">{branding.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Financial Statement</p>
        </header>

        {/* Period */}
        <section className="mb-6 flex items-baseline justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Period</p>
            <p className="text-lg font-semibold">{formatPeriodLabel()}</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Generated</p>
            <p className="text-sm">{format(new Date(), 'MMM dd, yyyy h:mm a')}</p>
          </div>
        </section>

        {/* Totals grid */}
        <section className="mb-8 grid grid-cols-3 gap-4">
          <div className="rounded-md border p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total Income</p>
            <p className="mt-1 text-xl font-semibold text-green-700">
              {formatCurrency(totals.income)}
            </p>
          </div>
          <div className="rounded-md border p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total Expenses</p>
            <p className="mt-1 text-xl font-semibold text-red-700">
              {formatCurrency(totals.expenses)}
            </p>
          </div>
          <div className="rounded-md border p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Net Balance</p>
            <p
              className={cn(
                'mt-1 text-xl font-semibold',
                totals.balance >= 0 ? 'text-green-700' : 'text-red-700'
              )}
            >
              {formatCurrency(totals.balance)}
            </p>
          </div>
        </section>

        {/* Body */}
        {isLoading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
        ) : view === 'day' ? (
          <DailyTransactionsTable transactions={transactions} formatCurrency={formatCurrency} />
        ) : (
          <BreakdownSections view={view} data={data} formatCurrency={formatCurrency} />
        )}

        <footer className="mt-12 border-t pt-4 text-center text-xs text-muted-foreground">
          End of statement · {branding.name}
        </footer>
      </div>
    </div>
  )
}

function DailyTransactionsTable({
  transactions,
  formatCurrency,
}: {
  transactions: Transaction[]
  formatCurrency: (amount: number) => string
}) {
  if (transactions.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No transactions found for this day.
      </p>
    )
  }
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold">Daily Transactions</h2>
      <table className="w-full text-sm">
        <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="py-2 pr-2">Type</th>
            <th className="py-2 pr-2">Category</th>
            <th className="py-2 pr-2">Description</th>
            <th className="py-2 pr-2">Method</th>
            <th className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => (
            <tr key={tx.id} className="border-b last:border-0">
              <td className="py-2 pr-2 capitalize">{tx.type}</td>
              <td className="py-2 pr-2">{tx.category}</td>
              <td className="py-2 pr-2">{tx.description || '-'}</td>
              <td className="py-2 pr-2">{tx.paymentMethod || '-'}</td>
              <td
                className={cn(
                  'py-2 text-right font-medium',
                  tx.type === 'income' ? 'text-green-700' : 'text-red-700'
                )}
              >
                {formatCurrency(tx.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function BreakdownSections({
  view,
  data,
  formatCurrency,
}: {
  view: View
  data: FinancialRecordResponse | null
  formatCurrency: (amount: number) => string
}) {
  const records = data?.records ?? []
  if (records.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No records found for this period.
      </p>
    )
  }

  // Yearly view: compact monthly summary table.
  if (view === 'year') {
    return (
      <section>
        <h2 className="mb-3 text-base font-semibold">Monthly Breakdown</h2>
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="py-2 pr-2">Month</th>
              <th className="py-2 pr-2 text-right">Income</th>
              <th className="py-2 pr-2 text-right">Expenses</th>
              <th className="py-2 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.date} className="border-b last:border-0">
                <td className="py-2 pr-2 font-medium">{r.label}</td>
                <td className="py-2 pr-2 text-right text-green-700">{formatCurrency(r.income)}</td>
                <td className="py-2 pr-2 text-right text-red-700">{formatCurrency(r.expenses)}</td>
                <td
                  className={cn(
                    'py-2 text-right font-semibold',
                    r.balance >= 0 ? 'text-green-700' : 'text-red-700'
                  )}
                >
                  {formatCurrency(r.balance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    )
  }

  // Week / month view: section per day with its transactions expanded.
  return (
    <section className="space-y-6">
      <h2 className="text-base font-semibold">Detailed Breakdown</h2>
      {records.map((r) => (
        <div key={r.date} className="break-inside-avoid">
          <div className="mb-2 flex items-baseline justify-between border-b pb-1">
            <h3 className="text-sm font-semibold">{r.label}</h3>
            <div className="flex items-center gap-4 text-xs">
              <span className="text-green-700">+{formatCurrency(r.income)}</span>
              <span className="text-red-700">-{formatCurrency(r.expenses)}</span>
              <span
                className={cn(
                  'min-w-[90px] text-right font-semibold',
                  r.balance >= 0 ? 'text-green-700' : 'text-red-700'
                )}
              >
                {formatCurrency(r.balance)}
              </span>
            </div>
          </div>
          {r.transactions && r.transactions.length > 0 ? (
            <table className="w-full text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2">Type</th>
                  <th className="py-1 pr-2">Category</th>
                  <th className="py-1 pr-2">Description</th>
                  <th className="py-1 pr-2">Method</th>
                  <th className="py-1 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {r.transactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-border/40 last:border-0">
                    <td className="py-1 pr-2 capitalize">{tx.type}</td>
                    <td className="py-1 pr-2">{tx.category}</td>
                    <td className="py-1 pr-2">{tx.description || '-'}</td>
                    <td className="py-1 pr-2">{tx.paymentMethod || '-'}</td>
                    <td
                      className={cn(
                        'py-1 text-right font-medium',
                        tx.type === 'income' ? 'text-green-700' : 'text-red-700'
                      )}
                    >
                      {formatCurrency(tx.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="py-2 text-xs text-muted-foreground">No transactions for this day.</p>
          )}
        </div>
      ))}
    </section>
  )
}
