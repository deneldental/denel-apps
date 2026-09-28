import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useLookup } from '@/shared/hooks/use-lookup'
import { CalendarHeader } from './calendar/calendar-header'
import { DayView } from './calendar/day-view'
import { MonthView } from './calendar/month-view'
import { WeekView } from './calendar/week-view'

interface Appointment {
  id: string
  date: Date | string
  status?: string
  type?: string
  patient?: {
    name?: string
  }
  [key: string]: unknown
}

interface Unavailability {
  id: string
  startTime: Date | string
  endTime: Date | string
  [key: string]: unknown
}

interface AppointmentCalendarProps {
  appointments: Appointment[]
  unavailability: Unavailability[]
  onDateClick?: (date: Date) => void
  onAppointmentClick?: (appointment: Appointment) => void
  onUnavailabilityClick?: (unavailability: Unavailability) => void
  onDateChange?: (date: Date) => void
  className?: string
}

export function AppointmentCalendar({
  appointments,
  unavailability,
  onDateClick,
  onAppointmentClick,
  onUnavailabilityClick,
  onDateChange,
  className,
}: AppointmentCalendarProps) {
  const _navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [date, setDate] = useState<Date>(
    searchParams.get('date') ? new Date(searchParams.get('date')!) : new Date()
  )
  const [view, setView] = useState<'month' | 'week' | 'day'>(() => {
    const raw = searchParams.get('view')
    return raw === 'month' || raw === 'week' || raw === 'day' ? raw : 'month'
  })
  // Appointment-type lookup, shared (one fetch) with every other picker and
  // refreshed automatically when Settings → Appointment Types is edited. The
  // active-only endpoint is fine here: inactive types can still be referenced
  // by older rows, and the colour helper null-falls-back for those.
  const { rows: appointmentTypes } = useLookup('appointment-types')

  const appointmentTypesLookup = useMemo(() => {
    const map = new Map<string, { colour?: string }>()
    for (const t of appointmentTypes) {
      if (t?.name) map.set(t.name, { colour: t.colour ?? undefined })
    }
    return map
  }, [appointmentTypes])

  const handleSetDate = (newDate: Date) => {
    setDate(newDate)
    onDateChange?.(newDate)
  }

  // Normalize events - filter out cancelled and completed appointments
  const events = useMemo(
    () => [
      ...appointments
        .filter((a) => {
          const status = typeof a.status === 'string' ? a.status : undefined
          return status !== 'cancelled' && status !== 'completed'
        })
        .map((a) => ({
          id: a.id,
          title:
            typeof a.patient === 'object' && a.patient && 'name' in a.patient
              ? (a.patient as { name?: string }).name || 'Unknown Patient'
              : 'Unknown Patient',
          date: new Date(a.date),
          type: 'appointment' as const,
          appointment: a,
        })),
      ...unavailability.map((u) => ({
        id: u.id,
        title: 'Doctor Blocked',
        date: new Date(u.startTime),
        type: 'unavailability' as const,
        unavailability: u,
      })),
    ],
    [appointments, unavailability]
  )

  interface CalendarEvent {
    id: string
    title: string
    date: Date
    type: 'appointment' | 'unavailability'
    appointment?: Appointment
    unavailability?: Unavailability
  }

  const handleEventClick = (event: CalendarEvent) => {
    if (event.type === 'appointment' && event.appointment && onAppointmentClick) {
      onAppointmentClick(event.appointment)
    } else if (event.type === 'unavailability' && event.unavailability && onUnavailabilityClick) {
      onUnavailabilityClick(event.unavailability)
    }
  }

  return (
    <div id="appt-calendar-root" className={cn('flex flex-col gap-4 h-full min-h-0', className)}>
      {/* CalendarHeader — fixed, never scrolls */}
      <CalendarHeader date={date} setDate={handleSetDate} view={view} setView={setView} />

      {/* View content — scrolls independently within the panel */}
      <div id="appt-calendar-view" className="flex-1 min-h-0 overflow-y-auto">
        {view === 'month' && (
          <MonthView
            date={date}
            events={events}
            onDateClick={onDateClick}
            onEventClick={handleEventClick}
            appointmentTypesLookup={appointmentTypesLookup}
          />
        )}
        {view === 'week' && (
          <WeekView
            date={date}
            events={events}
            onDateClick={onDateClick}
            onEventClick={handleEventClick}
            appointmentTypesLookup={appointmentTypesLookup}
          />
        )}
        {view === 'day' && (
          <DayView
            date={date}
            events={events}
            onDateClick={onDateClick}
            onEventClick={handleEventClick}
            appointmentTypesLookup={appointmentTypesLookup}
          />
        )}
      </div>
    </div>
  )
}
