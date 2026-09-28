import { FlaskConical, PackagePlus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTodaySalesCart } from '@/features/products/hooks/use-today-sales-cart'
import { getAppointments } from '@/lib/actions/appointments'
import { getExpenses } from '@/lib/actions/expenses'
import {
  clearLabExpense,
  getLabExpenseReadyCases,
  type LabExpenseReadyCase,
} from '@/lib/actions/labs'
import { getPatients } from '@/lib/actions/patients'
import { getPayments } from '@/lib/actions/payments'
import {
  type DailyExpenseTotal,
  getDailyExpenseTotal,
  getRestockDrafts,
  type RestockDraft,
  removeRestockDraft,
} from '@/lib/actions/reports'
import { getSales } from '@/lib/actions/sales'
import { useCan } from '@/lib/permissions-context'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { PaymentMethodSelect } from '@/shared/components/payment-method-select'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { InventoryMultiSelect } from '@/shared/components/ui/inventory-multiselect'
import { Label } from '@/shared/components/ui/label'
import { ProductsMultiSelect } from '@/shared/components/ui/products-multiselect'
import { Textarea } from '@/shared/components/ui/textarea'
import { surfaceApiError } from '@/shared/lib/api-error'
import { isSameLocalDay, localDateISO, parseLocalDate } from '@/shared/lib/dates'
import { centsToInput, formatCurrency, inputToCents } from '@/shared/utils/currency'

type BalanceEntry = {
  id: string
  method: string
  amount: string
}

// Local query keys — none of these resources have a matching group in
// `query-keys.ts` shaped for an unfiltered/date-scoped read.
const SALES_KEY = ['sales', 'list'] as const
const dailyExpenseTotalKey = (date: string) => ['reports', 'daily-expense-total', date] as const
const restockDraftsKey = (date: string) => ['reports', 'restock-drafts', date] as const
// Shares the `labs` prefix so a `queryKeys.labs.all` invalidation elsewhere
// (e.g. after a lab-case status change) also refreshes this list.
const LAB_EXPENSE_READY_CASES_KEY = ['labs', 'expense-ready-cases'] as const

