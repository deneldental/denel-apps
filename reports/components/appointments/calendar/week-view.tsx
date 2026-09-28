import {
  eachDayOfInterval,
  endOfWeek,
  format,
  isSameDay,
  isToday,
  startOfDay,
  startOfWeek,
} from 'date-fns'
import { cn } from '@/lib/utils'

interface Appointment {
  id: string
  date: Date | string
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
}

export function WeekView({ date, events, onEventClick, onDateClick }: WeekViewProps) {
  const weekStart = startOfWeek(date)
  const weekEnd = endOfWeek(date)
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd })

  // Generate hours 8 AM to 8 PM
  const hours = Array.from({ length: 13 }, (_, i) => i + 8)

  return (
    <div className="flex flex-col h-full border rounded-lg overflow-hidden bg-background">
      {/* Header */}
      <div className="grid grid-cols-8 border-b">
        <div className="w-16 border-r p-2"></div> {/* Time Label Column */}
        {weekDays.map((day) => (
          <div
            key={day.toString()}
            className={cn('p-2 text-center border-r last:border-r-0', isToday(day) && 'bg-blue-50')}
          >
            <div className="text-xs text-muted-foreground">{format(day, 'EEE')}</div>
            <div
              className={cn(
                'text-lg font-semibold w-8 h-8 rounded-full flex items-center justify-center mx-auto',
                isToday(day) && 'bg-primary text-primary-foreground'
              )}
            >
              {format(day, 'd')}
            </div>
          </div>
        ))}
      </div>

      {/* Time Grid */}
      <div className="overflow-y-auto max-h-[600px]">
        <div className="grid grid-cols-8 relative">
          {/* Time labels */}
          <div className="w-16 border-r text-xs text-muted-foreground text-center">
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

                  return (
                    <div
                      key={`${event.type}-${event.id}`}
                      className={cn(
                        'absolute left-1 right-1 p-1 rounded text-xs border overflow-hidden cursor-pointer shadow-sm',
                        event.type === 'appointment'
                          ? 'bg-blue-100 border-blue-200 text-blue-700'
                          : 'bg-red-100 border-red-200 text-red-700'
                      )}
                      style={{ top: `${topOffset}px`, height: '70px' }} // Fixed height 70px for <1hr, ideally dynamic
                      onClick={(e) => {
                        e.stopPropagation()
                        onEventClick?.(event)
                      }}
                    >
                      <div className="font-semibold">{format(event.date, 'HH:mm')}</div>
                      <div className="truncate">{event.title}</div>
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
