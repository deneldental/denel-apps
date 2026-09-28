import {
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
import { ArrowLeft, Calendar, RotateCcw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  type AttendanceDetail,
  type DailyRecord,
  deleteAttendanceException,
  getStaffAttendance,
  upsertAttendanceException,
} from '@/lib/actions/staff'
import { DataTable } from '@/shared/components/data-table/data-table'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { MonthCalendar, MonthSummaryCard } from '@/shared/components/month-calendar'
import { StatusBadge, type StatusTone } from '@/shared/components/status-badge'
import { usePermissions } from '@/shared/hooks/use-permissions'

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const DOW_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const ATTENDANCE_TONE: Record<DailyRecord['status'], StatusTone> = {
  present: 'success',
  late: 'warning',
  absent: 'danger',
  excused: 'warning',
  holiday: 'neutral',
  off: 'neutral',
  on_leave: 'neutral',
}

export default function AttendanceDetailPage() {
  const { staffId } = useParams<{ staffId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const { isAdmin } = usePermissions()
  const [month, setMonth] = useState(searchParams.get('month') || currentMonth())
  const [data, setData] = useState<AttendanceDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar')
  const [mutatingDate, setMutatingDate] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!staffId) return
    setLoading(true)
    const res = await getStaffAttendance(staffId, month)
    if (res.success && res.data) setData(res.data)
    else {
      toast.error(res.error || 'Failed to load attendance')
      setData(null)
    }
    setLoading(false)
  }, [staffId, month])

  useEffect(() => {
    void reload()
  }, [reload])

  // Remove a date from this staff's attendance (mark it off_day so it stops
  // counting), or restore a previously-removed date. Admin-only.
  const handleRemoveDate = useCallback(
    async (date: string) => {
      if (!staffId) return
      setMutatingDate(date)
      const res = await upsertAttendanceException({
        staffId,
        date,
        type: 'off_day',
        reason: 'Removed by admin — no attendance expected',
      })
      setMutatingDate(null)
      if (res.success) {
        toast.success(`${date} removed from attendance`)
        await reload()
      } else {
        toast.error(res.error || 'Failed to remove date')
      }
    },
    [staffId, reload]
  )

  const handleRestoreDate = useCallback(
    async (date: string, exceptionId: string) => {
      setMutatingDate(date)
      const res = await deleteAttendanceException(exceptionId)
      setMutatingDate(null)
      if (res.success) {
        toast.success(`${date} restored`)
        await reload()
      } else {
        toast.error(res.error || 'Failed to restore date')
      }
    },
    [reload]
  )

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
        cell: ({ row }) => (
          <StatusBadge tone={ATTENDANCE_TONE[row.original.status]}>
            {row.original.status}
          </StatusBadge>
        ),
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
      ...(isAdmin
        ? [
            {
              id: 'actions',
              header: '',
              cell: ({ row }: { row: { original: DailyRecord } }) => {
                const r = row.original
                const busy = mutatingDate === r.date
                if (r.exceptionId) {
                  return (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-muted-foreground"
                      disabled={busy}
                      onClick={() => handleRestoreDate(r.date, r.exceptionId as string)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Restore
                    </Button>
                  )
                }
                // Only offer removal on days that currently count.
                if (r.status === 'present' || r.status === 'late' || r.status === 'absent') {
                  return (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-destructive"
                      disabled={busy}
                      onClick={() => handleRemoveDate(r.date)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </Button>
                  )
                }
                return null
              },
            } as ColumnDef<DailyRecord>,
          ]
        : []),
    ],
    [isAdmin, mutatingDate, handleRestoreDate, handleRemoveDate]
  )

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div className="flex items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="att-detail-month" className="text-xs">
              Month
            </Label>
            <Input
              id="att-detail-month"
              type="month"
              value={month}
              onChange={(e) => changeMonth(e.target.value)}
              className="w-[150px]"
            />
          </div>
        </div>
      </div>

      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {data?.staff?.fullName ?? 'Attendance'}
        </h1>
        <p className="text-muted-foreground mt-1 capitalize">
          {data?.staff?.role || ''} · {data?.staff?.staffType || ''}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <MonthSummaryCard label="Present" value={data?.summary.daysPresent ?? '—'} />
        <MonthSummaryCard label="Late" value={data?.summary.daysLate ?? '—'} />
        <MonthSummaryCard
          label="Absent"
          value={data?.summary.daysAbsent ?? '—'}
          accent="destructive"
        />
        <MonthSummaryCard label="Excused" value={data?.summary.daysExcused ?? '—'} />
        <MonthSummaryCard
          label="Attendance %"
          value={data ? `${Number(data.summary.attendancePct).toFixed(1)}%` : '—'}
          accent="primary"
        />
      </div>

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
    </div>
  )
}
