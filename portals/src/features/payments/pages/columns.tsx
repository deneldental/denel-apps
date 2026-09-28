import type { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import { Eye, MoreHorizontal, Printer, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  type ReceiptDataShape,
  ReceiptViewDialog,
} from '@/features/payments/components/receipt-view-dialog'
import { ReversePaymentDialog } from '@/features/payments/components/reverse-payment-dialog'
import { getPaymentPlanByPatientId } from '@/lib/actions/payment-plans'
import { deletePayment, getPaymentsByPatientId } from '@/lib/actions/payments'
import { useBranding } from '@/lib/branding-context'
import type { paymentPlans, payments } from '@/lib/db/schema'
import { useCan } from '@/lib/permissions-context'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { formatCurrency } from '@/shared/utils/currency'

export type PaymentPlan = typeof paymentPlans.$inferSelect & {
  patient?: {
    id: string
    name: string
    phone: string | null
    patientId: string | null
  } | null
}
export type Payment = typeof payments.$inferSelect & {
  patient?: {
    id: string
    name: string
    phone: string | null
  } | null
  paymentPlan?: {
    id: string
    notes: string | null
    totalAmount: number
    type?: string | null
  } | null
}

type PaymentPlanActionsCellProps = {
  row: {
    original: PaymentPlan
  }
}

function PaymentPlanActionsCell({ row }: PaymentPlanActionsCellProps) {
  const navigate = useNavigate()
  return (
    <Button variant="ghost" size="sm" onClick={() => navigate(`/payment-plans/${row.original.id}`)}>
      <Eye className="mr-2 h-4 w-4" />
      View Details
    </Button>
  )
}

export const activePaymentPlanColumns: ColumnDef<PaymentPlan>[] = [
  {
    accessorKey: 'createdAt',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
    cell: ({ row }) => {
      const date = row.getValue('createdAt') as Date
      return <div>{new Date(date).toLocaleDateString()}</div>
    },
  },
  {
    accessorKey: 'patient.name',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Patient" />,
    cell: ({ row }) => {
      const patientId = row.original.patient?.id
      const name = row.original.patient?.name || 'Unknown'

      if (patientId) {
        return (
          <Link to={`/patients/${patientId}`} className="hover:underline text-primary font-medium">
            {name}
          </Link>
        )
      }
      return <div>{name}</div>
    },
  },
  {
    accessorKey: 'patient.patientId',
    id: 'patientId',
    header: ({ column }) => <DataTableColumnHeader column={column} title="ID" />,
    cell: ({ row }) => {
      return <div>{row.original.patient?.patientId || '-'}</div>
    },
  },
  {
    accessorKey: 'totalAmount',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Total Amount" />,
    cell: ({ row }) => {
      const amount = row.getValue('totalAmount') as number
      return <div className="font-medium">{formatCurrency(amount)}</div>
    },
  },
  {
    accessorKey: 'amountPerInstallment',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Installment" />,
    cell: ({ row }) => {
      const amount = row.getValue('amountPerInstallment') as number
      return <div>{formatCurrency(amount)}</div>
    },
  },
  {
    accessorKey: 'paymentFrequency',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Frequency" />,
    cell: ({ row }) => {
      const frequency = row.getValue('paymentFrequency') as string
      return <div className="capitalize">{frequency}</div>
    },
  },
  {
    accessorKey: 'status',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    cell: ({ row }) => {
      const status = row.getValue('status') as string
      return (
        <Badge
          variant={
            status === 'completed' ? 'success' : status === 'overdue' ? 'destructive' : 'warning'
          }
        >
          {status}
        </Badge>
      )
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => <PaymentPlanActionsCell row={row} />,
  },
]

// Helper function to parse description into treatment types and additional notes
function parseDescription(description: string | null): {
  treatmentTypes: string
  additionalNotes: string | null
} {
  if (!description) {
    return { treatmentTypes: '-', additionalNotes: null }
  }

  // Remove the ledger adjustment audit note from UI displays
  let cleanDescription = description.replace(/\s*\|\s*\[Ledger Adjustment by.*?\]/g, '')
  cleanDescription = cleanDescription.replace(/\[Ledger Adjustment by.*?\]/g, '').trim()

  if (!cleanDescription) {
    return { treatmentTypes: '-', additionalNotes: null }
  }

  // Split by " - " to separate treatment types from additional notes
  const parts = cleanDescription.split(' - ')
  const treatmentTypes = parts[0] || '-'
  const additionalNotes = parts.length > 1 ? parts.slice(1).join(' - ') : null

  return { treatmentTypes, additionalNotes }
}

// Derive a human-readable service label from the treatments array on a payment.
// Falls back to the description field, then 'Service Payment'.
function getServiceLabel(
  treatments: Array<{ treatmentId: string; name: string; amount: number }> | null | undefined,
  description: string | null | undefined
): string {
  if (treatments && treatments.length > 0) {
    return (
      treatments
        .map((t) => t.name)
        .filter(Boolean)
        .join(', ') || 'Service Payment'
    )
  }
  if (description) {
    const { treatmentTypes } = parseDescription(description)
    return treatmentTypes !== '-' ? treatmentTypes : 'Service Payment'
  }
  return 'Service Payment'
}

async function resolvePaymentPlanBalance(
  patientId: string,
  storedBalance: number | null | undefined
): Promise<{ total: number | undefined; balance: number | undefined }> {
  // getPaymentPlanByPatientId returns every plan for the patient (array, not
  // single) — take the most recent active one, matching the backend's
  // `orderBy: desc(createdAt)` + default archived=false filter.
  if (storedBalance != null) {
    const planResult = await getPaymentPlanByPatientId(patientId)
    const plan = planResult.success ? planResult.data?.[0] : undefined
    return {
      total: plan?.totalAmount,
      balance: storedBalance,
    }
  }

  const [planResult, paymentsResult] = await Promise.all([
    getPaymentPlanByPatientId(patientId),
    getPaymentsByPatientId(patientId),
  ])

  const plan = planResult.success ? planResult.data?.[0] : undefined
  if (!plan) {
    return { total: undefined, balance: undefined }
  }

  const completedPayments = paymentsResult.success
    ? paymentsResult.data.filter(
        (p) => (p.status === 'posted' || p.status === 'completed') && p.paymentPlanId === plan.id
      )
    : []
  const totalPaid = completedPayments.reduce((sum, p) => sum + p.amount, 0)

  return {
    total: plan.totalAmount,
    balance: Math.max(0, plan.totalAmount - totalPaid),
  }
}

function PaymentActions({ payment, onReload }: { payment: Payment; onReload: () => void }) {
  const branding = useBranding()
  // Deleting a settled payment is withheld from the front desk
  // (bundle_payments_only grants read/create/update, never delete). Reversal is
  // the sanctioned correction path and stays available on `payments:update`.
  const canDelete = useCan('payments', 'delete')
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showReceiptDialog, setShowReceiptDialog] = useState(false)
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(false)
  const [showReverseDialog, setShowReverseDialog] = useState(false)
  const [receiptData, setReceiptData] = useState<ReceiptDataShape | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const prepareReceiptData = async (): Promise<ReceiptDataShape | null> => {
    if (!payment.patient) {
      toast.error('Patient information not available')
      return null
    }

    let paymentPlanTotal: number | undefined
    let paymentPlanBalance: number | undefined

    if (payment.paymentPlanId && payment.patientId) {
      const resolved = await resolvePaymentPlanBalance(payment.patientId, payment.balance)
      paymentPlanTotal = resolved.total
      paymentPlanBalance = resolved.balance
    }

    let formattedAppointmentDate: string | undefined
    if (payment.createdAt) {
      try {
        const date =
          typeof payment.createdAt === 'string' ? new Date(payment.createdAt) : payment.createdAt
        formattedAppointmentDate = format(date, 'MMMM d, yyyy h:mm a')
      } catch {
        formattedAppointmentDate = undefined
      }
    }

    return {
      patientName: payment.patient.name,
      appointmentDate: formattedAppointmentDate,
      amountPaid: payment.amount,
      totalAmount: paymentPlanTotal,
      balance: paymentPlanBalance,
      paymentType: payment.method,
      paymentFor: getServiceLabel(payment.treatments, payment.description),
      notes: null,
      clinicName: branding.name,
      clinicPhone: branding.phones[0] ?? null,
      clinicAddress: branding.address,
      clinicWebsite: branding.website ?? null,
      generatedAt: new Date().toLocaleString(),
    }
  }

  const loadReceiptData = async (): Promise<ReceiptDataShape | null> => {
    try {
      const { api } = await import('@/lib/api-client')
      const res = await api.get<ReceiptDataShape>(`/api/payments/${payment.id}/receipt`)
      if (res.success && res.data) {
        return res.data
      }
    } catch (error) {
      console.warn('Failed to load backend receipt, falling back to local data:', error)
    }
    return prepareReceiptData()
  }

  const handlePrintReceipt = async () => {
    try {
      setIsLoading(true)
      const data = await loadReceiptData()
      setIsLoading(false)
      if (data) {
        setReceiptData(data)
        setAutoPrintReceipt(true)
        setShowReceiptDialog(true)
      } else {
        toast.error('Failed to load receipt')
      }
    } catch (error) {
      setIsLoading(false)
      console.error('Failed to generate receipt:', error)
      toast.error('Failed to generate receipt')
    }
  }

  const handleViewReceipt = async () => {
    try {
      setIsLoading(true)
      const data = await loadReceiptData()
      setIsLoading(false)
      if (data) {
        setReceiptData(data)
        setAutoPrintReceipt(false)
        setShowReceiptDialog(true)
      } else {
        toast.error('Failed to load receipt')
      }
    } catch (error) {
      setIsLoading(false)
      console.error('Failed to prepare receipt:', error)
      toast.error('Failed to load receipt')
    }
  }

  const handleDelete = async () => {
    setIsLoading(true)
    try {
      const result = await deletePayment(payment.id)
      if (result.success) {
        toast.success('Payment deleted successfully')
        onReload()
      } else {
        toast.error(result.error || 'Failed to delete payment')
      }
    } catch {
      toast.error('An error occurred while deleting the payment')
    } finally {
      setIsLoading(false)
      setShowDeleteDialog(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 w-8 p-0">
            <span className="sr-only">Open menu</span>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              handlePrintReceipt()
            }}
          >
            <Printer className="mr-2 h-4 w-4" />
            Print Receipt
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              handleViewReceipt()
            }}
          >
            <Eye className="mr-2 h-4 w-4" />
            View Receipt
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* Reverse is only meaningful for a posted (GL-settled) payment.
              Legacy rows may still carry 'completed' — accept both; the backend
              is the final authority and rejects anything not currently posted. */}
          {(payment.status === 'posted' || payment.status === 'completed') &&
            payment.direction !== 'outgoing' && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation()
                  setShowReverseDialog(true)
                }}
                className="text-destructive"
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Reverse payment…
              </DropdownMenuItem>
            )}
          {canDelete && (
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                setShowDeleteDialog(true)
              }}
              className="text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteConfirmationDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onConfirm={handleDelete}
        title="Delete Payment"
        description="Are you sure you want to delete this payment? This action cannot be undone."
        itemName={`Payment of ${formatCurrency(payment.amount)}`}
        isLoading={isLoading}
      />
      {receiptData && (
        <ReceiptViewDialog
          open={showReceiptDialog}
          onOpenChange={(open) => {
            setShowReceiptDialog(open)
            if (!open) {
              setAutoPrintReceipt(false)
              setReceiptData(null)
            }
          }}
          receiptData={receiptData}
          autoPrint={autoPrintReceipt}
        />
      )}
      <ReversePaymentDialog
        open={showReverseDialog}
        onOpenChange={setShowReverseDialog}
        paymentId={payment.id}
        paymentLabel={payment.paymentNumber}
        amount={payment.amount}
        onReversed={onReload}
      />
    </>
  )
}

