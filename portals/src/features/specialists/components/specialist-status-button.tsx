import { UserCheck, UserX } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  deactivateSpecialist,
  reactivateSpecialist,
  type Specialist,
} from '@/lib/actions/specialists'
import { ACTIONS, MODULES } from '@/lib/modules'
import { useCan } from '@/lib/permissions-context'
import { Button } from '@/shared/components/ui/button'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'

interface SpecialistStatusButtonProps {
  specialist: Specialist
  /** Called after the status changed, so the page and list can refetch. */
  onChanged: () => void
}

/**
 * Deactivate / reactivate a specialist.
 *
 * Deactivating is the delete-side privilege (`specialists:delete`); bringing
 * someone back is an ordinary update. Each side is shown only to a caller who
 * holds the matching permission, and the backend enforces the same split — this
 * isn't the gate, just no point offering a button that always 403s.
 *
 * The confirmation says what actually happens, including the login: the backend
 * suspends it and ends open sessions on deactivation, because the flag alone
 * only hides a doctor from scheduling.
 */
export function SpecialistStatusButton({ specialist, onChanged }: SpecialistStatusButtonProps) {
  const canDeactivate = useCan(MODULES.SPECIALISTS, ACTIONS.DELETE)
  const canReactivate = useCan(MODULES.SPECIALISTS, ACTIONS.UPDATE)
  const [open, setOpen] = useState(false)

  const isActive = specialist.isActive
  if (isActive ? !canDeactivate : !canReactivate) return null

  const hasLogin = Boolean(specialist.userId)

  async function handleConfirm() {
    const res = isActive
      ? await deactivateSpecialist(specialist.id)
      : await reactivateSpecialist(specialist.id)
    if (!res.success) {
      toast.error(res.error ?? `Could not ${isActive ? 'deactivate' : 'reactivate'} specialist`)
      // Throwing keeps the dialog open so the admin can retry or cancel.
      throw new Error(res.error ?? 'Request failed')
    }
    toast.success(`${specialist.name} ${isActive ? 'deactivated' : 'reactivated'}`)
    onChanged()
  }

  return (
    <>
      {isActive ? (
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => setOpen(true)}
        >
          <UserX className="mr-2 h-3.5 w-3.5" />
          Deactivate
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <UserCheck className="mr-2 h-3.5 w-3.5" />
          Reactivate
        </Button>
      )}

      <DeleteConfirmationDialog
        open={open}
        onOpenChange={setOpen}
        onConfirm={handleConfirm}
        tone="default"
        confirmLabel={isActive ? 'Deactivate' : 'Reactivate'}
        title={isActive ? `Deactivate ${specialist.name}?` : `Reactivate ${specialist.name}?`}
        description={
          isActive
            ? `They will no longer appear when booking appointments. Existing appointments, invoices and commission history are kept.${
                hasLogin
                  ? ' Their portal login is suspended and any open sessions end immediately.'
                  : ''
              } You can reactivate them at any time.`
            : `They will appear in appointment booking again.${
                hasLogin
                  ? ' Their portal login is restored, unless it was suspended separately in Access Management.'
                  : ''
              }`
        }
      />
    </>
  )
}
