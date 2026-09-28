import { AlertTriangle, Loader2 } from 'lucide-react'
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

interface CancelVisitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (reason: string) => Promise<void>
  patientName?: string
  date?: string
}

export function CancelVisitDialog({
  open,
  onOpenChange,
  onConfirm,
  patientName,
  date,
}: CancelVisitDialogProps) {
  const [reason, setReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleConfirm() {
    setIsSubmitting(true)
    try {
      await onConfirm(reason)
      onOpenChange(false)
      setReason('')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!isSubmitting) onOpenChange(v)
      }}
    >
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Cancel Visit
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to cancel this visit{' '}
            {patientName ? <strong>for {patientName}</strong> : ''}?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm text-muted-foreground">
          <p>
            Cancelling this visit will remove it from the active worklist. If this visit is in the
            past, you must provide a reason.
          </p>
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">Reason (optional, required if past)</Label>
            <Input
              id="cancel-reason"
              placeholder="e.g. Patient requested cancellation"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={isSubmitting}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Keep Visit
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Cancel Visit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
