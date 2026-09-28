import { AlertTriangle, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
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

interface SensitiveActionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Short title — e.g. "Reverse Payment" */
  title: string
  /** Longer explanation of impact + irreversibility. */
  description: string
  /** Label shown on the confirm button. Defaults to "Confirm". */
  confirmLabel?: string
  /** Show a "re-type name" input before confirm. Useful for very destructive actions. */
  requireNameMatch?: string
  /** Callback invoked with `{ reason }` when confirmed. Should handle its own errors + loading. */
  onConfirm: (data: { reason: string }) => Promise<void> | void
  /** Optional placeholder text for the reason field. */
  reasonPlaceholder?: string
  /** Whether reason is required. Defaults to true. */
  reasonRequired?: boolean
}

/**
 * A confirmation dialog for high-impact destructive or financial actions.
 *
 * Use for:
 * - Payment reversals / refunds
 * - Medical record deletion
 * - Treatment plan deletion
 * - Bulk waivers
 * - Staff deletion
 * - Role/permission changes
 *
 * Always captures a `reason` string for the audit log. For extremely destructive
 * actions, pass `requireNameMatch` with the entity name — the user must type it
 * exactly to enable the confirm button.
 *
 * The caller is responsible for displaying toasts and handling the actual mutation.
 */
export function SensitiveActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  requireNameMatch,
  onConfirm,
  reasonPlaceholder = 'Explain why this action is being taken…',
  reasonRequired = true,
}: SensitiveActionDialogProps) {
  const [reason, setReason] = useState('')
  const [nameMatch, setNameMatch] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setReason('')
      setNameMatch('')
    }
  }, [open])

  const reasonValid = !reasonRequired || reason.trim().length >= 3
  const nameValid = !requireNameMatch || nameMatch.trim() === requireNameMatch.trim()
  const canConfirm = reasonValid && nameValid && !submitting

  async function handleConfirm() {
    if (!canConfirm) return
    setSubmitting(true)
    try {
      await onConfirm({ reason: reason.trim() })
      onOpenChange(false)
    } catch {
      // caller is responsible for error toasts
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="mt-1 text-xs leading-relaxed">
                {description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {reasonRequired && (
            <div className="space-y-1.5">
              <Label className="text-xs">
                Reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={reasonPlaceholder}
                rows={3}
                disabled={submitting}
              />
              <p className="text-[10px] text-muted-foreground">
                Logged to the audit trail. At least 3 characters.
              </p>
            </div>
          )}

          {requireNameMatch && (
            <div className="space-y-1.5">
              <Label className="text-xs">
                Type <span className="font-mono font-semibold">{requireNameMatch}</span> to confirm
              </Label>
              <Input
                value={nameMatch}
                onChange={(e) => setNameMatch(e.target.value)}
                disabled={submitting}
                autoComplete="off"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={!canConfirm}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
