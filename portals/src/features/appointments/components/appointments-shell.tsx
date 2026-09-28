import { Bell } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AddAppointmentSheet } from '@/features/appointments/components/add-appointment-sheet'
import { AppointmentCalendar } from '@/features/appointments/components/appointment-calendar'
import { AppointmentDetailDialog } from '@/features/appointments/components/appointment-detail-dialog'
import { UnavailabilityDetailDialog } from '@/features/appointments/components/unavailability-detail-dialog'
import { UpcomingAppointmentsColumn } from '@/features/appointments/components/upcoming-appointments-column'
import { Button } from '@/shared/components/ui/button'
import { usePermissions } from '@/shared/hooks/use-permissions'

// ── Types ────────────────────────────────────────────────────────────────────

interface CalendarAppointment {
  id: string
  date: Date | string
  status?: string
  patient?: { name?: string }
  doctor?: { user?: { name?: string } }
  [key: string]: unknown
}

interface CalendarUnavailability {
  id: string
  startTime: Date | string
  endTime: Date | string
  [key: string]: unknown
}

interface Appointment {
  id: string
  patientId: string
  doctorId: string
  date: Date | string
  durationMinutes: number
  status: string
  type: string
  notes?: string | null
  patient?: { name: string }
  doctor?: { user?: { name: string } }
  [key: string]: unknown
}

interface Unavailability {
  id: string
  doctorId: string
  startTime: Date | string
  endTime: Date | string
  reason?: string | null
  doctor?: { user?: { name: string } }
  [key: string]: unknown
}

interface AppointmentsShellProps {
  appointments: CalendarAppointment[]
  unavailability: CalendarUnavailability[]
  isClinicalUser?: boolean
  isAdmin?: boolean
  isDoctor?: boolean
  currentDoctorId?: string
  currentDoctorName?: string
  setDoctorId?: (id: string | undefined) => void
  onReload?: () => void
}

// ── Shell ────────────────────────────────────────────────────────────────────
// Simplified post-redesign:
//   • No top-level tabs (no separate list view, no separate website-bookings
//     or block-time pages — those live as tabs INSIDE the right column).
//   • No "calendar vs list" layout toggle — calendar is always the primary
//     surface; the right column is collapsible if the user wants more canvas.
//   • Scheduled Reminders has moved out entirely to the CRM module.

export function AppointmentsShell({
  appointments,
  unavailability,
  isClinicalUser = false,
  isAdmin = false,
  isDoctor = false,
  currentDoctorId,
  currentDoctorName,
  setDoctorId,
  onReload,
}: AppointmentsShellProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const { hasPermission } = usePermissions()

  const [addSheetOpen, setAddSheetOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined)
  const [timelineDate, setTimelineDate] = useState<Date>(new Date())
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null)
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false)
  const [selectedUnavailability, setSelectedUnavailability] = useState<Unavailability | null>(null)
  const [isUnavailabilityDialogOpen, setIsUnavailabilityDialogOpen] = useState(false)

  function handleDateClick(date: Date) {
    setTimelineDate(date)
    if (!isClinicalUser) {
      setSelectedDate(date)
      setAddSheetOpen(true)
    }
  }

  function handleAppointmentClick(appointment: CalendarAppointment) {
    setSelectedAppointment(appointment as Appointment)
    setIsDetailDialogOpen(true)
  }

  function handleUnavailabilityClick(unavailability: CalendarUnavailability) {
    setSelectedUnavailability(unavailability as Unavailability)
    setIsUnavailabilityDialogOpen(true)
  }

  // Deep-link support: when the URL carries ?appointmentId=…, open the detail
  // dialog for that appointment if we can find it in the loaded list. Kept for
  // back-compat with any external links pointing at /appointments?appointmentId=…
  const deepLinkAppointmentId = searchParams.get('appointmentId')
  useEffect(() => {
    if (!deepLinkAppointmentId) return
    const match = appointments.find((a) => a.id === deepLinkAppointmentId)
    if (match) {
      setSelectedAppointment(match as Appointment)
      setIsDetailDialogOpen(true)
      const next = new URLSearchParams(searchParams)
      next.delete('appointmentId')
      setSearchParams(next, { replace: true })
    }
  }, [deepLinkAppointmentId, appointments, searchParams, setSearchParams])

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Scheduling</h1>
          <p className="text-muted-foreground">
            Calendar, today's roster, website bookings, and blocked time — all in one view.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasPermission('messaging', 'read') && (
            <Button asChild variant="outline">
              <Link to="/appointments/reminders">
                <Bell className="mr-2 h-4 w-4" />
                Scheduled Reminders
              </Link>
            </Button>
          )}
          {/* "New appointment" lives on the Today-tab sidebar header (the
              orange + New button). Keeping a second entry up here was
              redundant and crowded the page title. The sheet is still
              opened via the deep-link / date-cell click path below. */}
          {true && (
            <AddAppointmentSheet
              open={addSheetOpen}
              onOpenChange={(v) => {
                setAddSheetOpen(v)
                if (!v) setSelectedDate(undefined)
              }}
              defaultDate={selectedDate}
              onCreated={onReload}
            />
          )}
        </div>
      </div>

      {/* Calendar + right-side column. The column is always visible at a
          fixed width — the receptionist's worklist (Today / Website /
          Blocked) shouldn't be hidable since it's how they drive the day. */}
      <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-4 items-stretch flex-1 min-h-0 overflow-hidden">
        <AppointmentCalendar
          className="h-full"
          appointments={
            appointments as unknown as Array<{
              id: string
              date: Date | string
              [key: string]: unknown
            }>
          }
          unavailability={
            unavailability as unknown as Array<{
              id: string
              startTime: Date | string
              endTime: Date | string
              [key: string]: unknown
            }>
          }
          onDateClick={handleDateClick}
          onAppointmentClick={
            handleAppointmentClick as (a: {
              id: string
              date: Date | string
              [key: string]: unknown
            }) => void
          }
          onUnavailabilityClick={
            handleUnavailabilityClick as (u: {
              id: string
              startTime: Date | string
              endTime: Date | string
              [key: string]: unknown
            }) => void
          }
          onDateChange={setTimelineDate}
        />

        <UpcomingAppointmentsColumn
          appointments={appointments}
          unavailability={unavailability}
          selectedDate={timelineDate}
          onSelectedDateChange={setTimelineDate}
          onAppointmentClick={handleAppointmentClick}
          onUnavailabilityClick={handleUnavailabilityClick}
          onReload={onReload}
          currentDoctorId={currentDoctorId}
          currentDoctorName={currentDoctorName}
          isClinicalUser={isClinicalUser}
          className="h-full min-h-0"
        />
      </div>

      {/* Detail dialogs */}
      <AppointmentDetailDialog
        open={isDetailDialogOpen}
        onOpenChange={setIsDetailDialogOpen}
        appointment={
          selectedAppointment as
            | (Appointment & {
                patientId: string
                doctorId: string
                durationMinutes: number
                status: string
                type: string
              })
            | null
        }
        readOnly={isClinicalUser}
        isAdmin={isAdmin}
        onUpdate={onReload}
      />
      <UnavailabilityDetailDialog
        open={isUnavailabilityDialogOpen}
        onOpenChange={setIsUnavailabilityDialogOpen}
        unavailability={selectedUnavailability as (Unavailability & { doctorId: string }) | null}
        onReload={onReload}
      />
    </div>
  )
}
