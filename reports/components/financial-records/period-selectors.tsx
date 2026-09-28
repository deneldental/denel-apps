import { addWeeks, endOfWeek, format, startOfWeek, subWeeks } from 'date-fns'
import { CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface PeriodSelectorProps {
  view: 'day' | 'week' | 'month' | 'year'
  date: Date
  onDateChange: (date: Date) => void
}

export function PeriodSelector({ view, date, onDateChange }: PeriodSelectorProps) {
  if (view === 'day') {
    return <DaySelector date={date} onDateChange={onDateChange} />
  }
  if (view === 'week') {
    return <WeekSelector date={date} onDateChange={onDateChange} />
  }
  if (view === 'month') {
    return <MonthSelector date={date} onDateChange={onDateChange} />
  }
  return <YearSelector date={date} onDateChange={onDateChange} />
}

// Day Selector - Simple date picker
function DaySelector({ date, onDateChange }: { date: Date; onDateChange: (date: Date) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'justify-start text-left font-normal w-[280px]',
            !date && 'text-muted-foreground'
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? format(date, 'EEEE, MMMM dd, yyyy') : <span>Pick a date</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={(newDate) => newDate && onDateChange(newDate)}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  )
}

// Week Selector - Navigate weeks with arrows
function WeekSelector({ date, onDateChange }: { date: Date; onDateChange: (date: Date) => void }) {
  const weekStart = startOfWeek(date, { weekStartsOn: 0 }) // Sunday
  const weekEnd = endOfWeek(date, { weekStartsOn: 0 })

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="icon" onClick={() => onDateChange(subWeeks(date, 1))}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <div className="flex items-center gap-2 min-w-[280px] justify-center">
        <CalendarIcon className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">
          {format(weekStart, 'MMM dd')} - {format(weekEnd, 'MMM dd, yyyy')}
        </span>
      </div>
      <Button variant="outline" size="icon" onClick={() => onDateChange(addWeeks(date, 1))}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}

// Month Selector - Month and Year dropdowns
function MonthSelector({ date, onDateChange }: { date: Date; onDateChange: (date: Date) => void }) {
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]

  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 10 }, (_, i) => currentYear - 5 + i)

  const handleMonthChange = (monthIndex: string) => {
    const newDate = new Date(date)
    newDate.setMonth(parseInt(monthIndex, 10))
    onDateChange(newDate)
  }

  const handleYearChange = (year: string) => {
    const newDate = new Date(date)
    newDate.setFullYear(parseInt(year, 10))
    onDateChange(newDate)
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={date.getMonth().toString()} onValueChange={handleMonthChange}>
        <SelectTrigger className="w-[140px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {months.map((month, index) => (
            <SelectItem key={index} value={index.toString()}>
              {month}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={date.getFullYear().toString()} onValueChange={handleYearChange}>
        <SelectTrigger className="w-[100px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {years.map((year) => (
            <SelectItem key={year} value={year.toString()}>
              {year}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

// Year Selector - Year dropdown
function YearSelector({ date, onDateChange }: { date: Date; onDateChange: (date: Date) => void }) {
  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 20 }, (_, i) => currentYear - 10 + i)

  const handleYearChange = (year: string) => {
    const newDate = new Date(date)
    newDate.setFullYear(parseInt(year, 10))
    onDateChange(newDate)
  }

  return (
    <Select value={date.getFullYear().toString()} onValueChange={handleYearChange}>
      <SelectTrigger className="w-[120px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {years.map((year) => (
          <SelectItem key={year} value={year.toString()}>
            {year}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
