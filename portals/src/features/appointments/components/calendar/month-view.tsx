import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { useState } from 'react'
import { useBranding } from '@/lib/branding-context'
import { cn } from '@/lib/utils'
import { getAppointmentColour } from '@/shared/utils/appointment-colours'
import {
  type AppointmentStatus,
  getAppointmentDimming,
  isAppointmentPast,
} from '@/shared/utils/appointment-status'
import { DayAppointmentsSheet } from './day-appointments-sheet'

interface Appointment {
  id: string
  date: Date | string
  status?: string
  type?: string
  [key: string]: unknown
}

interface CalendarEvent {
  id: string
  title: string
  date: Date
  type: 'appointment' | 'unavailability'
  color?: string
  appointment?: Appointment
}

interface MonthViewProps {
  date: Date
  events: CalendarEvent[]
  onEventClick?: (event: CalendarEvent) => void
  onDateClick?: (date: Date) => void
  appointmentTypesLookup: Map<string, { colour?: string }>
}

const MAX_VISIBLE = 3

export function MonthView({
  date,
  events,
  onEventClick,
  onDateClick,
  appointmentTypesLookup,
}: MonthViewProps) {
  const { accentColor } = useBranding()

  const monthStart = startOfMonth(date)
  const monthEnd = endOfMonth(date)
  const startDate = startOfWeek(monthStart)
  const endDate = endOfWeek(monthEnd)

  const calendarDays = eachDayOfInterval({ start: startDate, end: endDate })
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  const [daySheetOpen, setDaySheetOpen] = useState(false)
  const [daySheetDate, setDaySheetDate] = useState<Date | null>(null)
  const [daySheetEvents, setDaySheetEvents] = useState<CalendarEvent[]>([])

  function openDaySheet(day: Date, dayEvents: CalendarEvent[]) {
    setDaySheetDate(day)
    setDaySheetEvents(dayEvents)
    setDaySheetOpen(true)
  }

  function handleDaySheetEventClick(event: CalendarEvent) {
    setDaySheetOpen(false)
    onEventClick?.(event)
  }

  return (
    <>
      <div className="flex flex-col border rounded-lg bg-background">
        <div className="grid grid-cols-7 border-b">
          {weekDays.map((day) => (
            <div
              key={day}
              className="py-2 text-center text-sm font-semibold text-muted-foreground border-r last:border-r-0"
            >
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 grid-rows-5 flex-1 min-h-[600px]">
          {calendarDays.map((day) => {
            const dayEvents = events.filter((e) => isSameDay(e.date, day))
            const visibleEvents = dayEvents.slice(0, MAX_VISIBLE)
            const overflow = dayEvents.length - visibleEvents.length

            return (
              <div
                key={day.toString()}
                className={cn(
                  'flex flex-col min-h-[120px] border-b border-r last:border-r-0 relative group transition-colors',
                  !isSameMonth(day, monthStart) && 'bg-muted/10 text-muted-foreground'
                )}
                // Today's cell gets a subtle wash of the clinic accent (~10% alpha)
                // instead of a hardcoded blue, so the highlight tracks branding.
                style={isToday(day) ? { backgroundColor: `${accentColor}1a` } : undefined}
              >
                {/* Top click strip — opens AddAppointmentSheet pre-filled with this date */}
                <button
                  type="button"
                  onClick={() => onDateClick?.(day)}
                  className={cn(
                    'flex justify-between items-center px-2 h-8 cursor-pointer hover:bg-muted/40 transition-colors',
                    !onDateClick && 'cursor-default hover:bg-transparent'
                  )}
                  aria-label={`Add appointment on ${format(day, 'MMM d, yyyy')}`}
                  disabled={!onDateClick}
                >
                  <span
                    className={cn(
                      'text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full',
                      isToday(day) && 'text-white'
                    )}
                    style={isToday(day) ? { backgroundColor: accentColor } : undefined}
                  >
                    {format(day, 'd')}
                  </span>
                </button>

                {/* Cards stack below the strip — capped at MAX_VISIBLE */}
                <div className="flex-1 px-2 pb-2 space-y-1 overflow-hidden">
                  {visibleEvents.map((event) => {
                    if (event.type !== 'appointment') {
                      // Block-time rows resolve against the `blocked` status
                      // overlay. The helper returns the overlay label so
                      // the body shows "Doctor Blocked" consistently.
                      const colour = getAppointmentColour(null, 'blocked', appointmentTypesLookup)
                      return (
                        <div
                          key={`${event.type}-${event.id}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            onEventClick?.(event)
                          }}
                          style={{
                            backgroundColor: colour.background,
                            color: colour.text,
                            borderLeft: colour.border ? `3px solid ${colour.border}` : undefined,
                          }}
                          className="text-xs px-2 py-1 rounded truncate cursor-pointer hover:brightness-95"
                        >
                          {format(event.date, 'HH:mm')} {colour.label ?? event.title}
                        </div>
                      )
                    }

                    const status = (event.appointment?.status ?? 'scheduled') as AppointmentStatus
                    const past = isAppointmentPast(event.date)
                    const dim = getAppointmentDimming(status, past)
                    const dashed = status === 'no_show'
                    const colour = getAppointmentColour(
                      event.appointment?.type,
                      status,
                      appointmentTypesLookup
                    )
                    // Cancelled rows strike through regardless of past flag.
                    const strike = colour.strikethrough || dim.strikethrough

                    return (
                      <div
                        key={`${event.type}-${event.id}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          onEventClick?.(event)
                        }}
                        style={{
                          backgroundColor: colour.background,
                          color: colour.text,
                        }}
                        className={cn(
                          'flex items-stretch text-xs rounded truncate cursor-pointer overflow-hidden',
                          dim.opacity
                        )}
                      >
                        <div
                          className={cn(
                            'w-1 flex-shrink-0',
                            dashed && 'border-l-2 border-dashed border-current bg-transparent'
                          )}
                          style={
                            dashed ? undefined : { backgroundColor: colour.border ?? colour.text }
                          }
                        />
                        <div className="flex-1 min-w-0 px-2 py-1 truncate">
                          <span className="font-semibold">{format(event.date, 'HH:mm')}</span>{' '}
                          <span className={cn('truncate', strike && 'line-through')}>
                            {event.title}
                          </span>
                        </div>
                      </div>
                    )
                  })}

                  {overflow > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        openDaySheet(day, dayEvents)
                      }}
                      className="w-full text-left text-xs font-medium text-muted-foreground hover:text-foreground hover:underline px-2 py-0.5"
                    >
                      +{overflow} more
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <DayAppointmentsSheet
        open={daySheetOpen}
        onOpenChange={setDaySheetOpen}
        date={daySheetDate}
        events={daySheetEvents}
        onEventClick={handleDaySheetEventClick}
        appointmentTypesLookup={appointmentTypesLookup}
      />
    </>
  )
}
