import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@denel/ui'
import { CalendarDays, Clock, Edit2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { DailyAttendanceRecord } from '@/lib/actions/staff'
import { setAttendanceOverride } from '@/lib/actions/staff'
import { StatusBadge as StatusPill, type StatusTone } from '@/shared/components/status-badge'

// The scorer emits UTC-anchored YYYY-MM-DD strings (Ghana = UTC+0), so all the
// calendar math here is done in UTC to stay aligned with the backend.

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function clockInTone(status: DailyAttendanceRecord['clockInStatus']): string {
  if (status === 'on_time') return 'text-emerald-600 dark:text-emerald-400'
  if (status === 'late_mild') return 'text-amber-600 dark:text-amber-400'
  if (status === 'late_severe') return 'text-red-600 dark:text-red-400'
  return 'text-muted-foreground'
}

function groupByDate(records: DailyAttendanceRecord[]): Map<string, DailyAttendanceRecord[]> {
  const m = new Map<string, DailyAttendanceRecord[]>()
  for (const r of records) {
    const list = m.get(r.date) ?? []
    list.push(r)
    m.set(r.date, list)
  }
  // Earliest clock-in first within a day.
  for (const list of m.values()) {
    list.sort((a, b) => (a.clockIn ?? '99:99').localeCompare(b.clockIn ?? '99:99'))
  }
  return m
}

// ── Calendar (month grid) ───────────────────────────────────────────────────

const CELL_PREVIEW = 3

export function AttendanceCalendarView({
  month,
  records,
  onSelectDate,
}: {
  month: string // YYYY-MM
  records: DailyAttendanceRecord[]
  onSelectDate: (date: string) => void
}) {
  const byDate = useMemo(() => groupByDate(records), [records])

  const cells = useMemo(() => {
    const [y, m] = month.split('-').map(Number)
    const monthIdx = m - 1
    const first = new Date(Date.UTC(y, monthIdx, 1))
    // Monday-start grid: how many blanks before day 1.
    const lead = (first.getUTCDay() + 6) % 7
    const out: Array<{ date: string; day: number } | null> = []
    for (let i = 0; i < lead; i++) out.push(null)
    for (
      const d = new Date(first);
      d.getUTCMonth() === monthIdx;
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      out.push({ date: d.toISOString().slice(0, 10), day: d.getUTCDate() })
    }
    // Trailing blanks to complete the last week row.
    while (out.length % 7 !== 0) out.push(null)
    return out
  }, [month])

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <div className="grid grid-cols-7 gap-px rounded-t-md bg-border">
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              className="bg-muted px-2 py-1.5 text-center text-xs font-medium text-muted-foreground"
            >
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px rounded-b-md bg-border">
          {cells.map((cell, i) => {
            if (!cell) {
              // biome-ignore lint/suspicious/noArrayIndexKey: blank calendar filler cell, no identity, position is deterministic per month
              return <div key={`blank-${i}`} className="min-h-[104px] bg-muted/30" />
            }
            const dayRecords = byDate.get(cell.date) ?? []
            const shown = dayRecords.slice(0, CELL_PREVIEW)
            const extra = dayRecords.length - shown.length
            return (
              <button
                key={cell.date}
                type="button"
                onClick={() => onSelectDate(cell.date)}
                className="flex min-h-[104px] flex-col gap-1 bg-background p-1.5 text-left transition-colors hover:bg-muted/60"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tabular-nums">{cell.day}</span>
                  {dayRecords.length > 0 && (
                    <span className="text-[10px] text-muted-foreground">{dayRecords.length}</span>
                  )}
                </div>
                <div className="flex flex-col gap-0.5">
                  {shown.map((r) => (
                    <div key={r.staffId} className="truncate text-[11px] leading-tight">
                      <span className="font-medium">{r.staffName.split(' ')[0]}</span>{' '}
                      <span className={`tabular-nums ${clockInTone(r.clockInStatus)}`}>
                        {r.clockIn ?? '—'}
                      </span>
                      <span className="text-muted-foreground">–{r.clockOut ?? '—'}</span>
                    </div>
                  ))}
                  {extra > 0 && (
                    <span className="text-[10px] font-medium text-primary">+{extra} more →</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Single-day view ─────────────────────────────────────────────────────────

const ATTENDANCE_TONE: Record<DailyAttendanceRecord['status'], StatusTone> = {
  present: 'success',
  late: 'warning',
  absent: 'danger',
  excused: 'warning',
  off: 'neutral',
  holiday: 'neutral',
  on_leave: 'neutral',
}

function StatusBadge({ status }: { status: DailyAttendanceRecord['status'] }) {
  return <StatusPill tone={ATTENDANCE_TONE[status]}>{status}</StatusPill>
}

export function AttendanceSingleDayView({
  date,
  records,
  onDateChange,
}: {
  date: string // YYYY-MM-DD
  records: DailyAttendanceRecord[]
  onDateChange: (date: string) => void
}) {
  const [editingRecord, setEditingRecord] = useState<DailyAttendanceRecord | null>(null)
  const [clockIn, setClockIn] = useState('')
  const [clockOut, setClockOut] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingRecord) return
    setSaving(true)
    const res = await setAttendanceOverride({
      staffId: editingRecord.staffId,
      date,
      clockIn: clockIn || undefined,
      clockOut: clockOut || undefined,
    })
    setSaving(false)
    if (res.success) {
      toast.success('Attendance overridden')
      setEditingRecord(null)
      // trigger refresh
      onDateChange(date)
    } else {
      toast.error('Failed to override')
    }
  }

  const dayRecords = useMemo(
    () =>
      records.filter((r) => r.date === date).sort((a, b) => a.staffName.localeCompare(b.staffName)),
    [records, date]
  )

  const pretty = useMemo(() => {
    if (!date) return ''
    const [y, m, d] = date.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    })
  }, [date])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-lg font-semibold">
            <CalendarDays className="h-5 w-5 text-primary" />
            {pretty || 'Pick a date'}
          </p>
          <p className="text-sm text-muted-foreground">{dayRecords.length} clocked in</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="single-day-date" className="text-xs">
            Date
          </Label>
          <Input
            id="single-day-date"
            type="date"
            value={date}
            onChange={(e) => e.target.value && onDateChange(e.target.value)}
            className="w-[170px]"
          />
        </div>
      </div>

      {dayRecords.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No one clocked in on this date.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Staff</th>
                <th className="px-4 py-2 font-medium">Clock In</th>
                <th className="px-4 py-2 font-medium">Clock Out</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {dayRecords.map((r) => (
                <tr key={r.staffId} className="border-b last:border-0">
                  <td className="px-4 py-2">
                    <div className="font-medium">{r.staffName}</div>
                    <div className="text-xs text-muted-foreground">{r.staffCode}</div>
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex items-center gap-1 tabular-nums font-medium ${clockInTone(r.clockInStatus)}`}
                    >
                      <Clock className="h-3.5 w-3.5" />
                      {r.clockIn ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2 tabular-nums">{r.clockOut ?? '—'}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => {
                        setEditingRecord(r)
                        setClockIn(r.clockIn || '')
                        setClockOut(r.clockOut || '')
                      }}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editingRecord && (
        <Dialog open={!!editingRecord} onOpenChange={(o) => !o && setEditingRecord(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Override Attendance</DialogTitle>
              <DialogDescription>
                Manually update clock-in/out times for {editingRecord.staffName} on {date}.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSave} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Clock In</Label>
                <Input type="time" value={clockIn} onChange={(e) => setClockIn(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Clock Out</Label>
                <Input type="time" value={clockOut} onChange={(e) => setClockOut(e.target.value)} />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setEditingRecord(null)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  Save Override
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
