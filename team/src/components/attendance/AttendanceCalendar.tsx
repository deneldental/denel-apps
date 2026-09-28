import { format } from 'date-fns'
import { LogIn, LogOut, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

export interface AttendanceDay {
  date: string
  clockIn: string | null
  clockOut: string | null
  hoursWorked: number | null
  status: string
}

/** Points a day's status earns — mirrors the attendance scorer. */
export function pointsForDay(status: string): number {
  switch (status) {
    case 'present':
      return 10
    case 'late':
      return 6
    case 'half_day':
      return 5
    case 'leave':
      return 10
    default:
      return 0
  }
}

type Tone = 'green' | 'amber' | 'red' | 'black'

/** Map an attendance status to the calendar's traffic-light tone. */
function toneForStatus(status: string | undefined): Tone {
  switch (status) {
    case 'present':
    case 'leave':
      return 'green' // clocked in on time / early
    case 'late':
    case 'half_day':
      return 'amber' // late
    case 'absent':
      return 'red' // absent
    default:
      return 'black' // no record / not used yet
  }
}

// Mild tiles — soft background + deep text, matching the stat-card / chip look
// used across the app. "black" = a day with no attendance record (future or
// simply never used); it gets a muted neutral so it reads as inert, not alarming.
const TILE: Record<Tone, string> = {
  green: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700',
  black: 'bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500',
}

// Slightly more saturated dots for the legend so the key stays readable at 12px.
const LEGEND_DOT: Record<Tone, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-400',
  red: 'bg-red-500',
  black: 'bg-neutral-300 dark:bg-neutral-600',
}

const SHEET_TONE: Record<Tone, string> = {
  green: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700',
  black: 'bg-neutral-100 text-neutral-500',
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface Cell {
  day: number
  dateStr: string
  record: AttendanceDay | null
  tone: Tone
  isToday: boolean
  isFuture: boolean
}

/**
 * A month calendar of attendance — one neat, colour-coded square per day.
 * Green = on time, amber = late, red = absent, black = no record / not yet
 * used. Tapping a day that has a record opens a bottom sheet with its clock-in,
 * clock-out, and points.
 */
export function AttendanceCalendar({
  monthAnchor,
  days,
}: {
  monthAnchor: Date
  days: AttendanceDay[]
}) {
  const [selected, setSelected] = useState<Cell | null>(null)

  const { cells, leadingBlanks } = useMemo(() => {
    const year = monthAnchor.getFullYear()
    const month = monthAnchor.getMonth()
    const daysInMonth = new Date(year, month + 1, 0).getDate()

    const byDate = new Map(days.map((d) => [d.date, d]))

    const todayMidnight = new Date()
    todayMidnight.setHours(0, 0, 0, 0)

    // Monday-based offset for the 1st of the month.
    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7

    const cells: Cell[] = []
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const record = byDate.get(dateStr) ?? null
      const dateObj = new Date(year, month, day)
      const isFuture = dateObj.getTime() > todayMidnight.getTime()
      // A future day is always black even if the backend returned a status for
      // it — it simply hasn't been used yet.
      const tone: Tone = isFuture ? 'black' : toneForStatus(record?.status)
      cells.push({
        day,
        dateStr,
        record,
        tone,
        isFuture,
        isToday: dateObj.getTime() === todayMidnight.getTime(),
      })
    }
    return { cells, leadingBlanks: firstWeekday }
  }, [monthAnchor, days])

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border bg-card p-3 shadow-xs">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 gap-1.5 mb-1.5">
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              className="text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
            >
              {w}
            </div>
          ))}
        </div>

        {/* Day tiles */}
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed leading blanks, order is stable
            <div key={`blank-${i}`} className="aspect-square" />
          ))}

          {cells.map((cell) => {
            const tappable = !!cell.record && !cell.isFuture
            const tileClass = cn(
              'aspect-square rounded-xl flex items-center justify-center transition-transform',
              TILE[cell.tone],
              cell.isToday && 'ring-2 ring-offset-1 ring-primary dark:ring-white',
              tappable && 'active:scale-95 cursor-pointer'
            )

            return tappable ? (
              <button
                key={cell.dateStr}
                type="button"
                onClick={() => setSelected(cell)}
                className={tileClass}
                aria-label={`${format(new Date(`${cell.dateStr}T00:00:00`), 'MMMM d')} — ${cell.record?.status}`}
              >
                <span className="text-sm font-bold leading-none">{cell.day}</span>
              </button>
            ) : (
              <div key={cell.dateStr} className={tileClass}>
                <span className="text-sm font-bold leading-none">{cell.day}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 px-1">
        {(
          [
            ['green', 'On time'],
            ['amber', 'Late'],
            ['red', 'Absent'],
            ['black', 'No record'],
          ] as const
        ).map(([tone, label]) => (
          <div key={tone} className="flex items-center gap-1.5">
            <span className={cn('h-3 w-3 rounded-md', LEGEND_DOT[tone])} />
            <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>

      {/* Day detail bottom sheet */}
      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl pb-8">
          {selected && (
            <>
              <SheetHeader className="text-left">
                <SheetTitle className="flex items-center justify-between gap-3">
                  <span>{format(new Date(`${selected.dateStr}T00:00:00`), 'EEEE, MMMM d')}</span>
                  <span
                    className={cn(
                      'rounded-lg px-2.5 py-1 text-xs font-bold capitalize',
                      SHEET_TONE[selected.tone]
                    )}
                  >
                    {(selected.record?.status ?? 'no record').replace('_', ' ')}
                  </span>
                </SheetTitle>
              </SheetHeader>

              <div className="mt-5 grid grid-cols-3 gap-3">
                <DetailTile
                  icon={<LogIn size={16} />}
                  label="Clock in"
                  value={selected.record?.clockIn || '—'}
                  tone="green"
                />
                <DetailTile
                  icon={<LogOut size={16} />}
                  label="Clock out"
                  value={selected.record?.clockOut || '—'}
                  tone="red"
                />
                <DetailTile
                  icon={<TrendingUp size={16} />}
                  label="Points"
                  value={`${pointsForDay(selected.record?.status ?? '')}`}
                  tone="amber"
                />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function DetailTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  tone: 'green' | 'amber' | 'red'
}) {
  const chip = {
    green: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-red-100 text-red-700',
  }[tone]
  return (
    <div className="rounded-2xl border bg-card p-3 flex flex-col items-center gap-1.5 text-center">
      <span className={cn('flex h-8 w-8 items-center justify-center rounded-xl', chip)}>
        {icon}
      </span>
      <span className="text-sm font-bold text-foreground leading-none">{value}</span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </div>
  )
}
