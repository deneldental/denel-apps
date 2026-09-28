import { formatCurrency } from '@denel/utils'
import type { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import { Eye, MoreHorizontal, Printer } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { ReceiptViewDialog } from '@/components/payments/receipt-view-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getPaymentPlanByPatientId } from '@/lib/actions/payment-plans'
import { getPaymentsByPatientId } from '@/lib/actions/payments'
import { generatePaymentReceipt } from '@/lib/utils/receipt'

export type PaymentPlan = {
  id: string
  patientId: string
  templateId: string | null
  totalAmount: number
  amountPerInstallment: number
  paymentFrequency: string
  numberOfInstallments: number
  status: string
  startDate: Date | string | null
  endDate: Date | string | null
  notes: string | null
  createdAt: Date | string
  updatedAt: Date | string
} & {
  patient?: {
    id: string
    name: string
    phone: string | null
    patientId: string | null
  } | null
}

export type Payment = {
  id: string
  patientId: string | null
  appointmentId: string | null
  paymentPlanId: string | null
  amount: number
  method: string
  status: string
  description: string | null
  balance: number | null
  recordedById: string | null
  createdAt: Date | string
  updatedAt: Date | string
} & {
  patient?: {
    id: string
    name: string
    phone: string | null
  } | null
  paymentPlan?: {
    id: string
    notes: string | null
    totalAmount: number
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
    <Button
      variant="ghost"
      size="sm"
      onClick={() => navigate(`/finance/payment-plans/${row.original.id}`)}
    >
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
          <Link
            to={`/patient-records/${patientId}`}
            className="hover:underline text-primary font-medium"
          >
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
      const formatted = formatCurrency(amount)
      return <div className="font-medium">{formatted}</div>
    },
  },
  {
    accessorKey: 'amountPerInstallment',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Installment" />,
    cell: ({ row }) => {
      const amount = row.getValue('amountPerInstallment') as number
      const formatted = formatCurrency(amount)
      return <div>{formatted}</div>
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
            status === 'completed' ? 'default' : status === 'overdue' ? 'destructive' : 'secondary'
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

  // Split by " - " to separate treatment types from additional notes
  const parts = description.split(' - ')
  const treatmentTypes = parts[0] || '-'
  const additionalNotes = parts.length > 1 ? parts.slice(1).join(' - ') : null

  return { treatmentTypes, additionalNotes }
}

function PaymentActions({ payment }: { payment: Payment }) {
  const [showReceiptDialog, setShowReceiptDialog] = useState(false)
  interface ReceiptData {
    patientName: string
    appointmentDate?: string
    amountPaid: number
    totalAmount?: number
    balance?: number
    paymentType: string
    paymentFor: string
    notes: string | null
    clinicName: string
    clinicPhone: string | null
    clinicAddress: string | null
    generatedAt: string
  }
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null)

  const handlePrintReceipt = async () => {
    try {
      if (!payment.patient) {
        toast.error('Patient information not available')
        return
      }

      let paymentPlanTotal: number | undefined
      let paymentPlanBalance: number | undefined

      // If it's a plan payment, use stored balance or calculate it
      if (payment.paymentPlanId && payment.patientId) {
        // Use stored balance if available (for older receipts)
        if (payment.balance !== null && payment.balance !== undefined) {
          paymentPlanBalance = payment.balance

          // Still need total amount for display
          const planResult = await getPaymentPlanByPatientId(payment.patientId)
          if (planResult.success && planResult.data) {
            paymentPlanTotal = planResult.data.totalAmount
          }
        } else {
          // Calculate balance for newer payments without stored balance
          const [planResult, paymentsResult] = await Promise.all([
            getPaymentPlanByPatientId(payment.patientId),
            getPaymentsByPatientId(payment.patientId),
          ])

          if (planResult.success && planResult.data) {
            paymentPlanTotal = planResult.data.totalAmount

            // Calculate balance: total - all completed payments for this plan (including current payment)
            const completedPayments =
              paymentsResult.success && paymentsResult.data
                ? paymentsResult.data.filter(
                    (p) => p.status === 'completed' && p.paymentPlanId === planResult.data?.id
                  )
                : []
            const totalPaid = completedPayments.reduce((sum, p) => sum + p.amount, 0)
            // Balance after all payments including this one
            paymentPlanBalance = planResult.data.totalAmount - totalPaid
          }
        }
      }

      generatePaymentReceipt({
        patientName: payment.patient.name,
        amountPaid: payment.amount,
        paymentMethod: payment.method,
        description:
          payment.paymentPlanId && payment.paymentPlan
            ? payment.description || payment.paymentPlan.notes || undefined // Use payment description or fallback to plan notes
            : payment.description || undefined, // For one-time payments, use description
        appointmentDate: payment.createdAt,
        paymentPlanTotal,
        paymentPlanBalance,
        paymentType: payment.paymentPlanId ? 'plan' : 'one-time',
        autoPrint: true,
      })
    } catch (error) {
      console.error('Failed to generate receipt:', error)
      toast.error('Failed to generate receipt')
    }
  }

  const prepareReceiptData = async () => {
    if (!payment.patient) {
      toast.error('Patient information not available')
      return null
    }

    let paymentPlanTotal: number | undefined
    let paymentPlanBalance: number | undefined

    // If it's a plan payment, use stored balance or calculate it
    if (payment.paymentPlanId && payment.patientId) {
      // Use stored balance if available (for older receipts)
      if (payment.balance !== null && payment.balance !== undefined) {
        paymentPlanBalance = payment.balance

        // Still need total amount for display
        const planResult = await getPaymentPlanByPatientId(payment.patientId)
        if (planResult.success && planResult.data) {
          paymentPlanTotal = planResult.data.totalAmount
        }
      } else {
        // Calculate balance for newer payments without stored balance
        const [planResult, paymentsResult] = await Promise.all([
          getPaymentPlanByPatientId(payment.patientId),
          getPaymentsByPatientId(payment.patientId),
        ])

        if (planResult.success && planResult.data) {
          paymentPlanTotal = planResult.data.totalAmount

          // Calculate balance: total - all completed payments for this plan (including current payment)
          const completedPayments =
            paymentsResult.success && paymentsResult.data
              ? paymentsResult.data.filter(
                  (p) => p.status === 'completed' && p.paymentPlanId === planResult.data?.id
                )
              : []
          const totalPaid = completedPayments.reduce((sum, p) => sum + p.amount, 0)
          // Balance after all payments including this one
          paymentPlanBalance = planResult.data.totalAmount - totalPaid
        }
      }
    }

    // Format appointment date
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

    // Convert cents to GHS
    const amountPaidGHS = payment.amount
    const totalAmountGHS = paymentPlanTotal ? paymentPlanTotal : undefined
    const balanceGHS = paymentPlanBalance !== undefined ? paymentPlanBalance : undefined

    return {
      patientName: payment.patient.name,
      appointmentDate: formattedAppointmentDate,
      amountPaid: amountPaidGHS,
      totalAmount: totalAmountGHS,
      balance: balanceGHS,
      paymentType: payment.method,
      paymentFor: payment.paymentPlanId
        ? 'Ortho Payment'
        : payment.description || 'Service Payment',
      notes: payment.description || null,
      clinicName: import.meta.env.VITE_CLINIC_NAME || 'Denel Dental Clinic',
      clinicPhone: import.meta.env.VITE_CLINIC_PHONE || null,
      clinicAddress: import.meta.env.VITE_CLINIC_ADDRESS || null,
      generatedAt: new Date().toLocaleString(),
    }
  }

  const handleViewReceipt = async () => {
    try {
      const data = await prepareReceiptData()
      if (data) {
        setReceiptData(data)
        setShowReceiptDialog(true)
      }
    } catch (error) {
      console.error('Failed to prepare receipt:', error)
      toast.error('Failed to load receipt')
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
        </DropdownMenuContent>
      </DropdownMenu>
      {receiptData && (
        <ReceiptViewDialog
          open={showReceiptDialog}
          onOpenChange={setShowReceiptDialog}
          receiptData={receiptData}
        />
      )}
    </>
  )
}

export const oneTimePaymentColumns: ColumnDef<Payment>[] = [
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
      const formatted = formatCurrency(amount)
      return <div className="font-medium">{formatted}</div>
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
              ? 'default'
              : status === 'pending'
                ? 'secondary'
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
      return <PaymentActions payment={row.original} />
    },
  },
]

export const planPaymentColumns: ColumnDef<Payment>[] = [
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
    accessorKey: 'amount',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" />,
    cell: ({ row }) => {
      const amount = row.getValue('amount') as number
      const formatted = formatCurrency(amount)
      return <div className="font-medium">{formatted}</div>
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
              ? 'default'
              : status === 'pending'
                ? 'secondary'
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
      return <PaymentActions payment={row.original} />
    },
  },
]
