import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@denel/ui'
import type { ColumnDef } from '@tanstack/react-table'
import { ArrowLeft, Calendar, GraduationCap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  type AttendanceDetail,
  type DailyRecord,
  getStaffAttendance,
  getStaffMember,
} from '@/lib/actions/staff'
import { DataTable } from '@/shared/components/data-table/data-table'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { MonthCalendar, MonthSummaryCard } from '@/shared/components/month-calendar'
import { StatusBadge } from '@/shared/components/status-badge'

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const DOW_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface TrainingProgressItem {
  id: string
  status: string
  score?: number | null
  completedAt?: string | null
  training: {
    id: string
    title: string
    passingScore?: number | null
    published?: boolean
    totalScore?: number | null
  }
}

interface StaffWithTraining {
  fullName?: string
  role?: string
  position?: string
  trainingProgress?: TrainingProgressItem[]
}

function scoreGrade(pct: number): { label: string; color: string } {
  if (pct >= 90) return { label: 'Excellent', color: 'text-emerald-600' }
  if (pct >= 75) return { label: 'Good', color: 'text-sky-600' }
  if (pct >= 60) return { label: 'Fair', color: 'text-amber-600' }
  return { label: 'Needs improvement', color: 'text-rose-600' }
}

export default function PerformanceDetailPage() {
  const { staffId } = useParams<{ staffId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [month, setMonth] = useState(searchParams.get('month') || currentMonth())
  const [data, setData] = useState<AttendanceDetail | null>(null)
  const [staffName, setStaffName] = useState<string | null>(null)
  const [staffRole, setStaffRole] = useState<string | null>(null)
  const [trainingItems, setTrainingItems] = useState<TrainingProgressItem[]>([])
  const [loading, setLoading] = useState(false)
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar')

  useEffect(() => {
    if (!staffId) return
    let cancelled = false
    setLoading(true)

    Promise.all([getStaffMember(staffId), getStaffAttendance(staffId, month)])
      .then(([staffRes, attendanceRes]) => {
        if (cancelled) return
        if (staffRes.success && staffRes.data) {
          const staff = staffRes.data as StaffWithTraining
          setStaffName(staff.fullName ?? null)
          setStaffRole(staff.role ?? staff.position ?? null)
          setTrainingItems((staff.trainingProgress ?? []).filter((t) => t.training?.published))
        } else {
          toast.error(staffRes.error || 'Failed to load staff')
        }

        if (attendanceRes.success && attendanceRes.data) {
          setData(attendanceRes.data)
        } else {
          toast.error(attendanceRes.error || 'Failed to load attendance')
          setData(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [staffId, month])

  function changeMonth(next: string) {
    const value = next || currentMonth()
    setMonth(value)
    setSearchParams({ month: value })
  }

  const columns = useMemo<ColumnDef<DailyRecord>[]>(
    () => [
      {
        accessorKey: 'date',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.date}</span>,
      },
      {
        accessorKey: 'dayOfWeek',
        header: 'Day',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {DOW_LABEL[row.original.dayOfWeek] ?? ''}
          </span>
        ),
      },
      {
        accessorKey: 'clockIn',
        header: 'Clock In',
        cell: ({ row }) => (
          <span className="font-mono text-sm tabular-nums">{row.original.clockIn || '—'}</span>
        ),
      },
      {
        accessorKey: 'clockOut',
        header: 'Clock Out',
        cell: ({ row }) => (
          <span className="font-mono text-sm tabular-nums">{row.original.clockOut || '—'}</span>
        ),
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: 'dailyScore',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Score" />,
        cell: ({ row }) =>
          row.original.isScoringDay ? (
            <span className="font-medium tabular-nums">{row.original.dailyScore}/10</span>
          ) : (
            <span className="text-xs text-muted-foreground">non-scoring</span>
          ),
      },
    ],
    []
  )

  const derived = useMemo(() => {
    const summary = data?.summary
    const monthTraining = trainingItems.filter((t) => {
      if (t.status !== 'completed' || !t.completedAt || t.score == null) return false
      return t.completedAt.startsWith(month)
    })
    const trainingPct =
      monthTraining.length > 0
        ? monthTraining.reduce((s, t) => s + (t.score ?? 0), 0) / monthTraining.length
        : null
    const attendancePct = summary?.attendancePct ?? 0
    const combinedPct =
      trainingPct !== null ? attendancePct * 0.6 + trainingPct * 0.4 : attendancePct
    return {
      presentDays: summary?.daysPresent ?? 0,
      lateDays: summary?.daysLate ?? 0,
      absentDays: summary?.daysAbsent ?? 0,
      excusedDays: summary?.daysExcused ?? 0,
      attendancePct,
      trainingPct,
      combinedPct,
      monthTraining,
      grade: scoreGrade(combinedPct),
    }
  }, [data, trainingItems, month])

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/performance')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div className="flex items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="perf-detail-month" className="text-xs">
              Month
            </Label>
            <Input
              id="perf-detail-month"
              type="month"
              value={month}
              onChange={(e) => changeMonth(e.target.value)}
              className="w-[150px]"
            />
          </div>
        </div>
      </div>

      <div>
        <h1 className="text-3xl font-bold tracking-tight">{staffName ?? 'Performance'}</h1>
        <p className="text-muted-foreground mt-1 capitalize">{staffRole || ''}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <MonthSummaryCard
          label="Combined score"
          value={`${derived.combinedPct.toFixed(1)}%`}
          accent="primary"
        />
        <MonthSummaryCard label="Attendance" value={`${derived.attendancePct.toFixed(1)}%`} />
        <MonthSummaryCard
          label="Training avg"
          value={derived.trainingPct !== null ? `${derived.trainingPct.toFixed(1)}%` : '—'}
        />
        <MonthSummaryCard label="Days present" value={derived.presentDays} />
        <MonthSummaryCard label="Days late" value={derived.lateDays} />
      </div>

      <p className="text-xs text-muted-foreground">
        Combined = attendance × 60% + training avg × 40%. Grade: {derived.grade.label} (
        {derived.combinedPct.toFixed(1)}%). Grades: ≥ 90% Excellent · ≥ 75% Good · ≥ 60% Fair ·
        &lt;60% Needs improvement.
      </p>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-4 pb-4 border-b mb-6">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Calendar className="h-5 w-5" />
              Daily breakdown — {month}
            </CardTitle>
            <CardDescription>Visual calendar showing all days of the week.</CardDescription>
          </div>
          <div className="flex items-center gap-1 bg-muted p-1 rounded-lg text-xs font-medium border">
            <button
              onClick={() => setViewMode('calendar')}
              className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                viewMode === 'calendar'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Calendar View
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              List View
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-muted-foreground">Loading…</div>
          ) : data && data.daily.length > 0 ? (
            viewMode === 'calendar' ? (
              <MonthCalendar dailyRecords={data.daily} month={month} />
            ) : (
              <DataTable columns={columns} data={data.daily} />
            )
          ) : (
            <div className="py-12 text-center text-muted-foreground">
              No daily records for {month}.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <GraduationCap className="h-5 w-5" />
            Training — {month}
          </CardTitle>
          <CardDescription>
            Training avg = average quiz score across completed trainings. Used for 40% of the
            combined score.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {trainingItems.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No training assigned yet.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {trainingItems.map((item) => {
                const isCompleted = item.status === 'completed'
                const completedThisMonth = isCompleted && item.completedAt?.startsWith(month)
                return (
                  <div key={item.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <GraduationCap className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{item.training.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.completedAt
                            ? `Completed ${new Date(item.completedAt).toLocaleDateString()}`
                            : 'Not yet completed'}
                          {completedThisMonth ? ' · This month' : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isCompleted && item.score != null ? (
                        <Badge variant="outline" className="tabular-nums">
                          {item.score}%
                        </Badge>
                      ) : (
                        <StatusBadge status={item.status} />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
