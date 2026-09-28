import { format } from 'date-fns'
import {
  AlertTriangle,
  Armchair,
  Calendar,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileText,
  Flag,
  Loader2,
  Pencil,
  Send,
  Stethoscope,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { SendReminderDialog } from '@/features/appointments/components/appointment-action-dialogs'
import { AcceptPaymentSheet } from '@/features/payments/components/accept-payment-sheet'
import { updateAppointment } from '@/lib/actions/appointments'
import { getDoctorUnavailability } from '@/lib/actions/doctor-availability'
import { getDoctors } from '@/lib/actions/doctors'
import { getAppointmentSyncStatus, resyncAppointmentToGoogle } from '@/lib/actions/google-calendar'
import { api } from '@/lib/api-client'
import { PatientPicker } from '@/shared/components/patient-picker'
import { Badge } from '@/shared/components/ui/badge'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Textarea } from '@/shared/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip'
import { useLookup } from '@/shared/hooks/use-lookup'

export interface Appointment {
  id: string
  patientId: string
  doctorId: string
  date: Date | string
  durationMinutes: number
  status: string
  type: string
  notes?: string | null
  patient?: {
    name: string
    phone?: string | null
  }
  doctor?: {
    specialty?: string | null
    user?: {
      name: string
    }
  }
  [key: string]: unknown
}

interface AppointmentDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  appointment: Appointment | null
  onUpdate?: () => void
  onDelete?: () => void
  readOnly?: boolean
  /** Admins can override the past-appointment lock with a reason. */
  isAdmin?: boolean
}

