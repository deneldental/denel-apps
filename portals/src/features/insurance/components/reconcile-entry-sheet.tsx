import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { SheetFormLayout } from '@/shared/components/sheet-form-layout'
import { Input } from '@/shared/components/ui/input'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { centsToInput, formatAmount, inputToCents } from '@/shared/utils/currency'
import type { ReconciliationEntry } from '../types'

interface Props {
  entry: ReconciliationEntry
  onClose: () => void
  onSaved: () => void
}

/**
 * "Mark reconciled" sheet — captures the actual settled amount from the
 * insurer for an existing reconciliation row.
 *
 * Migrated from the inline modal Dialog inside `reconciliation-tab.tsx`
 * (M6 dialog->sheet pass). Uses the `sm` size preset since the form is
 * intentionally tiny (two fields).
 */
export function ReconcileEntrySheet({ entry, onClose, onSaved }: Props) {
  // Seed from the previously saved paid amount, falling back to chargedAmount
  // on first reconciliation so the field is a useful starting point.
  const initialRaw = entry.insurerPaidAmount ?? entry.chargedAmount
  const initialAmount = initialRaw != null ? centsToInput(initialRaw) : ''
  const initialNotes = entry.notes ?? ''

  const [amount, setAmount] = useState(initialAmount)
  const [notes, setNotes] = useState(initialNotes)

  const { isSubmitting, submit } = useSubmitGuard()

  const isDirty = amount !== initialAmount || notes !== initialNotes
  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose,
  })

  async function handleSubmit() {
    await submit(async () => {
      const cents = inputToCents(amount)
      if (cents < 0) {
        toast.error('Invalid amount')
        return
      }
      if (cents > entry.chargedAmount) {
        toast.error('Amount cannot exceed charged amount')
        return
      }
      const res = await api.patch(`/api/insurance/reconciliation/${entry.id}`, {
        insurerPaidAmount: cents,
        notes: notes || null,
      })
      if (res.success) {
        toast.success('Entry reconciled')
        onSaved()
      } else {
        surfaceApiError(res)
      }
    })
  }

  return (
    <>
      <SheetFormLayout
        open
        onOpenChange={guardedOnOpenChange}
        title="Mark Reconciled"
        description="Record the amount actually settled by the insurer."
        size="sm"
        submitLabel="Reconcile"
        submitting={isSubmitting}
        onSubmit={handleSubmit}
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Charged to insurer</p>
            <p className="text-sm font-medium">GHS {formatAmount(Number(entry.chargedAmount))}</p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="insurer-paid-amount" className="text-xs font-medium">
              Amount settled (GHS)
            </label>
            <Input
              id="insurer-paid-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => {
                if (['e', 'E', '+'].includes(e.key)) e.preventDefault()
              }}
              // biome-ignore lint/a11y/noAutofocus: intentional — single-field form, sheet opens for this input
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="recon-notes" className="text-xs font-medium">
              Notes
            </label>
            <Input
              id="recon-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
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
