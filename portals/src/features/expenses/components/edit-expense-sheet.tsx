import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import type { Expense } from '@/features/expenses/pages/columns'
import { updateExpense } from '@/lib/actions/expenses'
import { queryKeys } from '@/lib/query-keys'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { PaymentMethodSelect } from '@/shared/components/payment-method-select'
import { SheetFormLayout } from '@/shared/components/sheet-form-layout'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Textarea } from '@/shared/components/ui/textarea'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useLookup } from '@/shared/hooks/use-lookup'
import { useSeedOnOpen } from '@/shared/hooks/use-seed-on-open'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { localDateISO, parseLocalDate } from '@/shared/lib/dates'

const editExpenseSchema = z.object({
  category: z.string().min(1, 'Please select a category'),
  amount: z
    .number({ error: 'Please enter a valid amount' })
    .positive('Please enter a valid amount'),
  date: z
    .string()
    .min(1, 'Please enter a date')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  paidTo: z.string().min(1, 'Please enter who this expense was paid to').max(255),
  paymentMethod: z.string().min(1, 'Please select a payment method'),
  description: z.string().max(1000).optional(),
})

interface EditExpenseSheetProps {
  expense: Expense
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Called after the PATCH succeeds, before the sheet closes. Lets callers
   * show contextual toasts (e.g. the M5.6 cascade notice for locked
   * expenses) without having to intercept the `onOpenChange(false)` close.
   */
  onSuccess?: () => void
}

function toDateInput(d: Expense['date']): string {
  if (!d) return localDateISO()
  return localDateISO(new Date(d))
}

/** Integer CENTS -> the cedis string an amount input displays. */
function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return ''
  return String(cents / 100)
}

export function EditExpenseSheet({
  expense,
  open,
  onOpenChange,
  onSuccess,
}: EditExpenseSheetProps) {
  const queryClient = useQueryClient()
  const { isSubmitting, submit } = useSubmitGuard()
  const [statusMessage, setStatusMessage] = useState<string | undefined>()

  const [category, setCategory] = useState<string>(expense.category || '')
  const [paymentMethod, setPaymentMethod] = useState<string>(expense.paymentMethod || '')
  // `expense.amount` is integer CENTS; the input holds cedis.
  const [amount, setAmount] = useState<string>(centsToInput(expense.amount))
  const [date, setDate] = useState<string>(toDateInput(expense.date))
  const [paidTo, setPaidTo] = useState<string>(expense.paidTo || '')
  const [description, setDescription] = useState<string>(expense.description || '')
  const [attachment, setAttachment] = useState<File | null>(null)

  // Shared expense-categories lookup — refreshes when Settings edits it, no reload.
  const { rows: categories } = useLookup('expense-categories', { enabled: open })

  // Fill the form each time the sheet opens for a record — not when a refetch
  // hands the same record back (a private file's link is re-signed every 15 min).
  useSeedOnOpen(open, expense.id, () => {
    setCategory(expense.category || '')
    setPaymentMethod(expense.paymentMethod || '')
    setAmount(centsToInput(expense.amount))
    setDate(toDateInput(expense.date))
    setPaidTo(expense.paidTo || '')
    setDescription(expense.description || '')
    setAttachment(null)
    setStatusMessage(undefined)
  })

  const isDirty = useMemo(() => {
    return (
      category !== (expense.category || '') ||
      paymentMethod !== (expense.paymentMethod || '') ||
      amount !== centsToInput(expense.amount) ||
      date !== toDateInput(expense.date) ||
      paidTo !== (expense.paidTo || '') ||
      description !== (expense.description || '') ||
      attachment !== null
    )
  }, [expense, category, paymentMethod, amount, date, paidTo, description, attachment])

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty: isDirty && !isSubmitting,
    onClose: () => onOpenChange(false),
  })

  function handleSubmit() {
    void submit(async () => {
      setStatusMessage(undefined)

      const amountNum = parseFloat(amount)
      const validation = editExpenseSchema.safeParse({
        category,
        amount: Number.isNaN(amountNum) ? undefined : amountNum,
        date,
        paidTo: paidTo.trim(),
        paymentMethod,
        description: description || undefined,
      })
      if (!validation.success) {
        const message = validation.error.issues[0]?.message ?? 'Please check the form'
        toast.error(message)
        return
      }

      // Validate date is a real calendar date
      if (!date || Number.isNaN(parseLocalDate(date).getTime())) {
        toast.error('Please enter a valid date')
        return
      }

      let attachmentUrl: string | null | undefined
      if (attachment && attachment.size > 0) {
        const { uploadExpenseFile } = await import('@/lib/actions/upload')
        const uploadResult = await uploadExpenseFile({
          file: attachment,
          category,
          paidTo: paidTo || null,
          date: parseLocalDate(date),
        })
        if (!uploadResult.success) {
          const message = uploadResult.error || 'Failed to upload file'
          setStatusMessage(message)
          toast.error(message)
          return
        }
        attachmentUrl = uploadResult.url || null
      }

      // The API speaks CENTS; the input holds cedis.
      const roundedAmount = Math.round(amountNum * 100)

      const data = {
        category,
        amount: roundedAmount,
        // parseLocalDate parses YYYY-MM-DD as local midnight, avoiding UTC day-shift on JSON.stringify
        date: parseLocalDate(date),
        description: description || null,
        paidTo: paidTo || null,
        paymentMethod: paymentMethod || null,
        ...(attachmentUrl !== undefined && { attachmentUrl }),
      }

      const result = await updateExpense(expense.id, data)

      if (result.success) {
        toast.success('Expense updated successfully.')
        onSuccess?.()
        onOpenChange(false)
        queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all })
      } else {
        const message = result.error || 'Something went wrong.'
        setStatusMessage(message)
        surfaceApiError(result)
      }
    })
  }

  return (
    <>
      <SheetFormLayout
        open={open}
        onOpenChange={guardedOnOpenChange}
        title="Edit Expense"
        description="Update expense details."
        size="md"
        submitLabel="Save Changes"
        submitting={isSubmitting}
        submitDisabled={!isDirty || isSubmitting}
        onSubmit={handleSubmit}
        statusMessage={statusMessage}
      >
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="edit-category">Category</Label>
            <Select value={category} onValueChange={setCategory} required>
              <SelectTrigger id="edit-category">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.name}>
                    {cat.displayName || cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-amount">Amount (₵)</Label>
            <Input
              id="edit-amount"
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-date">Date</Label>
            <Input
              id="edit-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-paidTo">Paid To *</Label>
            <Input
              id="edit-paidTo"
              value={paidTo}
              onChange={(e) => setPaidTo(e.target.value)}
              placeholder="Who was this expense paid to?"
              maxLength={255}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-paymentMethod">Payment Method *</Label>
            <PaymentMethodSelect
              id="edit-paymentMethod"
              value={paymentMethod}
              onValueChange={setPaymentMethod}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-attachment">Attachment (Optional)</Label>
            <Input
              id="edit-attachment"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
              onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
            />
            {expense.attachmentUrl && (
              <p className="text-xs text-muted-foreground">
                Current file:{' '}
                <a
                  href={expense.attachmentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  View
                </a>
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Upload a new receipt or supporting document (optional)
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-description">Note / Description</Label>
            <Textarea
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Additional information about this expense"
              maxLength={1000}
              rows={3}
            />
          </div>
        </div>
      </SheetFormLayout>

      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>
  )
}
