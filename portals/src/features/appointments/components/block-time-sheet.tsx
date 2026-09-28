import { format } from 'date-fns'
import { AlertTriangle, Ban, Loader2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  type AppointmentLike,
  appointmentRange,
  type BlockTimeConflict,
  findAppointmentsInBlockTime,
} from '@/features/appointments/conflicts'
import { getAppointments } from '@/lib/actions/appointments'
import { createUnavailability } from '@/lib/actions/doctor-availability'
import { getDoctors } from '@/lib/actions/doctors'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Separator } from '@/shared/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/shared/components/ui/sheet'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { apiErrorMessage } from '@/shared/lib/api-error'
import { localDateISO, parseLocalDate } from '@/shared/lib/dates'

type Doctor = { id: string; user?: { name: string } | null }

/** Raw appointment row as `GET /api/appointments` returns it. */
type ApiAppointment = {
  id: string
  doctorId: string
  status: string
  date: string
  durationMinutes?: number | null
  type?: string | null
  patient?: { name?: string | null } | null
}

interface BlockTimeSheetProps {
  currentDoctorId?: string
  currentDoctorName?: string
  isDoctor?: boolean
  onCreated?: () => void
}

export function BlockTimeSheet({
  currentDoctorId,
  currentDoctorName,
  isDoctor = false,
  onCreated,
}: BlockTimeSheetProps) {
  const [open, setOpen] = useState(false)
  const { isSubmitting, submit } = useSubmitGuard()
  const [isAllDay, setIsAllDay] = useState(false)
  const [selectedDoctorId, setSelectedDoctorId] = useState(
    isDoctor && currentDoctorId ? currentDoctorId : ''
  )

  // Live form-field state (date/start/end) so conflict checks recompute as
  // the user edits the range.
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('08:00')
  const [endTime, setEndTime] = useState('17:00')
  const [reason, setReason] = useState('')

  // Opt-in override for the overlap warning — see onSubmit.
  const [acknowledgedConflicts, setAcknowledgedConflicts] = useState(false)

  useLayoutEffect(() => {
    if (isDoctor && currentDoctorId) setSelectedDoctorId(currentDoctorId)
  }, [isDoctor, currentDoctorId])

  const appointmentsQuery = useApiQuery<ApiAppointment[]>(
    queryKeys.appointments.list({ doctorId: selectedDoctorId, date }),
    () =>
      getAppointments({
        doctorId: selectedDoctorId,
        from: new Date(`${date}T00:00:00`),
        to: new Date(`${date}T23:59:59`),
      }),
    { enabled: !!selectedDoctorId && !!date }
  )

  // The API returns `date` + `durationMinutes` and a nested patient — flatten
  // to the shape the conflict list renders.
  const existingAppointments: AppointmentLike[] = useMemo(
    () =>
      (appointmentsQuery.data ?? []).map((a) => ({
        id: a.id,
        doctorId: a.doctorId,
        status: a.status,
        date: a.date,
        durationMinutes: a.durationMinutes,
        patientName: a.patient?.name ?? 'Unknown patient',
        appointmentTypeName: a.type ?? null,
      })),
    [appointmentsQuery.data]
  )

  // A new doctor/date means a different conflict set — make the user
  // acknowledge that one rather than inheriting the previous approval.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset is keyed off selectedDoctorId/date, not read in the body
  useEffect(() => {
    setAcknowledgedConflicts(false)
  }, [selectedDoctorId, date])

  const doctorsQuery = useApiQuery<Doctor[]>(queryKeys.doctors.list(), () => getDoctors(), {
    enabled: open && !isDoctor,
  })
  const doctors = doctorsQuery.data ?? []

  // Pre-empt useApiMutation's generic error so a backend zod issue still
  // surfaces via `apiErrorMessage` (field + message), matching the
  // surfaceApiError() call this replaces.
  const createUnavailabilityMutation = useApiMutation(
    async (vars: Parameters<typeof createUnavailability>[0]) => {
      const res = await createUnavailability(vars)
      if (!res.success) throw new Error(apiErrorMessage(res, 'Failed to block time.'))
      return res
    },
    { invalidates: [queryKeys.appointments.all] }
  )

  function reset() {
    setIsAllDay(false)
    if (!isDoctor) setSelectedDoctorId('')
    setDate('')
    setStartTime('08:00')
    setEndTime('17:00')
    setReason('')
    setAcknowledgedConflicts(false)
  }

  // Compute the effective ISO range from the live form state.
  // parseLocalDate avoids UTC-midnight drift when constructing Date from YYYY-MM-DD.
  const rangeISO = useMemo(() => {
    if (!date) return null
    const s = isAllDay ? '08:00' : startTime
    const e = isAllDay ? '20:00' : endTime
    if (!s || !e) return null
    const base = parseLocalDate(date)
    const [sh, sm] = s.split(':').map(Number)
    const [eh, em] = e.split(':').map(Number)
    const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), sh, sm ?? 0)
    const end = new Date(base.getFullYear(), base.getMonth(), base.getDate(), eh, em ?? 0)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
    if (end <= start) return null
    return { startISO: start.toISOString(), endISO: end.toISOString() }
  }, [date, isAllDay, startTime, endTime])

  const conflicts: BlockTimeConflict[] = useMemo(() => {
    if (!selectedDoctorId || !rangeISO) return []
    return findAppointmentsInBlockTime(
      selectedDoctorId,
      rangeISO.startISO,
      rangeISO.endISO,
      existingAppointments
    )
  }, [selectedDoctorId, rangeISO, existingAppointments])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!selectedDoctorId) {
      toast.error('Please select a doctor')
      return
    }

    // Conflicts warn but don't forbid: the block is what stops NEW bookings, so
    // refusing to save it would leave the doctor bookable. Appointments already
    // on the calendar are left alone — the panel lists them so the user knows
    // what to move.
    if (conflicts.length > 0 && !acknowledgedConflicts) return

    await submit(async () => {
      const dateValue = date
      let startDateTime: Date
      let endDateTime: Date

      // Use parseLocalDate to avoid UTC-midnight drift on the base date,
      // then apply hours/minutes in local time.
      const base = parseLocalDate(dateValue)
      const makeLocal = (hhmm: string) => {
        const [h, m] = hhmm.split(':').map(Number)
        return new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m ?? 0)
      }

      if (isAllDay) {
        startDateTime = makeLocal('08:00')
        endDateTime = makeLocal('20:00')
      } else {
        startDateTime = makeLocal(startTime)
        endDateTime = makeLocal(endTime)

        if (endDateTime <= startDateTime) {
          toast.error('End time must be after start time')
          return
        }
      }

      try {
        await createUnavailabilityMutation.mutateAsync({
          doctorId: selectedDoctorId,
          startTime: startDateTime.toISOString(),
          endTime: endDateTime.toISOString(),
          reason: reason || null,
        })
        reset()
        setOpen(false)
        toast.success('Time blocked successfully.')
        onCreated?.()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to block time.')
      }
    })
  }

  // Dirty when any field has been touched away from defaults.
  const isDirty =
    date !== '' ||
    reason !== '' ||
    startTime !== '08:00' ||
    endTime !== '17:00' ||
    isAllDay ||
    (!isDoctor && selectedDoctorId !== '')

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: () => {
      reset()
      setOpen(false)
    },
  })

  function handleCancelBlock() {
    reset()
    setOpen(false)
  }

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(v) => {
          if (v) {
            setOpen(true)
          } else {
            guardedOnOpenChange(false)
          }
        }}
      >
        <SheetTrigger asChild>
          <Button
            size="sm"
            className="h-8 gap-1.5 bg-rose-600 hover:bg-rose-700 text-white shadow-sm"
          >
            <Ban className="h-3.5 w-3.5" />
            Block Time
          </Button>
        </SheetTrigger>
        <SheetContent className="!w-full !max-w-[480px] overflow-y-auto">
          <form onSubmit={onSubmit}>
            <SheetHeader className="mb-6">
              <SheetTitle>Block Doctor Time</SheetTitle>
              <SheetDescription>
                Prevent appointments from being scheduled during this period.
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-5 pb-6">
              {/* Doctor */}
              <div className="space-y-1.5">
                <Label htmlFor="doctorSelect">Doctor</Label>
                {isDoctor ? (
                  <Input
                    id="doctorSelect"
                    aria-label="Doctor"
                    value={currentDoctorName || ''}
                    disabled
                    className="bg-muted"
                  />
                ) : (
                  <Select value={selectedDoctorId} onValueChange={setSelectedDoctorId}>
                    <SelectTrigger id="doctorSelect">
                      <SelectValue placeholder="Select doctor" />
                    </SelectTrigger>
                    <SelectContent>
                      {doctors.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.user?.name || 'Unknown Doctor'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <Separator />

              {/* Date — blocking past time is pointless; mirror the past-date
                  guard applied to appointment creation. */}
              <div className="space-y-1.5">
                <Label htmlFor="date">Date</Label>
                <Input
                  id="date"
                  name="date"
                  type="date"
                  required
                  min={localDateISO()}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>

              {/* All day toggle */}
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-4 py-3 hover:bg-muted/40">
                <Checkbox
                  id="allDay"
                  checked={isAllDay}
                  onCheckedChange={(v) => setIsAllDay(v === true)}
                />
                <div>
                  <p className="text-sm font-medium">All day</p>
                  <p className="text-xs text-muted-foreground">8:00 AM — 8:00 PM</p>
                </div>
              </label>

              {/* Time range */}
              {!isAllDay && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="startTime">Start time</Label>
                    <Input
                      id="startTime"
                      name="startTime"
                      type="time"
                      required
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="endTime">End time</Label>
                    <Input
                      id="endTime"
                      name="endTime"
                      type="time"
                      required
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* Reason */}
              <div className="space-y-1.5">
                <Label htmlFor="reason">Reason (optional)</Label>
                <Input
                  id="reason"
                  name="reason"
                  placeholder="e.g. Vacation, Training, Surgery"
                  maxLength={200}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>

              {/* Conflict warning */}
              {conflicts.length > 0 && (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
                >
                  <div className="flex items-start gap-2 text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p className="font-medium">
                      This block time overlaps {conflicts.length} appointment
                      {conflicts.length === 1 ? '' : 's'}:
                    </p>
                  </div>
                  <ul className="mt-3 space-y-2 pl-6">
                    {conflicts.map(({ appointment: a }) => {
                      const range = appointmentRange(a)
                      return (
                        <li key={a.id} className="text-foreground/90">
                          {range && (
                            <span className="font-medium">
                              {format(range.start, 'h:mm a')}
                              {' – '}
                              {format(range.end, 'h:mm a')}
                            </span>
                          )}
                          <span className="text-muted-foreground">
                            {range ? ' · ' : ''}
                            {a.patientName ?? 'Unknown patient'}
                            {a.appointmentTypeName ? ` · ${a.appointmentTypeName}` : ''}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                  <p className="mt-3 pl-6 text-xs text-muted-foreground">
                    Blocking won't cancel these — they stay on the calendar. It only stops new
                    bookings in this window.
                  </p>
                  <label className="mt-3 flex cursor-pointer items-start gap-2 pl-6 text-xs">
                    <Checkbox
                      id="ack-conflicts"
                      checked={acknowledgedConflicts}
                      onCheckedChange={(v) => setAcknowledgedConflicts(v === true)}
                    />
                    <span>Block anyway — I'll move these appointments myself</span>
                  </label>
                </div>
              )}
            </div>

            <SheetFooter>
              <div className="flex w-full flex-col gap-2">
                <Button
                  type="submit"
                  disabled={isSubmitting || (conflicts.length > 0 && !acknowledgedConflicts)}
                  className="w-full"
                >
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Block Time
                </Button>
                {conflicts.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCancelBlock}
                    className="w-full"
                  >
                    Cancel block time
                  </Button>
                )}
              </div>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>
  )
}
