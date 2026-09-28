import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CalendarHeader } from './calendar/calendar-header'
import { DayView } from './calendar/day-view'
import { MonthView } from './calendar/month-view'
import { WeekView } from './calendar/week-view'
import { YearView } from './calendar/year-view'

interface Appointment {
  id: string
  date: Date | string
  status?: string
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
}

export function AppointmentCalendar({
  appointments,
  unavailability,
  onDateClick,
  onAppointmentClick,
  onUnavailabilityClick,
}: AppointmentCalendarProps) {
  const _navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [date, setDate] = useState<Date>(() => {
    const dateParam = searchParams.get('date')
    return dateParam ? new Date(dateParam) : new Date()
  })
  const [view, setView] = useState<'year' | 'month' | 'week' | 'day'>(() => {
    const viewParam = searchParams.get('view') as 'year' | 'month' | 'week' | 'day' | null
    return viewParam || 'month'
  })

  // Sync state to URL for bookmarking/navigation
  useEffect(() => {
    // If we are navigating, we probably want to preserve the date in URL
    // But for initial load, we might read from it.
    // We actually only need to set params if we want to support sharing URLs
    // For now preventing excessive loops or history stack pushes
  }, [])

  const handleSetDate = (newDate: Date) => {
    setDate(newDate)
  }

  // Normalize events - filter out cancelled and completed appointments
  const events = [
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
        appointment: a, // Store full appointment data
      })),
    ...unavailability.map((u) => ({
      id: u.id,
      title: 'Unavailable', //u.reason ||
      date: new Date(u.startTime),
      type: 'unavailability' as const,
      unavailability: u, // Store full unavailability data
    })),
  ]

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
    <div className="flex flex-col gap-4">
      <CalendarHeader date={date} setDate={handleSetDate} view={view} setView={setView} />

      <div className="min-h-[600px]">
        {view === 'year' && <YearView />}
        {view === 'month' && (
          <MonthView
            date={date}
            events={events}
            onDateClick={onDateClick}
            onEventClick={handleEventClick}
          />
        )}
        {view === 'week' && (
          <WeekView
            date={date}
            events={events}
            onDateClick={onDateClick}
            onEventClick={handleEventClick}
          />
        )}
        {view === 'day' && (
          <DayView
            date={date}
            events={events}
            onDateClick={onDateClick}
            onEventClick={handleEventClick}
          />
        )}
      </div>
    </div>
  )
}
