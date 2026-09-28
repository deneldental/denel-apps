import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { CheckCircle2, Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  PendingConfirmationsTab,
  usePendingConfirmations,
} from '@/features/app-payments/components/pending-confirmations-tab'
import { AcceptPaymentSheet } from '@/features/payments/components/accept-payment-sheet'
import { getOneTimePaymentColumns, getPlanPaymentColumns } from '@/features/payments/pages/columns'
import { getPayments } from '@/lib/actions/payments'
import { api } from '@/lib/api-client'
import { queryKeys } from '@/lib/query-keys'
import { DataTable } from '@/shared/components/data-table/data-table'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { formatCurrency } from '@/shared/utils/currency'

type OutstandingInvoice = {
  id: string
  invoiceNumber: string
  type: string
  status: string
  amount: number
  paidAmount: number
  dueDate: string | null
  patient: { id: string; name: string; patientId: string | null; phone: string | null } | null
  plan: { id: string; type: string } | null
}

const AGING_STATUS_VARIANT: Record<
  string,
  'default' | 'success' | 'warning' | 'destructive' | 'outline'
> = {
  pending: 'warning',
  partial: 'default',
  paid: 'success',
  overdue: 'destructive',
  waived: 'outline',
}

export default function ClinicLedgerPage() {
  const queryClient = useQueryClient()
  const [showAcceptDialog, setShowAcceptDialog] = useState(false)

  const {
    data: outstanding = [],
    isLoading: outstandingLoading,
    isFetching: outstandingFetching,
  } = useQuery({
    queryKey: queryKeys.clinicLedger.outstanding(),
    queryFn: async () => {
      const res = await api.get<OutstandingInvoice[]>('/api/clinic-ledger/outstanding')
      return res.success && res.data ? res.data : []
    },
  })

  const { data: allPayments = [], isLoading: paymentsLoading } = useQuery({
    queryKey: queryKeys.payments.list(),
    queryFn: async () => {
      const res = await getPayments()
      return res.success ? (res.data ?? []) : []
    },
  })

  const { data: pendingRequests = [] } = usePendingConfirmations()

  const oneTimePayments = allPayments.filter((p: any) => !p.paymentPlanId)
  const planPayments = allPayments.filter((p: any) => p.paymentPlanId)

  function refresh() {
    queryClient.invalidateQueries({ queryKey: queryKeys.clinicLedger.all })
    queryClient.invalidateQueries({ queryKey: queryKeys.payments.all })
  }

  const refreshing = outstandingFetching

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payments & Ledger</h1>
          <p className="text-muted-foreground">Payment records and outstanding invoices.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            disabled={refreshing}
            aria-label="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
          <Button onClick={() => setShowAcceptDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Accept Payment
          </Button>
        </div>
      </div>

      <AcceptPaymentSheet
        open={showAcceptDialog}
        onOpenChange={setShowAcceptDialog}
        onSuccess={() => {
          setShowAcceptDialog(false)
          refresh()
        }}
      />

      <Tabs defaultValue="one-time" className="w-full">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="one-time">One-time Payments</TabsTrigger>
          <TabsTrigger value="transactions">Plan Transactions</TabsTrigger>
          <TabsTrigger value="outstanding-invoices">Outstanding Invoices</TabsTrigger>
          <TabsTrigger value="pending-requests" className="gap-1.5">
            Pending Requests
            {pendingRequests.length > 0 && (
              <Badge variant="warning" className="px-1.5 py-0 text-xs">
                {pendingRequests.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="one-time" className="mt-4">
          {paymentsLoading ? (
            <Skeleton className="h-40 w-full rounded-xl" />
          ) : (
            <DataTable
              columns={getOneTimePaymentColumns(refresh)}
              data={oneTimePayments}
              initialColumnVisibility={{ additionalNotes: false }}
            />
          )}
        </TabsContent>

        <TabsContent value="transactions" className="mt-4">
          {paymentsLoading ? (
            <Skeleton className="h-40 w-full rounded-xl" />
          ) : (
            <DataTable
              columns={getPlanPaymentColumns(refresh)}
              data={planPayments}
              initialColumnVisibility={{ additionalNotes: false }}
            />
          )}
        </TabsContent>

        <TabsContent value="pending-requests" className="mt-4">
          <PendingConfirmationsTab onChanged={refresh} />
        </TabsContent>

        <TabsContent value="outstanding-invoices" className="mt-4">
          {outstandingLoading ? (
            <Skeleton className="h-40 w-full rounded-xl" />
          ) : outstanding.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-500/40" />
              <p className="font-medium text-muted-foreground">All invoices are settled</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Paid</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outstanding.map((inv) => {
                    const balance = inv.amount - inv.paidAmount
                    const overdue = inv.dueDate && new Date(inv.dueDate) < new Date()
                    return (
                      <TableRow key={inv.id}>
                        <TableCell className="font-mono text-xs">{inv.invoiceNumber}</TableCell>
                        <TableCell>
                          {inv.patient ? (
                            <>
                              <Link
                                to={`/patients/${inv.patient.id}`}
                                className="text-sm font-medium hover:underline"
                              >
                                {inv.patient.name}
                              </Link>
                              {inv.patient.patientId && (
                                <p className="text-xs font-mono text-muted-foreground">
                                  {inv.patient.patientId}
                                </p>
                              )}
                            </>
                          ) : (
                            <span className="text-sm text-muted-foreground italic">
                              Unknown patient
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs capitalize">
                          {inv.type.replace('_', ' ')}
                        </TableCell>
                        <TableCell className="text-sm">{formatCurrency(inv.amount)}</TableCell>
                        <TableCell className="text-sm text-emerald-600">
                          {formatCurrency(inv.paidAmount)}
                        </TableCell>
                        <TableCell className="text-sm font-semibold text-red-500">
                          {formatCurrency(balance)}
                        </TableCell>
                        <TableCell
                          className={`text-xs ${overdue ? 'text-red-500 font-medium' : 'text-muted-foreground'}`}
                        >
                          {inv.dueDate ? format(new Date(inv.dueDate), 'MMM d, yyyy') : '—'}
                          {overdue && ' (overdue)'}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={AGING_STATUS_VARIANT[inv.status] ?? 'outline'}
                            className="capitalize text-xs"
                          >
                            {inv.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
