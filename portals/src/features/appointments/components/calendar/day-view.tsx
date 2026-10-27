import { format, isSameDay, isToday, startOfDay } from 'date-fns'
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

interface DayViewProps {
  date: Date
  events: CalendarEvent[]
  onEventClick?: (event: CalendarEvent) => void
  onDateClick?: (date: Date) => void
  appointmentTypesLookup: Map<string, { colour?: string }>
}

const PX_PER_HOUR = 96 // h-24 = 6rem = 96px, matches the hour-row height below.
const MIN_EVENT_HEIGHT_PX = 24 // Keeps very short visits readable/clickable.
const DEFAULT_DURATION_MINUTES = 30

// [Medium] Every appointment card used to render at a fixed 88px regardless
// of length — a 15-min and a 2-hour visit looked identical. durationMinutes
// was already available (used correctly elsewhere for a text end-time
// label); the calendar grid just never read it.
function eventHeightPx(durationMinutes: unknown): number {
  const minutes = Number(durationMinutes) || DEFAULT_DURATION_MINUTES
  return Math.max(MIN_EVENT_HEIGHT_PX, (minutes / 60) * PX_PER_HOUR)
}

export function DayView({
  date,
  events,
  onEventClick,
  onDateClick,
  appointmentTypesLookup,
}: DayViewProps) {
  // §3.2 — calendar chrome tracks branding: accentColor for the today date
  // number, themeColor for the time-axis labels.
  const { accentColor, themeColor } = useBranding()

  // Generate hours 6 AM to 10 PM for Day View (More detailed)
  const hours = Array.from({ length: 17 }, (_, i) => i + 6)

  return (
    <div className="flex flex-col border rounded-lg bg-background">
      {/* Header — bottom border carries the brand theme colour */}
      <div
        className="p-4 border-b-2 text-center bg-muted/20"
        style={{ borderBottomColor: themeColor }}
      >
        <div className="text-sm text-muted-foreground">{format(date, 'EEEE')}</div>
        <div
          className="text-3xl font-bold inline-block rounded-full px-4"
          // Today's date number takes the clinic accent colour.
          style={isToday(date) ? { color: accentColor } : undefined}
        >
          {format(date, 'd')}
        </div>
      </div>

      {/* Time Grid */}
      <div className="overflow-y-auto flex-1 min-h-[600px]">
        <div className="relative">
          {hours.map((hour) => (
            <div key={hour} className="flex h-24 border-b relative group">
              {/* Time Label — axis text takes the brand theme colour */}
              <div
                className="w-20 border-r flex-shrink-0 text-right pr-4 pt-2 text-sm bg-muted/5 font-medium"
                style={{ color: themeColor }}
              >
                {hour}:00
              </div>

              {/* Slot Content Area */}
              <div
                className="flex-1 relative hover:bg-muted/10 cursor-pointer"
                onClick={() => {
                  const slotTime = startOfDay(date)
                  slotTime.setHours(hour)
                  onDateClick?.(slotTime)
                }}
              >
                {/* Dashed half-hour line could go here */}
              </div>
            </div>
          ))}

          {/* Events Overlay */}
          {events
            .filter((e) => isSameDay(e.date, date))
            .map((event) => {
              const startHour = event.date.getHours()
              const startMin = event.date.getMinutes()
              if (startHour < 6 || startHour > 22) return null

              const topOffset = (startHour - 6) * 96 // 96px per hour (h-24 = 6rem = 96px)
              const minOffset = (startMin / 60) * 96

              if (event.type !== 'appointment') {
                const colour = getAppointmentColour(null, 'blocked', appointmentTypesLookup)
                return (
                  <div
                    key={`${event.type}-${event.id}`}
                    className="absolute left-24 right-4 p-3 rounded-md text-sm border shadow-sm cursor-pointer hover:shadow-md transition-shadow"
                    style={{
                      top: `${topOffset + minOffset}px`,
                      height: '88px',
                      backgroundColor: colour.background,
                      color: colour.text,
                      borderColor: colour.border,
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onEventClick?.(event)
                    }}
                  >
                    <div className="flex items-center gap-2 font-semibold">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: colour.border ?? colour.text }}
                      />
                      {format(event.date, 'h:mm a')} - {colour.label ?? event.title}
                    </div>
                    <div className="text-xs opacity-75 mt-1">Blocked</div>
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
                    'absolute left-24 right-4 flex items-stretch rounded-md text-sm shadow-sm cursor-pointer hover:shadow-md transition-shadow overflow-hidden',
                    dim.opacity
                  )}
                  style={{
                    top: `${topOffset + minOffset}px`,
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
                    style={dashed ? undefined : { backgroundColor: colour.border ?? colour.text }}
                  />
                  <div className="flex-1 min-w-0 p-3">
                    <div className="font-semibold text-xs">{format(event.date, 'h:mm a')}</div>
                    <div className={cn('truncate', strike && 'line-through')}>{event.title}</div>
                  </div>
                </div>
              )
            })}
        </div>
      </div>
    </div>
  )
}
