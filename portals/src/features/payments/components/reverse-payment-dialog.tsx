import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { reversePayment } from '@/lib/actions/payments'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Label } from '@/shared/components/ui/label'
import { Textarea } from '@/shared/components/ui/textarea'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { formatCurrency } from '@/shared/utils/currency'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  paymentId: string
  /** Shown in the title so the user knows which payment they're reversing. */
  paymentLabel?: string | null
  /** Optional amount, surfaced in the description for an extra sanity check. */
  amount?: number | null
  /** Fired after a successful reversal so the caller can refresh its view. */
  onReversed?: () => void
}

/**
 * Confirm + reason capture for reversing a *posted* payment
 * (POST /api/payments/:id/reverse). Reversal posts a reversing journal entry,
 * rolls back invoice balances + any wallet credit, and flips the payment to
 * `reversed`. The backend rejects anything that isn't currently posted, so this
 * dialog should only be opened from a posted/completed payment.
 *
 * For invoices with payments already allocated, prefer a credit note instead —
 * this is the "undo the money movement" path, not the "reduce the bill" path.
 */
export function ReversePaymentDialog({
  open,
  onOpenChange,
  paymentId,
  paymentLabel,
  amount,
  onReversed,
}: Props) {
  const [reason, setReason] = useState('')
  const { isSubmitting, submit } = useSubmitGuard()

  useEffect(() => {
    if (open) setReason('')
  }, [open])

  function handleOpenChange(next: boolean) {
    if (isSubmitting) return
    onOpenChange(next)
  }

  function onSubmit() {
    const trimmed = reason.trim()
    if (!trimmed) {
      toast.error('A reason is required to reverse a payment')
      return
    }
    void submit(async () => {
      const res = await reversePayment(paymentId, trimmed)
      if (!res.success) {
        surfaceApiError(res, 'Failed to reverse payment')
        return
      }
      toast.success(
        `Payment reversed${res.data?.reversal?.entryNumber ? ` — JE ${res.data.reversal.entryNumber}` : ''}`
      )
      onOpenChange(false)
      onReversed?.()
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reverse payment{paymentLabel ? ` — ${paymentLabel}` : ''}</DialogTitle>
          <DialogDescription>
            Posts a reversing journal entry, rolls back the invoice balance(s) this payment settled
            and any wallet credit it created
            {amount != null ? `, undoing ${formatCurrency(amount)}` : ''}. Use a{' '}
            <strong>credit note</strong> instead if you only want to reduce what the patient owes on
            an invoice.
          </DialogDescription>
        </DialogHeader>

        <div>
          <Label htmlFor="reverse-reason">Reason</Label>
          <Textarea
            id="reverse-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Recorded against the wrong patient"
            maxLength={500}
            disabled={isSubmitting}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onSubmit}
            disabled={isSubmitting || !reason.trim()}
          >
            {isSubmitting ? 'Reversing…' : 'Reverse payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