export const getOneTimePaymentColumns = (onReload: () => void): ColumnDef<Payment>[] => [
  {
    accessorKey: 'createdAt',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
    cell: ({ row }) => {
      const date = row.getValue('createdAt') as Date
      return <div>{new Date(date).toLocaleDateString()}</div>
    },
  },
  {
    accessorKey: 'patient.name',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Patient" />,
    cell: ({ row }) => {
      return <div>{row.original.patient?.name || 'Walk-in'}</div>
    },
  },
  {
    accessorKey: 'amount',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" />,
    cell: ({ row }) => {
      const amount = row.getValue('amount') as number
      return <div className="font-medium">{formatCurrency(amount)}</div>
    },
  },
  {
    accessorKey: 'method',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Method" />,
    cell: ({ row }) => {
      const method = row.getValue('method') as string
      return <div className="capitalize">{method.replace('_', ' ')}</div>
    },
  },
  {
    accessorKey: 'status',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    cell: ({ row }) => {
      const status = row.getValue('status') as string
      return (
        <Badge
          variant={
            status === 'completed'
              ? 'success'
              : status === 'pending'
                ? 'warning'
                : status === 'failed'
                  ? 'destructive'
                  : 'outline'
          }
        >
          {status}
        </Badge>
      )
    },
  },
  {
    accessorKey: 'description',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Service Categories" />,
    cell: ({ row }) => {
      const description = row.getValue('description') as string | null
      const { treatmentTypes } = parseDescription(description)
      return <div>{treatmentTypes}</div>
    },
  },
  {
    id: 'additionalNotes',
    accessorFn: (row) => {
      const { additionalNotes } = parseDescription(row.description)
      return additionalNotes
    },
    header: ({ column }) => <DataTableColumnHeader column={column} title="Additional Notes" />,
    cell: ({ row }) => {
      const description = row.original.description
      const { additionalNotes } = parseDescription(description)
      return <div className="text-muted-foreground">{additionalNotes || '-'}</div>
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => {
      return <PaymentActions payment={row.original} onReload={onReload} />
    },
  },
]

export const getPlanPaymentColumns = (onReload: () => void): ColumnDef<Payment>[] => [
  {
    accessorKey: 'createdAt',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
    cell: ({ row }) => {
      const date = row.getValue('createdAt') as Date
      return <div>{new Date(date).toLocaleDateString()}</div>
    },
  },
  {
    accessorKey: 'patient.name',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Patient" />,
    cell: ({ row }) => {
      return <div>{row.original.patient?.name || 'Unknown'}</div>
    },
  },
  {
    // M5 — surface plan type (Fixed / Flexible) so the user can tell at a glance.
    // TODO(backend-wiring): join planType from payment_plans on the payment record.
    id: 'planType',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Plan Type" />,
    cell: ({ row }) => {
      const planType = row.original.paymentPlan?.type
      if (!planType) {
        return <span className="text-xs text-muted-foreground">—</span>
      }
      return (
        <Badge variant="outline" className="capitalize">
          {planType}
        </Badge>
      )
    },
  },
  {
    accessorKey: 'amount',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" />,
    cell: ({ row }) => {
      const amount = row.getValue('amount') as number
      return <div className="font-medium">{formatCurrency(amount)}</div>
    },
  },
  {
    accessorKey: 'method',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Method" />,
    cell: ({ row }) => {
      const method = row.getValue('method') as string
      return <div className="capitalize">{method.replace('_', ' ')}</div>
    },
  },
  {
    accessorKey: 'status',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    cell: ({ row }) => {
      const status = row.getValue('status') as string
      return (
        <Badge
          variant={
            status === 'completed'
              ? 'success'
              : status === 'pending'
                ? 'warning'
                : status === 'failed'
                  ? 'destructive'
                  : 'outline'
          }
        >
          {status}
        </Badge>
      )
    },
  },
  {
    accessorKey: 'description',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Service Categories" />,
    cell: ({ row }) => {
      const description = row.getValue('description') as string | null
      const { treatmentTypes } = parseDescription(description)
      return <div>{treatmentTypes}</div>
    },
  },
  {
    id: 'additionalNotes',
    accessorFn: (row) => {
      const { additionalNotes } = parseDescription(row.description)
      return additionalNotes
    },
    header: ({ column }) => <DataTableColumnHeader column={column} title="Additional Notes" />,
    cell: ({ row }) => {
      const description = row.original.description
      const { additionalNotes } = parseDescription(description)
      return <div className="text-muted-foreground">{additionalNotes || '-'}</div>
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => {
      return <PaymentActions payment={row.original} onReload={onReload} />
    },
  },
]
