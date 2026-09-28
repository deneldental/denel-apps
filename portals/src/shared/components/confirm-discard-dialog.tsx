import { AlertTriangle } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog'

interface ConfirmDiscardDialogProps {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
  /** Title text; defaults to "Discard unsaved changes?" */
  title?: string
  /** Body text; defaults to a generic warning. */
  description?: string
  /** Confirm button label; defaults to "Discard". */
  confirmLabel?: string
  /** Cancel button label; defaults to "Keep editing". */
  cancelLabel?: string
}

/**
 * Standardized "unsaved changes" warning. Pair with `useFormDirtyGuard()` —
 * the hook owns the open state and the confirm/cancel callbacks.
 *
 * Uses `AlertDialog` rather than `Dialog` so it remains focus-locked and
 * ignores outside-click dismissal (the user *must* make a choice).
 */
export function ConfirmDiscardDialog({
  open,
  onConfirm,
  onCancel,
  title = 'Discard unsaved changes?',
  description = 'You have unsaved changes in this form. If you leave now, they will be lost.',
  confirmLabel = 'Discard',
  cancelLabel = 'Keep editing',
}: ConfirmDiscardDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <AlertDialogTitle>{title}</AlertDialogTitle>
              <AlertDialogDescription className="mt-1">{description}</AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
