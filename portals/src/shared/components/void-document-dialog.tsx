import { useState } from 'react'
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

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What is being voided — used in the title, e.g. "invoice", "bill". */
  documentLabel: string
  /** Optional override for the dialog description copy. */
  description?: string
  /** Placeholder for the reason field. */
  reasonPlaceholder?: string
  /**
   * Called with the trimmed reason. Should return a truthy value on success
   * (the dialog then closes) or `false`/throw on failure (dialog stays open).
   */
  onConfirm: (reason: string) => Promise<boolean | undefined>
}

/**
 * Shared void-document confirmation dialog (remediation M24/M25).
 *
 * Replaces the duplicated void-dialog blocks in the invoice composer and
 * bill-detail. Owns its own `busy` state: while a void is in flight the
 * action + cancel buttons are disabled and the dialog cannot be dismissed
 * (H22 — no double-void, no close-mid-flight).
 */
export function VoidDocumentDialog({
  open,
  onOpenChange,
  documentLabel,
  description,
  reasonPlaceholder = 'e.g. Wrong patient',
  onConfirm,
}: Props) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  function handleOpenChange(next: boolean) {
    if (busy) return
    if (!next) setReason('')
    onOpenChange(next)
  }

  async function handleConfirm() {
    if (!reason.trim() || busy) return
    setBusy(true)
    try {
      const ok = await onConfirm(reason.trim())
      if (ok !== false) {
        setReason('')
        onOpenChange(false)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void {documentLabel}</DialogTitle>
          <DialogDescription>
            {description ??
              `Posts a reversal entry. Allowed only when no payments are recorded against this ${documentLabel}.`}
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label htmlFor="void-doc-reason">Reason</Label>
          <Input
            id="void-doc-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={reasonPlaceholder}
            disabled={busy}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={busy || !reason.trim()}>
            {busy ? 'Voiding…' : `Void ${documentLabel}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
