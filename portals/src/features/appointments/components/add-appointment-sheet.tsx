import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  type BlockTimeLike,
  DEFAULT_APPOINTMENT_MINUTES,
  findBlockTimeForAppointment,
} from '@/features/appointments/conflicts'
import { useAppointmentPickers } from '@/features/appointments/hooks/use-appointment-pickers'
import { createAppointment } from '@/lib/actions/appointments'
import { getDoctorUnavailability } from '@/lib/actions/doctor-availability'
import type { appointments } from '@/lib/db/schema'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { PatientPicker, type PickerPatient } from '@/shared/components/patient-picker'
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
import { Textarea } from '@/shared/components/ui/textarea'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { localDateISO } from '@/shared/lib/dates'

type Patient = {
  id: string
  name: string
  patientId: string | null
  isChild: boolean
  guardianName: string | null
  phone?: string | null
  guardianPhone?: string | null
}

interface AddAppointmentSheetProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultDate?: Date
  trigger?: React.ReactNode
  onCreated?: () => void
}

export function AddAppointmentSheet({
  open: controlledOpen,
  onOpenChange: setControlledOpen,
  defaultDate,
  trigger,
  onCreated,
}: AddAppointmentSheetProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const { isSubmitting, submit } = useSubmitGuard()
  const [blockTimes, setBlockTimes] = useState<BlockTimeLike[]>([])
  const [sendSMS, setSendSMS] = useState(true)
  const [sendDoctorEmail, setSendDoctorEmail] = useState(true)
  const [requiresEstimate, setRequiresEstimate] = useState(false)
  const [selectedPatientId, setSelectedPatientId] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<PickerPatient | null>(null)
  const [selectedDoctorId, setSelectedDoctorId] = useState('')
  const [selectedType, setSelectedType] = useState('')
  const [dateValue, setDateValue] = useState('')
  const [timeValue, setTimeValue] = useState('')

  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen! : internalOpen

  function resetForm() {
    setSelectedPatientId('')
    setSelectedPatient(null)
    setSelectedDoctorId('')
    setSelectedType('')
    setSendSMS(true)
    setSendDoctorEmail(true)
    setRequiresEstimate(false)
    setDateValue('')
    setTimeValue('')
  }

  function closeAndReset() {
    resetForm()
    if (isControlled) setControlledOpen?.(false)
    else setInternalOpen(false)
  }

  // Dirty only when the user has actively chosen a patient or doctor. Date/time
  // are auto-seeded to today/now on open (see the effect below), so including
  // them here would flag an untouched form as dirty and pop the discard guard on
  // every close.
  const isDirty = selectedPatientId !== '' || selectedDoctorId !== ''

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: closeAndReset,
  })

  const setOpen = (val: boolean) => {
    if (val) {
      if (isControlled) setControlledOpen?.(true)
      else setInternalOpen(true)
    } else {
      guardedOnOpenChange(false)
    }
  }

  const { doctors, appointmentTypes } = useAppointmentPickers(open)

  // Default the type once the catalog has loaded.
  useEffect(() => {
    if (appointmentTypes.length > 0 && !selectedType) {
      setSelectedType(appointmentTypes[0].name)
    }
  }, [appointmentTypes, selectedType])

  // Fetch the doctor's real unavailability (block times) when they're picked.
  useEffect(() => {
    if (!open || !selectedDoctorId) {
      setBlockTimes([])
      return
    }
    getDoctorUnavailability(selectedDoctorId).then((r) => {
      setBlockTimes(r.success ? ((r.data as BlockTimeLike[]) ?? []) : [])
    })
  }, [open, selectedDoctorId])

  const localDateStr = defaultDate ? localDateISO(defaultDate) : undefined
  const localTimeStr = defaultDate
    ? new Date(defaultDate.getTime() - defaultDate.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(11, 16)
    : undefined

  // Seed the live date/time state from the defaultDate when the sheet opens,
  // so the conflict check runs on the initial click-through from the calendar.
  useEffect(() => {
    if (!open) return
    setDateValue((prev) => prev || localDateStr || '')
    setTimeValue((prev) => prev || localTimeStr || '09:00')
  }, [open, localDateStr, localTimeStr])

  // Appointment types don't expose a duration field yet, so the proposed end
  // time for the block-time check uses the shared default slot length.
  const blockConflict = useMemo(() => {
    if (!selectedDoctorId || !dateValue || !timeValue) return null
    const start = new Date(`${dateValue}T${timeValue}`)
    if (Number.isNaN(start.getTime())) return null
    const end = new Date(start.getTime() + DEFAULT_APPOINTMENT_MINUTES * 60_000)
    return findBlockTimeForAppointment(
      selectedDoctorId,
      start.toISOString(),
      end.toISOString(),
      blockTimes
    )
  }, [selectedDoctorId, dateValue, timeValue, blockTimes])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!selectedPatientId) {
      toast.error('Please select a patient')
      return
    }
    if (!selectedDoctorId) {
      toast.error('Please select a doctor')
      return
    }
    if (!selectedType) {
      toast.error('Please select an appointment type')
      return
    }
    if (blockConflict) {
      toast.error('Doctor is unavailable during this time')
      return
    }

    const fd = new FormData(e.currentTarget)
    const dateStr = fd.get('date') as string
    const timeStr = fd.get('time') as string
    const dateTime = new Date(`${dateStr}T${timeStr}`)

    await submit(async () => {
      const result = await createAppointment(
        {
          patientId: selectedPatientId,
          doctorId: selectedDoctorId,
          date: dateTime,
          type: selectedType,
          status: 'scheduled',
          notes: fd.get('notes') as string,
          requiresEstimate,
        } as typeof appointments.$inferInsert,
        sendSMS,
        dateStr,
        timeStr,
        sendDoctorEmail
      )

      if (result.success) {
        closeAndReset()
        if (result.smsError) {
          toast.warning(`Appointment scheduled, but SMS failed: ${result.smsError}`)
        } else {
          toast.success(
            result.smsSent ? 'Appointment scheduled. SMS sent.' : 'Appointment scheduled.'
          )
        }
        onCreated?.()
      } else {
        surfaceApiError(result)
      }
    })
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {/* Only render a trigger when the caller passes one. The shell controls
          `open` directly via the calendar's date-cell click + the Today-tab
          "+ New" button — a hidden default button up here would just be
          chrome the user keeps noticing. */}
      {trigger ? <SheetTrigger asChild>{trigger}</SheetTrigger> : null}
      <SheetContent className="!w-full !max-w-[520px] overflow-y-auto">
        <form onSubmit={onSubmit}>
          <SheetHeader className="mb-6">
            <SheetTitle>New Appointment</SheetTitle>
            <SheetDescription>Schedule a patient appointment.</SheetDescription>
          </SheetHeader>

          <div className="space-y-5 pb-6">
            {/* Patient — shared <PatientPicker>, searches the server as the
                user types instead of holding every patient in memory. */}
            <div className="space-y-1.5">
              <Label htmlFor="add-appt-patient">Patient</Label>
              <PatientPicker
                id="add-appt-patient"
                value={selectedPatientId}
                onChange={(id, patient) => {
                  setSelectedPatientId(id)
                  setSelectedPatient(patient)
                }}
              />
              {selectedPatient && (
                <p className="text-xs text-muted-foreground">
                  {selectedPatient.isChild && selectedPatient.guardianPhone ? (
                    <>
                      <span className="font-medium text-foreground/80">Guardian:</span>{' '}
                      {selectedPatient.guardianPhone}
                    </>
                  ) : selectedPatient.phone ? (
                    <>
                      <span className="font-medium text-foreground/80">Phone:</span>{' '}
                      {selectedPatient.phone}
                    </>
                  ) : (
                    <span className="text-amber-700">No phone on file</span>
                  )}
                </p>
              )}
            </div>

            {/* Doctor */}
            <div className="space-y-1.5">
              <Label id="add-appt-doctor-label" htmlFor="add-appt-doctor">
                Doctor
              </Label>
              <Select value={selectedDoctorId} onValueChange={setSelectedDoctorId}>
                <SelectTrigger id="add-appt-doctor" aria-labelledby="add-appt-doctor-label">
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
              {doctors.length === 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  No doctors set up yet — add one in Doctors → Add Specialist.
                </p>
              )}
              {selectedDoctorId &&
                (() => {
                  const doc = doctors.find((d) => d.id === selectedDoctorId)
                  const email = doc?.user?.email ?? null
                  return (
                    <p className="text-xs text-muted-foreground">
                      {email ? (
                        <>
                          <span className="font-medium text-foreground/80">Email:</span> {email}
                        </>
                      ) : (
                        <span className="text-amber-700">No email on file</span>
                      )}
                    </p>
                  )
                })()}
            </div>

            <Separator />

            {/* Date + Time — past dates are blocked client-side too. The
                backend re-validates so a bypass via DevTools still fails. */}
            <div className="space-y-1.5">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="date">Date</Label>
                  <Input
                    id="date"
                    name="date"
                    type="date"
                    required
                    min={localDateISO()}
                    value={dateValue}
                    onChange={(e) => setDateValue(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="time">Time</Label>
                  <Input
                    id="time"
                    name="time"
                    type="time"
                    required
                    value={timeValue}
                    onChange={(e) => setTimeValue(e.target.value)}
                  />
                </div>
              </div>
              {blockConflict && (
                <p className="text-xs text-destructive" role="alert">
                  {doctors.find((d) => d.id === selectedDoctorId)?.user?.name ?? 'Doctor'} is
                  unavailable during this time
                  {blockConflict.reason ? ` — ${blockConflict.reason}.` : '.'}
                </p>
              )}
            </div>

            {/* Type */}
            <div className="space-y-1.5">
              <Label id="add-appt-type-label" htmlFor="add-appt-type">
                Appointment Type
              </Label>
              <Select name="type" value={selectedType} onValueChange={setSelectedType}>
                <SelectTrigger id="add-appt-type" aria-labelledby="add-appt-type-label">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {appointmentTypes.map((t) => (
                    <SelectItem key={t.id} value={t.name}>
                      {t.displayName || t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {appointmentTypes.length === 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  No appointment types set up yet — add them in Settings → Appointment Types.
                </p>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                name="notes"
                rows={3}
                placeholder="Any relevant notes…"
                maxLength={1000}
              />
            </div>

            <Separator />

            {/* SMS toggle */}
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-4 py-3 hover:bg-muted/40">
              <Checkbox
                id="send-sms"
                checked={sendSMS}
                onCheckedChange={(v) => setSendSMS(v === true)}
              />
              <div>
                <p className="text-sm font-medium">Send SMS notification</p>
                <p className="text-xs text-muted-foreground">
                  Patient will receive a booking confirmation via SMS
                </p>
              </div>
            </label>

            {/* Email toggle */}
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-4 py-3 hover:bg-muted/40">
              <Checkbox
                id="send-doctor-email"
                checked={sendDoctorEmail}
                onCheckedChange={(v) => setSendDoctorEmail(v === true)}
              />
              <div>
                <p className="text-sm font-medium">Send doctor email</p>
                <p className="text-xs text-muted-foreground">
                  Doctor will receive a booking confirmation via email
                </p>
              </div>
            </label>

            {/* Requires-estimate routing (0168) */}
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-4 py-3 hover:bg-muted/40">
              <Checkbox
                id="requires-estimate"
                checked={requiresEstimate}
                onCheckedChange={(v) => setRequiresEstimate(v === true)}
              />
              <div>
                <p className="text-sm font-medium">Requires estimate</p>
                <p className="text-xs text-muted-foreground">
                  Route doctor-first: consult → estimate → reception confirms &amp; takes payment
                </p>
              </div>
            </label>
          </div>

          <SheetFooter>
            <Button
              type="submit"
              disabled={isSubmitting || blockConflict !== null}
              className="w-full"
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Schedule Appointment
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </Sheet>
  )
}
