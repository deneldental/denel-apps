import { Badge, Card, CardContent } from '@denel/ui'
import { GraduationCap } from 'lucide-react'
import type { DailyRecord } from '@/lib/actions/staff'

/** Local YYYY-MM-DD for "today" — used to render upcoming days as "Future". */
function todayYMD(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface DayVisual {
  label: string
  cell: string
  badge: string
}

/**
 * Resolve a day's pill label + colours. `off` is split into "No Work" (Sun/Sat)
 * vs "Off-Day" (a per-staff recurring off day); an empty day in the future shows
 * as "Future" rather than a premature "Absent".
 */
function resolveVisual(record: DailyRecord, isFuture: boolean): DayVisual {
  if (isFuture && (record.status === 'absent' || record.status === 'excused')) {
    return {
      label: 'Future',
      cell: 'bg-slate-100/60 border-slate-200 text-slate-500 dark:bg-slate-900/40 dark:border-slate-800 dark:text-slate-400',
      badge: 'bg-slate-600 hover:bg-slate-700 text-white border-none',
    }
  }
  switch (record.status) {
    case 'present':
      return {
        label: 'On-Time',
        cell: 'bg-emerald-50/70 border-emerald-200 text-emerald-800 dark:bg-emerald-950/20 dark:border-emerald-800 dark:text-emerald-400',
        badge: 'bg-emerald-500 hover:bg-emerald-600 text-white border-none',
      }
    case 'late':
      return {
        label: 'Late',
        cell: 'bg-amber-50/70 border-amber-200 text-amber-800 dark:bg-amber-950/20 dark:border-amber-800 dark:text-amber-400',
        badge: 'bg-amber-500 hover:bg-amber-600 text-white border-none',
      }
    case 'absent':
      return {
        label: 'Absent',
        cell: 'bg-rose-50/70 border-rose-200 text-rose-800 dark:bg-rose-950/20 dark:border-rose-800 dark:text-rose-400',
        badge: 'bg-destructive hover:bg-destructive/90 text-destructive-foreground border-none',
      }
    case 'excused':
      return {
        label: 'Excused',
        cell: 'bg-blue-50/70 border-blue-200 text-blue-800 dark:bg-blue-950/20 dark:border-blue-800 dark:text-blue-400',
        badge: 'bg-blue-500 hover:bg-blue-600 text-white border-none',
      }
    case 'on_leave':
      return {
        label: 'On Leave',
        cell: 'bg-indigo-50/70 border-indigo-200 text-indigo-800 dark:bg-indigo-950/20 dark:border-indigo-800 dark:text-indigo-400',
        badge: 'bg-indigo-500 hover:bg-indigo-600 text-white border-none',
      }
    case 'holiday':
      return {
        label: 'Holiday',
        cell: 'bg-purple-50/70 border-purple-200 text-purple-800 dark:bg-purple-950/20 dark:border-purple-800 dark:text-purple-400',
        badge: 'bg-purple-500 hover:bg-purple-600 text-white border-none',
      }
    case 'off': {
      // A weekend off is "No Work" (nobody's scheduled); a weekday off is a
      // per-staff "Off-Day".
      const isWeekend = record.dayOfWeek === 0 || record.dayOfWeek === 6
      return {
        label: isWeekend ? 'No Work' : 'Off-Day',
        cell: 'bg-slate-50/40 border-slate-200 text-slate-500 dark:bg-slate-900/20 dark:border-slate-800 dark:text-slate-400 opacity-80',
        badge: 'bg-slate-500 hover:bg-slate-600 text-white border-none',
      }
    }
    default:
      return {
        label: record.status,
        cell: 'bg-slate-50/40 border-slate-200 text-slate-600 dark:bg-slate-900/10 dark:border-slate-800 dark:text-slate-400',
        badge: 'bg-slate-500 hover:bg-slate-600 text-white border-none',
      }
  }
}

export function MonthCalendar({
  dailyRecords,
  month,
  /** date (YYYY-MM-DD) → training titles completed that day, overlaid on the cell. */
  trainingByDate,
}: {
  dailyRecords: DailyRecord[]
  month: string
  trainingByDate?: Record<string, string[]>
}) {
  const [yearStr, monthStr] = month.split('-')
  const year = parseInt(yearStr, 10)
  const monthIndex = parseInt(monthStr, 10) - 1
  const today = todayYMD()

  const totalDays = new Date(year, monthIndex + 1, 0).getDate()
  const startDayOfWeek = new Date(year, monthIndex, 1).getDay()

  const cells: Array<{ type: 'empty' | 'day'; id?: string; dayNum?: number; dateStr?: string }> = []

  for (let i = 0; i < startDayOfWeek; i++) {
    cells.push({ type: 'empty', id: `lead-${i}` })
  }

  for (let d = 1; d <= totalDays; d++) {
    const dayStr = String(d).padStart(2, '0')
    cells.push({
      type: 'day',
      dayNum: d,
      dateStr: `${yearStr}-${monthStr}-${dayStr}`,
    })
  }

  const totalCells = cells.length
  const endPadding = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7)
  for (let i = 0; i < endPadding; i++) {
    cells.push({ type: 'empty', id: `trail-${i}` })
  }

  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const shortWeekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <div className="flex flex-col gap-4">
      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b pb-2 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {weekdays.map((day, idx) => (
          <div key={day}>
            <span className="hidden sm:inline">{day}</span>
            <span className="sm:hidden">{shortWeekdays[idx]}</span>
          </div>
        ))}
      </div>

      {/* Days grid */}
      <div className="grid grid-cols-7 gap-2 sm:gap-3">
        {cells.map((cell) => {
          if (cell.type === 'empty') {
            return (
              <div
                key={cell.id}
                className="min-h-[100px] sm:min-h-[120px] rounded-xl border border-dashed border-muted bg-muted/5 opacity-45"
              />
            )
          }

          const record = dailyRecords.find((r) => r.date === cell.dateStr)
          const trainings = cell.dateStr ? trainingByDate?.[cell.dateStr] : undefined
          const isFuture = !!cell.dateStr && cell.dateStr > today

          // No attendance record: still show a Future marker for upcoming days,
          // and a training overlay if training landed on an unscored day.
          if (!record) {
            return (
              <div
                key={cell.dateStr}
                className="min-h-[100px] sm:min-h-[120px] rounded-xl border p-2 sm:p-3 flex flex-col justify-between bg-card text-muted-foreground opacity-70"
              >
                <div className="text-sm font-semibold">{cell.dayNum}</div>
                <div className="text-[10px] text-center my-auto">
                  {isFuture ? 'Future' : 'No Data'}
                </div>
                <TrainingOverlay trainings={trainings} />
              </div>
            )
          }

          const visual = resolveVisual(record, isFuture)

          return (
            <div
              key={cell.dateStr}
              className={`min-h-[110px] sm:min-h-[130px] rounded-xl border p-2 sm:p-3 flex flex-col justify-between transition-all hover:shadow-md ${visual.cell}`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-sm font-semibold">{cell.dayNum}</span>
                <Badge
                  className={`text-[9px] sm:text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 scale-90 sm:scale-100 origin-right ${visual.badge}`}
                >
                  {visual.label}
                </Badge>
              </div>

              <div className="my-1 flex flex-col justify-center">
                {record.clockIn || record.clockOut ? (
                  <div className="text-center font-mono text-[10px] sm:text-xs tracking-tight text-foreground/80">
                    <div className="truncate">
                      {record.clockIn ? `In: ${record.clockIn}` : 'In: —'}
                    </div>
                    <div className="truncate">
                      {record.clockOut ? `Out: ${record.clockOut}` : 'Out: —'}
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-[10px] sm:text-xs text-muted-foreground/60 italic">
                    {visual.label === 'No Work' || visual.label === 'Off-Day'
                      ? visual.label
                      : record.status === 'holiday'
                        ? 'Holiday'
                        : isFuture
                          ? ''
                          : 'No punches'}
                  </div>
                )}
              </div>

              <TrainingOverlay trainings={trainings} />

              <div className="flex items-end justify-between text-[9px] sm:text-[10px] text-muted-foreground/80 mt-1 border-t pt-1 border-current/10">
                {record.isScoringDay ? (
                  <span className="font-medium">
                    Score:{' '}
                    <span className="font-semibold text-foreground">{record.dailyScore}</span>/10
                  </span>
                ) : (
                  <span className="text-[9px] opacity-70">Non-scoring</span>
                )}
                {record.exceptionReason && (
                  <span
                    className="truncate max-w-[50%] font-medium text-foreground/70"
                    title={record.exceptionReason}
                  >
                    {record.exceptionReason}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** A small training pill shown beneath the attendance status when a training
 *  was completed that day — renders even on holiday / off / no-work days. */
function TrainingOverlay({ trainings }: { trainings?: string[] }) {
  if (!trainings || trainings.length === 0) return null
  const title = trainings.join(', ')
  return (
    <div
      className="flex items-center gap-1 rounded-md bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-sky-700 dark:text-sky-300"
      title={title}
    >
      <GraduationCap className="h-3 w-3 shrink-0" />
      <span className="truncate">
        {trainings.length === 1 ? 'Training' : `${trainings.length} trainings`}
      </span>
    </div>
  )
}

export function MonthSummaryCard({
  label,
  value,
  accent,
}: {
  label: string
  value: string | number
  accent?: 'destructive' | 'primary'
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
        <p
          className={`mt-2 text-2xl font-semibold tabular-nums ${
            accent === 'destructive' ? 'text-destructive' : ''
          }`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  )
}
