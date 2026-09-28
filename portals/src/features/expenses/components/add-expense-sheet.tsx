import { Plus } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { createExpense } from '@/lib/actions/expenses'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { PaymentMethodSelect } from '@/shared/components/payment-method-select'
import { SheetFormLayout } from '@/shared/components/sheet-form-layout'
import { Button } from '@/shared/components/ui/button'
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
import { type LookupRow, useLookup } from '@/shared/hooks/use-lookup'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { localDateISO, parseLocalDate } from '@/shared/lib/dates'
import { PettyRefPicker } from './petty-ref-picker'

type PettyRefType = 'none' | 'service_provider' | 'staff' | 'specialist'

interface AddExpenseSheetProps {
  buttonText?: string
  onSuccess?: () => void
}

/**
 * Add-expense form as a right-side Sheet. Self-contained — renders its own
 * trigger button and manages open state internally, matching the dialog's
 * original API so callers only change the import/name.
 */
export function AddExpenseSheet({ buttonText = 'Add Expense', onSuccess }: AddExpenseSheetProps) {
  const [open, setOpen] = useState(false)
  const { isSubmitting, submit } = useSubmitGuard()
  const [statusMessage, setStatusMessage] = useState<string | undefined>()

  const formRef = useRef<HTMLFormElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Form state (matches the old dialog's controlled fields)
  const [category, setCategory] = useState<string>('')
  const [paymentMethod, setPaymentMethod] = useState<string>('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(localDateISO())
  const [paidTo, setPaidTo] = useState('')
  const [pettyRefId, setPettyRefId] = useState('')
  const [description, setDescription] = useState('')
  const [attachment, setAttachment] = useState<File | null>(null)

  // Shared expense-categories lookup — refreshes when Settings edits it, no reload.
  const { rows } = useLookup('expense-categories', { enabled: open })
  const categories = rows as Array<
    LookupRow & { isPettyCash?: boolean; pettyRefType?: PettyRefType }
  >

  // Petty cash: the selected category's required recipient reference (drives the
  // morphed "Paid To" control). Non-petty categories keep the free-text field.
  const activeRefType: PettyRefType = useMemo(() => {
    const cat = categories.find((cx) => cx.name === category)
    return cat?.isPettyCash ? (cat.pettyRefType ?? 'none') : 'none'
  }, [categories, category])

  const isDirty = useMemo(() => {
    return (
      category !== '' ||
      paymentMethod !== '' ||
      amount !== '' ||
      date !== localDateISO() ||
      paidTo !== '' ||
      description !== '' ||
      attachment !== null
    )
  }, [category, paymentMethod, amount, date, paidTo, description, attachment])

  function resetForm() {
    setCategory('')
    setPaymentMethod('')
    setAmount('')
    setDate(localDateISO())
    setPaidTo('')
    setPettyRefId('')
    setDescription('')
    setAttachment(null)
    setStatusMessage(undefined)
    formRef.current?.reset()
  }

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty: isDirty && !isSubmitting,
    onClose: () => {
      setOpen(false)
      resetForm()
    },
  })

  function handleSubmit() {
    void submit(async () => {
      setStatusMessage(undefined)

      const amountNum = parseFloat(amount)
      if (Number.isNaN(amountNum) || amountNum <= 0) {
        toast.error('Please enter a valid amount')
        return
      }
      // Reject amounts with more than 2 decimal places
      if (!/^\d+(\.\d{1,2})?$/.test(amount.trim())) {
        toast.error('Amount must have at most 2 decimal places')
        return
      }
      if (!category) {
        toast.error('Please select a category')
        return
      }
      if (!paymentMethod) {
        toast.error('Please select a payment method')
        return
      }
      if (
        activeRefType === 'service_provider' ||
        activeRefType === 'staff' ||
        activeRefType === 'specialist'
      ) {
        if (!pettyRefId) {
          toast.error(
            activeRefType === 'service_provider'
              ? 'Please select the service provider'
              : activeRefType === 'specialist'
                ? 'Please select the doctor (specialist)'
                : 'Please select the staff member'
          )
          return
        }
      } else if (!paidTo || paidTo.trim() === '') {
        toast.error('Please enter who this expense was paid to')
        return
      }

      let attachmentUrl: string | null = null
      if (attachment && attachment.size > 0) {
        // Fail fast: backend imageOrPdf profile caps at 25 MB
        if (attachment.size > 25 * 1024 * 1024) {
          toast.error('File too large. Maximum size is 25 MB.')
          return
        }
        // Verify extension matches the backend's imageOrPdf allowed list
        const ext = attachment.name.split('.').pop()?.toLowerCase() ?? ''
        if (!['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
          toast.error('Unsupported file type. Please upload a PDF, JPG, PNG, or WebP file.')
          return
        }
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
          surfaceApiError(uploadResult)
          return
        }
        attachmentUrl = uploadResult.url || null
      }

      const result = await createExpense({
        category,
        // The API speaks CENTS; the input holds cedis.
        amount: Math.round(Number(amountNum) * 100),
        date: parseLocalDate(date),
        description: description || null,
        paidTo: paidTo || null,
        // Petty cash reference — the backend derives the type from the category
        // and snapshots the recipient's name/contact server-side.
        pettyRefId: pettyRefId || null,
        paymentMethod: paymentMethod || null,
        attachmentUrl,
      })

      if (result.success) {
        toast.success('Expense created successfully.')
        setOpen(false)
        resetForm()
        onSuccess?.()
        triggerRef.current?.focus()
      } else {
        const message = result.error || 'Something went wrong.'
        setStatusMessage(message)
        surfaceApiError(result)
      }
    })
  }

  return (
    <>
      <Button ref={triggerRef} onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" />
        {buttonText}
      </Button>

      <SheetFormLayout
        open={open}
        onOpenChange={guardedOnOpenChange}
        title="Add Expense"
        description="Record a new expense for the clinic."
        size="md"
        submitLabel="Create Expense"
        submitting={isSubmitting}
        submitDisabled={!isDirty || isSubmitting}
        onSubmit={handleSubmit}
        statusMessage={statusMessage}
      >
        <form ref={formRef} className="grid gap-4" onSubmit={(e) => e.preventDefault()}>
          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <Select
              value={category}
              onValueChange={(v) => {
                setCategory(v)
                // Category change may swap the required reference — reset the payee.
                setPettyRefId('')
                setPaidTo('')
                setStatusMessage(undefined)
              }}
            >
              <SelectTrigger id="category">
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
            <Label htmlFor="amount">Amount (₵)</Label>
            <Input
              id="amount"
              name="amount"
              type="number"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value)
                setStatusMessage(undefined)
              }}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              name="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          {activeRefType === 'service_provider' ||
          activeRefType === 'staff' ||
          activeRefType === 'specialist' ? (
            // Petty cash: "Paid To" morphs into a provider/staff/specialist picker.
            <PettyRefPicker
              refType={activeRefType}
              valueId={pettyRefId}
              onChange={(id, name) => {
                setPettyRefId(id)
                setPaidTo(name)
                setStatusMessage(undefined)
              }}
            />
          ) : (
            <div className="space-y-2">
              <Label htmlFor="paidTo">Paid To *</Label>
              <Input
                id="paidTo"
                name="paidTo"
                placeholder="Who was this expense paid to?"
                value={paidTo}
                maxLength={200}
                onChange={(e) => {
                  setPaidTo(e.target.value)
                  setStatusMessage(undefined)
                }}
                required
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="paymentMethod">Payment Method *</Label>
            <PaymentMethodSelect
              id="paymentMethod"
              value={paymentMethod}
              onValueChange={(v) => {
                setPaymentMethod(v)
                setStatusMessage(undefined)
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="attachment">Attachment (Optional)</Label>
            <Input
              id="attachment"
              name="attachment"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">Upload a receipt or supporting document</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Note / Description</Label>
            <Textarea
              id="description"
              name="description"
              placeholder="Additional information about this expense"
              rows={3}
              maxLength={1000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </form>
      </SheetFormLayout>

      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>
  )
}
