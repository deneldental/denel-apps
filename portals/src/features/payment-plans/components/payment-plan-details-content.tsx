import { format, parseISO } from 'date-fns'
import { Calendar, ChevronLeft, CreditCard, DollarSign, Receipt } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  type ReceiptDataShape,
  ReceiptViewDialog,
} from '@/features/payments/components/receipt-view-dialog'
import type { PaymentPlanDetail, PaymentPlanHistoryPayment } from '@/lib/actions/payment-plans'
import { api } from '@/lib/api-client'
import { Badge } from '@/shared/components/ui/badge'
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

interface PaymentPlanDetailsContentProps {
  plan: PaymentPlanDetail
}

/** A payment's own date when it has one (a plain date), otherwise when it was recorded. */
function paymentDay(p: PaymentPlanHistoryPayment): string {
  const day = p.paymentDate ? parseISO(p.paymentDate) : new Date(p.createdAt)
  return Number.isNaN(day.getTime()) ? '—' : format(day, 'MMM d, yyyy')
}

const PAYMENT_STATUS: Record<PaymentPlanHistoryPayment['status'], string> = {
  posted: 'Posted',
  reversed: 'Reversed',
}

export function PaymentPlanDetailsContent({ plan }: PaymentPlanDetailsContentProps) {
  const [receipt, setReceipt] = useState<ReceiptDataShape | null>(null)
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  async function openReceipt(paymentId: string) {
    setLoadingId(paymentId)
    const res = await api.get<ReceiptDataShape>(`/api/payments/${paymentId}/receipt`)
    setLoadingId(null)
    if (!res.success || !res.data) {
      toast.error('Failed to load receipt')
      return
    }
    setReceipt(res.data)
    setReceiptOpen(true)
  }

  const { totals } = plan
  const frequency = plan.paymentFrequency ?? plan.installmentPeriod
  const isFixed = (plan.scheduleType ?? plan.type) === 'fixed'

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/payments" className="hover:text-foreground">
          Payments
        </Link>
        <span>/</span>
        <span className="text-foreground">Payment Plan Details</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payment Plan Details</h1>
          <p className="text-muted-foreground">
            {plan.planNumber ? `${plan.planNumber} · ` : ''}
            View payment plan information and transaction history
          </p>
        </div>
        <Link to="/payments">
          <Button variant="outline">
            <ChevronLeft className="mr-2 h-4 w-4" />
            Back to Payments
          </Button>
        </Link>
      </div>

      {/* Plan Info Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Amount</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="plan-total">
              {formatCurrency(totals.total)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Paid</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="plan-paid">
              {formatCurrency(totals.paid)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Balance</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="plan-balance">
              {formatCurrency(totals.balance)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Status</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="flex items-center gap-2">
            <Badge
              variant={
                plan.status === 'completed'
                  ? 'default'
                  : plan.status === 'overdue'
                    ? 'destructive'
                    : 'secondary'
              }
              className="capitalize"
            >
              {plan.status}
            </Badge>
            {plan.archived && <Badge variant="outline">Archived</Badge>}
          </CardContent>
        </Card>
      </div>

      {/* Plan Details */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Plan Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Patient</p>
              <Link to={`/patients/${plan.patient.id}`} className="hover:underline">
                <p className="text-base font-medium">{plan.patient.name}</p>
              </Link>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Plan Type</p>
              <Badge variant="outline" className="capitalize">
                {plan.scheduleType ?? plan.type}
              </Badge>
            </div>
            {plan.invoice && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">Master Invoice</p>
                <p>
                  {plan.invoice.invoiceNumber}{' '}
                  <span className="text-sm capitalize text-muted-foreground">
                    ({plan.invoice.status.replace(/_/g, ' ')})
                  </span>
                </p>
              </div>
            )}
            <div>
              <p className="text-sm font-medium text-muted-foreground">Start Date</p>
              <p>{format(new Date(plan.startDate), 'MMMM d, yyyy')}</p>
            </div>
            {isFixed && (
              <>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Amount Per Installment
                  </p>
                  <p>
                    {plan.amountPerInstallment ? formatCurrency(plan.amountPerInstallment) : 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Payment Frequency</p>
                  <p className="capitalize">{frequency || 'N/A'}</p>
                </div>
              </>
            )}
            {plan.notes && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">Notes</p>
                <p className="text-sm">{plan.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contact Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Phone</p>
              <p>{plan.patient.phone || 'N/A'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Email</p>
              <p>{plan.patient.email || 'N/A'}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Payment History */}
      <Card>
        <CardHeader>
          <CardTitle>Payment History</CardTitle>
          <CardDescription>
            Payments applied to this plan ({plan.payments.length} total). A reversed payment is
            shown for the record and is not counted in Total Paid.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {plan.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments have been made yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Applied to plan</TableHead>
                  <TableHead className="w-24 text-right">Receipt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.payments.map((p) => (
                  <TableRow key={p.id} data-testid={`payment-${p.id}`}>
                    <TableCell>{paymentDay(p)}</TableCell>
                    <TableCell className="font-mono text-sm">{p.paymentNumber ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {p.method.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.status === 'posted' ? 'default' : 'destructive'}>
                        {PAYMENT_STATUS[p.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(p.amount)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {p.appliedToPlan > 0 ? formatCurrency(p.appliedToPlan) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {/* Like the patient ledger, a receipt is offered for money that was received:
                          a reversed payment was handed back, and its receipt would read as paid. */}
                      {p.status === 'posted' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`View receipt for ${p.paymentNumber ?? 'payment'}`}
                          disabled={loadingId === p.id}
                          onClick={() => void openReceipt(p.id)}
                        >
                          <Receipt className="h-4 w-4" />
                        </Button>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {receipt && (
        <ReceiptViewDialog
          open={receiptOpen}
          onOpenChange={(o) => {
            setReceiptOpen(o)
            if (!o) setReceipt(null)
          }}
          receiptData={receipt}
        />
      )}
    </div>
  )
}
