import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@denel/ui'
import type { ColumnDef } from '@tanstack/react-table'
import { ChevronLeft, ChevronRight, Loader2, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  type AttendanceDetail,
  getStaffAttendance,
  getStaffPerformanceHistory,
  type MonthlyPerformanceRow,
} from '@/lib/actions/staff'
import { DataTable } from '@/shared/components/data-table/data-table'
import { MonthCalendar, MonthSummaryCard } from '@/shared/components/month-calendar'

interface TrainingProgressItem {
  id: string
  status: string
  score?: number | null
  completedAt?: string | null
  training?: { id: string; title: string; published?: boolean }
}

interface StaffWithTraining {
  trainingProgress?: TrainingProgressItem[]
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function combinedScore(r: MonthlyPerformanceRow): number {
  const att = r.attendancePct ?? 0
  const tr = r.trainingScorePct
  if (tr === null || tr === undefined) return att
  return att * 0.6 + tr * 0.4
}

function scoreGrade(pct: number): { label: string; color: string } {
  if (pct >= 90) return { label: 'Excellent', color: 'text-emerald-600' }
  if (pct >= 75) return { label: 'Good', color: 'text-sky-600' }
  if (pct >= 60) return { label: 'Fair', color: 'text-amber-600' }
  return { label: 'Needs improvement', color: 'text-rose-600' }
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/**
 * Dual-interface performance view — a month calendar overlaying attendance
 * status *and* training completions per day, with a 12-month combined-score
 * history table below for the trend.
 */
export function StaffPerformanceTab({
  staffId,
  staff,
}: {
  staffId: string
  staff?: StaffWithTraining
}) {
  const [month, setMonth] = useState(currentMonth())
  const [attendance, setAttendance] = useState<AttendanceDetail | null>(null)
  const [attLoading, setAttLoading] = useState(true)

  const [history, setHistory] = useState<MonthlyPerformanceRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)

  const isCurrentMonth = month >= currentMonth()

  useEffect(() => {
    let cancelled = false
    setAttLoading(true)
    getStaffAttendance(staffId, month)
      .then((res) => {
        if (cancelled) return
        setAttendance(res.success && res.data ? res.data : null)
      })
      .finally(() => {
        if (!cancelled) setAttLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [staffId, month])

  useEffect(() => {
    let cancelled = false
    setHistoryLoading(true)
    getStaffPerformanceHistory(staffId, 12)
      .then((res) => {
        if (cancelled) return
        if (res.success) setHistory(res.data)
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [staffId])

  // Bucket completed trainings by the day they were completed, for the calendar
  // overlay. Renders even on off / holiday / no-work days.
  const trainingByDate = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const t of staff?.trainingProgress ?? []) {
      if (t.status !== 'completed' || !t.completedAt) continue
      const date = t.completedAt.slice(0, 10)
      if (!date.startsWith(month)) continue
      const title = t.training?.title ?? 'Training'
      if (map[date]) map[date].push(title)
      else map[date] = [title]
    }
    return map
  }, [staff, month])

  const trainingsThisMonth = useMemo(
    () => Object.values(trainingByDate).reduce((sum, list) => sum + list.length, 0),
    [trainingByDate]
  )

  const attendancePct = attendance ? Number(attendance.summary.attendancePct) : null

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
          <div>
            <CardTitle>Attendance &amp; training</CardTitle>
            <CardDescription>
              Daily attendance status with a training overlay. Approved leaves show as “On Leave”.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setMonth((m) => shiftMonth(m, -1))}
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[130px] text-center text-sm font-medium">
              {monthLabel(month)}
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setMonth((m) => shiftMonth(m, 1))}
              disabled={isCurrentMonth}
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <MonthSummaryCard
              label="Attendance"
              value={attendancePct == null ? '—' : `${attendancePct.toFixed(1)}%`}
            />
            <MonthSummaryCard label="Trainings" value={trainingsThisMonth} />
            <MonthSummaryCard
              label="Days present"
              value={
                attendance
                  ? `${attendance.summary.daysPresent + attendance.summary.daysLate}/${attendance.summary.scoringDays}`
                  : '—'
              }
            />
          </div>

          {attLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <MonthCalendar
              month={month}
              dailyRecords={attendance?.daily ?? []}
              trainingByDate={trainingByDate}
            />
          )}
        </CardContent>
      </Card>

      <PerformanceHistoryCard rows={history} loading={historyLoading} />
    </div>
  )
}

function PerformanceHistoryCard({
  rows,
  loading,
}: {
  rows: MonthlyPerformanceRow[]
  loading: boolean
}) {
  const columns = useMemo<ColumnDef<MonthlyPerformanceRow>[]>(
    () => [
      {
        id: 'month',
        header: 'Month',
        accessorFn: (r) => (r as { month?: string }).month ?? '',
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {(row.original as { month?: string }).month ?? '—'}
          </span>
        ),
      },
      {
        id: 'combinedScore',
        header: () => (
          <span className="flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> Combined
          </span>
        ),
        accessorFn: (r) => combinedScore(r),
        cell: ({ row }) => {
          const pct = combinedScore(row.original)
          const { label, color } = scoreGrade(pct)
          return (
            <div className="flex flex-col">
              <span className={`font-bold tabular-nums ${color}`}>{pct.toFixed(1)}%</span>
              <span className="text-[10px] text-muted-foreground">{label}</span>
            </div>
          )
        },
      },
      {
        id: 'attendance',
        header: 'Attendance (60%)',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="tabular-nums">{Number(row.original.attendancePct).toFixed(1)}%</span>
            <span className="text-[10px] text-muted-foreground">
              {row.original.daysPresent}P · {row.original.daysLate}L · {row.original.daysAbsent}A
            </span>
          </div>
        ),
      },
      {
        id: 'training',
        header: 'Training (40%)',
        cell: ({ row }) => {
          const r = row.original
          return (
            <div className="flex flex-col">
              <span className="tabular-nums">
                {r.trainingScorePct === null ? '—' : `${Number(r.trainingScorePct).toFixed(1)}%`}
              </span>
              <span className="text-[10px] text-muted-foreground">{r.trainingsCompleted} done</span>
            </div>
          )
        },
      },
    ],
    []
  )

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Monthly history</CardTitle>
        <CardDescription>
          Combined monthly score = attendance (60%) + training avg (40%).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No monthly history yet — records appear as each month finishes.
          </p>
        ) : (
          <DataTable columns={columns} data={rows} />
        )}
      </CardContent>
    </Card>
  )
}
