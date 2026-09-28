import { cedisToCents } from '@denel/utils'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  type ReceiptDataShape,
  ReceiptViewDialog,
} from '@/features/payments/components/receipt-view-dialog'
import {
  createDraftPayment,
  type DraftPaymentInput,
  type PaymentMethod,
  postDraftPayment,
} from '@/lib/actions/payments-v2'
import { api } from '@/lib/api-client'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { PaymentMethodSelect } from '@/shared/components/payment-method-select'
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
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { localDateISO } from '@/shared/lib/dates'
import { formatCurrency } from '@/shared/utils/currency'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: string
  patientName?: string
  currentBalance: number
  /** Fires after the top-up is posted (so the parent can refresh the ledger).
   *  Called BEFORE the receipt dialog opens — closing the receipt is independent. */
  onPosted?: () => void
}

/** A wallet top-up is a payment with NO allocations — the full amount lands in
 *  `unallocatedAmount` and gets credited to the patient's wallet via
 *  `creditWallet()` inside `postPayment`. Wallet itself is intentionally not a
 *  valid funding method here (you can't top up the wallet from the wallet), so
 *  <PaymentMethodSelect> is rendered with `excludeMethods={['wallet']}`. */

export function WalletTopUpDialog({
  open,
  onOpenChange,
  patientId,
  patientName,
  currentBalance,
  onPosted,
}: Props) {
  // Free-form so the configurable lookup's slug flows straight through; the
  // typed payment payload re-asserts `PaymentMethod` at the draft boundary.
  const [method, setMethod] = useState<string>('cash')
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [referenceBlurred, setReferenceBlurred] = useState(false)
  const [paymentDate, setPaymentDate] = useState(localDateISO)

  const { isSubmitting, submit } = useSubmitGuard()

  const [receiptData, setReceiptData] = useState<ReceiptDataShape | null>(null)
  const [receiptOpen, setReceiptOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    setMethod('cash')
    setAmount('')
    setReference('')
    setReferenceBlurred(false)
    setPaymentDate(localDateISO())
  }, [open])

  // The field is CEDIS (type="number", placeholder "0.00"), but `currentBalance`
  // and the payment API are in cents. This used to post `amountNum` straight
  // through, so a GH₵50.00 top-up credited the patient GH₵0.50 — and the
  // "new balance" preview added cedis to cents. `cedisToCents` is the boundary.
  const amountNum = Number(amount) || 0
  const amountCents = cedisToCents(amountNum)
  const needsReference = method !== 'cash'
  const isValid = amountNum > 0 && !!method && (!needsReference || !!reference.trim())
  const newBalance = currentBalance + amountCents
  const showRefError = needsReference && referenceBlurred && !reference.trim()

  const isDirty = amount !== '' || reference !== ''
  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: () => onOpenChange(false),
  })

  const handleSubmit = useCallback(() => {
    if (amountNum <= 0) return toast.error('Enter an amount greater than 0')
    if (needsReference && !reference.trim()) {
      setReferenceBlurred(true)
      return toast.error('A reference is required for this payment method')
    }

    void submit(async () => {
      const draft: DraftPaymentInput = {
        patientId,
        amount: amountCents,
        method: method as PaymentMethod,
        paymentDate,
        externalReference: reference.trim() || null,
        description: 'Wallet top-up',
        // No allocations → full amount lands in unallocatedAmount → credited to
        // wallet on post.
        allocations: [],
      }
      const draftRes = await createDraftPayment(draft)
      if (!draftRes.success || !draftRes.data) {
        throw new Error(draftRes.error ?? 'Failed to create top-up draft')
      }
      const paymentId = draftRes.data.id
      const postRes = await postDraftPayment(paymentId)
      if (!postRes.success) {
        throw new Error(postRes.error ?? 'Failed to post top-up')
      }

      toast.success(`Wallet topped up by ${formatCurrency(amountNum)}`)
      onPosted?.()

      const receiptRes = await api.get<ReceiptDataShape>(`/api/payments/${paymentId}/receipt`)
      if (receiptRes.success && receiptRes.data) {
        setReceiptData(receiptRes.data)
        setReceiptOpen(true)
      } else if (!receiptRes.success) {
        toast.warning('Top-up posted — receipt unavailable')
      }
      onOpenChange(false)
    })
  }, [
    amountNum,
    needsReference,
    reference,
    submit,
    method,
    paymentDate,
    patientId,
    onPosted,
    onOpenChange,
  ])

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => (isSubmitting ? null : guardedOnOpenChange(o))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Top up wallet{patientName ? ` — ${patientName}` : ''}</DialogTitle>
            <DialogDescription>
              Add credit to the patient's wallet. The amount is recorded as a payment with no
              invoice allocation and shows up in the transactions list with its own receipt.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSubmit()
            }}
          >
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/20 p-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Current balance</span>
                  <span className="font-mono">{formatCurrency(currentBalance)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Top-up</span>
                  <span className="font-mono text-emerald-700">+{formatCurrency(amountNum)}</span>
                </div>
                <div className="flex justify-between border-t pt-1 mt-1">
                  <span className="font-medium">New balance</span>
                  <span className="font-mono font-semibold">{formatCurrency(newBalance)}</span>
                </div>
              </div>

              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-6 space-y-1.5">
                  <Label htmlFor="topup-method">Method</Label>
                  <PaymentMethodSelect
                    id="topup-method"
                    className="h-9"
                    value={method}
                    onValueChange={setMethod}
                    excludeMethods={['wallet']}
                  />
                </div>
                <div className="col-span-6 space-y-1.5">
                  <Label htmlFor="topup-amount">Amount (GHS)</Label>
                  <Input
                    id="topup-amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="h-9 text-right"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="topup-date">Payment date</Label>
                <Input
                  id="topup-date"
                  type="date"
                  value={paymentDate}
                  max={localDateISO()}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="h-9"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="topup-ref">Reference{needsReference ? '' : ' (optional)'}</Label>
                <Input
                  id="topup-ref"
                  type="text"
                  placeholder={
                    method === 'momo'
                      ? 'MoMo transaction ID'
                      : method === 'cheque'
                        ? 'Cheque #'
                        : method === 'bank_transfer'
                          ? 'Bank transfer ref'
                          : method === 'card'
                            ? 'Card auth code'
                            : 'No reference needed for cash'
                  }
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  onBlur={() => setReferenceBlurred(true)}
                  disabled={method === 'cash'}
                  maxLength={100}
                  aria-invalid={showRefError}
                  className="h-9"
                />
                {showRefError && (
                  <p className="text-xs text-destructive">
                    A reference is required for this payment method.
                  </p>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={isSubmitting}
                onClick={() => guardedOnOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting || !isValid}>
                {isSubmitting
                  ? 'Posting…'
                  : `Top up ${amountNum > 0 ? formatCurrency(amountNum) : ''}`}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {receiptData && (
        <ReceiptViewDialog
          open={receiptOpen}
          onOpenChange={(o) => {
            setReceiptOpen(o)
            if (!o) setReceiptData(null)
          }}
          receiptData={receiptData}
        />
      )}

      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>
  )
}
