import { format, isSameDay, isToday, startOfDay } from 'date-fns'
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

interface DayViewProps {
  date: Date
  events: CalendarEvent[]
  onEventClick?: (event: CalendarEvent) => void
  onDateClick?: (date: Date) => void
}

export function DayView({ date, events, onEventClick, onDateClick }: DayViewProps) {
  // Generate hours 6 AM to 10 PM for Day View (More detailed)
  const hours = Array.from({ length: 17 }, (_, i) => i + 6)

  return (
    <div className="flex flex-col h-full border rounded-lg overflow-hidden bg-background">
      {/* Header */}
      <div className="p-4 border-b text-center bg-muted/20">
        <div className="text-sm text-muted-foreground">{format(date, 'EEEE')}</div>
        <div
          className={cn(
            'text-3xl font-bold inline-block rounded-full px-4',
            isToday(date) && 'text-primary'
          )}
        >
          {format(date, 'd')}
        </div>
      </div>

      {/* Time Grid */}
      <div className="overflow-y-auto flex-1 min-h-[600px]">
        <div className="relative">
          {hours.map((hour) => (
            <div key={hour} className="flex h-24 border-b relative group">
              {/* Time Label */}
              <div className="w-20 border-r flex-shrink-0 text-right pr-4 pt-2 text-sm text-muted-foreground bg-muted/5 font-medium">
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

              return (
                <div
                  key={`${event.type}-${event.id}`}
                  className={cn(
                    'absolute left-24 right-4 p-3 rounded-md text-sm border shadow-sm cursor-pointer hover:shadow-md transition-shadow',
                    event.type === 'appointment'
                      ? 'bg-blue-100 border-blue-200 text-blue-800'
                      : 'bg-red-100 border-red-200 text-red-800'
                  )}
                  style={{ top: `${topOffset + minOffset}px`, height: '88px' }} // Approx 1 hour height safe margin
                  onClick={(e) => {
                    e.stopPropagation()
                    onEventClick?.(event)
                  }}
                >
                  <div className="flex items-center gap-2 font-semibold">
                    <div
                      className={cn(
                        'w-2 h-2 rounded-full',
                        event.type === 'appointment' ? 'bg-blue-500' : 'bg-red-500'
                      )}
                    />
                    {format(event.date, 'h:mm a')} - {event.title}
                  </div>
                  <div className="text-xs opacity-75 mt-1">
                    {event.type === 'appointment' ? 'Check details' : 'Blocked'}
                  </div>
                </div>
              )
            })}
        </div>
      </div>
    </div>
  )
}
