import { ShieldAlert } from 'lucide-react'
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
import { Label } from '@/shared/components/ui/label'
import { PasswordInput } from '@/shared/components/ui/password-input'

interface AdminPasswordDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Resolve once the password has been verified and the action completed.
   *  Reject with an Error to keep the dialog open and show the message. */
  onConfirm: (password: string) => Promise<void>
  title: string
  description: string
  /** Name of the item being permanently deleted (rendered for confirmation). */
  itemName?: string
  /** Confirm button label. Defaults to "Permanently delete". */
  confirmLabel?: string
}

/**
 * Two-factor confirmation dialog for destructive admin actions. The caller
 * receives the entered password in `onConfirm` and is responsible for sending
 * it to the backend endpoint that re-verifies it server-side.
 */
export function AdminPasswordDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  itemName,
  confirmLabel = 'Permanently delete',
}: AdminPasswordDialogProps) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setPassword('')
      setError(null)
      setBusy(false)
    }
  }, [open])

  async function handleConfirm() {
    if (!password) {
      setError('Password is required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onConfirm(password)
      onOpenChange(false)
    } catch (err: any) {
      setError(err?.message ?? 'Verification failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
              <ShieldAlert className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="mt-1">{description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {itemName && (
          <div className="py-2">
            <p className="text-sm text-muted-foreground">
              Target: <span className="font-semibold text-foreground">{itemName}</span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              This action is irreversible. Re-enter your password to confirm.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="admin-password">Your password</Label>
          <PasswordInput
            id="admin-password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) handleConfirm()
            }}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={busy || !password}>
            {busy ? `${confirmLabel}…` : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
