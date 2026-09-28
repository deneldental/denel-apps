import { format } from 'date-fns'
import {
  Bell,
  Calendar,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Pencil,
  Stethoscope,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getAppointmentTypes } from '@/lib/actions/appointment-types'
import { updateAppointment } from '@/lib/actions/appointments'
import { getDoctors } from '@/lib/actions/doctors'
import { getPatients } from '@/lib/actions/patients'
import { CheckInPaymentDialog } from './check-in-payment-dialog'

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
}

export function AppointmentDetailDialog({
  open,
  onOpenChange,
  appointment,
  onUpdate,
  onDelete,
  readOnly = false,
}: AppointmentDetailDialogProps) {
  const navigate = useNavigate()
  const [isEditMode, setIsEditMode] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  interface Patient {
    id: string
    name: string
  }
  interface Doctor {
    id: string
    user?: {
      name: string
    }
  }
  interface AppointmentType {
    id: string
    name: string
    displayName?: string | null
  }
  const [patientsList, setPatientsList] = useState<Patient[]>([])
  const [doctorsList, setDoctorsList] = useState<Doctor[]>([])
  const [appointmentTypesList, setAppointmentTypesList] = useState<AppointmentType[]>([])
  const [showCheckInPaymentDialog, setShowCheckInPaymentDialog] = useState(false)

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

  useEffect(() => {
    if (isEditMode && open) {
      getPatients().then((res) => {
        if (res.success) {
          setPatientsList(res.data || [])
        } else {
          toast.error(res.error || 'Failed to load patients')
        }
      })
      getDoctors().then((res) => {
        if (res.success) {
          setDoctorsList(res.data || [])
        } else {
          toast.error(res.error || 'Failed to load doctors')
        }
      })
      getAppointmentTypes().then((res) => {
        if (res.success) {
          setAppointmentTypesList(res.data || [])
        } else {
          toast.error(res.error || 'Failed to load appointment types')
        }
      })
    }
  }, [isEditMode, open])

  useEffect(() => {
    if (!open) {
      setIsEditMode(false)
    }
  }, [open])

  if (!appointment) return null

  const appointmentDate = new Date(appointment.date)
  const endTime = new Date(appointmentDate.getTime() + (appointment.durationMinutes || 30) * 60000)

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled':
        return 'default'
      case 'completed':
        return 'secondary'
      case 'cancelled':
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

      const result = await updateAppointment(appointment.id, updateData, sendSMS)

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
        navigate(0)
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
  }

  const handleReschedule = () => {
    // Enter edit mode to reschedule
    setIsEditMode(true)
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
        navigate(0)
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="space-y-4">
          <DialogTitle>Appointment Details</DialogTitle>

          {!isEditMode ? (
            <div className="space-y-6">
              {/* Title Section */}
              <div className="space-y-2">
                <div className="flex items-start gap-3">
                  <div className="space-y-2 flex-1">
                    <Badge variant={getStatusColor(appointment.status)} className="capitalize">
                      {appointment.status}
                    </Badge>
                    <div className="text-2xl font-semibold">
                      {`${appointment.type.charAt(0).toUpperCase() + appointment.type.slice(1)} - ${appointment.patient?.name || 'Unknown Patient'}`}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {format(appointmentDate, 'EEEE, MMMM d')} •{' '}
                      {format(appointmentDate, 'h:mm a')} - {format(endTime, 'h:mm a')}
                    </div>
                  </div>
                  {!readOnly && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setIsEditMode(true)}
                        disabled={isLoading}
                        aria-label="Edit appointment"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onDelete?.()}
                        disabled={isLoading || !onDelete}
                        aria-label="Delete appointment"
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {/* Patient */}
              <div className="flex items-start gap-3">
                <User className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="flex-1 space-y-1">
                  <div className="text-xs text-muted-foreground">Patient</div>
                  <div className="text-sm font-medium">
                    {appointment.patient?.name || 'Unknown Patient'}
                  </div>
                  {appointment.patient?.phone && (
                    <div className="text-xs text-muted-foreground">{appointment.patient.phone}</div>
                  )}
                </div>
              </div>

              {/* Doctor */}
              <div className="flex items-start gap-3">
                <Stethoscope className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="flex-1 space-y-1">
                  <div className="text-xs text-muted-foreground">Doctor</div>
                  <div className="text-sm font-medium">
                    {appointment.doctor?.user?.name || 'Unknown Doctor'}
                  </div>
                  {appointment.doctor?.specialty && (
                    <div className="text-xs text-muted-foreground">
                      {appointment.doctor.specialty}
                    </div>
                  )}
                </div>
              </div>

              {/* Description */}
              <div className="flex items-start gap-3">
                <FileText className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="flex-1 space-y-1">
                  <div className="text-xs text-muted-foreground">Description</div>
                  <div className="text-sm">{appointment.notes || 'No description provided.'}</div>
                </div>
              </div>

              {/* Date and Time */}
              <div className="flex items-start gap-3">
                <Bell className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="flex-1 space-y-1">
                  <div className="text-xs text-muted-foreground">Date and Time</div>
                  <div className="text-sm">
                    {format(appointmentDate, 'EEEE, MMMM d')} • {format(appointmentDate, 'h:mm a')}{' '}
                    - {format(endTime, 'h:mm a')}
                  </div>
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
                  <Select
                    value={formData.patientId}
                    onValueChange={(value) => setFormData({ ...formData, patientId: value })}
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select patient" />
                    </SelectTrigger>
                    <SelectContent>
                      {patientsList.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Doctor */}
              <div className="flex items-start gap-3 py-2">
                <Stethoscope className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground mb-1 block">Doctor</Label>
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
                </div>
              </div>

              {/* Appointment Type */}
              <div className="flex items-start gap-3 py-2">
                <Clock className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground mb-1 block">Type</Label>
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
                </div>
              </div>

              {/* Status */}
              <div className="flex items-start gap-3 py-2">
                <Clock className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground mb-1 block">Status</Label>
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
                </div>
              </div>

              {/* Notes */}
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

        {/* Footer Actions */}
        {!readOnly && (
          <div className="flex items-center justify-start gap-2 pt-4 mt-4 flex-wrap">
            {isEditMode ? (
              <>
                <Button variant="outline" onClick={handleCancel} disabled={isLoading}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={isLoading}>
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                {appointment.status === 'scheduled' && (
                  <>
                    <Button variant="outline" onClick={handleCheckIn} disabled={isLoading}>
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Check In
                    </Button>
                    <Button variant="outline" onClick={handleReschedule} disabled={isLoading}>
                      <CalendarClock className="mr-2 h-4 w-4" />
                      Reschedule
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleCancelAppointment}
                      disabled={isLoading}
                      className="text-destructive hover:text-destructive"
                    >
                      <X className="mr-2 h-4 w-4" />
                      Cancel
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>

      {/* Check-In Payment Dialog */}
      <CheckInPaymentDialog
        open={showCheckInPaymentDialog}
        onOpenChange={setShowCheckInPaymentDialog}
        appointment={appointment}
        onSuccess={handleCheckInSuccess}
      />
    </Dialog>
  )
}
