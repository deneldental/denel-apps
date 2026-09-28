// Reusable "archive this thing" confirmation. Mirrors the shared
// DeleteConfirmationDialog but uses archive-appropriate copy + icon
// (archive is reversible — restore is one click in the Archived tab —
// so it shouldn't borrow the destructive "cannot be undone" language).

import { Archive } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'

interface ArchiveConfirmationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<void>
  title: string
  description: string
  itemName?: string
  /** Extra warning shown above the action buttons. Used by the invoice
   *  archive flow to call out that transactions get hidden along with it. */
  warning?: string
  confirmLabel?: string
}

export function ArchiveConfirmationDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  itemName,
  warning,
  confirmLabel = 'Archive',
}: ArchiveConfirmationDialogProps) {
  const [busy, setBusy] = useState(false)

  async function handleConfirm() {
    setBusy(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch {
      /* parent shows the toast when it has context; this is the safety net */
      toast.error('Archive failed — please try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
              <Archive className="h-5 w-5 text-amber-700 dark:text-amber-400" />
            </div>
            <div>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="mt-1">{description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        {itemName && (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Archiving:</span>{' '}
            <span className="font-semibold">{itemName}</span>
          </div>
        )}
        {warning && (
          <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-200">
            {warning}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          You can restore it any time from the <strong>Archived</strong> tab.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy} autoFocus>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={busy}>
            {busy ? 'Archiving…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
