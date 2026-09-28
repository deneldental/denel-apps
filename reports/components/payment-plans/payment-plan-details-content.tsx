import type { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import { Calendar, ChevronLeft, CreditCard, DollarSign } from 'lucide-react'
import { Link } from 'react-router-dom'
import { DataTable } from '@/components/data-table/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils/currency'

interface Payment {
  id: string
  amount: number
  method: string
  status: string
  createdAt: Date
  balance: number | null
}

interface PaymentPlan {
  id: string
  type: string
  totalAmount: number
  amountPerInstallment: number | null
  paymentFrequency: string | null
  startDate: Date
  status: string
  notes: string | null
  patient: {
    id: string
    name: string
    phone: string | null
    email: string | null
  }
  payments: Payment[]
}

interface PaymentPlanDetailsContentProps {
  plan: PaymentPlan
}

export function PaymentPlanDetailsContent({ plan }: PaymentPlanDetailsContentProps) {
  const totalPaid = plan.payments.reduce((sum, payment) => sum + payment.amount, 0)
  const balance = plan.totalAmount - totalPaid

  const paymentColumns: ColumnDef<Payment>[] = [
    {
      accessorKey: 'createdAt',
      header: 'Date',
      cell: ({ row }) => format(new Date(row.original.createdAt), 'MMM d, yyyy'),
    },
    {
      accessorKey: 'amount',
      header: 'Amount',
      cell: ({ row }) => formatCurrency(row.original.amount),
    },
    {
      accessorKey: 'method',
      header: 'Method',
      cell: ({ row }) => (
        <Badge variant="outline" className="capitalize">
          {row.original.method}
        </Badge>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <Badge
          variant={row.original.status === 'completed' ? 'default' : 'secondary'}
          className="capitalize"
        >
          {row.original.status}
        </Badge>
      ),
    },
    {
      accessorKey: 'balance',
      header: 'Balance After',
      cell: ({ row }) =>
        row.original.balance !== null ? formatCurrency(row.original.balance) : 'N/A',
    },
  ]

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/finance/payments" className="hover:text-foreground">
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
            View payment plan information and transaction history
          </p>
        </div>
        <Link to="/finance/payments">
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
            <div className="text-2xl font-bold">{formatCurrency(plan.totalAmount)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Paid</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalPaid)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Balance</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(balance)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Status</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <Badge
              variant={plan.status === 'completed' ? 'default' : 'secondary'}
              className="capitalize"
            >
              {plan.status}
            </Badge>
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
              <Link to={`/patient-records/${plan.patient.id}`} className="hover:underline">
                <p className="text-base font-medium">{plan.patient.name}</p>
              </Link>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Plan Type</p>
              <Badge variant="outline" className="capitalize">
                {plan.type}
              </Badge>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Start Date</p>
              <p>{format(new Date(plan.startDate), 'MMMM d, yyyy')}</p>
            </div>
            {plan.type === 'fixed' && (
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
                  <p className="capitalize">{plan.paymentFrequency || 'N/A'}</p>
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
            All payments made towards this plan ({plan.payments.length} total)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable columns={paymentColumns} data={plan.payments} />
        </CardContent>
      </Card>
    </div>
  )
}
