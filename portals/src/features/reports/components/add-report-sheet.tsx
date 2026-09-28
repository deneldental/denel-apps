import { useRef } from 'react'
import { toast } from 'sonner'
import { todaySalesCart } from '@/features/products/hooks/use-today-sales-cart'
import { DailyReportForm } from '@/features/reports/components/daily-report-form'
import { createDailyReport } from '@/lib/actions/reports'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'

interface AddReportSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  submittedBy: string
  onSuccess?: () => void
  isAdmin?: boolean
}

export function AddReportSheet({
  open,
  onOpenChange,
  submittedBy,
  onSuccess,
  isAdmin = false,
}: AddReportSheetProps) {
  const { isSubmitting, submit } = useSubmitGuard()

  // Track whether the user has interacted with the form since it opened.
  // We set this true on first open and clear it on successful submit so the
  // dirty-guard only fires when there is genuinely unsaved work.
  const isDirtyRef = useRef(false)
  // When the sheet opens, mark it dirty (form loads pre-filled data immediately).
  if (open && !isDirtyRef.current) {
    isDirtyRef.current = true
  }

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty: open ? isDirtyRef.current : false,
    onClose: () => {
      isDirtyRef.current = false
      onOpenChange(false)
    },
    warnOnBrowserUnload: false,
  })

  // Also block close while a submit is in-flight.
  const safeOnOpenChange = (next: boolean) => {
    if (!next && isSubmitting) return
    guardedOnOpenChange(next)
  }

  const handleSubmit = async (payload: {
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
  }) => {
    await submit(async () => {
      const result = await createDailyReport(payload)
      if (result.success) {
        toast.success('Report submitted successfully.')
        // Today's-sales cart is now persisted in DB as part of the report — flush it.
        todaySalesCart.clear()
        isDirtyRef.current = false
        onOpenChange(false)
        onSuccess?.()
      } else {
        surfaceApiError(result, 'Failed to submit report.')
      }
    })
  }

  return (
    <>
      <Sheet open={open} onOpenChange={safeOnOpenChange}>
        <SheetContent
          side="right"
          className="!w-[50vw] !max-w-[720px] !p-0 flex flex-col gap-0 sm:!max-w-[720px]"
        >
          <SheetHeader className="shrink-0 space-y-1 border-b px-6 pt-6 pb-4 text-left">
            <SheetTitle>Submit Daily Report</SheetTitle>
            <SheetDescription>
              Record today&apos;s patient counts, payments, expenses, and inventory usage.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            <DailyReportForm
              submittedBy={submittedBy}
              onSubmit={handleSubmit}
              isSubmitting={isSubmitting}
              isAdmin={isAdmin}
            />
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
        description="You have an unsaved daily report in progress. If you leave now, all entries will be lost."
      />
    </>
  )
}
