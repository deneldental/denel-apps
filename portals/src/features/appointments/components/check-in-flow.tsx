import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { NoPaymentCheckInDialog } from '@/features/appointments/components/appointment-action-dialogs'
import { AcceptPaymentSheet } from '@/features/payments/components/accept-payment-sheet'
import { checkInAppointment } from '@/lib/actions/appointments'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'

/** How a check-in attempt ended, so the caller can refresh and close. */
export type CheckInOutcome = 'checked_in' | 'payment_only' | 'cancelled'

type Stage = 'payment' | 'no-payment' | 'retry'

interface CheckInFlowProps {
  /** The visit being checked in, or null when no check-in is under way. */
  appointment: { id: string; patientId?: string; patient?: { name?: string | null } | null } | null
  /** Called once when the attempt ends, whichever way. The caller closes and refreshes. */
  onFinished: (outcome: CheckInOutcome) => void
}

/**
 * The whole "check a patient in" experience, shared by the appointment detail dialog
 * and the Today column (F09/F10/F11).
 *
 *  1. Choose how the visit is paid for. The payment sheet is told WHICH visit, so
 *     any payment it records names it (F11).
 *  2. A one-time payment is taken by the check-in request itself, so payment, status
 *     and the doctor's note are all or nothing. A plan or insurance payment is
 *     recorded first and the check-in follows as its own request.
 *  3. If that follow-up fails the payment already exists, so the failure is stated
 *     plainly and the retry can only check in, never charge again (F10). The screen
 *     never reports success it did not get.
 */
export function CheckInFlow({ appointment, onFinished }: CheckInFlowProps) {
  const id = appointment?.id ?? null
  // Stage is remembered per visit, so selecting a different visit starts afresh.
  const [progress, setProgress] = useState<{
    id: string
    stage: Stage | null
    failure: string
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stage: Stage | null = !id ? null : progress?.id === id ? progress.stage : 'payment'
  const failure = progress?.id === id ? progress.failure : ''

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    },
    []
  )

  const finish = (outcome: CheckInOutcome) => {
    if (id) setProgress({ id, stage: null, failure: '' })
    onFinished(outcome)
  }

  // The child sheets close themselves just BEFORE they report success or "no
  // payment", so a close on its own is not yet a cancellation. Wait one tick: if a
  // success or a hand-over follows, `settle` cancels the pending close.
  const closedByChild = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null
      finish('cancelled')
    }, 0)
  }
  const settle = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  const showFailure = (message: string) => {
    if (id) setProgress({ id, stage: 'retry', failure: message })
  }

  /** Check in after a payment that was recorded separately. Safe to repeat: it takes no money. */
  const confirmCheckIn = async () => {
    if (!appointment || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const res = await checkInAppointment(appointment.id, { paymentRecordedElsewhere: true })
      if (res.success) {
        if (res.data?.alreadyCheckedIn) toast.info('This patient was already checked in.')
        else toast.success('Checked in')
        finish('checked_in')
      } else {
        showFailure(res.error || 'The patient could not be checked in.')
      }
    } catch (err) {
      showFailure(err instanceof Error ? err.message : 'Network error')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const handlePaymentSuccess = (info?: { checkedIn?: boolean }) => {
    settle()
    // A one-time payment was taken by the check-in request, which also checked the
    // patient in. Anything else still needs the check-in step.
    if (info?.checkedIn) finish('checked_in')
    else void confirmCheckIn()
  }

  const patientName = appointment?.patient?.name || 'The patient'

  return (
    <>
      <AcceptPaymentSheet
        open={stage === 'payment'}
        onOpenChange={(open) => {
          if (!open && stage === 'payment') closedByChild()
        }}
        presetPatientId={appointment?.patientId}
        appointmentId={appointment?.id}
        onSuccess={handlePaymentSuccess}
        showNoPaymentOption
        onNoPayment={() => {
          settle()
          if (id) setProgress({ id, stage: 'no-payment', failure: '' })
        }}
      />

      <NoPaymentCheckInDialog
        open={stage === 'no-payment'}
        onOpenChange={(open) => {
          if (!open && stage === 'no-payment') closedByChild()
        }}
        appointment={appointment as never}
        onCheckedIn={() => {
          settle()
          finish('checked_in')
        }}
      />

      <Dialog
        open={stage === 'retry'}
        onOpenChange={(open) => {
          if (!open && !busy) finish('payment_only')
        }}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Payment recorded — check-in failed</DialogTitle>
            <DialogDescription>
              {patientName}&apos;s payment was recorded, but they could not be checked in: {failure}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Checking in again will not take another payment.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => finish('payment_only')} disabled={busy}>
              Not now
            </Button>
            <Button onClick={() => void confirmCheckIn()} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Check in again
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
