import { cedisToCents } from '@denel/utils'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { type CreditNoteReason, createAndPostCreditNote } from '@/lib/actions/credit-notes'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Textarea } from '@/shared/components/ui/textarea'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { formatCurrency } from '@/shared/utils/currency'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoiceId: string
  invoiceNumber: string
  invoiceBalance: number
  invoiceTaxTotal: number
  invoiceTotal: number
  onPosted: () => void
}

const REASONS: { value: CreditNoteReason; label: string; hint: string }[] = [
  { value: 'discount', label: 'Discount', hint: 'Posts to 4900 Discounts Given' },
  { value: 'correction', label: 'Correction', hint: 'Billing error fix' },
  { value: 'cancellation', label: 'Cancellation', hint: 'Service not delivered' },
  { value: 'goodwill', label: 'Goodwill', hint: 'Customer-relations credit' },
  { value: 'write_off', label: 'Write off', hint: 'Posts to 5900 Bad Debt — no tax reversal' },
]

const VALID_REASONS = REASONS.map((r) => r.value) as [CreditNoteReason, ...CreditNoteReason[]]

/**
 * Cents -> the plain decimal string a text input needs ("9000.00"). NOT
 * `formatAmount`: that groups with commas, which `Number()` cannot parse back.
 */
function centsToCedisInput(cents: number): string {
  return (Number(cents) / 100).toFixed(2)
}

/** Client-side schema mirrors the backend createAndPostSchema required fields. */
const submitSchema = z.object({
  invoiceId: z.string().uuid(),
  reason: z.enum(VALID_REASONS),
  // The wire value is integer CENTS. The field the user types is CEDIS; the
  // conversion happens once, at submit, via `cedisToCents`.
  amount: z
    .number()
    .int('Amount must be a whole number of pesewas')
    .positive('Amount must be positive'),
  reasonNotes: z.string().nullish(),
  includeTaxReversal: z.boolean(),
})

export function IssueCreditNoteDialog({
  open,
  onOpenChange,
  invoiceId,
  invoiceNumber,
  invoiceBalance,
  invoiceTaxTotal,
  invoiceTotal,
  onPosted,
}: Props) {
  const [reason, setReason] = useState<CreditNoteReason>('discount')
  const [amount, setAmount] = useState('')
  const [reasonNotes, setReasonNotes] = useState('')
  const [includeTaxReversal, setIncludeTaxReversal] = useState(true)

  const { isSubmitting, submit } = useSubmitGuard()

  useEffect(() => {
    if (open) {
      // Default to the full remaining balance, IN CEDIS — `invoiceBalance` is
      // cents (already net of prior posted credit notes), and this seeds a text
      // field the user reads and edits. Seeding the raw cents showed a GH₵9,000
      // balance as "900000.00" and, if accepted, filed a credit note for
      // GH₵9,000.00 worth of pesewas.
      setAmount(centsToCedisInput(invoiceBalance))
      setReason('discount')
      setReasonNotes('')
      setIncludeTaxReversal(true)
    }
  }, [open, invoiceBalance])

  // `amountNum` is what the user typed: CEDIS. `amountCents` is the same value
  // in the unit every other number here uses.
  const amountNum = Number(amount) || 0
  const amountCents = cedisToCents(amountNum)
  const fraction = invoiceTotal > 0 ? amountCents / invoiceTotal : 0
  const taxReversedPreview =
    reason !== 'write_off' && includeTaxReversal ? Math.round(invoiceTaxTotal * fraction) : 0
  const overCap = amountCents > invoiceBalance
  const negative = amountCents <= 0
  const notCentAligned = amount !== '' && Math.round(amountNum * 100) !== amountNum * 100

  const isDirty =
    amount !== centsToCedisInput(invoiceBalance) || reasonNotes !== '' || reason !== 'discount'

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: () => onOpenChange(false),
  })

  async function onSubmit() {
    const parsed = submitSchema.safeParse({
      invoiceId,
      reason,
      amount: amountCents,
      reasonNotes: reasonNotes.trim() || null,
      includeTaxReversal,
    })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Invalid input')
      return
    }
    if (overCap) {
      toast.error('Amount exceeds invoice balance')
      return
    }

    await submit(async () => {
      const res = await createAndPostCreditNote({
        invoiceId: parsed.data.invoiceId,
        reason: parsed.data.reason,
        amount: parsed.data.amount,
        reasonNotes: parsed.data.reasonNotes,
        includeTaxReversal: parsed.data.includeTaxReversal,
      })
      if (!res.success) {
        surfaceApiError(res, 'Failed to post credit note')
        return
      }

      toast.success(
        `Posted ${res.data?.creditNote.creditNoteNumber ?? ''} — JE ${res.data?.journalEntry.entryNumber ?? ''}`
      )
      onOpenChange(false)
      onPosted()
    })
  }

  return (
    <>
      <Dialog open={open} onOpenChange={isSubmitting ? undefined : guardedOnOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Issue credit note — {invoiceNumber}</DialogTitle>
            <DialogDescription>
              Reduces the patient's balance on a posted invoice. Write-offs post to 5900 Bad Debt;
              other reasons post to 4900 Discounts Given (or the original line's revenue account
              when line-level credits are added).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cn-reason">Reason</Label>
                <Select
                  value={reason}
                  onValueChange={(v) => {
                    if (REASONS.some((r) => r.value === v)) setReason(v as CreditNoteReason)
                  }}
                >
                  <SelectTrigger id="cn-reason">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REASONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  {REASONS.find((r) => r.value === reason)?.hint}
                </p>
              </div>
              <div>
                <Label htmlFor="cn-amount">Amount</Label>
                <Input
                  id="cn-amount"
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Max {formatCurrency(invoiceBalance)} (invoice balance)
                </p>
                {negative && amount !== '' && (
                  <Badge variant="destructive" className="mt-1">
                    Amount must be positive
                  </Badge>
                )}
                {notCentAligned && (
                  <Badge variant="destructive" className="mt-1">
                    Amount must be a whole cent (e.g. 10.50)
                  </Badge>
                )}
              </div>
            </div>

            <div>
              <Label htmlFor="cn-notes">Notes</Label>
              <Textarea
                id="cn-notes"
                rows={2}
                value={reasonNotes}
                onChange={(e) => setReasonNotes(e.target.value)}
                placeholder="Optional context — recorded in the audit log"
                maxLength={500}
              />
            </div>

            {reason !== 'write_off' && invoiceTaxTotal > 0 && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="cn-tax-reversal"
                  checked={includeTaxReversal}
                  onCheckedChange={(c) => setIncludeTaxReversal(Boolean(c))}
                />
                <Label htmlFor="cn-tax-reversal" className="text-sm font-normal cursor-pointer">
                  Reverse {formatCurrency(taxReversedPreview)} of tax (proportional to credit)
                </Label>
              </div>
            )}

            {overCap && <Badge variant="destructive">Amount exceeds invoice balance</Badge>}
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
              disabled={isSubmitting || negative || overCap || notCentAligned}
            >
              {isSubmitting ? 'Posting…' : 'Post credit note'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>
  )
}
