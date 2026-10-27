// Three small dialogs used by the Today-tab sidebar's per-appointment
// dropdown so each action routes directly to its function instead of
// pushing the user back into the full detail dialog:
//
//   - <NoPaymentCheckInDialog>   — capture a reason, append to the
//     appointment notes, transition to checked_in.
//   - <RescheduleAppointmentDialog> — date + time only, prefilled from
//     the existing appointment. Marks the appointment 'rescheduled' when
//     the time actually changes and offers an SMS opt-in.
//   - <SendReminderDialog>       — preview the SMS template + patient
//     phone, confirm, then POST /appointment-workflow/:id/send-confirmation.

import { format } from 'date-fns'
import { CalendarClock, Loader2, Send } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  type BlockTimeLike,
  DEFAULT_APPOINTMENT_MINUTES,
  findBlockTimeForAppointment,
} from '@/features/appointments/conflicts'
import { checkInAppointment, updateAppointment } from '@/lib/actions/appointments'
import { getDoctorUnavailability } from '@/lib/actions/doctor-availability'
import { api } from '@/lib/api-client'
import { useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
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
import { Textarea } from '@/shared/components/ui/textarea'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { localDateISO } from '@/shared/lib/dates'

// ── Shared minimal appointment shape ─────────────────────────────────────────
// All three dialogs accept whatever appointment shape the caller has; we read
// only the fields we actually render or send, so the loose `[key: string]: unknown`
// in the column file stays compatible.

export interface ActionAppointment {
  id: string
  date: Date | string
  notes?: string | null
  /** Needed by the reschedule dialog to pre-check the doctor's block times. */
  doctorId?: string
  durationMinutes?: number | null
  patient?: { name?: string; phone?: string | null } | null
  doctor?: { user?: { name?: string } | null } | null
}

// ─── No-payment check-in ─────────────────────────────────────────────────────

/** The server refuses a shorter reason (checkInSchema in routes/appointment-workflow.ts). */
const MIN_NO_PAYMENT_REASON = 3

interface NoPaymentCheckInProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  appointment: ActionAppointment | null
  /** Fires after the appointment is marked checked-in successfully so the
   *  parent can refetch its list. */
  onCheckedIn?: () => void
}

