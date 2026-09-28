import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { DollarSign, FileText, MoreVertical, Printer, TrendingDown, TrendingUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Pagination } from '@/features/financial-records/components/pagination'
import { PeriodSelector } from '@/features/financial-records/components/period-selectors'
import { ReceiptDialog } from '@/features/financial-records/components/receipt-dialog'
import {
  type ReceiptDataShape,
  ReceiptViewDialog,
} from '@/features/payments/components/receipt-view-dialog'
import {
  getDailyTransactions,
  getFinancialRecords,
  type Transaction,
} from '@/lib/actions/financials'
import { api } from '@/lib/api-client'
import { useLoading } from '@/lib/loading-context'
import { cn } from '@/lib/utils'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/shared/components/ui/accordion'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { formatCurrency } from '@/shared/utils/currency'

export default function FinancialRecordsPage() {
  const [view, setView] = useState<'day' | 'week' | 'month' | 'year'>('month')
  const [date, setDate] = useState(new Date())
  const { setIsLoading } = useLoading()
  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false)
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null)
  // Income rows are real `payments` records — fetch the same group-aware
  // receipt the payments module uses (GET /api/payments/:id/receipt already
  // merges every sibling of a split payment into one `methods` list), so a
  // multi-method payment shows one unified receipt instead of one per method.
  // Expense rows aren't payments at all, so they keep the plain ReceiptDialog.
  const [paymentReceiptOpen, setPaymentReceiptOpen] = useState(false)
  const [paymentReceiptData, setPaymentReceiptData] = useState<ReceiptDataShape | null>(null)

  // Pagination state
  const [dailyPage, setDailyPage] = useState(1)
  const [breakdownPage, setBreakdownPage] = useState(1)

  // `getDailyTransactions`/`getFinancialRecords` already unwrap `ApiResponse` and
  // resolve the bare payload, so these use plain `useQuery` rather than
  // `useApiQuery` (which expects the `{success,data,error}` envelope).
  const dateISO = date.toISOString()
  const breakdownView = view === 'day' ? undefined : view

  const dailyQuery = useQuery({
    queryKey: ['financial-records', 'daily', dateISO, dailyPage, 20] as const,
    queryFn: () => getDailyTransactions(dateISO, dailyPage, 20),
    enabled: view === 'day',
  })

  const breakdownQuery = useQuery({
    queryKey: ['financial-records', breakdownView ?? 'month', dateISO, breakdownPage, 10] as const,
    queryFn: () => getFinancialRecords(breakdownView ?? 'month', dateISO, breakdownPage, 10),
    enabled: breakdownView !== undefined,
  })

  const transactions = view === 'day' ? (dailyQuery.data?.transactions ?? []) : []
  const dailyPagination = view === 'day' ? (dailyQuery.data?.pagination ?? null) : null
  const data = view === 'day' ? null : (breakdownQuery.data ?? null)
  const breakdownPagination = view === 'day' ? null : (breakdownQuery.data?.pagination ?? null)
  const isLoading = view === 'day' ? dailyQuery.isFetching : breakdownQuery.isFetching

  // Mirror into the shared reference-counted loading context, same as every
  // other migrated page — the JSX below still reads the local `isLoading`.
  useEffect(() => {
    setIsLoading(isLoading)
  }, [isLoading, setIsLoading])

  // Reset pagination when view or date changes
  useEffect(() => {
    setDailyPage(1)
    setBreakdownPage(1)
  }, [])

  const handlePrint = () => {
    window.print()
  }

  const handleViewReceipt = async (transaction: Transaction) => {
    if (transaction.type !== 'income') {
      // Expenses aren't `payments` rows — no group-aware receipt to fetch.
      setSelectedTransaction(transaction)
      setReceiptDialogOpen(true)
      return
    }
    const res = await api.get<ReceiptDataShape>(`/api/payments/${transaction.id}/receipt`)
    if (res.success && res.data) {
      setPaymentReceiptData(res.data)
      setPaymentReceiptOpen(true)
    } else {
      toast.error(res.error || 'Failed to load receipt')
    }
  }

  const formatPeriodLabel = () => {
    if (view === 'day') {
      return format(date, 'EEEE, MMM dd, yyyy')
    }
    if (view === 'week') {
      return `Week of ${format(date, 'MMM dd, yyyy')}`
    }
    if (view === 'month') return format(date, 'MMMM yyyy')
    return format(date, 'yyyy')
  }

  return (
    <div className="container mx-auto p-6 print:p-0">
      {/* Print-specific styles to expand all accordions */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
                @media print {
                    /* Force all accordion content to be visible when printing */
                    [data-radix-accordion-content] {
                        display: block !important;
                        height: auto !important;
                        overflow: visible !important;
                    }
                    /* Hide accordion triggers (arrows) in print */
                    [data-radix-accordion-trigger] svg {
                        display: none !important;
                    }
                }
            `,
        }}
      />

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Financial Records</h1>
          <p className="text-muted-foreground mt-2">
            View and analyze your income and expenses over time.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap print:hidden">
          {/* Tab-like buttons */}
          <div className="flex items-center gap-2 bg-muted p-1 rounded-lg">
            <Button
              variant={view === 'day' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setView('day')}
            >
              Daily
            </Button>
            <Button
              variant={view === 'week' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setView('week')}
            >
              Weekly
            </Button>
            <Button
              variant={view === 'month' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setView('month')}
            >
              Monthly
            </Button>
            <Button
              variant={view === 'year' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setView('year')}
            >
              Yearly
            </Button>
          </div>
        </div>
      </div>

      {/* Period Selector */}
      <div className="flex items-center justify-center mb-6 bg-card p-4 rounded-lg border shadow-sm print:border-none print:shadow-none print:p-0">
        <div className="print:hidden">
          <PeriodSelector view={view} date={date} onDateChange={setDate} />
        </div>
        <div className="hidden print:block font-semibold text-lg">{formatPeriodLabel()}</div>
      </div>

      {/* Daily View */}
      {view === 'day' ? (
        <div>
          {/* Summary Cards for Daily View */}
          <div className="grid gap-4 md:grid-cols-3 mb-8">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Income</CardTitle>
                <TrendingUp className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {formatCurrency(
                    transactions
                      .filter((t) => t.type === 'income')
                      .reduce((sum, t) => sum + t.amount, 0)
                  )}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
                <TrendingDown className="h-4 w-4 text-red-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">
                  {formatCurrency(
                    transactions
                      .filter((t) => t.type === 'expense')
                      .reduce((sum, t) => sum + t.amount, 0)
                  )}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Net Balance</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div
                  className={cn(
                    'text-2xl font-bold',
                    transactions.reduce(
                      (sum, t) => sum + (t.type === 'income' ? t.amount : -t.amount),
                      0
                    ) >= 0
                      ? 'text-green-600'
                      : 'text-red-600'
                  )}
                >
                  {formatCurrency(
                    transactions.reduce(
                      (sum, t) => sum + (t.type === 'income' ? t.amount : -t.amount),
                      0
                    )
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="print:border-none print:shadow-none">
            <CardHeader>
              <CardTitle>Daily Transactions</CardTitle>
              <CardDescription>All payments and expenses for this day.</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? null : (
                <div className="relative w-full overflow-auto">
                  <table className="w-full caption-bottom text-sm text-left">
                    <thead className="[&_tr]:border-b">
                      <tr className="border-b transition-colors hover:bg-muted/50">
                        <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                          Type
                        </th>
                        <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                          Category
                        </th>
                        <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                          Description
                        </th>
                        <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                          Method
                        </th>
                        <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                          Amount
                        </th>
                        <th className="h-12 px-4 font-medium text-muted-foreground text-right print:hidden">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="[&_tr:last-child]:border-0">
                      {transactions.map((tx) => (
                        <tr key={tx.id} className="border-b transition-colors hover:bg-muted/50">
                          <td className="p-4 align-middle">
                            <span
                              className={cn(
                                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
                                tx.type === 'income'
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-red-100 text-red-800'
                              )}
                            >
                              {tx.type === 'income' ? 'Income' : 'Expense'}
                            </span>
                          </td>
                          <td className="p-4 align-middle">{tx.category}</td>
                          <td className="p-4 align-middle">{tx.description || '-'}</td>
                          <td className="p-4 align-middle">{tx.paymentMethod || '-'}</td>
                          <td
                            className={cn(
                              'p-4 align-middle text-right font-medium',
                              tx.type === 'income' ? 'text-green-600' : 'text-red-600'
                            )}
                          >
                            {formatCurrency(tx.amount)}
                          </td>
                          <td className="p-4 text-right print:hidden">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleViewReceipt(tx)}>
                                  <FileText className="mr-2 h-4 w-4" />
                                  View Receipt
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {transactions.length === 0 && (
                    <div className="text-center py-10 text-muted-foreground">
                      No transactions found for this day.
                    </div>
                  )}
                </div>
              )}

              {/* Pagination for Daily view */}
              {dailyPagination && (
                <Pagination
                  currentPage={dailyPagination.page}
                  totalPages={dailyPagination.totalPages}
                  onPageChange={setDailyPage}
                  totalItems={dailyPagination.total}
                  pageSize={dailyPagination.pageSize}
                  itemLabel="transactions"
                />
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          {isLoading ? null : (
            <div className="grid gap-4 md:grid-cols-3 mb-8">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Income</CardTitle>
                  <TrendingUp className="h-4 w-4 text-green-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">
                    {formatCurrency(data?.totalIncome || 0)}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
                  <TrendingDown className="h-4 w-4 text-red-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-red-600">
                    {formatCurrency(data?.totalExpenses || 0)}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Net Balance</CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div
                    className={cn(
                      'text-2xl font-bold',
                      (data?.netBalance || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                    )}
                  >
                    {formatCurrency(data?.netBalance || 0)}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Detailed Breakdown */}
          <Card className="print:border-none print:shadow-none">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Detailed Breakdown</CardTitle>
                  <CardDescription>
                    Breakdown by {view === 'year' ? 'month' : 'day'} for the selected period.
                  </CardDescription>
                </div>
                <Button onClick={handlePrint} size="sm" className="print:hidden">
                  <Printer className="mr-2 h-4 w-4" />
                  Print Report
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? null : view === 'year' ? (
                <div className="relative w-full overflow-auto">
                  <table className="w-full caption-bottom text-sm">
                    <thead className="[&_tr]:border-b">
                      <tr className="border-b transition-colors hover:bg-muted/50">
                        <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                          Month
                        </th>
                        <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                          Income
                        </th>
                        <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                          Expenses
                        </th>
                        <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                          Balance
                        </th>
                      </tr>
                    </thead>
                    <tbody className="[&_tr:last-child]:border-0">
                      {data?.records.map((record) => (
                        <tr
                          key={record.date}
                          className="border-b transition-colors hover:bg-muted/50"
                        >
                          <td className="p-4 align-middle font-medium">{record.label}</td>
                          <td className="p-4 align-middle text-right text-green-600">
                            {formatCurrency(record.income)}
                          </td>
                          <td className="p-4 align-middle text-right text-red-600">
                            {formatCurrency(record.expenses)}
                          </td>
                          <td
                            className={cn(
                              'p-4 align-middle text-right font-medium',
                              record.balance >= 0 ? 'text-green-600' : 'text-red-600'
                            )}
                          >
                            {formatCurrency(record.balance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {data?.records.length === 0 && (
                    <div className="text-center py-10 text-muted-foreground">
                      No records found for this period.
                    </div>
                  )}
                </div>
              ) : (
                <Accordion type="multiple" className="w-full">
                  {data?.records.map((record) => (
                    <AccordionItem key={record.date} value={record.date}>
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex items-center justify-between w-full pr-4">
                          <span className="font-medium">{record.label}</span>
                          <div className="flex items-center gap-4 text-sm">
                            <span className="text-green-600">+{formatCurrency(record.income)}</span>
                            <span className="text-red-600">-{formatCurrency(record.expenses)}</span>
                            <span
                              className={cn(
                                'font-semibold min-w-[100px] text-right',
                                record.balance >= 0 ? 'text-green-600' : 'text-red-600'
                              )}
                            >
                              {formatCurrency(record.balance)}
                            </span>
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        {record.transactions && record.transactions.length > 0 ? (
                          <div className="relative w-full overflow-auto">
                            <table className="w-full caption-bottom text-sm">
                              <thead className="[&_tr]:border-b">
                                <tr className="border-b transition-colors">
                                  <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground text-xs">
                                    Type
                                  </th>
                                  <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground text-xs">
                                    Category
                                  </th>
                                  <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground text-xs">
                                    Description
                                  </th>
                                  <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground text-xs">
                                    Method
                                  </th>
                                  <th className="h-10 px-4 text-right align-middle font-medium text-muted-foreground text-xs">
                                    Amount
                                  </th>
                                  <th className="h-10 px-4 text-right align-middle font-medium text-muted-foreground text-xs print:hidden">
                                    Actions
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="[&_tr:last-child]:border-0">
                                {record.transactions.map((tx) => (
                                  <tr
                                    key={tx.id}
                                    className="border-b transition-colors hover:bg-muted/50"
                                  >
                                    <td className="p-3 align-middle">
                                      <span
                                        className={cn(
                                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
                                          tx.type === 'income'
                                            ? 'bg-green-100 text-green-800'
                                            : 'bg-red-100 text-red-800'
                                        )}
                                      >
                                        {tx.type === 'income' ? 'Income' : 'Expense'}
                                      </span>
                                    </td>
                                    <td className="p-3 align-middle text-sm">{tx.category}</td>
                                    <td className="p-3 align-middle text-sm">
                                      {tx.description || '-'}
                                    </td>
                                    <td className="p-3 align-middle text-sm">
                                      {tx.paymentMethod || '-'}
                                    </td>
                                    <td
                                      className={cn(
                                        'p-3 align-middle text-right font-medium text-sm',
                                        tx.type === 'income' ? 'text-green-600' : 'text-red-600'
                                      )}
                                    >
                                      {formatCurrency(tx.amount)}
                                    </td>
                                    <td className="p-3 text-right print:hidden">
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button variant="ghost" size="sm">
                                            <MoreVertical className="h-4 w-4" />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                          <DropdownMenuItem onClick={() => handleViewReceipt(tx)}>
                                            <FileText className="mr-2 h-4 w-4" />
                                            View Receipt
                                          </DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="text-center py-6 text-sm text-muted-foreground">
                            No transactions for this day.
                          </div>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              )}

              {/* Pagination for Weekly/Monthly views */}
              {breakdownPagination && view !== 'year' && (
                <Pagination
                  currentPage={breakdownPagination.page}
                  totalPages={breakdownPagination.totalPages}
                  onPageChange={setBreakdownPage}
                  totalItems={breakdownPagination.total}
                  pageSize={breakdownPagination.pageSize}
                  itemLabel="days"
                />
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Receipt Dialog — expense rows only (see handleViewReceipt) */}
      <ReceiptDialog
        open={receiptDialogOpen}
        onOpenChange={setReceiptDialogOpen}
        transaction={selectedTransaction}
      />

      {/* Payment receipt — income rows, unified across a split payment's
          sibling methods via the same dialog the payments module uses. */}
      {paymentReceiptData && (
        <ReceiptViewDialog
          open={paymentReceiptOpen}
          onOpenChange={(open) => {
            setPaymentReceiptOpen(open)
            if (!open) setPaymentReceiptData(null)
          }}
          receiptData={paymentReceiptData}
        />
      )}
    </div>
  )
}
