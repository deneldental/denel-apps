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
  color?: string
  appointment?: Appointment
}

interface MonthViewProps {
  date: Date
  events: CalendarEvent[]
  onEventClick?: (event: CalendarEvent) => void
  onDateClick?: (date: Date) => void
}

export function MonthView({ date, events, onEventClick, onDateClick }: MonthViewProps) {
  const monthStart = startOfMonth(date)
  const monthEnd = endOfMonth(date)
  const startDate = startOfWeek(monthStart)
  const endDate = endOfWeek(monthEnd)

  const calendarDays = eachDayOfInterval({ start: startDate, end: endDate })
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <div className="flex flex-col h-full border rounded-lg overflow-hidden bg-background">
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
        {/* Fixed row count might vary based on month, flex-1 ensures it fills if we use flex layout for rows */}
        {calendarDays.map((day) => {
          const dayEvents = events.filter((e) => isSameDay(e.date, day))
          return (
            <div
              key={day.toString()}
              className={cn(
                'min-h-[120px] p-2 border-b border-r last:border-r-0 relative group transition-colors hover:bg-muted/30 cursor-pointer',
                !isSameMonth(day, monthStart) && 'bg-muted/10 text-muted-foreground',
                isToday(day) && 'bg-blue-50/50'
              )}
              onClick={() => onDateClick?.(day)}
            >
              <div className="flex justify-between items-start">
                <span
                  className={cn(
                    'text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full',
                    isToday(day) && 'bg-primary text-primary-foreground'
                  )}
                >
                  {format(day, 'd')}
                </span>
              </div>
              <div className="mt-2 space-y-1">
                {dayEvents.map((event) => (
                  <div
                    key={`${event.type}-${event.id}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onEventClick?.(event)
                    }}
                    className={cn(
                      'text-xs px-2 py-1 rounded truncate cursor-pointer',
                      event.type === 'appointment'
                        ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                        : 'bg-red-100 text-red-700 hover:bg-red-200'
                    )}
                  >
                    {format(event.date, 'HH:mm')} {event.title}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
