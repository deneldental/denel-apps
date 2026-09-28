import { Loader2, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { createAppointment } from '@/lib/actions/appointments'
import { getDoctors } from '@/lib/actions/doctors'
import type { appointments, doctors } from '@/lib/db/schema'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { PatientPicker } from '@/shared/components/patient-picker'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useLookup } from '@/shared/hooks/use-lookup'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { localDateISO } from '@/shared/lib/dates'

type Doctor = typeof doctors.$inferSelect & {
  user: {
    id: string
    name: string
    email: string
    phone: string | null
    image: string | null
  } | null
}
interface AddAppointmentDialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultDate?: Date
  trigger?: React.ReactNode
  /** Called after a successful appointment creation — use to invalidate query cache. */
  onSuccess?: () => void
}

export function AddAppointmentDialog({
  open: controlledOpen,
  onOpenChange: setControlledOpen,
  defaultDate,
  trigger,
  onSuccess,
}: AddAppointmentDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const { isSubmitting, submit } = useSubmitGuard()
  // Key incremented on close to unmount/remount the form, clearing uncontrolled inputs.
  const [formKey, setFormKey] = useState(0)

  // Derived state to handle both controlled and uncontrolled modes
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen

  const closeDialog = () => {
    setSendSMS(false)
    setSelectedPatientId('')
    setFormKey((k) => k + 1)
    if (isControlled) {
      setControlledOpen?.(false)
    } else {
      setInternalOpen(false)
    }
  }

  // State for selections
  const [doctorsList, setDoctorsList] = useState<Doctor[]>([])
  // Shared appointment-type lookup — refreshes when Settings edits it, no reload.
  const { rows: appointmentTypesList } = useLookup('appointment-types', { enabled: open })
  const [sendSMS, setSendSMS] = useState(false)
  const [selectedPatientId, setSelectedPatientId] = useState<string>('')

  // Dirty tracking: form is dirty once a patient has been picked (the only
  // controlled field; uncontrolled inputs are cleared via formKey remount).
  const isDirty = selectedPatientId !== ''

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: closeDialog,
  })

  useEffect(() => {
    if (open) {
      getDoctors().then((res) => {
        if (res.success) setDoctorsList(res.data || [])
      })
    }
  }, [open])

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    await submit(async () => {
      const formData = new FormData(event.currentTarget)
      const dateStr = formData.get('date') as string
      const timeStr = formData.get('time') as string

      // Client-side guard: patient is required (browser ignores required on hidden inputs)
      if (!selectedPatientId) {
        toast.error('Please select a patient.')
        return
      }

      // Combine date and time into a single Date object
      const dateTime = new Date(`${dateStr}T${timeStr}`)

      const data = {
        patientId: selectedPatientId,
        doctorId: formData.get('doctorId') as string,
        date: dateTime,
        type: formData.get('type') as string,
        status: 'scheduled',
        notes: formData.get('notes') as string,
      }

      const result = await createAppointment(
        data as typeof appointments.$inferInsert,
        sendSMS,
        dateStr,
        timeStr
      )

      if (result.success) {
        closeDialog()
        onSuccess?.()

        if (result.smsError) {
          toast.warning(`Appointment scheduled, but SMS failed: ${result.smsError}`)
        } else {
          const message = result.smsSent
            ? 'Appointment scheduled and SMS notification sent to patient.'
            : 'Appointment scheduled.'
          toast.success(message)
        }
      } else {
        surfaceApiError(result)
      }
    })
  }

  return (
    <>
      <Dialog open={open} onOpenChange={guardedOnOpenChange}>
        <DialogTrigger asChild>
          {trigger || (
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Appointment
            </Button>
          )}
        </DialogTrigger>
        <DialogContent className="sm:max-w-[425px]">
          <form key={formKey} onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>New Appointment</DialogTitle>
              <DialogDescription>Schedule a new appointment.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="add-appt-dialog-patient">Patient</Label>
                <PatientPicker
                  id="add-appt-dialog-patient"
                  value={selectedPatientId}
                  onChange={(id) => setSelectedPatientId(id)}
                  placeholder="Select patient"
                />
                {/* Hidden input carries patientId in FormData; required omitted — browser ignores it on hidden inputs, guard is in onSubmit */}
                <input type="hidden" name="patientId" value={selectedPatientId} />
              </div>
              <div className="grid gap-2">
                <Label id="add-appt-dialog-doctor-label">Doctor</Label>
                <Select name="doctorId" aria-labelledby="add-appt-dialog-doctor-label">
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
              </div>
              <div className="grid gap-2">
                <Label htmlFor="add-appt-dialog-date">Date</Label>
                <Input
                  id="add-appt-dialog-date"
                  name="date"
                  type="date"
                  required
                  min={localDateISO()}
                  defaultValue={defaultDate ? localDateISO(defaultDate) : undefined}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="add-appt-dialog-time">Time</Label>
                <Input
                  id="add-appt-dialog-time"
                  name="time"
                  type="time"
                  required
                  defaultValue={
                    defaultDate
                      ? new Date(defaultDate.getTime() - defaultDate.getTimezoneOffset() * 60000)
                          .toISOString()
                          .slice(11, 16)
                      : undefined
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label id="add-appt-dialog-type-label">Type</Label>
                <Select
                  name="type"
                  defaultValue="consultation"
                  aria-labelledby="add-appt-dialog-type-label"
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
              </div>
              <div className="grid gap-2">
                <Label htmlFor="add-appt-dialog-notes">Notes</Label>
                <Input id="add-appt-dialog-notes" name="notes" maxLength={1000} />
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="send-sms"
                  checked={sendSMS}
                  onCheckedChange={(checked) => setSendSMS(checked === true)}
                />
                <Label htmlFor="send-sms" className="cursor-pointer text-sm">
                  Send SMS notification to patient
                </Label>
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Schedule
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>
  )
}