export function NoPaymentCheckInDialog({
  open,
  onOpenChange,
  appointment,
  onCheckedIn,
}: NoPaymentCheckInProps) {
  const [reason, setReason] = useState('')
  const { isSubmitting, submit } = useSubmitGuard()

  useEffect(() => {
    if (!open) {
      setReason('')
    }
  }, [open])

  async function handleConfirm() {
    if (!appointment) return
    const trimmed = reason.trim()
    if (trimmed.length < MIN_NO_PAYMENT_REASON) {
      toast.error(`Give a reason of at least ${MIN_NO_PAYMENT_REASON} characters`)
      return
    }
    await submit(async () => {
      // The check-in request stamps the arrival, queues the doctor's note and keeps
      // the reason on the visit, and a repeat is harmless (the patient is simply
      // reported as already checked in).
      const res = await checkInAppointment(appointment.id, { noPaymentReason: trimmed })
      if (res.success) {
        if (res.data?.alreadyCheckedIn) toast.info('This patient was already checked in.')
        else toast.success('Checked in (no payment recorded)')
        onOpenChange(false)
        onCheckedIn?.()
      } else {
        surfaceApiError(res, 'Failed to check in')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !isSubmitting && onOpenChange(v)}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Check in without payment</DialogTitle>
          <DialogDescription>
            The appointment will move to <strong>Checked in</strong> and no payment record will be
            created. A short reason is required and gets appended to the appointment notes.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="no-pay-reason">Reason *</Label>
          <Textarea
            id="no-pay-reason"
            rows={4}
            placeholder="e.g. follow-up — covered by previous visit; consultation only; courtesy visit…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={isSubmitting}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isSubmitting || reason.trim().length < MIN_NO_PAYMENT_REASON}
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirm check-in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Reschedule ──────────────────────────────────────────────────────────────

interface RescheduleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  appointment: ActionAppointment | null
  /** Fires after a successful reschedule so the calendar can refetch. */
  onRescheduled?: () => void
}

/** Build the local YYYY-MM-DD / HH:MM strings the date+time inputs expect. */
function splitLocalDateTime(d: Date): { date: string; time: string } {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString()
  return { date: local.slice(0, 10), time: local.slice(11, 16) }
}

export function RescheduleAppointmentDialog({
  open,
  onOpenChange,
  appointment,
  onRescheduled,
}: RescheduleDialogProps) {
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [sendSms, setSendSms] = useState(true)
  const { isSubmitting, submit } = useSubmitGuard()

  // Prefill from the appointment whenever the dialog opens. The user can
  // adjust either field; we PATCH with the new combined timestamp on save.
  useEffect(() => {
    if (!open || !appointment) return
    const parts = splitLocalDateTime(new Date(appointment.date))
    setDate(parts.date)
    setTime(parts.time)
    setSendSms(true)
  }, [open, appointment])

  // Load the doctor's block times so an unavailable slot is caught before the
  // round-trip. The backend enforces this too (409 DOCTOR_UNAVAILABLE) — this
  // is just so the receptionist sees it while picking, not after saving.
  const doctorId = appointment?.doctorId
  const unavailabilityQuery = useApiQuery<BlockTimeLike[]>(
    queryKeys.appointments.unavailability(doctorId),
    () => getDoctorUnavailability(doctorId),
    { enabled: open && !!doctorId }
  )
  const blockTimes = unavailabilityQuery.data ?? []

  const blockConflict = useMemo(() => {
    if (!doctorId || !date || !time) return null
    const start = new Date(`${date}T${time}`)
    if (Number.isNaN(start.getTime())) return null
    const minutes = appointment?.durationMinutes || DEFAULT_APPOINTMENT_MINUTES
    const end = new Date(start.getTime() + minutes * 60_000)
    return findBlockTimeForAppointment(doctorId, start.toISOString(), end.toISOString(), blockTimes)
  }, [doctorId, date, time, blockTimes, appointment?.durationMinutes])

  async function handleSave() {
    if (!appointment) return
    if (!date || !time) {
      toast.error('Date and time are required')
      return
    }
    const next = new Date(`${date}T${time}`)
    if (Number.isNaN(next.getTime())) {
      toast.error('Invalid date/time')
      return
    }
    const current = new Date(appointment.date)
    const changed = next.getTime() !== current.getTime()
    if (!changed) {
      toast.error('Pick a different date or time')
      return
    }
    if (blockConflict) {
      toast.error('Doctor is unavailable during this time')
      return
    }

    await submit(async () => {
      const res = await updateAppointment(
        appointment.id,
        { date: next, status: 'rescheduled' },
        sendSms
      )
      if (res.success) {
        if (res.smsError) {
          toast.warning(`Rescheduled, but SMS failed: ${res.smsError}`)
        } else if (res.smsSent) {
          toast.success('Rescheduled and patient notified by SMS')
        } else {
          toast.success('Appointment rescheduled')
        }
        onOpenChange(false)
        onRescheduled?.()
      } else {
        surfaceApiError(res, 'Failed to reschedule')
      }
    })
  }

  const todayStr = localDateISO()

  return (
    <Dialog open={open} onOpenChange={(v) => !isSubmitting && onOpenChange(v)}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            Reschedule appointment
          </DialogTitle>
          <DialogDescription>
            {appointment?.patient?.name ? <>For {appointment.patient.name}. </> : null}
            Pick a new date and time. Status will flip to <strong>rescheduled</strong>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="reschedule-date">New date *</Label>
              <Input
                id="reschedule-date"
                type="date"
                min={todayStr}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reschedule-time">New time *</Label>
              <Input
                id="reschedule-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
          </div>
          {blockConflict && (
            <p className="text-xs text-destructive" role="alert">
              {appointment?.doctor?.user?.name ?? 'Doctor'} is unavailable during this time
              {blockConflict.reason ? ` — ${blockConflict.reason}.` : '.'}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Checkbox
              id="reschedule-sms"
              checked={sendSms}
              onCheckedChange={(c) => setSendSms(c === true)}
              disabled={isSubmitting}
            />
            <Label htmlFor="reschedule-sms" className="cursor-pointer text-sm">
              Notify patient by SMS
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSubmitting || !date || !time || !!blockConflict}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save new time
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Send Reminder ───────────────────────────────────────────────────────────

interface SendReminderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  appointment: ActionAppointment | null
  /** Fires after the SMS attempt regardless of result, so callers can clear
   *  loading state etc. */
  onSent?: () => void
}

/** Mirror of the backend's hardcoded confirmation SMS template
 *  (backend/src/routes/appointment-workflow.ts) so the preview shown to the
 *  receptionist matches what the patient receives. The trailing confirmation
 *  URL is server-generated (token rotates per send) — we show a placeholder.
 *  Uses date-fns format() with fixed locale-neutral patterns so server and
 *  browser renderings are identical regardless of the user's locale. */
function buildReminderPreview(appt: ActionAppointment): string {
  const date = new Date(appt.date)
  const patientName = appt.patient?.name || 'Patient'
  const doctorName = appt.doctor?.user?.name || 'your doctor'
  const dateStr = format(date, 'MM/dd/yyyy')
  const timeStr = format(date, 'hh:mm a')
  return `Hi ${patientName}, reminder: appointment at Denel Dental on ${dateStr} at ${timeStr} with ${doctorName}. Confirm or cancel: <confirmation-link>`
}

export function SendReminderDialog({
  open,
  onOpenChange,
  appointment,
  onSent,
}: SendReminderDialogProps) {
  const { isSubmitting, submit } = useSubmitGuard()

  if (!appointment) {
    return null
  }

  const message = buildReminderPreview(appointment)
  const phone = appointment.patient?.phone || null
  const apptDate = new Date(appointment.date)

  async function handleSend() {
    if (!appointment) return
    await submit(async () => {
      const res = await api.post(
        `/api/appointment-workflow/${appointment.id}/send-confirmation`,
        {}
      )
      if (res.success) {
        toast.success('Reminder sent')
        onOpenChange(false)
        onSent?.()
      } else {
        surfaceApiError(res, 'Failed to send reminder')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !isSubmitting && onOpenChange(v)}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" />
            Send appointment reminder?
          </DialogTitle>
          <DialogDescription>
            The patient will receive an SMS reminder with a confirmation link they can use to
            confirm or cancel.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">To</span>
              <span className="font-medium">
                {appointment.patient?.name ?? 'Unknown patient'}
                {phone ? ` · ${phone}` : ''}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">When</span>
              <span className="font-medium">
                {format(apptDate, 'EEE, MMM d')} · {format(apptDate, 'h:mm a')}
              </span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Message preview
            </Label>
            <div className="rounded-md border bg-card p-3 text-sm leading-relaxed whitespace-pre-wrap">
              {message}
            </div>
            <p className="text-[11px] text-muted-foreground">
              The <code>&lt;confirmation-link&gt;</code> is generated on send — a fresh token
              rotates every time so old links are invalidated.
            </p>
          </div>
          {!phone && (
            <p className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-2 text-xs text-amber-900 dark:text-amber-200">
              No phone number on file — the send will be rejected. Add a phone to the patient record
              first.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={isSubmitting || !phone}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send reminder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
