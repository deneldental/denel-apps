import {
  eachDayOfInterval,
  endOfWeek,
  format,
  isSameDay,
  isToday,
  startOfDay,
  startOfWeek,
} from 'date-fns'
import { useBranding } from '@/lib/branding-context'
import { cn } from '@/lib/utils'
import { getAppointmentColour } from '@/shared/utils/appointment-colours'
import {
  type AppointmentStatus,
  getAppointmentDimming,
  isAppointmentPast,
} from '@/shared/utils/appointment-status'

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
  appointment?: Appointment
}

interface WeekViewProps {
  date: Date
  events: CalendarEvent[]
  onEventClick?: (event: CalendarEvent) => void
  onDateClick?: (date: Date) => void // Assuming creating at specific time slot
  appointmentTypesLookup: Map<string, { colour?: string }>
}

const PX_PER_HOUR = 80 // h-20 = 5rem = 80px, matches the hour-row height below.
const MIN_EVENT_HEIGHT_PX = 24 // Keeps very short visits readable/clickable.
const DEFAULT_DURATION_MINUTES = 30

// [Medium] Every appointment card used to render at a fixed 70px regardless
// of length — a 15-min and a 2-hour visit looked identical. durationMinutes
// was already available (used correctly elsewhere for a text end-time
// label); the calendar grid just never read it.
function eventHeightPx(durationMinutes: unknown): number {
  const minutes = Number(durationMinutes) || DEFAULT_DURATION_MINUTES
  return Math.max(MIN_EVENT_HEIGHT_PX, (minutes / 60) * PX_PER_HOUR)
}

export function WeekView({
  date,
  events,
  onEventClick,
  onDateClick,
  appointmentTypesLookup,
}: WeekViewProps) {
  // §3.2 — calendar chrome tracks branding: accentColor for the today-column
  // highlight, themeColor for the time-axis labels.
  const { accentColor, themeColor } = useBranding()

  // [Medium] Was Sunday-start (date-fns default) while the sidebar's
  // week-strip uses Monday-start (weekStartsOn: 1) — two different
  // definitions of "this week" visible on the same page.
  const weekStart = startOfWeek(date, { weekStartsOn: 1 })
  const weekEnd = endOfWeek(date, { weekStartsOn: 1 })
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd })

  // Generate hours 8 AM to 8 PM
  const hours = Array.from({ length: 13 }, (_, i) => i + 8)

  return (
    <div className="flex flex-col border rounded-lg bg-background">
      {/* Header */}
      <div className="grid grid-cols-8 border-b">
        <div className="w-16 border-r p-2"></div> {/* Time Label Column */}
        {weekDays.map((day) => (
          <div
            key={day.toString()}
            className="p-2 text-center border-r last:border-r-0"
            // Today's column header carries a subtle accent wash (~10% alpha).
            style={isToday(day) ? { backgroundColor: `${accentColor}1a` } : undefined}
          >
            <div className="text-xs text-muted-foreground">{format(day, 'EEE')}</div>
            <div
              className={cn(
                'text-lg font-semibold w-8 h-8 rounded-full flex items-center justify-center mx-auto',
                isToday(day) && 'text-white'
              )}
              style={isToday(day) ? { backgroundColor: accentColor } : undefined}
            >
              {format(day, 'd')}
            </div>
          </div>
        ))}
      </div>

      {/* Time Grid */}
      <div className="overflow-y-auto max-h-[600px]">
        <div className="grid grid-cols-8 relative">
          {/* Time labels — axis text takes the brand theme colour */}
          <div className="w-16 border-r text-xs text-center" style={{ color: themeColor }}>
            {hours.map((hour) => (
              <div key={hour} className="h-20 border-b relative">
                <span className="absolute -top-3 left-0 right-0">{hour}:00</span>
              </div>
            ))}
          </div>

          {/* Columns for days */}
          {weekDays.map((day) => (
            <div key={day.toString()} className="border-r last:border-r-0 relative">
              {hours.map((hour) => (
                <div
                  key={hour}
                  className="h-20 border-b hover:bg-muted/20 cursor-pointer"
                  onClick={() => {
                    const slotTime = startOfDay(day)
                    slotTime.setHours(hour)
                    onDateClick?.(slotTime)
                  }}
                />
              ))}

              {/* Events Overlay */}
              {events
                .filter((e) => isSameDay(e.date, day))
                .map((event) => {
                  const startHour = event.date.getHours()
                  // Make sure it fits in our view (8am-8pm)
                  if (startHour < 8 || startHour > 20) return null

                  const topOffset = (startHour - 8) * 80 // 80px per hour

                  if (event.type !== 'appointment') {
                    const colour = getAppointmentColour(null, 'blocked', appointmentTypesLookup)
                    return (
                      <div
                        key={`${event.type}-${event.id}`}
                        className="absolute left-1 right-1 p-1 rounded text-xs border overflow-hidden cursor-pointer shadow-sm"
                        style={{
                          top: `${topOffset}px`,
                          height: '70px',
                          backgroundColor: colour.background,
                          color: colour.text,
                          borderColor: colour.border,
                        }}
                        onClick={(e) => {
                          e.stopPropagation()
                          onEventClick?.(event)
                        }}
                      >
                        <div className="font-semibold">{format(event.date, 'HH:mm')}</div>
                        <div className="truncate">{colour.label ?? event.title}</div>
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
                  const strike = colour.strikethrough || dim.strikethrough

                  return (
                    <div
                      key={`${event.type}-${event.id}`}
                      className={cn(
                        'absolute left-1 right-1 flex items-stretch rounded text-xs overflow-hidden cursor-pointer shadow-sm',
                        dim.opacity
                      )}
                      style={{
                        top: `${topOffset}px`,
                        height: `${eventHeightPx(event.appointment?.durationMinutes)}px`,
                        backgroundColor: colour.background,
                        color: colour.text,
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        onEventClick?.(event)
                      }}
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
                      <div className="flex-1 min-w-0 p-1">
                        <div className="font-semibold">{format(event.date, 'HH:mm')}</div>
                        <div className={cn('truncate', strike && 'line-through')}>
                          {event.title}
                        </div>
                      </div>
                    </div>
                  )
                })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
