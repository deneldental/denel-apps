import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { postRefund, type RefundInput } from '@/lib/actions/credit-notes'
import { getPatientCredit } from '@/lib/actions/payments-v2'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { PaymentMethodSelect } from '@/shared/components/payment-method-select'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Textarea } from '@/shared/components/ui/textarea'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { localDateISO } from '@/shared/lib/dates'
import { formatCurrency } from '@/shared/utils/currency'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: string
  patientName?: string
  onPosted?: () => void
}

// NOTE: switched to the shared, configurable <PaymentMethodSelect>. The refund
// API does NOT constrain `method` to a closed enum — `POST /api/payments/refund`
// validates it as `z.string().min(1)`, and `resolveChannelAccountId` falls back
// to the default cash channel for any slug it doesn't recognise — so submitting
// a lookup `name` verbatim is safe. `method` state is widened to `string` and
// re-narrowed to `RefundInput['method']` only at the `postRefund` call boundary.

export function RefundDialog({ open, onOpenChange, patientId, patientName, onPosted }: Props) {
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<string>('cash')
  const [externalRef, setExternalRef] = useState('')
  const [notes, setNotes] = useState('')
  const [paymentDate, setPaymentDate] = useState(localDateISO())
  const { isSubmitting, submit } = useSubmitGuard()

  const isDirty = amount !== '' || externalRef !== '' || notes !== ''
  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: () => onOpenChange(false),
  })

  // Shared with invoice-composer.tsx's identical getPatientCredit() read —
  // both surface the same deposit balance for the same patient.
  const creditQuery = useApiQuery<{ depositBalance: number }>(
    queryKeys.patients.credit(patientId),
    () => getPatientCredit(patientId),
    { enabled: open }
  )
  const credit = Number(creditQuery.data?.depositBalance ?? 0)
  const loading = creditQuery.isLoading

  // Re-fetch the patient's available credit from the backend (source of
  // truth). Used again after a failed submit so the `overCap` guard never
  // acts on a stale client-cached balance (remediation H20).
  async function loadCredit() {
    await creditQuery.refetch()
  }

  useEffect(() => {
    if (!open) return
    setAmount('')
    setMethod('cash')
    setExternalRef('')
    setNotes('')
    setPaymentDate(localDateISO())
  }, [open])

  const amountNum = Number(amount) || 0
  const overCap = Math.round(amountNum * 100) > Math.round(credit * 100)
  const negative = amountNum <= 0
  const badPrecision = amount !== '' && !/^\d+(\.\d{1,2})?$/.test(amount.trim())

  function onSubmit() {
    if (negative) return toast.error('Amount must be positive')
    if (badPrecision) return toast.error('Amount must have at most 2 decimal places')
    if (overCap) return toast.error('Refund exceeds available patient credit')

    void submit(async () => {
      const res = await postRefund({
        patientId,
        amount: amountNum,
        method: method as RefundInput['method'],
        paymentDate,
        externalReference: externalRef.trim() || null,
        description: notes.trim() || null,
      })
      if (!res.success) {
        // The backend rejected it — our cached credit may be stale. Re-fetch the
        // authoritative balance before the user retries (fire-and-forget so busy
        // clears immediately via useSubmitGuard's finally block).
        loadCredit()
        surfaceApiError(res, 'Failed to post refund')
        return
      }
      toast.success(
        `Refunded — payment ${res.data?.payment.paymentNumber ?? ''}, JE ${res.data?.journalEntry.entryNumber ?? ''}`
      )
      queryClient.invalidateQueries({ queryKey: queryKeys.patients.credit(patientId) })
      onOpenChange(false)
      onPosted?.()
    })
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => (isSubmitting ? null : guardedOnOpenChange(o))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Refund patient {patientName ? `— ${patientName}` : ''}</DialogTitle>
            <DialogDescription>
              Refunds draw down from the patient's unallocated credit (2200 Patient Deposits). Issue
              a credit note first if the credit you want to refund is still tied up in a paid
              invoice.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex items-center justify-between border rounded p-2 bg-muted/30">
              <span className="text-sm">Available patient credit</span>
              <span className="font-mono">{loading ? '…' : formatCurrency(credit)}</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="rf-amount">Amount</Label>
                <Input
                  id="rf-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={loading || credit <= 0}
                />
              </div>
              <div>
                <Label htmlFor="rf-method">Method</Label>
                <PaymentMethodSelect
                  id="rf-method"
                  value={method}
                  onValueChange={setMethod}
                  disabled={loading}
                  placeholder="Select method"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="rf-date">Payment date</Label>
              <Input
                id="rf-date"
                type="date"
                max={localDateISO()}
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="rf-ref">Reference</Label>
              <Input
                id="rf-ref"
                value={externalRef}
                onChange={(e) => setExternalRef(e.target.value)}
                placeholder="Bank ref / MoMo txn id"
                maxLength={100}
              />
            </div>

            <div>
              <Label htmlFor="rf-notes">Notes</Label>
              <Textarea
                id="rf-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={500}
              />
            </div>

            {overCap && !loading && (
              <Badge variant="destructive">Refund exceeds available credit</Badge>
            )}
            {badPrecision && (
              <p className="text-sm text-destructive">Amount must have at most 2 decimal places</p>
            )}
            {credit <= 0 && !loading && (
              <p className="text-sm text-muted-foreground">
                This patient has no unallocated credit available to refund.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              disabled={isSubmitting}
              onClick={() => guardedOnOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={onSubmit}
              disabled={
                loading || isSubmitting || negative || overCap || badPrecision || credit <= 0
              }
            >
              {isSubmitting ? 'Refunding…' : 'Post refund'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
        title="Discard unsaved refund?"
        description="You have unsaved changes in this refund form. If you leave now, they will be lost."
      />
    </>
  )
}
