import { Lock, LockOpen } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { setInventoryLockStatus } from '@/lib/actions/settings'
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
import { Button } from '@/shared/components/ui/button'

interface InventoryLockToggleProps {
  isLocked: boolean
  isAdmin: boolean
}

export function InventoryLockToggle({
  isLocked: initialIsLocked,
  isAdmin,
}: InventoryLockToggleProps) {
  const [isLocked, setIsLocked] = useState(initialIsLocked)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  if (!isAdmin) {
    // Show lock status indicator for non-admins
    if (!isLocked) return null

    return (
      <div className="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2">
        <Lock className="h-4 w-4 text-orange-600" />
        <span className="text-sm font-medium text-orange-800">Inventory Locked</span>
        <span className="text-xs text-orange-600">(Admin only editing)</span>
      </div>
    )
  }

  const handleToggle = () => {
    setShowConfirmDialog(true)
  }

  const confirmToggle = async () => {
    setIsLoading(true)
    const newLockedState = !isLocked

    try {
      const result = await setInventoryLockStatus(newLockedState)

      if (result.success) {
        setIsLocked(newLockedState)
        toast.success(
          newLockedState
            ? 'Inventory locked. Only administrators can make manual changes.'
            : 'Inventory unlocked. All authorized users can make changes.'
        )
        // Refresh the page to update permissions
        window.location.reload()
      } else {
        toast.error(result.error || 'Failed to update lock status')
      }
    } catch {
      toast.error('An error occurred while updating lock status')
    } finally {
      setIsLoading(false)
      setShowConfirmDialog(false)
    }
  }

  return (
    <>
      <Button
        variant={isLocked ? 'destructive' : 'outline'}
        size="sm"
        onClick={handleToggle}
        disabled={isLoading}
        className="gap-2"
      >
        {isLocked ? (
          <>
            <Lock className="h-4 w-4" />
            Locked (Admin Only)
          </>
        ) : (
          <>
            <LockOpen className="h-4 w-4" />
            Unlocked
          </>
        )}
      </Button>

      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isLocked ? 'Unlock Inventory?' : 'Lock Inventory?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isLocked ? (
                <>
                  Unlocking inventory will allow all authorized users to create, edit, and delete
                  inventory items. Inventory will still be updated automatically through daily
                  reports.
                </>
              ) : (
                <>
                  Locking inventory will restrict create, edit, and delete operations to
                  administrators only. Other users will only be able to use inventory items in daily
                  reports and view the inventory list. Inventory quantities will still be updated
                  automatically when reports are submitted.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmToggle} disabled={isLoading}>
              {isLoading ? 'Updating...' : isLocked ? 'Unlock' : 'Lock'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
