import { format } from 'date-fns'
import { Calendar, Clock, Loader2, Trash2, User } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { deleteUnavailability } from '@/lib/actions/doctor-availability'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'

interface Unavailability {
  id: string
  doctorId: string
  startTime: Date | string
  endTime: Date | string
  reason?: string | null
  doctor?: {
    user?: {
      name: string
    }
  }
  [key: string]: unknown
}

interface UnavailabilityDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  unavailability: Unavailability | null
  onReload?: () => void
}

export function UnavailabilityDetailDialog({
  open,
  onOpenChange,
  unavailability,
  onReload,
}: UnavailabilityDetailDialogProps) {
  const navigate = useNavigate()
  const [isDeleting, setIsDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  if (!unavailability) return null

  const startTime = new Date(unavailability.startTime)
  const endTime = new Date(unavailability.endTime)

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      const result = await deleteUnavailability(unavailability.id)

      if (result.success) {
        toast.success('Blocked time removed successfully')
        if (onReload) {
          onReload()
        } else {
          navigate(0)
        }
        onOpenChange(false)
        setShowDeleteConfirm(false)
      } else {
        toast.error(result.error || 'Failed to remove blocked time')
      }
    } catch (error) {
      console.error('Error deleting unavailability:', error)
      toast.error('An error occurred while removing blocked time')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Blocked Time</DialogTitle>
            <DialogDescription>View and manage blocked time slot</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Doctor */}
            <div className="flex items-start gap-3">
              <User className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div className="flex-1 space-y-1">
                <div className="text-xs text-muted-foreground">Doctor</div>
                <div className="text-sm font-medium">
                  {unavailability.doctor?.user?.name || 'Unknown Doctor'}
                </div>
              </div>
            </div>

            {/* Date */}
            <div className="flex items-start gap-3">
              <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div className="flex-1 space-y-1">
                <div className="text-xs text-muted-foreground">Date</div>
                <div className="text-sm font-medium">{format(startTime, 'EEEE, MMMM d, yyyy')}</div>
              </div>
            </div>

            {/* Time */}
            <div className="flex items-start gap-3">
              <Clock className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div className="flex-1 space-y-1">
                <div className="text-xs text-muted-foreground">Time</div>
                <div className="text-sm font-medium">
                  {format(startTime, 'h:mm a')} - {format(endTime, 'h:mm a')}
                </div>
              </div>
            </div>

            {/* Reason */}
            {unavailability.reason && (
              <div className="flex items-start gap-3">
                <div className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="flex-1 space-y-1">
                  <div className="text-xs text-muted-foreground">Reason</div>
                  <div className="text-sm">{unavailability.reason}</div>
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button
              variant="destructive"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isDeleting}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Remove Block
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Blocked Time?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this blocked time slot from the calendar. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
