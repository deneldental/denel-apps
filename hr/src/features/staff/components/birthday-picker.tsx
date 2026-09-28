// PR-19 — compact day/month picker for the privacy-preserving staff birthday.
// Two Selects side-by-side. The day list adjusts to the chosen month.

import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@denel/ui'
import { useMemo } from 'react'

const NONE_VALUE = '__none__'
const MONTHS = [
  { value: 1, label: 'Jan' },
  { value: 2, label: 'Feb' },
  { value: 3, label: 'Mar' },
  { value: 4, label: 'Apr' },
  { value: 5, label: 'May' },
  { value: 6, label: 'Jun' },
  { value: 7, label: 'Jul' },
  { value: 8, label: 'Aug' },
  { value: 9, label: 'Sep' },
  { value: 10, label: 'Oct' },
  { value: 11, label: 'Nov' },
  { value: 12, label: 'Dec' },
] as const

function daysInMonth(month: number | null): number {
  if (!month) return 31
  // Use a non-leap year so February caps at 28.
  return new Date(2025, month, 0).getDate()
}

export function BirthdayPicker({
  day,
  month,
  onDayChange,
  onMonthChange,
  idPrefix = 'birthday',
}: {
  day: number | null
  month: number | null
  onDayChange: (next: number | null) => void
  onMonthChange: (next: number | null) => void
  idPrefix?: string
}) {
  const maxDay = daysInMonth(month)
  const days = useMemo(() => Array.from({ length: maxDay }, (_, i) => i + 1), [maxDay])

  const dayDisplayValue = day && day <= maxDay ? String(day) : NONE_VALUE

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-month`} className="text-xs">
          Birth month
        </Label>
        <Select
          value={month ? String(month) : NONE_VALUE}
          onValueChange={(v) => {
            const next = v === NONE_VALUE ? null : Number(v)
            onMonthChange(next)
            if (next && day && day > daysInMonth(next)) onDayChange(null)
          }}
        >
          <SelectTrigger id={`${idPrefix}-month`}>
            <SelectValue placeholder="Month" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>
              <span className="text-muted-foreground">—</span>
            </SelectItem>
            {MONTHS.map((m) => (
              <SelectItem key={m.value} value={String(m.value)}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-day`} className="text-xs">
          Day
        </Label>
        <Select
          value={dayDisplayValue}
          onValueChange={(v) => onDayChange(v === NONE_VALUE ? null : Number(v))}
        >
          <SelectTrigger id={`${idPrefix}-day`}>
            <SelectValue placeholder="Day" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>
              <span className="text-muted-foreground">—</span>
            </SelectItem>
            {days.map((d) => (
              <SelectItem key={d} value={String(d)}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
