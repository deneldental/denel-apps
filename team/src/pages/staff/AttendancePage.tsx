import { StatCard } from '@denel/ui/blocks'
import { addDays, format, startOfWeek } from 'date-fns'
import {
  AlarmClock,
  CalendarCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ClockAlert,
  Loader2,
  TrendingUp,
  Wrench,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { AttendanceCalendar } from '@/components/attendance/AttendanceCalendar'
import { SubmitAttendanceModal } from '@/components/attendance/SubmitAttendanceModal'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { staffApi } from '@/lib/api'
import { cn } from '@/lib/utils'

type AttendanceStatus = 'present' | 'absent' | 'late' | 'half_day' | 'leave'

const STATUS_VARIANT: Record<AttendanceStatus, 'success' | 'secondary' | 'outline' | 'error'> = {
  present: 'success',
  late: 'outline',
  half_day: 'secondary',
  absent: 'error',
  leave: 'secondary',
}

// HR-L13: type the staff-portal attendance contract (mirrors the backend
// /api/staff-portal/attendance response) so a backend field rename surfaces at
// compile time instead of breaking the PWA silently at runtime.
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

interface AttendanceSubmission {
  id: string
  date: string
  punchType: 'clock_in' | 'clock_out'
  time: string
  reason: string
  status: 'pending' | 'approved' | 'rejected'
}

export default function AttendancePage() {
  const [activeView, setActiveView] = useState<'day' | 'week' | 'month'>('week')
  const [dayAnchor, setDayAnchor] = useState(() => new Date())
  const [weekAnchor, setWeekAnchor] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [monthAnchor, setMonthAnchor] = useState(() => new Date())

  const [data, setData] = useState<AttendanceData | null>(null)
  const [monthData, setMonthData] = useState<{
    days: AttendanceDay[]
    summary: AttendanceSummary & { score: number }
  } | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [monthlyScore, setMonthlyScore] = useState<number | null>(null)

  // Fix requests — the staff-facing side of HR's Attendance → Fix Requests tab.
  const [submissions, setSubmissions] = useState<AttendanceSubmission[]>([])
  const [fixModalOpen, setFixModalOpen] = useState(false)
  const [fixModalDate, setFixModalDate] = useState('')

  const loadSubmissions = useCallback(async () => {
    const res = await staffApi.getAttendanceSubmissions()
    if (res.success && Array.isArray(res.data)) {
      setSubmissions(res.data as AttendanceSubmission[])
    }
  }, [])

  useEffect(() => {
    void loadSubmissions()
  }, [loadSubmissions])

  const pendingFixesForDate = (date: string) =>
    submissions.filter((s) => s.date === date && s.status === 'pending')

  // A fix has already been approved for this day — the record is corrected, so
  // there's nothing left to request. Used to disable the per-day fix button.
  const hasApprovedFix = (date: string) =>
    submissions.some((s) => s.date === date && s.status === 'approved')

  const openFixModal = (date: string) => {
    setFixModalDate(date)
    setFixModalOpen(true)
  }

  useEffect(() => {
    setLoading(true)
    setError('')

    if (activeView === 'day' || activeView === 'week') {
      const targetDate = activeView === 'day' ? dayAnchor : weekAnchor
      const weekDateString = format(targetDate, 'yyyy-MM-dd')

      const fetchWeek = staffApi.getAttendance(weekDateString)
      const fetchHistory = staffApi.getAttendanceHistory(1)

      Promise.all([fetchWeek, fetchHistory])
        .then(([resWeek, resHistory]) => {
          if (resWeek.success) {
            setData(resWeek.data as AttendanceData)
          } else {
            setError(resWeek.error || 'Failed to load attendance')
          }

          if (resHistory.success && resHistory.data) {
            const historyDays = resHistory.data as AttendanceDay[]
            const now = new Date()
            const currentYear = now.getFullYear()
            const currentMonth = now.getMonth()

            const currentMonthDays = historyDays.filter((d) => {
              const dDate = new Date(d.date + 'T00:00:00')
              return dDate.getFullYear() === currentYear && dDate.getMonth() === currentMonth
            })

            if (currentMonthDays.length > 0) {
              let points = 0
              for (const d of currentMonthDays) {
                points += pointsForDay(d.status)
              }
              setMonthlyScore(points)
            } else {
              setMonthlyScore(0)
            }
          }
        })
        .catch(() => setError('Network error'))
        .finally(() => setLoading(false))
    } else if (activeView === 'month') {
      const mondays = getMondaysInMonth(monthAnchor)
      const fetchPromises = mondays.map((monday) =>
        staffApi.getAttendance(format(monday, 'yyyy-MM-dd'))
      )

      Promise.all(fetchPromises)
        .then((results) => {
          const allDays: AttendanceDay[] = []
          let totalHours = 0
          let daysPresent = 0
          let daysLate = 0

          for (const res of results) {
            if (res.success && res.data) {
              const weekData = res.data as AttendanceData
              allDays.push(...weekData.days)
            }
          }

          const seen = new Set<string>()
          const filteredDays = allDays
            .filter((d) => {
              const dDate = new Date(d.date + 'T00:00:00')
              return (
                dDate.getFullYear() === monthAnchor.getFullYear() &&
                dDate.getMonth() === monthAnchor.getMonth()
              )
            })
            .filter((d) => {
              if (seen.has(d.date)) return false
              seen.add(d.date)
              return true
            })
            .sort((a, b) => a.date.localeCompare(b.date))

          let points = 0
          for (const d of filteredDays) {
            points += pointsForDay(d.status)
            if (d.status === 'present' || d.status === 'leave') {
              daysPresent++
            } else if (d.status === 'late') {
              daysLate++
            }
            if (d.hoursWorked) totalHours += d.hoursWorked
          }

          setMonthData({
            days: filteredDays,
            summary: {
              totalHours,
              daysPresent,
              daysLate,
              score: points,
            },
          })
        })
        .catch(() => setError('Network error'))
        .finally(() => setLoading(false))
    }
  }, [activeView, dayAnchor, weekAnchor, monthAnchor])

  const prevDay = () => setDayAnchor((d) => addDays(d, -1))
  const nextDay = () => setDayAnchor((d) => addDays(d, 1))
  const isCurrentDay = format(dayAnchor, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')

  const prevWeek = () => setWeekAnchor((d) => addDays(d, -7))
  const nextWeek = () => setWeekAnchor((d) => addDays(d, 7))
  const isCurrentWeek =
    format(weekAnchor, 'yyyy-MM-dd') ===
    format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')

  const prevMonth = () => setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  const nextMonth = () => setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
  const isCurrentMonth =
    monthAnchor.getFullYear() === new Date().getFullYear() &&
    monthAnchor.getMonth() === new Date().getMonth()

  const weekRange = `${format(weekAnchor, 'MMM d')} – ${format(addDays(weekAnchor, 6), 'MMM d, yyyy')}`

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

  // Same traffic-light standard as the monthly calendar: present/leave → green,
  // late/half_day → amber, absent → red. Mild background + deep text throughout.
  const toneMap: Record<AttendanceStatus, 'emerald' | 'amber' | 'red'> = {
    present: 'emerald',
    leave: 'emerald',
    late: 'amber',
    half_day: 'amber',
    absent: 'red',
  }

  const getToneDetails = (status: string) => {
    const tone = toneMap[status as AttendanceStatus] || 'amber'
    return {
      emerald: {
        card: 'border-emerald-100 bg-emerald-50 text-emerald-950',
        chip: 'bg-emerald-100 text-emerald-700',
        text: 'text-emerald-950',
        muted: 'text-emerald-800/80',
        border: 'border-emerald-200/50',
      },
      amber: {
        card: 'border-amber-100 bg-amber-50 text-amber-950',
        chip: 'bg-amber-100 text-amber-700',
        text: 'text-amber-950',
        muted: 'text-amber-800/80',
        border: 'border-amber-200/50',
      },
      red: {
        card: 'border-red-100 bg-red-50 text-red-950',
        chip: 'bg-red-100 text-red-700',
        text: 'text-red-950',
        muted: 'text-red-800/80',
        border: 'border-red-200/50',
      },
    }[tone]
  }

  const activeDay = data?.days.find((d) => d.date === format(dayAnchor, 'yyyy-MM-dd'))

  return (
    <div className="p-5 pb-8 space-y-5">
      <div className="pt-2 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Register</h1>
          <p className="text-sm text-muted-foreground">
            {activeView === 'day' && format(dayAnchor, 'EEEE, MMM d, yyyy')}
            {activeView === 'week' && weekRange}
            {activeView === 'month' && format(monthAnchor, 'MMMM yyyy')}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (activeView === 'day') prevDay()
              else if (activeView === 'week') prevWeek()
              else if (activeView === 'month') prevMonth()
            }}
            aria-label="Previous range"
          >
            <ChevronLeft size={18} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (activeView === 'day') nextDay()
              else if (activeView === 'week') nextWeek()
              else if (activeView === 'month') nextMonth()
            }}
            disabled={
              activeView === 'day'
                ? isCurrentDay
                : activeView === 'week'
                  ? isCurrentWeek
                  : isCurrentMonth
            }
            aria-label="Next range"
          >
            <ChevronRight size={18} />
          </Button>
        </div>
      </div>

      <Tabs value={activeView} onValueChange={(v) => setActiveView(v as any)} className="w-full">
        <TabsList className="grid w-full grid-cols-3 bg-secondary/30 p-1 rounded-xl">
          <TabsTrigger value="day" className="rounded-lg text-xs font-semibold">
            Daily
          </TabsTrigger>
          <TabsTrigger value="week" className="rounded-lg text-xs font-semibold">
            Weekly
          </TabsTrigger>
          <TabsTrigger value="month" className="rounded-lg text-xs font-semibold">
            Monthly
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Punch time wrong? Request a fix — HR reviews it.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={() =>
            openFixModal(
              activeView === 'day'
                ? format(dayAnchor, 'yyyy-MM-dd')
                : format(new Date(), 'yyyy-MM-dd')
            )
          }
        >
          <Wrench size={14} />
          Request Fix
        </Button>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && (
        <>
          {activeView === 'day' && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <StatCard
                  tone="violet"
                  icon={TrendingUp}
                  value={monthlyScore !== null ? `${monthlyScore} pts` : '—'}
                  label="Current score"
                />
                <StatCard
                  tone="emerald"
                  icon={Clock}
                  value={activeDay?.clockIn || '—'}
                  label="Clock In"
                />
                <StatCard
                  tone="emerald"
                  icon={Clock}
                  value={activeDay?.clockOut || '—'}
                  label="Clock Out"
                />
              </div>

              {activeDay ? (
                (() => {
                  const t = getToneDetails(activeDay.status)
                  return (
                    <div
                      className={cn('rounded-2xl border p-6 flex flex-col gap-4 shadow-xs', t.card)}
                    >
                      <div className="flex items-center justify-between">
                        <div
                          className={cn(
                            'w-14 h-14 flex flex-col items-center justify-center rounded-2xl font-bold shadow-xs shrink-0',
                            t.chip
                          )}
                        >
                          <span className="text-[10px] uppercase tracking-wider opacity-75">
                            {format(dayAnchor, 'EEE')}
                          </span>
                          <span className="text-xl leading-none mt-0.5">
                            {format(dayAnchor, 'd')}
                          </span>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn(
                            'capitalize font-bold border-none px-3.5 py-1.5 text-xs rounded-xl shadow-xs',
                            t.chip
                          )}
                        >
                          {activeDay.status.replace('_', ' ')}
                        </Badge>
                      </div>

                      <div className="space-y-2">
                        <h3 className={cn('text-sm font-bold', t.text)}>Work Hours Log</h3>
                        <div className="flex items-center gap-2">
                          <Clock size={14} className={cn('opacity-60', t.text)} />
                          {activeDay.clockIn && activeDay.clockOut ? (
                            <span className={cn('font-semibold text-sm', t.text)}>
                              {activeDay.clockIn} – {activeDay.clockOut}
                            </span>
                          ) : (
                            <span className={cn('text-sm font-semibold opacity-60', t.text)}>
                              No clock-in/out records
                            </span>
                          )}
                        </div>
                      </div>

                      {pendingFixesForDate(activeDay.date).length > 0 && (
                        <div className={cn('flex flex-col gap-1 border-t pt-3', t.border)}>
                          {pendingFixesForDate(activeDay.date).map((s) => (
                            <div
                              key={s.id}
                              className={cn(
                                'text-xs font-semibold inline-flex items-center gap-1.5',
                                t.muted
                              )}
                            >
                              <ClockAlert size={13} className="text-amber-500" />
                              Pending {s.punchType.replace('_', ' ')} fix ({s.time})
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="flex justify-end">
                        {hasApprovedFix(activeDay.date) ? (
                          <span
                            className={cn(
                              'text-xs font-semibold inline-flex items-center gap-1.5',
                              t.muted
                            )}
                          >
                            <CheckCircle2 size={13} className="text-emerald-500" />
                            Fix approved
                          </span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className={cn('h-7 gap-1.5', t.muted)}
                            onClick={() => openFixModal(activeDay.date)}
                          >
                            <Wrench size={13} />
                            Request fix
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })()
              ) : (
                <Card>
                  <CardContent className="py-12 text-center text-sm text-muted-foreground space-y-4">
                    <p>No attendance records for this day yet.</p>
                    {hasApprovedFix(format(dayAnchor, 'yyyy-MM-dd')) ? (
                      <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-600">
                        <CheckCircle2 size={14} />
                        Fix approved
                      </span>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => openFixModal(format(dayAnchor, 'yyyy-MM-dd'))}
                      >
                        <Wrench size={14} />
                        Request fix
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {activeView === 'week' && data && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <StatCard
                  tone="violet"
                  icon={TrendingUp}
                  value={monthlyScore !== null ? `${monthlyScore} pts` : '—'}
                  label="Current score"
                />
                <StatCard
                  tone="emerald"
                  icon={CalendarCheck}
                  value={data.summary.daysPresent}
                  label="Days present"
                />
                <StatCard
                  tone="amber"
                  icon={AlarmClock}
                  value={data.summary.daysLate}
                  label="Days late"
                />
              </div>

              {data.days.length > 0 ? (
                <div className="grid gap-3">
                  {data.days.map((d) => {
                    const t = getToneDetails(d.status)
                    const pending = pendingFixesForDate(d.date)
                    return (
                      <div
                        key={d.date}
                        className={cn(
                          'relative flex flex-col gap-2 rounded-2xl border p-3.5 transition-all duration-200 hover:shadow-xs',
                          t.card
                        )}
                      >
                        <div className="flex items-center gap-3.5">
                          <div
                            className={cn(
                              'w-11 h-11 flex flex-col items-center justify-center rounded-xl font-bold shadow-xs shrink-0',
                              t.chip
                            )}
                          >
                            <span className="text-[9px] uppercase tracking-wider opacity-75">
                              {format(new Date(d.date + 'T00:00:00'), 'EEE')}
                            </span>
                            <span className="text-sm leading-none mt-0.5">
                              {format(new Date(d.date + 'T00:00:00'), 'd')}
                            </span>
                          </div>

                          <div className="flex-1 min-w-0">
                            {d.clockIn && d.clockOut ? (
                              <div className="flex items-center gap-1.5">
                                <Clock size={12} className={cn('opacity-60', t.text)} />
                                <span className={cn('font-semibold text-xs', t.text)}>
                                  {d.clockIn} – {d.clockOut}
                                </span>
                              </div>
                            ) : (
                              <span className={cn('text-xs font-semibold opacity-60', t.text)}>
                                No Clock-in/out records
                              </span>
                            )}
                          </div>

                          <Badge
                            variant="outline"
                            className={cn(
                              'capitalize font-bold border-none px-2.5 py-1 text-[10px] rounded-lg shadow-2xs',
                              t.chip
                            )}
                          >
                            {d.status.replace('_', ' ')}
                          </Badge>
                        </div>

                        {pending.length > 0 && (
                          <div className={cn('flex flex-col gap-1 border-t pt-2', t.border)}>
                            {pending.map((s) => (
                              <div
                                key={s.id}
                                className={cn(
                                  'text-[11px] font-semibold inline-flex items-center gap-1.5',
                                  t.muted
                                )}
                              >
                                <ClockAlert size={12} className="text-amber-500" />
                                Pending {s.punchType.replace('_', ' ')} fix ({s.time})
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="flex justify-end">
                          {hasApprovedFix(d.date) ? (
                            <span
                              className={cn(
                                'h-6 px-2 inline-flex items-center gap-1 text-[10px] font-semibold',
                                t.muted
                              )}
                            >
                              <CheckCircle2 size={11} className="text-emerald-500" />
                              Fix approved
                            </span>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className={cn('h-6 px-2 text-[10px] gap-1', t.muted)}
                              onClick={() => openFixModal(d.date)}
                            >
                              <Wrench size={11} />
                              Request fix
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <Card>
                  <CardContent className="py-10 text-center text-sm text-muted-foreground">
                    No attendance records for this week yet.
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {activeView === 'month' && monthData && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <StatCard
                  tone="violet"
                  icon={TrendingUp}
                  value={
                    monthData.summary.score !== undefined ? `${monthData.summary.score} pts` : '—'
                  }
                  label="Month score"
                />
                <StatCard
                  tone="emerald"
                  icon={CalendarCheck}
                  value={monthData.summary.daysPresent}
                  label="Days present"
                />
                <StatCard
                  tone="amber"
                  icon={AlarmClock}
                  value={monthData.summary.daysLate}
                  label="Days late"
                />
              </div>

              <AttendanceCalendar monthAnchor={monthAnchor} days={monthData.days} />
            </div>
          )}
        </>
      )}

      <SubmitAttendanceModal
        open={fixModalOpen}
        onOpenChange={setFixModalOpen}
        defaultDate={fixModalDate}
        onSubmitted={loadSubmissions}
      />
    </div>
  )
}
