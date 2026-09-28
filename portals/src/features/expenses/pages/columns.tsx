import { useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import { Eye, Lock, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { EditExpenseSheet } from '@/features/expenses/components/edit-expense-sheet'
import { deleteExpense } from '@/lib/actions/expenses'
import type { expenses } from '@/lib/db/schema'
import { queryKeys } from '@/lib/query-keys'
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

export type Expense = typeof expenses.$inferSelect

function ExpenseActions({ expense }: { expense: Expense }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const handleDelete = async () => {
    const result = await deleteExpense(expense.id)

    if (result.success) {
      toast.success('Expense deleted successfully')
      queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all })
    } else {
      toast.error(result.error || 'Failed to delete expense')
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
          <DropdownMenuItem onClick={() => navigate(`/expenses/view/${expense.id}`)}>
            <Eye className="mr-2 h-4 w-4" />
            View Details
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShowEditDialog(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setShowDeleteDialog(true)} className="text-destructive">
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {showEditDialog && (
        <EditExpenseSheet
          expense={expense}
          open={showEditDialog}
          onOpenChange={setShowEditDialog}
        />
      )}

      {showDeleteDialog && (
        <DeleteConfirmationDialog
          open={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
          onConfirm={handleDelete}
          title="Delete Expense"
          description="Are you sure you want to delete this expense? This action cannot be undone."
          itemName={`${expense.category} - ${formatCurrency(expense.amount)}`}
        />
      )}
    </>
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
      // M5.6 — show a muted lock icon for expenses attached to a daily report.
      // Visible to all roles; title-attribute doubles as accessible label.
      const isLocked = Boolean(row.original.dailyReportId)
      return (
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="capitalize">
            {category}
          </Badge>
          {isLocked && (
            <span
              role="img"
              aria-label="Locked — attached to a daily report"
              title="Locked — attached to a daily report"
              className="inline-flex"
            >
              <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            </span>
          )}
        </div>
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
      return <div className="font-medium">{formatCurrency(amount)}</div>
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
