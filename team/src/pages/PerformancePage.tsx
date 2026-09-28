import { StatCard } from '@denel/ui/blocks'
import { format, startOfWeek } from 'date-fns'
import {
  AlarmClock,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  Loader2,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { AttendanceCalendar } from '@/components/attendance/AttendanceCalendar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { staffApi } from '@/lib/api'
import { cn } from '@/lib/utils'

// ─── Types ───────────────────────────────────────────────────────────────────

interface AttendanceDay {
  date: string
  clockIn: string | null
  clockOut: string | null
  hoursWorked: number | null
  status: string
}
interface AttendanceSummary {
  totalHours: number
  daysPresent: number
  daysLate: number
}
interface AttendanceData {
  days: AttendanceDay[]
  summary: AttendanceSummary
}

interface TrainingProgress {
  id: string
  status: string
  score?: number
  completedAt?: string
  training: {
    id: string
    title: string
    passingScore?: number
    published: boolean
    totalScore?: number // max points for this training, if set
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pointsForDay(status: string): number {
  switch (status) {
    case 'present':
      return 10
    case 'late':
      return 6
    case 'half_day':
      return 5
    case 'leave':
      return 10
    case 'absent':
    default:
      return 0
  }
}

/** Returns every Monday that falls within (or just before the start of) a given month. */
function getMondaysInMonth(date: Date): Date[] {
  const year = date.getFullYear()
  const month = date.getMonth()
  const mondays: Date[] = []
  const firstMonday = startOfWeek(new Date(year, month, 1), { weekStartsOn: 1 })
  const current = new Date(firstMonday)
  const lastDayOfMonth = new Date(year, month + 1, 0)
  while (current <= lastDayOfMonth) {
    mondays.push(new Date(current))
    current.setDate(current.getDate() + 7)
  }
  return mondays
}

function workingDaysInMonth(date: Date): number {
  const year = date.getFullYear()
  const month = date.getMonth()
  const days = new Date(year, month + 1, 0).getDate()
  let count = 0
  for (let d = 1; d <= days; d++) {
    const dow = new Date(year, month, d).getDay()
    if (dow !== 0 && dow !== 6) count++
  }
  return count
}

const TONE = {
  emerald: {
    card: 'border-emerald-100 bg-emerald-50 text-emerald-950',
    chip: 'bg-emerald-100 text-emerald-700',
    text: 'text-emerald-950',
    muted: 'text-emerald-800/70',
    bar: 'bg-emerald-500',
  },
  amber: {
    card: 'border-amber-100 bg-amber-50 text-amber-950',
    chip: 'bg-amber-100 text-amber-700',
    text: 'text-amber-950',
    muted: 'text-amber-800/70',
    bar: 'bg-amber-400',
  },
  sky: {
    card: 'border-sky-100 bg-sky-50 text-sky-950',
    chip: 'bg-sky-100 text-sky-700',
    text: 'text-sky-950',
    muted: 'text-sky-800/70',
    bar: 'bg-sky-400',
  },
  violet: {
    card: 'border-violet-100 bg-violet-50 text-violet-950',
    chip: 'bg-violet-100 text-violet-700',
    text: 'text-violet-950',
    muted: 'text-violet-800/70',
    bar: 'bg-violet-400',
  },
  brand: {
    card: 'border-brand/20 bg-brand/5 text-foreground',
    chip: 'bg-brand/15 text-brand',
    text: 'text-foreground',
    muted: 'text-muted-foreground',
    bar: 'bg-brand',
  },
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PerformancePage() {
  const [monthAnchor, setMonthAnchor] = useState(() => new Date())
  const isCurrentMonth =
    monthAnchor.getFullYear() === new Date().getFullYear() &&
    monthAnchor.getMonth() === new Date().getMonth()

  // Attendance data for this month
  const [attendanceDays, setAttendanceDays] = useState<AttendanceDay[]>([])
  // Training list (all-time, filtered to published)
  const [trainingItems, setTrainingItems] = useState<TrainingProgress[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')

    const mondays = getMondaysInMonth(monthAnchor)
    const attendanceFetches = mondays.map((m) => staffApi.getAttendance(format(m, 'yyyy-MM-dd')))

    Promise.all([...attendanceFetches, staffApi.getTraining()])
      .then((results) => {
        // Last result is training
        const trainingRes = results[results.length - 1]
        const attendanceResults = results.slice(0, results.length - 1)

        // Collapse attendance weeks → unique days in this month
        const allDays: AttendanceDay[] = []
        for (const res of attendanceResults) {
          if (res.success && res.data) {
            const weekData = res.data as AttendanceData
            allDays.push(...weekData.days)
          }
        }
        const seen = new Set<string>()
        const monthDays = allDays
          .filter((d) => {
            const dd = new Date(d.date + 'T00:00:00')
            return (
              dd.getFullYear() === monthAnchor.getFullYear() &&
              dd.getMonth() === monthAnchor.getMonth()
            )
          })
          .filter((d) => {
            if (seen.has(d.date)) return false
            seen.add(d.date)
            return true
          })
          .sort((a, b) => a.date.localeCompare(b.date))

        setAttendanceDays(monthDays)

        if (trainingRes.success && trainingRes.data) {
          const all = trainingRes.data as TrainingProgress[]
          setTrainingItems(all.filter((i) => i.training.published))
        } else {
          setTrainingItems([])
        }
      })
      .catch(() => setError('Network error — could not load performance data.'))
      .finally(() => setLoading(false))
  }, [monthAnchor])

  // ── Derived numbers ────────────────────────────────────────────────────────
  const derived = useMemo(() => {
    // Attendance points this month
    const attendancePoints = attendanceDays.reduce((sum, d) => sum + pointsForDay(d.status), 0)
    const workDays = workingDaysInMonth(monthAnchor)
    const maxAttendancePoints = workDays * 10
    const attendancePct =
      maxAttendancePoints > 0 ? (attendancePoints / maxAttendancePoints) * 100 : 0

    const daysPresent = attendanceDays.filter(
      (d) => d.status === 'present' || d.status === 'leave'
    ).length
    const daysLate = attendanceDays.filter((d) => d.status === 'late').length

    // Training: group by month that training was completed
    const monthKey = `${monthAnchor.getFullYear()}-${String(monthAnchor.getMonth() + 1).padStart(2, '0')}`
    const monthTraining = trainingItems.filter((t) => {
      if (t.status !== 'completed' || !t.completedAt) return false
      return t.completedAt.startsWith(monthKey)
    })
    // All assigned (pending/in-progress/completed) trainings shown for context
    const assignedTraining = trainingItems

    // Training score: average of scored trainings completed this month
    // Each training scores up to 100 (quiz score). Total training score =
    // sum(score) / (count * 100) * 100 → average %
    const scoredTraining = monthTraining.filter((t) => t.score != null)
    const trainingPct =
      scoredTraining.length > 0
        ? scoredTraining.reduce((s, t) => s + (t.score ?? 0), 0) / scoredTraining.length
        : null

    // Combined monthly score = weighted average: 60% attendance + 40% training
    // If no training this month, attendance is the whole score
    let combinedPct: number
    if (trainingPct !== null) {
      combinedPct = attendancePct * 0.6 + trainingPct * 0.4
    } else {
      combinedPct = attendancePct
    }

    const scoreGrade = (pct: number) => {
      if (pct >= 90) return { label: 'Excellent', tone: 'emerald' as const }
      if (pct >= 75) return { label: 'Good', tone: 'sky' as const }
      if (pct >= 60) return { label: 'Fair', tone: 'amber' as const }
      return { label: 'Needs improvement', tone: 'brand' as const }
    }

    return {
      attendancePoints,
      maxAttendancePoints,
      attendancePct,
      daysPresent,
      daysLate,
      monthTraining,
      assignedTraining,
      trainingPct,
      combinedPct,
      grade: scoreGrade(combinedPct),
      workDays,
    }
  }, [attendanceDays, trainingItems, monthAnchor])

  const prevMonth = () => setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  const nextMonth = () => setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))

  const { grade } = derived
  const gradeT = TONE[grade.tone]

  return (
    <div className="page-enter p-5 pb-20 space-y-5">
      {/* ── Header with month navigator ─────────────────────────────── */}
      <div className="pt-2 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Performance</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{format(monthAnchor, 'MMMM yyyy')}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={prevMonth} aria-label="Previous month">
            <ChevronLeft size={18} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={nextMonth}
            disabled={isCurrentMonth}
            aria-label="Next month"
          >
            <ChevronRight size={18} />
          </Button>
        </div>
      </div>

      {/* ── Loading / Error states ───────────────────────────────────── */}
      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* ── Combined score hero card ─────────────────────────────── */}
          <div className={cn('rounded-2xl border p-5 flex flex-col gap-3 shadow-xs', gradeT.card)}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={cn('text-[10px] font-bold uppercase tracking-widest', gradeT.muted)}>
                  Combined Monthly Score
                </p>
                <div className="flex items-end gap-1.5 mt-1">
                  <span className={cn('text-4xl font-extrabold leading-none', gradeT.text)}>
                    {derived.combinedPct.toFixed(0)}
                  </span>
                  <span className={cn('text-sm font-bold pb-0.5', gradeT.muted)}>%</span>
                </div>
              </div>
              <div
                className={cn(
                  'w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 shadow-xs',
                  gradeT.chip
                )}
              >
                <Sparkles size={24} />
              </div>
            </div>

            {/* Combined progress bar */}
            <div className="space-y-1.5">
              <Progress value={derived.combinedPct} className="h-2.5 rounded-full" />
              <div className="flex items-center justify-between">
                <Badge
                  variant="outline"
                  className={cn(
                    'capitalize text-[10px] font-bold border-none px-2 py-0.5 rounded-md',
                    gradeT.chip
                  )}
                >
                  {grade.label}
                </Badge>
                <span
                  className={cn('text-[10px] font-semibold uppercase tracking-wider', gradeT.muted)}
                >
                  {derived.trainingPct !== null
                    ? 'Attendance 60% · Training 40%'
                    : 'Attendance only — no training this month'}
                </span>
              </div>
            </div>
          </div>

          {/* ── Stat cards ──────────────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-3">
            <StatCard
              tone="emerald"
              icon={CalendarCheck}
              value={derived.daysPresent}
              label="Days present"
            />
            <StatCard tone="amber" icon={AlarmClock} value={derived.daysLate} label="Days late" />
            <StatCard
              tone="violet"
              icon={GraduationCap}
              value={derived.trainingPct !== null ? `${derived.trainingPct.toFixed(0)}%` : '—'}
              label="Training avg"
            />
          </div>

          {/* ── Attendance breakdown ─────────────────────────────────── */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold tracking-tight flex items-center gap-2">
                <CalendarCheck size={16} className="text-primary" />
                Attendance
              </h2>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-foreground">
                  {derived.attendancePoints}
                </span>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  / {derived.maxAttendancePoints} pts
                </span>
              </div>
            </div>

            {/* Attendance progress bar */}
            <div className="rounded-xl border border-sky-100 bg-sky-50 p-3.5 space-y-2">
              <div className="flex items-center justify-between text-sky-950">
                <span className="text-xs font-bold">
                  {derived.attendancePct.toFixed(0)}% — {derived.workDays} working days
                </span>
                <span className="text-[10px] font-semibold text-sky-800/70 uppercase tracking-wider">
                  10 pts / day
                </span>
              </div>
              <Progress value={derived.attendancePct} className="h-2 rounded-full" />
            </div>

            {/* Month calendar */}
            <AttendanceCalendar monthAnchor={monthAnchor} days={attendanceDays} />
          </section>

          {/* ── Training breakdown ───────────────────────────────────── */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold tracking-tight flex items-center gap-2">
                <GraduationCap size={16} className="text-primary" />
                Training
              </h2>
              <Badge
                variant="outline"
                className="text-[10px] font-bold border-primary/20 text-primary bg-primary/5"
              >
                {derived.monthTraining.length} completed this month
              </Badge>
            </div>

            {derived.assignedTraining.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  No training assigned yet.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-2">
                {derived.assignedTraining.map((item) => {
                  const isCompleted = item.status === 'completed'
                  const completedThisMonth =
                    isCompleted &&
                    item.completedAt &&
                    item.completedAt.startsWith(
                      `${monthAnchor.getFullYear()}-${String(monthAnchor.getMonth() + 1).padStart(2, '0')}`
                    )
                  const passed =
                    isCompleted &&
                    item.score != null &&
                    (item.training.passingScore == null || item.score >= item.training.passingScore)

                  const tone = isCompleted ? (passed ? 'emerald' : 'brand') : 'sky'
                  const t = TONE[tone]

                  return (
                    <div
                      key={item.id}
                      className={cn('rounded-2xl border p-3.5 space-y-2.5', t.card)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div
                            className={cn(
                              'w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-xs',
                              t.chip
                            )}
                          >
                            <GraduationCap size={14} />
                          </div>
                          <p className={cn('text-sm font-bold leading-snug', t.text)}>
                            {item.training.title}
                          </p>
                        </div>

                        {isCompleted ? (
                          <Badge
                            variant="outline"
                            className={cn(
                              'shrink-0 text-[10px] font-bold border-none px-2 py-0.5 rounded-lg',
                              t.chip
                            )}
                          >
                            {item.score != null ? `${item.score}%` : 'Done'}
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className={cn(
                              'shrink-0 capitalize text-[10px] font-bold border-none px-2 py-0.5 rounded-lg',
                              t.chip
                            )}
                          >
                            {item.status.replace('_', ' ')}
                          </Badge>
                        )}
                      </div>

                      {/* Score progress bar */}
                      {isCompleted && item.score != null && (
                        <div className="space-y-1">
                          <Progress value={item.score} className="h-1.5 rounded-full" />
                          <div
                            className={cn(
                              'flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider',
                              t.muted
                            )}
                          >
                            {item.training.passingScore != null ? (
                              <span>Pass: {item.training.passingScore}%</span>
                            ) : (
                              <span />
                            )}
                            <span className={passed ? 'text-emerald-600' : 'text-brand'}>
                              {passed ? '✓ Passed' : 'Not passed'}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Footer row */}
                      <div
                        className={cn(
                          'flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider pt-0.5',
                          t.muted
                        )}
                      >
                        {item.completedAt ? (
                          <span>Completed {new Date(item.completedAt).toLocaleDateString()}</span>
                        ) : (
                          <span>Not yet completed</span>
                        )}
                        {completedThisMonth && (
                          <span className="text-emerald-600 font-bold">This month</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* ── Score breakdown legend ───────────────────────────────── */}
          <div className="rounded-2xl border border-border bg-muted/30 p-4 space-y-2">
            <p className="text-xs font-bold text-foreground">How your score is calculated</p>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>Attendance (60% weight)</span>
                <span className="font-semibold text-foreground">
                  {derived.attendancePct.toFixed(0)}% → {(derived.attendancePct * 0.6).toFixed(0)}{' '}
                  pts
                </span>
              </div>
              <div className="flex justify-between">
                <span>Training avg (40% weight)</span>
                <span className="font-semibold text-foreground">
                  {derived.trainingPct !== null
                    ? `${derived.trainingPct.toFixed(0)}% → ${(derived.trainingPct * 0.4).toFixed(0)} pts`
                    : 'No training — skipped'}
                </span>
              </div>
              <div className="h-px bg-border my-1" />
              <div className="flex justify-between font-bold text-foreground">
                <span>Combined</span>
                <span>{derived.combinedPct.toFixed(0)}%</span>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-1.5 pt-1">
              {(
                [
                  { range: '≥ 90%', label: 'Excellent', tone: 'emerald' },
                  { range: '≥ 75%', label: 'Good', tone: 'sky' },
                  { range: '≥ 60%', label: 'Fair', tone: 'amber' },
                  { range: '< 60%', label: 'Needs work', tone: 'brand' },
                ] as const
              ).map((g) => (
                <div
                  key={g.label}
                  className={cn(
                    'rounded-lg px-2 py-1.5 text-center text-[9px] font-bold leading-tight',
                    TONE[g.tone].chip
                  )}
                >
                  <div>{g.range}</div>
                  <div className="opacity-80">{g.label}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
