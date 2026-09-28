import { format } from 'date-fns'
import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import type { DailyReport } from '@/features/reports/pages/columns'
import { getExpenses } from '@/lib/actions/expenses'
import { getInventoryItems } from '@/lib/actions/inventory'
import { getPayments } from '@/lib/actions/payments'
import { getProducts } from '@/lib/actions/products'
import type { items } from '@/lib/db/schema'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/shared/components/ui/breadcrumb'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { formatCurrency } from '@/shared/utils/currency'

type InventoryItem = typeof items.$inferSelect
type Product = typeof items.$inferSelect

interface ReportDetailContentProps {
  report: DailyReport
  onBack?: () => void
}

function isSameDay(dateValue: Date, dateString: string) {
  const target = new Date(`${dateString}T00:00:00`)
  return (
    dateValue.getFullYear() === target.getFullYear() &&
    dateValue.getMonth() === target.getMonth() &&
    dateValue.getDate() === target.getDate()
  )
}

export function ReportDetailContent({ report, onBack }: ReportDetailContentProps) {
  const navigate = useNavigate()
  interface Payment {
    id: string
    amount: number
    createdAt: Date | string
    method?: string | null
    patient?: {
      name: string
    } | null
    [key: string]: unknown
  }
  interface Expense {
    id: string
    amount: number
    date?: Date | string
    createdAt?: Date | string
    category?: string
    paymentMethod?: string | null
    description?: string | null
    [key: string]: unknown
  }
  const reportDate = new Date(report.reportDate)
  const reportDateString = reportDate.toISOString().slice(0, 10)

  const inventoryQuery = useApiQuery<InventoryItem[]>(queryKeys.inventory.list(), () =>
    getInventoryItems()
  )
  const productsQuery = useApiQuery<Product[]>(queryKeys.products.list(), () => getProducts())
  const paymentsQuery = useApiQuery<Payment[]>(queryKeys.payments.list(), () => getPayments())
  const expensesQuery = useApiQuery<Expense[]>(queryKeys.expenses.list(), () => getExpenses())

  const inventoryItems = inventoryQuery.data ?? []
  const productsList = productsQuery.data ?? []
  const payments = paymentsQuery.data ?? []
  const expenses = expensesQuery.data ?? []
  const isLoading =
    inventoryQuery.isLoading ||
    productsQuery.isLoading ||
    paymentsQuery.isLoading ||
    expensesQuery.isLoading

  // Filter payments and expenses for the report date
  const dailyPayments = payments.filter((payment) => {
    const createdAt = new Date(payment.createdAt)
    return isSameDay(createdAt, reportDateString)
  })

  const dailyExpenses = expenses.filter((expense) => {
    const expenseDate = new Date(expense.date || expense.createdAt || new Date())
    return isSameDay(expenseDate, reportDateString)
  })

  const createdAt = new Date(report.createdAt)

  // Get inventory item names
  const getInventoryName = (id: string) => {
    const item = inventoryItems.find((i) => i.id === id)
    return item?.name || 'Unknown Item'
  }

  // Get product names
  const getProductName = (id: string) => {
    const product = productsList.find((p) => p.id === id)
    return product?.name || 'Unknown Product'
  }

  const inventoryUsed = (report.inventoryUsed as Array<{ id: string; quantity: number }>) || []
  const productsSold = (report.productsSold as Array<{ id: string; quantity: number }>) || []
  const balances = (report.balances as Array<{ method: string; amount: number }>) || []

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Breadcrumbs */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/reports">Reports</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{format(reportDate, 'MMM d, yyyy')}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => (onBack ? onBack() : navigate(-1))}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </div>
      </div>

      {/* Report Details */}
      <div className="grid gap-6">
        {/* Missed-report banner */}
        {(report as any).isMissedReport && (
          <Card className="border-amber-300 bg-amber-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-amber-900">⚠ Missed Report</CardTitle>
              <CardDescription className="text-amber-800">
                Submitted late by an administrator.
              </CardDescription>
            </CardHeader>
            {(report as any).adminNote && (
              <CardContent>
                <p className="text-xs uppercase tracking-wider font-medium text-amber-700 mb-1">
                  Reason
                </p>
                <p className="text-sm whitespace-pre-line text-amber-900">
                  {(report as any).adminNote}
                </p>
              </CardContent>
            )}
          </Card>
        )}

        {/* Summary Card */}
        <Card>
          <CardHeader>
            <CardTitle>Report Summary</CardTitle>
            <CardDescription>
              Daily report for {format(reportDate, 'EEEE, MMMM d, yyyy')}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Checked-in Patients</p>
              <p className="text-2xl font-bold">{report.checkedInCount}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">New Patients</p>
              <p className="text-2xl font-bold">{report.newPatientsCount}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Payments</p>
              <p className="text-2xl font-bold text-green-600">
                {formatCurrency(report.totalPayments)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Expenses</p>
              <p className="text-2xl font-bold text-red-600">
                {formatCurrency(report.totalExpenses)}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Payments Breakdown */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Total Payment Received</CardTitle>
                <CardDescription>Breakdown of all payments for this date</CardDescription>
              </div>
              <span className="text-lg font-semibold text-green-600">
                {formatCurrency(report.totalPayments)}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            {dailyPayments.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No payments recorded for this date.
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {dailyPayments.map((payment) => (
                  <Card key={payment.id} className="border">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold">
                        {payment.patient?.name || 'Walk-in'}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      <div className="flex items-center justify-between">
                        <span className="capitalize">
                          {payment.method?.replace('_', ' ') || 'Payment'}
                        </span>
                        <span className="font-semibold text-foreground">
                          {formatCurrency(payment.amount)}
                        </span>
                      </div>
                      <div className="mt-1 text-xs">
                        {format(new Date(payment.createdAt), 'h:mm a')}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Expenses Breakdown */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Total Expenses Made</CardTitle>
                <CardDescription>Breakdown of all expenses for this date</CardDescription>
              </div>
              <span className="text-lg font-semibold text-red-600">
                {formatCurrency(report.totalExpenses)}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            {dailyExpenses.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No expenses recorded for this date.
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {dailyExpenses.map((expense) => (
                  <Card key={expense.id} className="border">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold capitalize">
                        {expense.category}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      <div className="flex items-center justify-between">
                        <span className="capitalize">{expense.paymentMethod || 'Expense'}</span>
                        <span className="font-semibold text-foreground">
                          {formatCurrency(expense.amount)}
                        </span>
                      </div>
                      {expense.description && (
                        <div className="mt-1 text-xs">{expense.description}</div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Balances Card */}
        {balances.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Balances</CardTitle>
              <CardDescription>Payment method balances</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {balances.map((balance, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <span className="font-medium capitalize">{balance.method}</span>
                    <span className="text-lg font-semibold">{formatCurrency(balance.amount)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Inventory Used Card */}
        {inventoryUsed.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Inventory Used</CardTitle>
              <CardDescription>Items used during this period</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading inventory items...</p>
              ) : (
                <div className="space-y-2">
                  {inventoryUsed.map((item, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <span className="font-medium">{getInventoryName(item.id)}</span>
                      <Badge variant="secondary">Qty: {item.quantity}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Restocked Items Card */}
        {Array.isArray((report as any).restockedItems) &&
          (report as any).restockedItems.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Restocked Items</CardTitle>
                <CardDescription>
                  Stock additions recorded and applied with this report
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {(
                    (report as any).restockedItems as Array<{
                      name: string
                      quantityAdded: number
                      inventoryType?: string
                      location?: string | null
                    }>
                  ).map((item, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div className="min-w-0">
                        <p className="font-medium truncate">{item.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.inventoryType === 'product' ? 'Product' : 'Inventory'}
                          {item.location ? ` · ${item.location}` : ''}
                        </p>
                      </div>
                      <Badge variant="secondary">+{item.quantityAdded}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

        {/* Products Sold Card */}
        {productsSold.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Products Sold</CardTitle>
              <CardDescription>Products sold during this period</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading products...</p>
              ) : (
                <div className="space-y-2">
                  {productsSold.map((product, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <span className="font-medium">{getProductName(product.id)}</span>
                      <Badge variant="secondary">Qty: {product.quantity}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Module digest (admin-v1 §10.1) — each module's summary for the day */}
        <ModuleDigestCard summaries={(report.moduleSummaries as ModuleSummary[] | null) ?? []} />

        {/* Metadata Card */}
        <Card>
          <CardHeader>
            <CardTitle>Report Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Submitted By:</span>
              <span className="font-medium">
                {report.submittedBy?.name || report.submittedBy?.email || 'Unknown'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Created At:</span>
              <span className="font-medium">{format(createdAt, "MMM d, yyyy 'at' h:mm a")}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ── Module digest (admin-v1 §10.1) ──────────────────────────────────────────────

interface ModuleSummary {
  module: string
  title: string
  metrics: Array<{ label: string; value: string | number }>
}

function ModuleDigestCard({ summaries }: { summaries: ModuleSummary[] }) {
  if (!Array.isArray(summaries) || summaries.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Module digest</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {summaries.map((block) => (
          <div key={block.module} className="rounded-lg border p-3">
            <p className="text-sm font-semibold">{block.title}</p>
            <dl className="mt-2 space-y-1">
              {block.metrics.map((m) => (
                <div key={m.label} className="flex justify-between text-sm">
                  <dt className="text-muted-foreground">{m.label}</dt>
                  <dd className="font-medium tabular-nums">{m.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
