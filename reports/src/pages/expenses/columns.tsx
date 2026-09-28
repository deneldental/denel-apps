import { formatCurrency } from '@denel/utils'
import type { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import { Eye } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export type Expense = {
  id: string
  date: Date | string
  amount: number
  category: string
  description: string | null
  paidTo: string | null
  paymentMethod: string | null
  attachmentUrl: string | null
  recordedById: string | null
  createdAt: Date | string
  updatedAt: Date | string
}

function ExpenseActions({ expense }: { expense: Expense }) {
  const navigate = useNavigate()

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => navigate(`/finance/expenses/view/${expense.id}`)}
    >
      <Eye className="mr-2 h-4 w-4" />
      View Details
    </Button>
  )
}

export const columns: ColumnDef<Expense>[] = [
  {
    accessorKey: 'date',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
    cell: ({ row }) => {
      const date = row.getValue('date') as Date
      return <div>{format(new Date(date), 'MMM d, yyyy')}</div>
    },
  },
  {
    accessorKey: 'category',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
    cell: ({ row }) => {
      const category = row.getValue('category') as string
      return (
        <Badge variant="outline" className="capitalize">
          {category}
        </Badge>
      )
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id))
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
    accessorKey: 'description',
    id: 'description',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Description" />,
    cell: ({ row }) => {
      const description = row.getValue('description') as string
      return <div className="max-w-[300px] truncate">{description || '-'}</div>
    },
  },
  {
    accessorKey: 'paidTo',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Paid To" />,
    cell: ({ row }) => {
      const paidTo = row.getValue('paidTo') as string
      return <div>{paidTo || '-'}</div>
    },
  },
  {
    accessorKey: 'paymentMethod',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Payment Method" />,
    cell: ({ row }) => {
      const method = row.getValue('paymentMethod') as string
      return <div className="capitalize">{method ? method.replace('_', ' ') : '-'}</div>
    },
  },
  {
    accessorKey: 'attachmentUrl',
    header: 'Attachment',
    cell: ({ row }) => {
      const url = row.getValue('attachmentUrl') as string | null
      if (!url) return <div className="text-muted-foreground">-</div>
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline text-sm"
        >
          Download
        </a>
      )
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => {
      return <ExpenseActions expense={row.original} />
    },
  },
]
