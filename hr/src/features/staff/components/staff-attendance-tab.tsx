import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@denel/ui'
import type { ColumnDef } from '@tanstack/react-table'
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, Printer } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  type AttendanceDetail,
  type DailyRecord,
  downloadStaffAttendancePdf,
  getStaffAttendance,
} from '@/lib/actions/staff'
import { DataTable } from '@/shared/components/data-table/data-table'
import { StatusBadge } from '@/shared/components/status-badge'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

/** Shift a YYYY-MM string by ±1 month. */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function StaffAttendanceTab({ staffId, staffName }: { staffId: string; staffName: string }) {
  const [month, setMonth] = useState(currentMonth())
  const [detail, setDetail] = useState<AttendanceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [openDay, setOpenDay] = useState<DailyRecord | null>(null)
  const [printing, setPrinting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getStaffAttendance(staffId, month)
      .then((res) => {
        if (cancelled) return
        setDetail(res.success && res.data ? res.data : null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [staffId, month])

  const rows = useMemo(() => {
    const daily = detail?.daily ?? []
    return statusFilter === 'all' ? daily : daily.filter((d) => d.status === statusFilter)
  }, [detail, statusFilter])

  const columns = useMemo<ColumnDef<DailyRecord>[]>(
    () => [
      {
        accessorKey: 'date',
        header: 'Date',
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.date}</span>,
      },
      {
        id: 'day',
        header: 'Day',
        cell: ({ row }) => (
          <span className="text-muted-foreground">{DAY_NAMES[row.original.dayOfWeek]}</span>
        ),
      },
      {
        accessorKey: 'clockIn',
        header: 'Clock In',
        cell: ({ row }) => <span className="tabular-nums">{row.original.clockIn ?? '—'}</span>,
      },
      {
        accessorKey: 'clockOut',
        header: 'Clock Out',
        cell: ({ row }) => <span className="tabular-nums">{row.original.clockOut ?? '—'}</span>,
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'points',
        header: 'Points',
        cell: ({ row }) =>
          row.original.isScoringDay ? (
            <span className="font-medium tabular-nums">{row.original.dailyScore}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
    ],
    []
  )

  async function handlePrint() {
    try {
      setPrinting(true)
      await downloadStaffAttendancePdf(staffId, 8)
      toast.success(`Attendance PDF downloaded for ${staffName}.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate PDF')
    } finally {
      setPrinting(false)
    }
  }

  const summary = detail?.summary

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Attendance</CardTitle>
            <CardDescription>
              Daily clock-ins and points for the selected month. Click a row for the day's detail.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to={`/attendance/${staffId}`}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Full page
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrint} disabled={printing}>
              {printing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Printer className="mr-2 h-4 w-4" />
              )}
              Print PDF
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Month nav + summary + status filter */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setMonth((m) => shiftMonth(m, -1))}
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Input
                type="month"
                value={month}
                max={currentMonth()}
                onChange={(e) => e.target.value && setMonth(e.target.value)}
                className="w-[150px]"
              />
              <Button
                variant="outline"
                size="icon"
                disabled={month >= currentMonth()}
                onClick={() => setMonth((m) => shiftMonth(m, 1))}
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="present">Present</SelectItem>
                <SelectItem value="late">Late</SelectItem>
                <SelectItem value="absent">Absent</SelectItem>
                <SelectItem value="excused">Excused</SelectItem>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="holiday">Holiday</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {summary && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Attendance" value={`${Number(summary.attendancePct).toFixed(1)}%`} />
              <Stat label="Points" value={`${summary.totalScore} / ${summary.maxScore}`} />
              <Stat label="Present" value={`${summary.daysPresent + summary.daysLate}`} />
              <Stat label="Absent" value={`${summary.daysAbsent}`} />
            </div>
          )}

          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : (
            <DataTable columns={columns} data={rows} meta={{ onRowClick: setOpenDay }} />
          )}
        </CardContent>
      </Card>

      <DayDetailSheet day={openDay} onClose={() => setOpenDay(null)} />
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-base font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function DayDetailSheet({ day, onClose }: { day: DailyRecord | null; onClose: () => void }) {
  return (
    <Sheet open={!!day} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{day ? `${DAY_NAMES[day.dayOfWeek]}, ${day.date}` : 'Day'}</SheetTitle>
          <SheetDescription>Clock-in / clock-out and points for this day.</SheetDescription>
        </SheetHeader>
        {day && (
          <div className="mt-6 space-y-3 text-sm">
            <Row label="Status">
              <StatusBadge status={day.status} />
            </Row>
            <Row label="Clock in">
              <span className="tabular-nums">{day.clockIn ?? '—'}</span>
              <span className="ml-2 text-xs text-muted-foreground capitalize">
                {day.clockInStatus?.replace(/_/g, ' ')}
              </span>
            </Row>
            <Row label="Clock out">
              <span className="tabular-nums">{day.clockOut ?? '—'}</span>
              <span className="ml-2 text-xs text-muted-foreground capitalize">
                {day.clockOutStatus?.replace(/_/g, ' ')}
              </span>
            </Row>
            <Row label="Points">
              {day.isScoringDay ? (
                <span className="font-medium tabular-nums">{day.dailyScore}</span>
              ) : (
                <span className="text-muted-foreground">Not a scoring day</span>
              )}
            </Row>
            {day.exceptionReason && <Row label="Note">{day.exceptionReason}</Row>}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b pb-2">
      <span className="text-muted-foreground">{label}</span>
      <span>{children}</span>
    </div>
  )
}
