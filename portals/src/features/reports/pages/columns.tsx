import type { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import { Eye, MoreHorizontal, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { deleteDailyReport } from '@/lib/actions/reports'
import type { dailyReports } from '@/lib/db/schema'
import { useCan } from '@/lib/permissions-context'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
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

export type DailyReport = typeof dailyReports.$inferSelect & {
  submittedBy?: { name?: string | null; email?: string | null }
}

function ReportActions({ report, onReload }: { report: DailyReport; onReload: () => void }) {
  const navigate = useNavigate()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  // Deleting a frozen daily summary is admin-only (`reports:delete` is withheld
  // from bundle_reports_submit) — don't render a menu item that 403s.
  const canDelete = useCan('reports', 'delete')

  const handleDelete = async () => {
    const result = await deleteDailyReport(report.id)
    if (result.success) {
      toast.success('Report deleted successfully')
      onReload()
    } else {
      toast.error(result.error || 'Failed to delete report')
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
              navigate(`/reports/${report.id}`)
            }}
          >
            <Eye className="mr-2 h-4 w-4" />
            View Report
          </DropdownMenuItem>
          {canDelete && (
            <>
              <DropdownMenuSeparator />
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
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteConfirmationDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onConfirm={handleDelete}
        title="Delete Report"
        description="Are you sure you want to delete this report? This action cannot be undone."
        itemName={`Report for ${format(new Date(report.reportDate), 'MMM d, yyyy')}`}
      />
    </>
  )
}

export const getDailyReportColumns = (onReload: () => void): ColumnDef<DailyReport>[] => [
  {
    accessorKey: 'reportDate',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
    cell: ({ row }) => {
      const dateValue = row.getValue('reportDate') as Date
      return <div>{format(new Date(dateValue), 'MMM d, yyyy')}</div>
    },
  },
  {
    accessorKey: 'totalPayments',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Payments" />,
    cell: ({ row }) => formatCurrency(row.getValue('totalPayments') as number),
  },
  {
    accessorKey: 'totalExpenses',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Expenses" />,
    cell: ({ row }) => formatCurrency(row.getValue('totalExpenses') as number),
  },
  {
    id: 'submittedBy',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Submitted By" />,
    cell: ({ row }) => {
      const submittedBy = row.original.submittedBy
      return <div>{submittedBy?.name || submittedBy?.email || 'Unknown'}</div>
    },
  },
  {
    accessorKey: 'createdAt',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
    cell: ({ row }) => {
      const dateValue = row.getValue('createdAt') as Date
      return <div>{format(new Date(dateValue), "MMM d, yyyy 'at' h:mm a")}</div>
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => <ReportActions report={row.original} onReload={onReload} />,
  },
]
