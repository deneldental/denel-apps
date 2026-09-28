import { format } from 'date-fns'
import { ExternalLink, FileText, Lock, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { Expense } from '@/features/expenses/pages/columns'
import { deleteExpense } from '@/lib/actions/expenses'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip'
import { usePermissions } from '@/shared/hooks/use-permissions'
import { formatCurrency } from '@/shared/utils/currency'
import { EditExpenseSheet } from './edit-expense-sheet'

interface ExpenseDetailContentProps {
  expense: Expense
  /**
   * Called after a successful delete. Used by the slide-in sheet to close
   * itself and let the parent refresh its list.
   */
  onDeleted?: () => void
  /**
   * Called after the edit sheet closes. Used by the slide-in sheet to
   * refresh the parent list without a full `navigate(0)`.
   */
  onEdited?: () => void
}

/**
 * Renders the read-only expense detail body plus edit/delete actions.
 * Designed to live inside either a page or a Sheet — it owns no breadcrumbs
 * or back button; the host decides the chrome.
 */
export function ExpenseDetailContent({ expense, onDeleted, onEdited }: ExpenseDetailContentProps) {
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const { isAdmin } = usePermissions()

  // M5.6 — lock state: an expense attached to a daily report is locked.
  // Receptionists see a disabled Edit button with a tooltip; admins can still
  // edit, and on successful save we toast about the cascaded report recompute.
  const isLocked = Boolean(expense.dailyReportId)
  const editBlocked = isLocked && !isAdmin

  const handleDelete = async () => {
    const result = await deleteExpense(expense.id)
    if (result.success) {
      toast.success('Expense deleted successfully')
      onDeleted?.()
    } else {
      toast.error(result.error || 'Failed to delete expense')
    }
  }

  const formattedAmount = formatCurrency(expense.amount)

  const expenseDate = expense.date ? new Date(expense.date) : new Date(expense.createdAt)

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Category</p>
              <div className="mt-1">
                <Badge variant="outline" className="capitalize">
                  {expense.category}
                </Badge>
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Amount</p>
              <p className="mt-1 text-lg font-semibold">{formattedAmount}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Date</p>
              <p className="mt-1">{format(expenseDate, 'MMMM d, yyyy')}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Created At</p>
              <p className="mt-1">
                {format(new Date(expense.createdAt), "MMMM d, yyyy 'at' h:mm a")}
              </p>
            </div>
          </div>
          {expense.paidTo && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">Paid To</p>
              <p className="mt-1">{expense.paidTo}</p>
              {expense.pettyRefContact && (
                <p className="text-xs text-muted-foreground">{expense.pettyRefContact}</p>
              )}
            </div>
          )}
          {expense.confirmationStatus && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">Petty cash review</p>
              <div className="mt-1 flex items-center gap-2">
                <Badge
                  variant={
                    expense.confirmationStatus === 'confirmed'
                      ? 'default'
                      : expense.confirmationStatus === 'flagged'
                        ? 'destructive'
                        : 'secondary'
                  }
                >
                  {expense.confirmationStatus === 'confirmed'
                    ? 'Confirmed'
                    : expense.confirmationStatus === 'flagged'
                      ? 'Flagged'
                      : 'Pending'}
                </Badge>
              </div>
              {expense.confirmationNote && (
                <p className="mt-1 text-sm text-muted-foreground">{expense.confirmationNote}</p>
              )}
            </div>
          )}
          {expense.paymentMethod && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">Payment Method</p>
              <p className="mt-1 capitalize">{expense.paymentMethod.replace('_', ' ')}</p>
            </div>
          )}
          {expense.description && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">Description / Notes</p>
              <p className="mt-1 whitespace-pre-wrap">{expense.description}</p>
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-muted-foreground">Receipts & Attachments</p>
            {expense.attachmentUrl ? (
              <ul className="mt-2 divide-y divide-border rounded-md border">
                {[expense.attachmentUrl].map((url) => {
                  const fileName = (() => {
                    try {
                      const parsed = new URL(url)
                      const last = parsed.pathname.split('/').filter(Boolean).pop() || 'Attachment'
                      return decodeURIComponent(last)
                    } catch {
                      return url.split('/').filter(Boolean).pop() || 'Attachment'
                    }
                  })()
                  return (
                    <li key={url} className="flex items-center justify-between gap-3 px-3 py-2">
                      <button
                        type="button"
                        onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm hover:underline"
                      >
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{fileName}</span>
                      </button>
                      <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground italic">No receipts attached</p>
            )}
          </div>
        </div>
      </div>

      {/* Edit + delete actions — pinned at the bottom of the sheet body */}
      <div className="flex items-center justify-end gap-2 border-t pt-4">
        {editBlocked ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* Wrapper span so the tooltip still shows over a disabled button. */}
                <span className="inline-flex">
                  <Button variant="outline" size="sm" disabled aria-disabled="true">
                    <Lock className="mr-2 h-4 w-4" />
                    Edit
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Locked by daily report</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setShowEditDialog(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </Button>
        )}
        <Button variant="destructive" size="sm" onClick={() => setShowDeleteDialog(true)}>
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </Button>
      </div>

      {showEditDialog && (
        <EditExpenseSheet
          expense={expense}
          open={showEditDialog}
          onOpenChange={(open) => {
            setShowEditDialog(open)
            if (!open) {
              onEdited?.()
            }
          }}
          onSuccess={() => {
            // M5.6 — admin saved an edit on a locked expense: let them know the
            // linked daily report's totals were recomputed server-side.
            if (isLocked && isAdmin) {
              toast.success('Expense updated — linked daily report totals refreshed')
            }
          }}
        />
      )}

      {showDeleteDialog && (
        <DeleteConfirmationDialog
          open={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
          onConfirm={handleDelete}
          title="Delete Expense"
          description="Are you sure you want to delete this expense? This action cannot be undone."
          itemName={`${expense.category} - ${formattedAmount}`}
        />
      )}
    </div>
  )
}