export function DailyReportForm({
  submittedBy,
  onSubmit,
  isSubmitting = false,
  isAdmin = false,
}: {
  submittedBy: string
  onSubmit?: (payload: {
    reportDate: Date
    checkedInCount: number
    newPatientsCount: number
    totalPayments: number
    totalExpenses: number
    balances: Array<{ method: string; amount: number }>
    inventoryUsed: Array<{ id: string; quantity: number }>
    productsSold: Array<{ id: string; quantity: number }>
    restockedItems: Array<{
      inventoryId: string | null
      inventoryType: string
      name: string
      quantityAdded: number
      location: string | null
    }>
    saleIds?: string[]
    additionalNote?: string
    isMissedReport?: boolean
    adminNote?: string
  }) => void
  isSubmitting?: boolean
  /** When true, allows submitting a report for a past date with an adminNote. */
  isAdmin?: boolean
}) {
  const [selectedDate, setSelectedDate] = useState(localDateISO())
  const [adminNote, setAdminNote] = useState('')
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
  interface Patient {
    id: string
    name: string
    createdAt: Date | string
    [key: string]: unknown
  }
  interface Appointment {
    id: string
    date: Date | string
    status?: string
    [key: string]: unknown
  }
  interface SaleItem {
    sale: {
      id: string
      productId?: string
      status?: string
      saleDate: string | Date
      quantity: number
      totalAmount: number
    }
    product: { name: string } | null
  }
  // Drives only the itemised list below — the total is fetched separately.
  const canReadExpenses = useCan('expenses', 'read')

  const paymentsQuery = useApiQuery<Payment[]>(queryKeys.payments.list(), () => getPayments())
  const payments = paymentsQuery.data ?? []
  useEffect(() => {
    if (paymentsQuery.isError) {
      surfaceApiError({ error: paymentsQuery.error?.message }, 'Failed to load payments')
    }
  }, [paymentsQuery.isError, paymentsQuery.error])

  // Skipped entirely without `expenses:read` — firing it would 403 and log a
  // console error for a list this role is never shown. The total comes from
  // the aggregate endpoint instead.
  const expensesQuery = useApiQuery<Expense[]>(queryKeys.expenses.list(), () => getExpenses(), {
    enabled: canReadExpenses,
  })
  const expenses = expensesQuery.data ?? []

  const patientsQuery = useApiQuery<Patient[]>(queryKeys.patients.list(), () => getPatients())
  const patients = patientsQuery.data ?? []
  useEffect(() => {
    if (patientsQuery.isError) {
      surfaceApiError({ error: patientsQuery.error?.message }, 'Failed to load patients')
    }
  }, [patientsQuery.isError, patientsQuery.error])

  const appointmentsQuery = useApiQuery<Appointment[]>(queryKeys.appointments.list(), () =>
    getAppointments()
  )
  const appointments = appointmentsQuery.data ?? []
  useEffect(() => {
    if (appointmentsQuery.isError) {
      surfaceApiError({ error: appointmentsQuery.error?.message }, 'Failed to load appointments')
    }
  }, [appointmentsQuery.isError, appointmentsQuery.error])

  const salesQuery = useApiQuery<SaleItem[]>(SALES_KEY, () => getSales())
  const allSales = salesQuery.data ?? []
  useEffect(() => {
    if (salesQuery.isError) {
      surfaceApiError({ error: salesQuery.error?.message }, 'Failed to load sales')
    }
  }, [salesQuery.isError, salesQuery.error])

  // Day's expense total from the server. `null` while loading / on failure, so
  // a failed fetch never silently reads as GHS 0.00.
  const dailyExpenseTotalQuery = useApiQuery<DailyExpenseTotal>(
    dailyExpenseTotalKey(selectedDate),
    () => getDailyExpenseTotal(selectedDate)
  )
  const dailyExpenseTotal = dailyExpenseTotalQuery.data?.totalExpenses ?? null
  useEffect(() => {
    if (dailyExpenseTotalQuery.isError) {
      surfaceApiError(
        { error: dailyExpenseTotalQuery.error?.message },
        'Failed to load the expense total'
      )
    }
  }, [dailyExpenseTotalQuery.isError, dailyExpenseTotalQuery.error])

  const restockDraftsQuery = useApiQuery<RestockDraft[]>(restockDraftsKey(selectedDate), () =>
    getRestockDrafts(selectedDate)
  )
  const restockDrafts = restockDraftsQuery.data ?? []

  const labReadyCasesQuery = useApiQuery<LabExpenseReadyCase[]>(LAB_EXPENSE_READY_CASES_KEY, () =>
    getLabExpenseReadyCases()
  )
  const labReadyCases = labReadyCasesQuery.data ?? []

  const removeRestockMutation = useApiMutation<void, string>(removeRestockDraft, {
    invalidates: [restockDraftsKey(selectedDate)],
    onSuccess: () => toast.success('Restock entry removed'),
    onError: (err) => toast.error(err.message || 'Failed to remove restock'),
  })

  const clearLabExpenseMutation = useApiMutation(
    (vars: { caseId: string; amount: number; paymentMethod: string }) =>
      clearLabExpense(vars.caseId, { amount: vars.amount, paymentMethod: vars.paymentMethod }),
    {
      invalidates: [
        LAB_EXPENSE_READY_CASES_KEY,
        dailyExpenseTotalKey(selectedDate),
        ...(canReadExpenses ? [queryKeys.expenses.list()] : []),
      ],
      onSuccess: () => toast.success('Lab expense recorded'),
      onError: (err) => toast.error(err.message || 'Failed to clear lab expense'),
    }
  )

  const [balances, setBalances] = useState<BalanceEntry[]>([
    { id: 'balance-1', method: '', amount: '' },
  ])
  const [selectedInventory, setSelectedInventory] = useState<
    Array<{ id: string; quantity: number }>
  >([])
  const [selectedProducts, setSelectedProducts] = useState<Array<{ id: string; quantity: number }>>(
    []
  )
  const todaySalesCart = useTodaySalesCart()
  const [additionalNote, setAdditionalNote] = useState('')

  // Pre-fill productsSold from the on-device today-sales cart whenever the
  // report's date is today. Cart entries take precedence over manual selections
  // for the same product id so the totals reflect what the user collected on
  // the Products page.
  useEffect(() => {
    if (selectedDate !== todaySalesCart.date) return
    if (todaySalesCart.items.length === 0) return
    setSelectedProducts((prev) => {
      const byId = new Map(prev.map((p) => [p.id, p.quantity]))
      for (const item of todaySalesCart.items) {
        byId.set(item.productId, item.quantity)
      }
      return Array.from(byId.entries()).map(([id, quantity]) => ({ id, quantity }))
    })
  }, [selectedDate, todaySalesCart])

  // Is this report being submitted for a past date?
  const isMissedReport = useMemo(() => {
    const today = localDateISO()
    return selectedDate < today
  }, [selectedDate])

  function handleRemoveRestock(id: string) {
    removeRestockMutation.mutate(id)
  }

  function handleClearLabExpense(caseId: string, amount: number, paymentMethod: string) {
    clearLabExpenseMutation.mutate({ caseId, amount, paymentMethod })
  }

  const dailyDraftSales = useMemo(() => {
    const target = parseLocalDate(selectedDate)
    return allSales.filter((s) => {
      const saleDate = new Date(s.sale.saleDate)
      return isSameLocalDay(saleDate, target) && (s.sale.status === 'draft' || !s.sale.status)
    })
  }, [allSales, selectedDate])

  const dailyPayments = useMemo(() => {
    const target = parseLocalDate(selectedDate)
    return payments.filter((payment) => {
      const createdAt = new Date(payment.createdAt)
      return isSameLocalDay(createdAt, target)
    })
  }, [payments, selectedDate])

  const dailyExpenses = useMemo(() => {
    const target = parseLocalDate(selectedDate)
    return expenses.filter((expense) => {
      const expenseDate = new Date(expense.date || expense.createdAt || new Date())
      return isSameLocalDay(expenseDate, target)
    })
  }, [expenses, selectedDate])

  const dailyNewPatients = useMemo(() => {
    const target = parseLocalDate(selectedDate)
    return patients.filter((patient) => {
      const createdAt = new Date(patient.createdAt)
      return isSameLocalDay(createdAt, target)
    })
  }, [patients, selectedDate])

  const dailyCheckedInPatients = useMemo(() => {
    const target = parseLocalDate(selectedDate)
    return appointments.filter((appointment) => {
      if (appointment.status !== 'completed') return false
      const appointmentDate = new Date(appointment.date)
      return isSameLocalDay(appointmentDate, target)
    })
  }, [appointments, selectedDate])

  const totalPayments = dailyPayments.reduce((sum, p) => sum + (p.amount || 0), 0)

  // Authoritative expense total for the selected day, from an aggregate endpoint
  // gated on `reports:create`. Reception has no `expenses:read`, so summing
  // `dailyExpenses` locally would silently yield 0 for them and overstate the
  // balance. The itemised list below is best-effort and stays empty for roles
  // that cannot read individual expenses.
  const totalExpenses = dailyExpenseTotal ?? 0
  const totalBalance = totalPayments - totalExpenses
  const isOverspent = totalExpenses > totalPayments

  const addBalanceRow = () => {
    setBalances((prev) => [...prev, { id: crypto.randomUUID(), method: '', amount: '' }])
  }

  const removeBalanceRow = (id: string) => {
    setBalances((prev) => prev.filter((row) => row.id !== id))
  }

  const handleSubmit = () => {
    if (!onSubmit) return

    // Missed reports (past dates) require admin permission + a reason note.
    if (isMissedReport) {
      if (!isAdmin) {
        toast.error('Only admins can submit reports for past dates.')
        return
      }
      if (!adminNote.trim()) {
        toast.error('Please record why this report is being submitted late.')
        return
      }
    }

    // Lab cases that have crossed the patient-payment threshold must be paid
    // out to the lab and recorded as expenses before the report can submit.
    if (labReadyCases.length > 0) {
      toast.error(
        `${labReadyCases.length} lab case${labReadyCases.length === 1 ? '' : 's'} must be cleared before submission.`
      )
      return
    }

    const restockedItems = restockDrafts.map((d) => ({
      inventoryId: d.inventoryId,
      inventoryType: d.inventoryType,
      name: d.name,
      quantityAdded: d.quantityAdded,
      location: d.location,
    }))

    // Exclude products already covered by saleIds to avoid double stock deduction.
    // The backend deducts stock for saleIds and productsSold separately.
    const draftSaleProductIds = new Set(
      dailyDraftSales.map((s) => s.sale.productId).filter((id): id is string => id != null)
    )
    const deduplicatedProducts = selectedProducts.filter((p) => !draftSaleProductIds.has(p.id))

    const saleIds = dailyDraftSales.map((s) => s.sale.id)

    // Validate additional note when overspent
    if (isOverspent) {
      if (!additionalNote.trim()) {
        toast.error('Please provide an additional note about who we owe.')
        return
      }

      // Submit without balance validation when overspent
      onSubmit({
        reportDate: parseLocalDate(selectedDate),
        checkedInCount: dailyCheckedInPatients.length,
        newPatientsCount: dailyNewPatients.length,
        totalPayments,
        totalExpenses,
        balances: [], // No balances when overspent
        inventoryUsed: selectedInventory,
        productsSold: deduplicatedProducts,
        restockedItems,
        saleIds,
        additionalNote: additionalNote.trim(),
        isMissedReport,
        adminNote: isMissedReport ? adminNote.trim() : undefined,
      })
      return
    }

    // When not overspent, validate balances
    const cleanedBalances = balances
      .filter((row) => row.method && row.amount)
      .map((row) => ({
        method: row.method,
        // The API speaks CENTS; the input holds cedis.
        amount: Math.round(Number(row.amount) * 100),
      }))

    if (cleanedBalances.length === 0) {
      toast.error('Please add at least one balance entry.')
      return
    }

    if (cleanedBalances.some((row) => Number.isNaN(row.amount))) {
      toast.error('Balance amounts must be valid numbers.')
      return
    }

    // Validate that total balances equal the calculated total balance
    const balancesSum = cleanedBalances.reduce((sum, b) => sum + b.amount, 0)
    const expectedBalance = totalBalance

    if (Math.abs(balancesSum - expectedBalance) > 0.01) {
      // Allow GHS 0.01 tolerance for decimal rounding only
      toast.error(
        `Balance amounts must add up to ${formatCurrency(expectedBalance)}. Current sum: ${formatCurrency(balancesSum)}`
      )
      return
    }

    onSubmit({
      reportDate: parseLocalDate(selectedDate),
      checkedInCount: dailyCheckedInPatients.length,
      newPatientsCount: dailyNewPatients.length,
      totalPayments,
      totalExpenses,
      balances: cleanedBalances,
      inventoryUsed: selectedInventory,
      productsSold: deduplicatedProducts,
      restockedItems,
      saleIds,
      additionalNote: additionalNote.trim() || undefined,
      isMissedReport,
      adminNote: isMissedReport ? adminNote.trim() : undefined,
    })
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Date - Report</h1>
        <div className="flex items-center gap-3">
          <Label htmlFor="report-date" className="text-sm text-muted-foreground">
            Date
          </Label>
          <Input
            id="report-date"
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="max-w-[220px]"
          />
        </div>
      </div>

      {isMissedReport && (
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-amber-900">⚠ Missed Report</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-amber-800">
              This report is being submitted for a past date.{' '}
              {isAdmin
                ? 'Please record the reason it was missed.'
                : 'Only an admin can submit missed reports — please ask your administrator.'}
            </p>
            {isAdmin && (
              <div className="space-y-2">
                <Label htmlFor="adminNote" className="text-amber-900">
                  Reason for late submission <span className="text-red-600">*</span>
                </Label>
                <Textarea
                  id="adminNote"
                  rows={3}
                  placeholder="e.g. Internet outage, receptionist emergency, system failure…"
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  className="border-amber-300 focus:border-amber-500 bg-background"
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Total checked-in patients</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {dailyCheckedInPatients.length}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Total new patients</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{dailyNewPatients.length}</CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Total payment received</h2>
          <span className="text-sm font-semibold text-green-600">
            {formatCurrency(totalPayments)}
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {dailyPayments.map((payment) => (
            <Card key={payment.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
                  {payment.patient?.name || 'Walk-in'}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span>{payment.method?.replace('_', ' ') || 'Payment'}</span>
                  <span className="font-semibold text-foreground">
                    {formatCurrency(payment.amount)}
                  </span>
                </div>
                <div className="mt-1 text-xs">
                  {new Date(payment.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
          {dailyPayments.length === 0 && (
            <Card>
              <CardContent className="text-sm text-muted-foreground py-6">
                No payments recorded for this date.
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Total expenses made</h2>
          <span className="text-sm font-semibold text-red-600">
            {dailyExpenseTotal === null ? '—' : formatCurrency(totalExpenses)}
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {dailyExpenses.map((expense) => (
            <Card key={expense.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold capitalize">
                  {expense.category}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span>{expense.paymentMethod || 'Expense'}</span>
                  <span className="font-semibold text-foreground">
                    {formatCurrency(expense.amount)}
                  </span>
                </div>
                {expense.description && <div className="mt-1 text-xs">{expense.description}</div>}
              </CardContent>
            </Card>
          ))}
          {dailyExpenses.length === 0 && (
            <Card>
              <CardContent className="text-sm text-muted-foreground py-6">
                {/* The total is authoritative even when the itemised list is
 withheld, so don't claim there were no expenses. */}
                {totalExpenses > 0
                  ? 'Itemised expenses are not visible to your role. The total above is included in this report.'
                  : 'No expenses recorded for this date.'}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-xl font-semibold">Inventory Used</h2>
        <div className="space-y-2">
          <Label>Select inventory items used</Label>
          <InventoryMultiSelect
            value={selectedInventory}
            onChange={setSelectedInventory}
            placeholder="Select inventory items..."
          />
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-xl font-semibold">Products Sold</h2>
        <div className="space-y-2">
          <Label>Select products sold</Label>
          <ProductsMultiSelect
            value={selectedProducts}
            onChange={setSelectedProducts}
            placeholder="Select products..."
          />
          {dailyDraftSales.length > 0 && (
            <div className="mt-4 p-4 border rounded-md bg-muted/50">
              <h3 className="text-sm font-medium mb-2">Draft Sales Queue (Auto-included)</h3>
              <ul className="text-sm space-y-1">
                {dailyDraftSales.map((s) => (
                  <li key={s.sale.id} className="flex justify-between">
                    <span>
                      {s.product?.name || 'Unknown Product'} (x{s.sale.quantity})
                    </span>
                    <span className="text-muted-foreground">
                      {formatCurrency(s.sale.totalAmount)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground mt-3">
                These draft items will be submitted automatically when creating this report.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <PackagePlus className="h-5 w-5" />
            Restocking
          </h2>
          <span className="text-xs text-muted-foreground">
            {restockDrafts.length} item{restockDrafts.length === 1 ? '' : 's'} pending
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Items recorded as restocked during the day. Stock is applied when the report is submitted.
          Add new entries from the dashboard Low Stock card.
        </p>
        {restockDrafts.length === 0 ? (
          <Card>
            <CardContent className="text-sm text-muted-foreground py-6">
              No restocks recorded for this date.
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-md border divide-y">
            {restockDrafts.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{d.name}</p>
                  <p className="text-xs text-muted-foreground">
                    +{d.quantityAdded}
                    {d.inventoryType === 'product' ? ' · Product' : ' · Inventory'}
                    {d.location ? ` · ${d.location}` : ''}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => handleRemoveRestock(d.id)}
                  aria-label={`Remove ${d.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lab Expenses to Clear — gates report submission. */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            Lab Expenses to Clear
          </h2>
          <span
            className={`text-xs ${labReadyCases.length > 0 ? 'text-red-600 font-semibold' : 'text-muted-foreground'}`}
          >
            {labReadyCases.length} case{labReadyCases.length === 1 ? '' : 's'} pending
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Patient has covered the lab cost on these cases. Pay the lab and record each as an expense
          before submitting the report.
        </p>
        {labReadyCases.length === 0 ? (
          <Card>
            <CardContent className="text-sm text-muted-foreground py-6">
              No lab expenses pending clearance.
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-md border divide-y">
            {labReadyCases.map((c) => (
              <LabExpenseRow
                key={c.id}
                labCase={c}
                clearing={
                  clearLabExpenseMutation.isPending &&
                  clearLabExpenseMutation.variables?.caseId === c.id
                }
                onClear={(amount, paymentMethod) =>
                  handleClearLabExpense(c.id, amount, paymentMethod)
                }
              />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">
            {isOverspent ? 'Outstanding Amount (Deficit)' : 'Balance'}
          </h2>
          <span className={`text-lg font-bold ${isOverspent ? 'text-red-600' : 'text-green-600'}`}>
            {formatCurrency(Math.abs(totalBalance))}
            {isOverspent && ' (DEFICIT)'}
          </span>
        </div>

        {isOverspent ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-medium text-red-800 mb-2">
              ⚠️ Expenses exceed payments by {formatCurrency(Math.abs(totalBalance))}
            </p>
            <p className="text-xs text-red-600 mb-3">
              Since expenses are higher than payments, please provide details about the outstanding
              amount.
            </p>
            <div className="space-y-2">
              <Label htmlFor="additionalNote" className="text-red-800">
                Additional Note <span className="text-red-600">*</span>
              </Label>
              <Input
                id="additionalNote"
                placeholder="Who do we owe?"
                value={additionalNote}
                onChange={(e) => setAdditionalNote(e.target.value)}
                className="border-red-300 focus:border-red-500"
                required={isOverspent}
              />
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Note: Individual balances must add up to {formatCurrency(totalBalance)}
            </p>
            <div className="space-y-3">
              {balances.map((row) => (
                <div key={row.id} className="grid gap-3 md:grid-cols-[1fr_1fr_auto] items-end">
                  <div className="space-y-2">
                    <Label>Payment Method</Label>
                    <PaymentMethodSelect
                      value={row.method}
                      onValueChange={(value) =>
                        setBalances((prev) =>
                          prev.map((entry) =>
                            entry.id === row.id ? { ...entry, method: value } : entry
                          )
                        )
                      }
                      placeholder="Select method"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Balance left (GHS)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={row.amount}
                      onChange={(e) =>
                        setBalances((prev) =>
                          prev.map((entry) =>
                            entry.id === row.id ? { ...entry, amount: e.target.value } : entry
                          )
                        )
                      }
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    {balances.length > 1 && (
                      <Button variant="outline" onClick={() => removeBalanceRow(row.id)}>
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              <Button variant="outline" onClick={addBalanceRow}>
                Add Payment Method
              </Button>
            </div>
          </>
        )}
      </div>

      <div className="text-sm text-muted-foreground">
        Submitted by: <span className="font-medium text-foreground">{submittedBy}</span>
      </div>

      {onSubmit && (
        <div className="flex items-center justify-end">
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || labReadyCases.length > 0}
            title={
              labReadyCases.length > 0
                ? `Clear ${labReadyCases.length} pending lab expense(s) first`
                : undefined
            }
          >
            {isSubmitting ? 'Submitting...' : 'Submit Report'}
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Lab expense row ──────────────────────────────────────────────────────────
// Inline payment-method picker + amount field per pending lab case. The
// amount defaults to the case's labCost; receptionist confirms (or adjusts)
// and clicks Record to fire clearLabExpense().

function LabExpenseRow({
  labCase,
  clearing,
  onClear,
}: {
  labCase: LabExpenseReadyCase
  clearing: boolean
  onClear: (amount: number, paymentMethod: string) => void
}) {
  // labCase.labCost/cost are integer CENTS (like every other money column);
  // centsToInput renders them as the cedis string this field edits.
  const defaultAmount = centsToInput(labCase.labCost ?? labCase.cost ?? 0)
  const [amount, setAmount] = useState(defaultAmount)
  const [method, setMethod] = useState<string>('')

  const patientName = labCase.patient?.name ?? labCase.externalPatientName ?? 'Patient'
  const vendorName = labCase.vendor?.name ?? 'Lab'

  function submit() {
    const amt = inputToCents(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Enter a valid amount.')
      return
    }
    if (!method) {
      toast.error('Pick a payment method.')
      return
    }
    onClear(amt, method)
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_120px_140px_auto] gap-2 px-3 py-2 items-center">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">
          {labCase.caseNumber} · {labCase.serviceName}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          To {vendorName} · for {patientName}
        </p>
      </div>
      <Input
        type="number"
        step="0.01"
        min={0}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="h-8 text-sm"
      />
      <PaymentMethodSelect
        value={method}
        onValueChange={setMethod}
        className="h-8 text-sm"
        placeholder="Method"
      />
      <Button type="button" size="sm" onClick={submit} disabled={clearing} className="shrink-0">
        {clearing ? 'Recording…' : 'Record'}
      </Button>
    </div>
  )
}
