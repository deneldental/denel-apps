import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  format,
  subDays,
  subMonths,
  subWeeks,
  subYears,
} from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface CalendarHeaderProps {
  date: Date
  setDate: (date: Date) => void
  view: 'year' | 'month' | 'week' | 'day'
  setView: (view: 'year' | 'month' | 'week' | 'day') => void
}

export function CalendarHeader({ date, setDate, view, setView }: CalendarHeaderProps) {
  const handlePrev = () => {
    switch (view) {
      case 'year':
        setDate(subYears(date, 1))
        break
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
      case 'year':
        setDate(addYears(date, 1))
        break
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
        <div className="flex items-center rounded-md border bg-background shadow-sm">
          <Button
            variant="ghost"
            size="icon"
            onClick={handlePrev}
            className="h-8 w-8 rounded-none rounded-l-md"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToday}
            className="h-8 rounded-none font-normal"
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleNext}
            className="h-8 w-8 rounded-none rounded-r-md"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <h2 className="text-xl font-semibold ml-4">
          {format(date, view === 'year' ? 'yyyy' : 'MMMM yyyy')}
        </h2>
      </div>

      <div className="flex items-center gap-2">
        <Select value={view} onValueChange={(v: 'year' | 'month' | 'week' | 'day') => setView(v)}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="View" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="year">Year</SelectItem>
            <SelectItem value="month">Month</SelectItem>
            <SelectItem value="week">Week</SelectItem>
            <SelectItem value="day">Day</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
