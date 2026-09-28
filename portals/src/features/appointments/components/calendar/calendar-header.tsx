import { addDays, addMonths, addWeeks, format, subDays, subMonths, subWeeks } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useBranding } from '@/lib/branding-context'
import { Button } from '@/shared/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'

interface CalendarHeaderProps {
  date: Date
  setDate: (date: Date) => void
  view: 'month' | 'week' | 'day'
  setView: (view: 'month' | 'week' | 'day') => void
}

export function CalendarHeader({ date, setDate, view, setView }: CalendarHeaderProps) {
  // §3.2 — calendar chrome tracks the clinic branding. themeColor drives the
  // header title + nav-button group accent; accentColor the "Today" action.
  const { themeColor, accentColor } = useBranding()

  const handlePrev = () => {
    switch (view) {
      case 'month':
        setDate(subMonths(date, 1))
        break
      case 'week':
        setDate(subWeeks(date, 1))
        break
      case 'day':
        setDate(subDays(date, 1))
        break
    }
  }

  const handleNext = () => {
    switch (view) {
      case 'month':
        setDate(addMonths(date, 1))
        break
      case 'week':
        setDate(addWeeks(date, 1))
        break
      case 'day':
        setDate(addDays(date, 1))
        break
    }
  }

  const handleToday = () => setDate(new Date())

  return (
    <div className="flex items-center justify-between py-4">
      <div className="flex items-center gap-2">
        <div
          className="flex items-center rounded-md border bg-background shadow-sm"
          // Nav-button group border picks up the clinic theme colour (~35% alpha).
          style={{ borderColor: `${themeColor}59` }}
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={handlePrev}
            className="h-8 w-8 rounded-none rounded-l-md"
            aria-label="Previous period"
            // Prev/next arrows tint to the brand theme colour.
            style={{ color: themeColor }}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToday}
            className="h-8 rounded-none font-medium"
            // "Today" action uses the accent colour to match the calendar's
            // today-cell highlight in month/week/day views.
            style={{ color: accentColor }}
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleNext}
            className="h-8 w-8 rounded-none rounded-r-md"
            aria-label="Next period"
            style={{ color: themeColor }}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <h2
          className="text-xl font-semibold ml-4 border-b-2 pb-0.5"
          // Title underline accent ties the header to the brand theme colour.
          style={{ borderColor: themeColor }}
        >
          {format(date, 'MMMM yyyy')}
        </h2>
      </div>

      <div className="flex items-center gap-2">
        <Select value={view} onValueChange={(v: 'month' | 'week' | 'day') => setView(v)}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="View" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="month">Month</SelectItem>
            <SelectItem value="week">Week</SelectItem>
            <SelectItem value="day">Day</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