export function AppointmentDetailDialog({
  open,
  onOpenChange,
  appointment,
  onUpdate,
  onDelete,
  readOnly = false,
  isAdmin = false,
}: AppointmentDetailDialogProps) {
  const _navigate = useNavigate()
  const [isEditMode, setIsEditMode] = useState(false)
  const [isRescheduleMode, setIsRescheduleMode] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [showSendReminderConfirm, setShowSendReminderConfirm] = useState(false)
  const [showNoShowDialog, setShowNoShowDialog] = useState(false)
  const [noShowNote, setNoShowNote] = useState('')
  interface Doctor {
    id: string
    user?: {
      name: string
    }
  }
  const [doctorsList, setDoctorsList] = useState<Doctor[]>([])
  // Shared appointment-type lookup — refreshes when Settings edits it, no reload.
  const { rows: appointmentTypesList } = useLookup('appointment-types', {
    enabled: isEditMode && open,
  })
  const [showCheckInPaymentDialog, setShowCheckInPaymentDialog] = useState(false)
  /** Reason captured when an admin edits a past appointment. */
  const [overrideReason, setOverrideReason] = useState('')
  /** Google Calendar mirror status for this appointment. */
  const [gcalSync, setGcalSync] = useState<{
    method?: 'oauth' | 'service_account'
    configured: boolean
    doctorConnected: boolean
    eventLinked: boolean
    syncedAt: string | null
  } | null>(null)
  const [gcalResyncing, setGcalResyncing] = useState(false)

  // Form state
  const [formData, setFormData] = useState({
    date: '',
    time: '',
    type: '',
    status: '',
    notes: '',
    patientId: '',
    doctorId: '',
  })
  const [sendSMS, setSendSMS] = useState(false)

  const [blockTimes, setBlockTimes] = useState<any[]>([])

  useEffect(() => {
    if (open && formData.doctorId) {
      getDoctorUnavailability(formData.doctorId).then((res) => {
        if (res.success && res.data) {
          setBlockTimes(res.data)
        }
      })
    }
  }, [open, formData.doctorId])

  const editConflict = useMemo(() => {
    if (!formData.doctorId || !formData.date || !formData.time) return null
    if (
      formData.status !== 'scheduled' &&
      formData.status !== 'rescheduled' &&
      formData.status !== 'checked_in'
    ) {
      return null
    }

    const start = new Date(`${formData.date}T${formData.time}`)
    if (Number.isNaN(start.getTime())) return null
    const end = new Date(start.getTime() + (appointment?.durationMinutes || 30) * 60_000)

    for (const bt of blockTimes) {
      if (bt.doctorId !== formData.doctorId) continue
      const btStart = new Date(bt.startTime).getTime()
      const btEnd = new Date(bt.endTime).getTime()
      if (start.getTime() < btEnd && btStart < end.getTime()) {
        return bt
      }
    }
    return null
  }, [
    formData.doctorId,
    formData.date,
    formData.time,
    formData.status,
    blockTimes,
    appointment?.durationMinutes,
  ])

  const hasBlockConflict = useMemo(() => {
    if (!appointment || blockTimes.length === 0) return false
    const apptStart = new Date(appointment.date).getTime()
    const apptEnd = apptStart + (appointment.durationMinutes || 30) * 60_000
    if (
      appointment.status !== 'scheduled' &&
      appointment.status !== 'rescheduled' &&
      appointment.status !== 'checked_in'
    ) {
      return false
    }

    return blockTimes.some((bt) => {
      const btStart = new Date(bt.startTime).getTime()
      const btEnd = new Date(bt.endTime).getTime()
      return apptStart < btEnd && btStart < apptEnd
    })
  }, [appointment, blockTimes])

  useEffect(() => {
    if (!appointment) return

    const appointmentDate = new Date(appointment.date)
    const dateStr = new Date(
      appointmentDate.getTime() - appointmentDate.getTimezoneOffset() * 60000
    )
      .toISOString()
      .slice(0, 10)
    const timeStr = new Date(
      appointmentDate.getTime() - appointmentDate.getTimezoneOffset() * 60000
    )
      .toISOString()
      .slice(11, 16)

    setFormData({
      date: dateStr,
      time: timeStr,
      type: appointment.type || '',
      status: appointment.status || 'scheduled',
      notes: appointment.notes || '',
      patientId: appointment.patientId || '',
      doctorId: appointment.doctorId || '',
    })
  }, [appointment])

  // Fetch the Google Calendar sync status for the row we're viewing.
  useEffect(() => {
    if (!open || !appointment?.id) {
      setGcalSync(null)
      return
    }
    let cancelled = false
    getAppointmentSyncStatus(appointment.id).then((r) => {
      if (cancelled) return
      if (r.success && r.data) setGcalSync(r.data)
    })
    return () => {
      cancelled = true
    }
  }, [open, appointment?.id])

  useEffect(() => {
    if (isEditMode && open) {
      getDoctors().then((res) => {
        if (res.success) {
          setDoctorsList(res.data || [])
        } else {
          toast.error(res.error || 'Failed to load doctors')
        }
      })
    }
  }, [isEditMode, open])

  useEffect(() => {
    if (!open) {
      setIsEditMode(false)
      setIsRescheduleMode(false)
    }
  }, [open])

  if (!appointment) return null

  const appointmentDate = new Date(appointment.date)
  const endTime = new Date(appointmentDate.getTime() + (appointment.durationMinutes || 30) * 60000)

  // Past-appointment lock. Threshold: start-of-today. Admins can override but
  // must enter a reason — handled by the global confirm dialog further down.
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const isPast = appointmentDate < startOfToday
  // For non-admins, isPast collapses straight into the existing readOnly path
  // (Edit/Delete buttons in the header + the entire mutation footer disappear).
  const lockedForRole = readOnly || (isPast && !isAdmin)
  const adminCanOverridePast = isPast && isAdmin && !readOnly

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled':
        return 'default'
      case 'confirmed':
      case 'checked_in':
      case 'in_chair':
        return 'secondary'
      case 'completed':
        return 'secondary'
      case 'cancelled':
      case 'no_show':
      case 'no-show':
        return 'destructive'
      default:
        return 'outline'
    }
  }

  const handleSave = async () => {
    if (!appointment) return

    setIsLoading(true)

    try {
      // Combine date and time into a single Date object
      const dateTime = new Date(`${formData.date}T${formData.time}`)

      // Check if date/time has changed (rescheduled)
      const originalDate = new Date(appointment.date)
      const originalDateStr = new Date(
        originalDate.getTime() - originalDate.getTimezoneOffset() * 60000
      )
        .toISOString()
        .slice(0, 10)
      const originalTimeStr = new Date(
        originalDate.getTime() - originalDate.getTimezoneOffset() * 60000
      )
        .toISOString()
        .slice(11, 16)

      const isRescheduled = formData.date !== originalDateStr || formData.time !== originalTimeStr

      // If rescheduled, update status to 'rescheduled' (unless it's already cancelled or completed)
      let status = formData.status
      if (isRescheduled && appointment.status === 'scheduled') {
        status = 'rescheduled'
      }

      const updateData = {
        date: dateTime,
        type: formData.type,
        status: status,
        notes: formData.notes || null,
        patientId: formData.patientId,
        doctorId: formData.doctorId,
      }

      // Past-appointment admin override — the backend rejects past edits
      // without a 3+ char reason. Validate here so the toast is descriptive.
      const isPastNow =
        new Date(appointment.date) <
        (() => {
          const t = new Date()
          t.setHours(0, 0, 0, 0)
          return t
        })()
      if (isPastNow && overrideReason.trim().length < 3) {
        toast.error('Editing a past appointment requires a reason (3+ chars).')
        setIsLoading(false)
        return
      }

      // Check if rescheduling or changing doctor hits a blocked time slot
      const movesTime = formData.date !== originalDateStr || formData.time !== originalTimeStr
      const movesDoctor = formData.doctorId !== appointment.doctorId
      if ((movesTime || movesDoctor) && editConflict) {
        toast.error(
          `Doctor is unavailable during this time (${editConflict.reason || 'Blocked slot'})`
        )
        setIsLoading(false)
        return
      }

      const result = await updateAppointment(
        appointment.id,
        updateData,
        sendSMS,
        isPastNow ? overrideReason.trim() : undefined
      )

      if (result.success) {
        if (isRescheduled) {
          if (result.smsError) {
            toast.warning(`Appointment rescheduled, but SMS failed: ${result.smsError}`)
          } else {
            const message = result.smsSent
              ? 'Appointment rescheduled and SMS notification sent.'
              : 'Appointment rescheduled successfully.'
            toast.success(message)
          }
        } else {
          toast.success('Appointment updated successfully.')
        }
        setIsEditMode(false)
        setIsRescheduleMode(false)
        onUpdate?.()
      } else {
        toast.error(result.error || 'Failed to update appointment.')
      }
    } catch {
      toast.error('An error occurred while updating the appointment.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCancel = () => {
    // Reset form data to original appointment values
    if (appointment) {
      const appointmentDate = new Date(appointment.date)
      const dateStr = new Date(
        appointmentDate.getTime() - appointmentDate.getTimezoneOffset() * 60000
      )
        .toISOString()
        .slice(0, 10)
      const timeStr = new Date(
        appointmentDate.getTime() - appointmentDate.getTimezoneOffset() * 60000
      )
        .toISOString()
        .slice(11, 16)

      setFormData({
        date: dateStr,
        time: timeStr,
        type: appointment.type || '',
        status: appointment.status || 'scheduled',
        notes: appointment.notes || '',
        patientId: appointment.patientId || '',
        doctorId: appointment.doctorId || '',
      })
    }
    setIsEditMode(false)
    setIsRescheduleMode(false)
  }

  const handleReschedule = () => {
    // Enter edit mode scoped to reschedule (date/time + SMS toggle only)
    setIsEditMode(true)
    setIsRescheduleMode(true)
  }

  const handleCancelAppointment = async () => {
    if (!appointment) return

    setIsLoading(true)
    try {
      const result = await updateAppointment(appointment.id, {
        status: 'cancelled',
      })

      if (result.success) {
        toast.success('Appointment cancelled successfully.')
        onUpdate?.()
      } else {
        toast.error(result.error || 'Failed to cancel appointment.')
      }
    } catch {
      toast.error('An error occurred while cancelling the appointment.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCheckIn = () => {
    if (!appointment) return

    if (appointment.status !== 'scheduled') {
      toast.error('Only scheduled appointments can be checked in.')
      return
    }

    // Open the check-in payment dialog
    setShowCheckInPaymentDialog(true)
  }

  const handleCheckInSuccess = () => {
    // Close both dialogs
    setShowCheckInPaymentDialog(false)
    onOpenChange(false)
    // Trigger refresh
    onUpdate?.()
  }

  // ── Workflow transitions (Phase 1.5) ────────────────────────────────────────
  async function runTransition(
    action: 'seat' | 'complete' | 'no-show' | 'cancel',
    label: string,
    notes?: string
  ) {
    if (!appointment) return
    setIsLoading(true)
    try {
      const payload: { action: string; notes?: string } = { action }
      if (notes?.trim()) payload.notes = notes.trim()
      const res = await api.patch(`/api/appointment-workflow/${appointment.id}/transition`, payload)
      if (res.success) {
        toast.success(label)
        onUpdate?.()
        onOpenChange(false)
      } else {
        toast.error((res.error as string) || 'Failed')
      }
    } finally {
      setIsLoading(false)
    }
  }

  async function confirmNoShow() {
    await runTransition('no-show', 'Marked as no-show', noShowNote)
    setShowNoShowDialog(false)
    setNoShowNote('')
  }

  // Send-reminder is now delegated to <SendReminderDialog> (in
  // `appointment-action-dialogs.tsx`) so the preview + send are shared with
  // the Today-tab sidebar. The icon button just toggles the dialog open.

  async function handleResyncGcal() {
    if (!appointment) return
    setGcalResyncing(true)
    try {
      const res = await resyncAppointmentToGoogle(appointment.id)
      if (res.success) {
        toast.success('Synced to Google Calendar')
        // Refetch the status so the UI flips from pending → synced.
        const updated = await getAppointmentSyncStatus(appointment.id)
        if (updated.success && updated.data) setGcalSync(updated.data)
      } else {
        toast.error((res.error as string) || 'Failed to sync')
      }
    } finally {
      setGcalResyncing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        aria-describedby={undefined}
      >
        <DialogHeader className="space-y-4">
          <DialogTitle>Appointment Details</DialogTitle>

          {isPast && (
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-3 text-xs text-amber-900 dark:text-amber-200">
              {lockedForRole ? (
                <>This appointment has passed. Details are read-only.</>
              ) : (
                <>
                  <strong>Past appointment.</strong> Admin edits are logged with the reason you
                  provide.
                </>
              )}
            </div>
          )}

          {hasBlockConflict && !isEditMode && (
            <div className="rounded-md border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-900 p-3 text-xs text-rose-900 dark:text-rose-200 flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <strong>Schedule Conflict:</strong> This appointment overlaps with a blocked time
                slot on the doctor's calendar. Please reschedule.
              </div>
            </div>
          )}

          {editConflict && isEditMode && (
            <div className="rounded-md border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-900 p-3 text-xs text-rose-900 dark:text-rose-200 flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <strong>Doctor Blocked:</strong> Doctor is unavailable during this time (
                {editConflict.reason || 'Blocked slot'}). Rescheduling will fail.
              </div>
            </div>
          )}

          {isEditMode && adminCanOverridePast && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-3 space-y-2">
              <Label
                htmlFor="override-reason"
                className="text-xs font-medium text-amber-900 dark:text-amber-200"
              >
                Reason for editing this past appointment <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="override-reason"
                rows={2}
                placeholder="e.g. patient called to correct the time; record was wrong"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                className="text-sm"
              />
              <p className="text-[11px] text-amber-700 dark:text-amber-300">
                Required (3+ chars). Stored in the audit log.
              </p>
            </div>
          )}

          {!isEditMode ? (
            <div className="space-y-6">
              {/* Top action bar — Google-Calendar-style icon row.
                  Status-aware: only renders the actions that apply to the
                  current appointment.status. Less-common actions collapse
                  into the "more" menu so the row stays scannable. */}
              {!lockedForRole && (
                <TooltipProvider delayDuration={120}>
                  <div className="flex items-center justify-end gap-0.5 -mt-1">
                    <IconAction
                      icon={<Pencil className="h-4 w-4" />}
                      label="Edit"
                      onClick={() => setIsEditMode(true)}
                      disabled={isLoading}
                    />
                    {(appointment.status === 'scheduled' ||
                      appointment.status === 'confirmed' ||
                      appointment.status === 'rescheduled') && (
                      <>
                        <IconAction
                          icon={<CheckCircle2 className="h-4 w-4" />}
                          label="Check in"
                          tone="success"
                          onClick={handleCheckIn}
                          disabled={isLoading}
                        />
                        <IconAction
                          icon={<Send className="h-4 w-4" />}
                          label="Send reminder"
                          onClick={() => setShowSendReminderConfirm(true)}
                          disabled={isLoading}
                        />
                        <IconAction
                          icon={<CalendarClock className="h-4 w-4" />}
                          label="Reschedule"
                          onClick={handleReschedule}
                          disabled={isLoading}
                        />
                      </>
                    )}
                    {appointment.status === 'checked_in' && (
                      <IconAction
                        icon={<Armchair className="h-4 w-4" />}
                        label="Seat patient"
                        tone="success"
                        onClick={() => runTransition('seat', 'Patient seated')}
                        disabled={isLoading}
                      />
                    )}
                    {appointment.status === 'in_chair' && (
                      <IconAction
                        icon={<CheckCircle2 className="h-4 w-4" />}
                        label="Mark completed"
                        tone="success"
                        onClick={() => runTransition('complete', 'Appointment completed')}
                        disabled={isLoading}
                      />
                    )}
                    {/* Pre-arrival statuses get the full transition set as
                        direct icons — no nested menu, since the receptionist
                        triggers no-show / cancel often enough that hiding
                        them behind a kebab adds a click without value. */}
                    {(appointment.status === 'scheduled' ||
                      appointment.status === 'confirmed' ||
                      appointment.status === 'rescheduled') && (
                      <IconAction
                        icon={<Flag className="h-4 w-4" />}
                        label="Mark no-show"
                        tone="warning"
                        onClick={() => setShowNoShowDialog(true)}
                        disabled={isLoading}
                      />
                    )}
                    {(appointment.status === 'scheduled' ||
                      appointment.status === 'confirmed' ||
                      appointment.status === 'rescheduled' ||
                      appointment.status === 'checked_in') && (
                      <IconAction
                        icon={<X className="h-4 w-4" />}
                        label="Cancel appointment"
                        tone="destructive"
                        onClick={handleCancelAppointment}
                        disabled={isLoading}
                      />
                    )}
                    {/* Delete hidden on past admin overrides — admins should
                        cancel-via-edit (captures the reason in audit). */}
                    {!isPast && onDelete && (
                      <IconAction
                        icon={<Trash2 className="h-4 w-4" />}
                        label="Delete"
                        tone="destructive"
                        onClick={() => onDelete?.()}
                        disabled={isLoading}
                      />
                    )}
                  </div>
                </TooltipProvider>
              )}

              {/* Title Section */}
              <div className="space-y-2">
                <div className="flex items-start gap-3">
                  <div className="space-y-2 flex-1">
                    <Badge variant={getStatusColor(appointment.status)} className="capitalize">
                      {appointment.status.replace('_', ' ')}
                    </Badge>
                    <div className="text-2xl font-semibold">
                      {`${appointment.type.charAt(0).toUpperCase() + appointment.type.slice(1)} — ${appointment.patient?.name || 'Unknown Patient'}`}
                    </div>
                  </div>
                </div>
              </div>

              {/* Date and Time — moved above the patient/doctor row so the
                  primary "when" sits next to the title; the duplicate
                  date line under the title has been removed. */}
              <div className="flex items-start gap-3">
                <Clock className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="flex-1 space-y-1">
                  <div className="text-xs text-muted-foreground">Date and Time</div>
                  <div className="text-sm">
                    {format(appointmentDate, 'EEEE, MMMM d')} • {format(appointmentDate, 'h:mm a')}{' '}
                    - {format(endTime, 'h:mm a')}
                  </div>
                </div>
              </div>

              {/* Patient + Doctor — two columns so they sit side-by-side on
                  any reasonable dialog width, stacking only on the narrowest
                  viewports. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex items-start gap-3">
                  <User className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div className="flex-1 space-y-1 min-w-0">
                    <div className="text-xs text-muted-foreground">Patient</div>
                    <div className="text-sm font-medium truncate">
                      {appointment.patient?.name || 'Unknown Patient'}
                    </div>
                    {appointment.patient?.phone && (
                      <div className="text-xs text-muted-foreground truncate">
                        {appointment.patient.phone}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Stethoscope className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div className="flex-1 space-y-1 min-w-0">
                    <div className="text-xs text-muted-foreground">Doctor</div>
                    <div className="text-sm font-medium truncate">
                      {appointment.doctor?.user?.name || 'Unknown Doctor'}
                    </div>
                    {appointment.doctor?.specialty && (
                      <div className="text-xs text-muted-foreground truncate">
                        {appointment.doctor.specialty}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Google Calendar sync state */}
              {gcalSync && (
                <div className="flex items-start gap-3">
                  <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div className="flex-1 space-y-1">
                    <div className="text-xs text-muted-foreground">
                      Google Calendar
                      {gcalSync.method && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                          {gcalSync.method === 'service_account' ? 'Service account' : 'OAuth'}
                        </span>
                      )}
                    </div>
                    {!gcalSync.configured ? (
                      <div className="text-sm text-muted-foreground">Not configured on server</div>
                    ) : gcalSync.eventLinked ? (
                      <div className="text-sm text-emerald-700 dark:text-emerald-400">
                        ✓ Synced
                        {gcalSync.syncedAt && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({format(new Date(gcalSync.syncedAt), 'MMM d, h:mm a')})
                          </span>
                        )}
                        {gcalSync.method === 'service_account' && (
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            Written to the shared clinic calendar. Inviting attendees needs Google
                            Workspace Domain-Wide Delegation — without it the doctor / patient won't
                            get an email invite and must subscribe to the shared calendar to see it.
                          </p>
                        )}
                      </div>
                    ) : gcalSync.method !== 'service_account' && !gcalSync.doctorConnected ? (
                      <div className="text-sm text-muted-foreground">
                        Doctor hasn't connected their Google account
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="text-sm text-amber-700 dark:text-amber-400">
                          Not yet synced — the event may already exist on the calendar without a
                          link record on our end.
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleResyncGcal}
                          disabled={gcalResyncing || isLoading}
                        >
                          {gcalResyncing && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                          Re-sync now
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Description */}
              <div className="flex items-start gap-3">
                <FileText className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="flex-1 space-y-1">
                  <div className="text-xs text-muted-foreground">Description</div>
                  <div className="text-sm">{appointment.notes || 'No description provided.'}</div>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Date and Time */}
              <div className="flex items-start gap-3 py-2">
                <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="flex-1">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="grid gap-2">
                      <Label htmlFor="date" className="text-xs">
                        Date
                      </Label>
                      <Input
                        id="date"
                        type="date"
                        // Reschedule must move forward — past-appointment lock
                        // protects the existing row, this prevents rescheduling
                        // INTO the past.
                        min={new Date().toISOString().slice(0, 10)}
                        value={formData.date}
                        onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                        required
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="time" className="text-xs">
                        Time
                      </Label>
                      <Input
                        id="time"
                        type="time"
                        value={formData.time}
                        onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                        required
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Patient */}
              <div className="flex items-start gap-3 py-2">
                <Users className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground mb-1 block">Patient</Label>
                  {isRescheduleMode ? (
                    <div className="text-sm font-medium py-2">
                      {appointment.patient?.name || 'Unknown Patient'}
                    </div>
                  ) : (
                    <PatientPicker
                      value={formData.patientId}
                      onChange={(id) => setFormData({ ...formData, patientId: id })}
                      placeholder="Select patient"
                    />
                  )}
                </div>
              </div>

              {/* Doctor */}
              <div className="flex items-start gap-3 py-2">
                <Stethoscope className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground mb-1 block">Doctor</Label>
                  {isRescheduleMode ? (
                    <div className="text-sm font-medium py-2">
                      {appointment.doctor?.user?.name || 'Unknown Doctor'}
                    </div>
                  ) : (
                    <Select
                      value={formData.doctorId}
                      onValueChange={(value) => setFormData({ ...formData, doctorId: value })}
                      required
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select doctor" />
                      </SelectTrigger>
                      <SelectContent>
                        {doctorsList.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.user?.name || 'Unknown Doctor'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>

              {/* Appointment Type */}
              <div className="flex items-start gap-3 py-2">
                <Clock className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground mb-1 block">Type</Label>
                  {isRescheduleMode ? (
                    <div className="text-sm font-medium py-2 capitalize">
                      {appointment.type || '—'}
                    </div>
                  ) : (
                    <Select
                      value={formData.type}
                      onValueChange={(value) => setFormData({ ...formData, type: value })}
                      required
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        {appointmentTypesList.map((type) => (
                          <SelectItem key={type.id} value={type.name}>
                            {type.displayName || type.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>

              {/* Status */}
              <div className="flex items-start gap-3 py-2">
                <Clock className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground mb-1 block">Status</Label>
                  {isRescheduleMode ? (
                    <div className="text-sm font-medium py-2 capitalize">
                      {appointment.status || '—'}
                    </div>
                  ) : (
                    <Select
                      value={formData.status}
                      onValueChange={(value) => setFormData({ ...formData, status: value })}
                      required
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="scheduled">Scheduled</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                        <SelectItem value="rescheduled">Rescheduled</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>

              {/* Notes */}
              {!isRescheduleMode && (
                <div className="flex items-start gap-3 py-2">
                  <FileText className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground mb-1 block">Notes</Label>
                    <Input
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      placeholder="Add notes..."
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center space-x-2 py-2">
                <Checkbox
                  id="send-sms-edit"
                  checked={sendSMS}
                  onCheckedChange={(checked: boolean | 'indeterminate') =>
                    setSendSMS(checked === true)
                  }
                />
                <Label htmlFor="send-sms-edit" className="cursor-pointer text-sm">
                  Send SMS notification
                </Label>
              </div>
            </>
          )}
        </DialogHeader>

        {/* Footer Actions — edit mode only. View mode actions live in the
            icon row at the top of the body (Google-Calendar-style header). */}
        {!lockedForRole && isEditMode && (
          <div className="flex items-center justify-end gap-2 pt-4 mt-4">
            <Button variant="outline" onClick={handleCancel} disabled={isLoading}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </div>
        )}
      </DialogContent>

      {/* Check-In Payment Dialog — reuses AcceptPaymentSheet so the staff
          can pick one-time / plan / insurance for the patient on the spot. */}
      <AcceptPaymentSheet
        open={showCheckInPaymentDialog}
        onOpenChange={setShowCheckInPaymentDialog}
        presetPatientId={appointment.patientId}
        onSuccess={handleCheckInSuccess}
      />

      {/* Send Reminder — shared SMS-template-preview dialog used by both the
          Today-tab sidebar and this detail dialog so the receptionist sees
          the exact same preview in both surfaces. */}
      <SendReminderDialog
        open={showSendReminderConfirm}
        onOpenChange={setShowSendReminderConfirm}
        appointment={appointment}
        onSent={() => onUpdate?.()}
      />

      {/* No-show Capture Dialog */}
      <Dialog
        open={showNoShowDialog}
        onOpenChange={(next) => {
          setShowNoShowDialog(next)
          if (!next) setNoShowNote('')
        }}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Mark as no-show</DialogTitle>
            <DialogDescription className="mt-1">
              Record the last response from the patient (optional). This note will be appended to
              the appointment's notes.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <Label htmlFor="no-show-note" className="text-xs">
              Last response from patient
            </Label>
            <Textarea
              id="no-show-note"
              value={noShowNote}
              onChange={(e) => setNoShowNote(e.target.value)}
              placeholder="e.g. Patient said they were stuck in traffic and would call back..."
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowNoShowDialog(false)
                setNoShowNote('')
              }}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button onClick={confirmNoShow} disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}

// One-off icon action used inside the dialog's top action bar. Wraps a
// ghost icon button with a tooltip and a colour tone so the row stays
// visually consistent across the success / destructive / neutral actions.
function IconAction({
  icon,
  label,
  onClick,
  disabled,
  tone = 'neutral',
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  tone?: 'neutral' | 'success' | 'warning' | 'destructive'
}) {
  const toneClass =
    tone === 'success'
      ? 'text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30'
      : tone === 'warning'
        ? 'text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30'
        : tone === 'destructive'
          ? 'text-destructive hover:text-destructive hover:bg-destructive/10'
          : ''
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`h-8 w-8 ${toneClass}`}
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
