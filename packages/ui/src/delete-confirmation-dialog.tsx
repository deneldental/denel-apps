import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import { Button } from './button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog'

interface DeleteConfirmationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<void> | void
  title: string
  description: string
  /** Name of the thing being acted on. Renders in a "You are about to delete: X"
   *  block (destructive tone only); skip it for non-destructive flows. */
  itemName?: string
  /** External loading state — useful when the parent already tracks busy. */
  isLoading?: boolean
  /** Label on the confirm button. Defaults to "Delete". */
  confirmLabel?: string
  /** Visual tone of the confirm button + warning copy. Defaults to "destructive". */
  tone?: 'destructive' | 'default'
}

/**
 * Shared confirm-before-action dialog. Defaults to a destructive Delete
 * confirmation; pass `tone="default"` + `confirmLabel="<verb>"` for
 * non-destructive flows (mark declined, disconnect, etc.).
 */
export function DeleteConfirmationDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  itemName,
  isLoading = false,
  confirmLabel,
  tone = 'destructive',
}: DeleteConfirmationDialogProps) {
  const [isBusy, setIsBusy] = useState(false)

  const handleConfirm = async () => {
    setIsBusy(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch {
      // Error handling is done in the parent component
    } finally {
      setIsBusy(false)
    }
  }

  const isDestructive = tone === 'destructive'
  const defaultedLabel = confirmLabel ?? (isDestructive ? 'Delete' : 'Confirm')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div
              className={
                isDestructive
                  ? 'flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10'
                  : 'flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30'
              }
            >
              <AlertTriangle
                className={
                  isDestructive
                    ? 'h-5 w-5 text-destructive'
                    : 'h-5 w-5 text-amber-700 dark:text-amber-400'
                }
              />
            </div>
            <div>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="mt-1">{description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        {itemName && (
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              {isDestructive ? 'You are about to delete:' : 'Target:'}{' '}
              <span className="font-semibold text-foreground">{itemName}</span>
            </p>
            {isDestructive && (
              <p className="mt-2 text-sm text-muted-foreground">This action cannot be undone.</p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isBusy || isLoading}
          >
            Cancel
          </Button>
          <Button
            variant={isDestructive ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={isBusy || isLoading}
          >
            {isBusy || isLoading ? `${defaultedLabel}…` : defaultedLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
