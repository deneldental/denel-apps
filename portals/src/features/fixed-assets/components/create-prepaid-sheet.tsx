import { Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { createPrepaid } from '@/lib/actions/fixed-assets'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/shared/components/ui/sheet'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { formatCurrency, inputToCents } from '@/shared/utils/currency'

interface CreatePrepaidSheetProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: React.ReactNode
  onCreated?: () => void
}

const today = () => new Date().toISOString().slice(0, 10)

export function CreatePrepaidSheet({
  open: controlledOpen,
  onOpenChange: setControlledOpen,
  trigger,
  onCreated,
}: CreatePrepaidSheetProps) {
  const isControlled = controlledOpen !== undefined
  const [internalOpen, setInternalOpen] = useState(false)
  const open = isControlled ? controlledOpen : internalOpen

  const { isSubmitting, submit } = useSubmitGuard()

  const [name, setName] = useState('')
  const [totalAmount, setTotalAmount] = useState('')
  const [startDate, setStartDate] = useState(today())
  const [months, setMonths] = useState('')

  // Integer pesewas — `formatCurrency` below expects cents, and `Math.floor`
  // matches the backend amortiser (each month gets the floor; the final month
  // absorbs the remainder).
  const monthlyPreview = useMemo(() => {
    const totalCents = inputToCents(totalAmount)
    const m = Number(months)
    if (totalCents <= 0 || !Number.isInteger(m) || m <= 0) return null
    return Math.floor(totalCents / m)
  }, [totalAmount, months])

  const isDirty = name !== '' || totalAmount !== '' || months !== ''

  function resetForm() {
    setName('')
    setTotalAmount('')
    setStartDate(today())
    setMonths('')
  }

  function closeAndReset() {
    if (isControlled) setControlledOpen?.(false)
    else setInternalOpen(false)
    resetForm()
  }

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: closeAndReset,
  })

  const setOpen = (next: boolean) => {
    if (next) {
      if (isControlled) setControlledOpen?.(true)
      else setInternalOpen(true)
    } else {
      guardedOnOpenChange(false)
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const total = inputToCents(totalAmount)
    const m = Number(months)
    if (!name.trim()) return toast.error('Please enter a name')
    if (total <= 0) return toast.error('Enter a valid total amount')
    if (!startDate) return toast.error('Please pick a start date')
    if (!Number.isInteger(m) || m <= 0) return toast.error('Months must be a positive whole number')

    void submit(async () => {
      const res = await createPrepaid({
        name: name.trim(),
        totalAmount: total,
        startDate,
        months: m,
      })
      if (!res.success) {
        surfaceApiError(res, 'Failed to create prepaid asset')
        return
      }
      toast.success('Prepaid asset created.')
      closeAndReset()
      onCreated?.()
    })
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {trigger ? <SheetTrigger asChild>{trigger}</SheetTrigger> : null}
      <SheetContent className="!w-full !max-w-[480px] overflow-y-auto">
        <form onSubmit={onSubmit}>
          <SheetHeader className="mb-6">
            <SheetTitle>New prepaid asset</SheetTitle>
            <SheetDescription>
              Record a prepayment (e.g. annual insurance or rent) to amortize over its term. Each
              month, post one slice to recognize the expense (DR Expense / CR Prepaid).
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-5 pb-6">
            <div className="space-y-1.5">
              <Label htmlFor="prepaid-name">Name</Label>
              <Input
                id="prepaid-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Annual equipment insurance"
                maxLength={200}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="prepaid-total">Total amount (GHS)</Label>
                <Input
                  id="prepaid-total"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                  onKeyDown={(e) => {
                    if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault()
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prepaid-months">Term (months)</Label>
                <Input
                  id="prepaid-months"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="e.g. 12"
                  value={months}
                  onChange={(e) => setMonths(e.target.value)}
                  onKeyDown={(e) => {
                    if (['e', 'E', '+', '-', '.'].includes(e.key)) e.preventDefault()
                  }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="prepaid-start">Start date</Label>
              <Input
                id="prepaid-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>

            {monthlyPreview != null && (
              <p className="text-xs text-muted-foreground">
                Estimated monthly amortization:{' '}
                <span className="font-medium text-foreground">
                  {formatCurrency(monthlyPreview)}
                </span>{' '}
                (the final month absorbs any rounding remainder).
              </p>
            )}
          </div>

          <SheetFooter>
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create prepaid asset
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </Sheet>
  )
}
