import { Plus } from 'lucide-react'
import { useState } from 'react'
import { AddAppointmentDialog } from '@/components/appointments/add-appointment-dialog'
import { AddUnavailabilityDialog } from '@/components/appointments/add-unavailability-dialog'
import { AppointmentCalendar } from '@/components/appointments/appointment-calendar'
import { AppointmentDetailDialog } from '@/components/appointments/appointment-detail-dialog'
import { AppointmentList } from '@/components/appointments/appointment-list'
import { UnavailabilityDetailDialog } from '@/components/appointments/unavailability-detail-dialog'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

// Minimal type for calendar compatibility
interface CalendarAppointment {
  id: string
  date: Date | string
  status?: string
  patient?: {
    name?: string
  }
  doctor?: {
    user?: {
      name?: string
    }
  }
  [key: string]: unknown
}

interface CalendarUnavailability {
  id: string
  startTime: Date | string
  endTime: Date | string
  [key: string]: unknown
}

// Detailed type for detail dialog
interface Appointment {
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
  }
  doctor?: {
    user?: {
      name: string
    }
  }
  [key: string]: unknown
}

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

interface AppointmentsShellProps {
  appointments: CalendarAppointment[]
  unavailability: CalendarUnavailability[]
  userRole?: string
  canCreateAppointments?: boolean
  currentDoctorId?: string
  currentDoctorName?: string
}

export function AppointmentsShell({
  appointments,
  unavailability,
  canCreateAppointments = true,
  currentDoctorId,
  currentDoctorName,
}: AppointmentsShellProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined)
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null)
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false)
  const [selectedUnavailability, setSelectedUnavailability] = useState<Unavailability | null>(null)
  const [isUnavailabilityDialogOpen, setIsUnavailabilityDialogOpen] = useState(false)

  const handleDateClick = (date: Date) => {
    // Only allow date click for creating appointments if user has permission
    if (canCreateAppointments) {
      setSelectedDate(date)
      setIsDialogOpen(true)
    }
  }

  const handleAppointmentClick = (appointment: CalendarAppointment) => {
    setSelectedAppointment(appointment as Appointment)
    setIsDetailDialogOpen(true)
  }

  const handleUnavailabilityClick = (unavailability: CalendarUnavailability) => {
    setSelectedUnavailability(unavailability as Unavailability)
    setIsUnavailabilityDialogOpen(true)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Appointments</h1>
          <p className="text-muted-foreground">Schedule and manage appointments.</p>
        </div>
      </div>

      <Tabs defaultValue="calendar" className="w-full">
        <TabsList>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="list">All Appointments</TabsTrigger>
        </TabsList>
        <TabsContent value="calendar" className="mt-4 flex flex-col gap-4">
          <div className="flex justify-end gap-2">
            <AddUnavailabilityDialog
              currentDoctorId={currentDoctorId}
              currentDoctorName={currentDoctorName}
              isDoctor={!!currentDoctorId}
            />
            {canCreateAppointments && (
              <AddAppointmentDialog
                open={isDialogOpen}
                onOpenChange={(open) => {
                  setIsDialogOpen(open)
                  if (!open) setSelectedDate(undefined)
                }}
                defaultDate={selectedDate}
                trigger={
                  <Button onClick={() => setIsDialogOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    New Appointment
                  </Button>
                }
              />
            )}
          </div>
          <AppointmentCalendar
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
            onDateClick={canCreateAppointments ? handleDateClick : undefined}
            onAppointmentClick={
              handleAppointmentClick as (appointment: {
                id: string
                date: Date | string
                [key: string]: unknown
              }) => void
            }
            onUnavailabilityClick={
              handleUnavailabilityClick as (unavailability: {
                id: string
                startTime: Date | string
                endTime: Date | string
                [key: string]: unknown
              }) => void
            }
          />
        </TabsContent>
        <TabsContent value="list" className="mt-4">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <AppointmentList data={appointments as any} />
        </TabsContent>
      </Tabs>
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
        readOnly={!canCreateAppointments}
      />
      <UnavailabilityDetailDialog
        open={isUnavailabilityDialogOpen}
        onOpenChange={setIsUnavailabilityDialogOpen}
        unavailability={
          selectedUnavailability as
            | (Unavailability & {
                doctorId: string
              })
            | null
        }
      />
    </div>
  )
}
