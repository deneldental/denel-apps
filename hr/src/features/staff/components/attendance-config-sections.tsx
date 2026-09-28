// PR-18 — Holidays + per-staff off-days + ad-hoc excuses sections, lifted out
// of the HR Settings page so they can live alongside the monthly attendance
// grid where HR actually reaches for them.
//
// Each section is self-contained and loads its own data. The page hosting
// them just supplies a staff option list (already loaded for the dropdowns).

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@denel/ui'
import type { ColumnDef } from '@tanstack/react-table'
import { CalendarDays, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  deleteAttendanceException,
  deleteHoliday,
  deleteStaffOffDay,
  type ExceptionRow,
  getAllStaffOffDays,
  getAttendanceExceptions,
  getHolidays,
  getStaffOffDays,
  type HolidayRow,
  type OffDayOverviewRow,
  type OffDayRow,
  setStaffOffDay,
  upsertAttendanceException,
  upsertAttendanceExceptionRange,
  upsertHoliday,
} from '@/lib/actions/staff'
import { DataTable } from '@/shared/components/data-table/data-table'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { TagBadge } from '@/shared/components/tag-badge'

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
] as const

const EXCEPTION_TYPES = [
  { value: 'excused_absence', label: 'Excused absence' },
  { value: 'off_day', label: 'Off-day' },
  { value: 'holiday', label: 'Holiday' },
] as const

export interface StaffOption {
  id: string
  fullName: string
}

// ── Holidays section ────────────────────────────────────────────────────────

export function HolidaysSection() {
  const [rows, setRows] = useState<HolidayRow[]>([])
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState<'full' | 'half'>('full')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await getHolidays()
    if (res.success) setRows(res.data)
    else toast.error(res.error || 'Failed to load holidays')
    setLoading(false)
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  async function handleAdd() {
    if (!date || !name) {
      toast.error('Date and name are required')
      return
    }
    setSaving(true)
    const res = await upsertHoliday(date, name, type)
    setSaving(false)
    if (res.success) {
      toast.success(`Saved ${name} on ${date}`)
      setDate('')
      setName('')
      setType('full')
      await load()
    } else {
      toast.error(res.error || 'Failed to save')
    }
  }

  const handleDelete = useCallback(async (id: string, label: string) => {
    const res = await deleteHoliday(id)
    if (res.success) {
      toast.success(`Removed ${label}`)
      setRows((prev) => prev.filter((r) => r.id !== id))
    } else {
      toast.error(res.error || 'Failed to delete')
    }
  }, [])

  const columns = useMemo<ColumnDef<HolidayRow>[]>(
    () => [
      {
        accessorKey: 'date',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.date}</span>,
      },
      {
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => <span>{row.original.name}</span>,
      },
      {
        accessorKey: 'type',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
        cell: ({ row }) => (
          <TagBadge label={row.original.type}>
            {row.original.type === 'half' ? 'Half-day' : 'Full'}
          </TagBadge>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleDelete(row.original.id, row.original.name)}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        ),
      },
    ],
    [handleDelete]
  )

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarDays className="h-4 w-4" />
          Clinic holidays
        </CardTitle>
        <CardDescription>
          Apply to all staff. Days marked as holiday don&apos;t count as absent.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="holiday-date" className="text-xs">
              Date
            </Label>
            <Input
              id="holiday-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-[170px]"
            />
          </div>
          <div className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
            <Label htmlFor="holiday-name" className="text-xs">
              Name
            </Label>
            <Input
              id="holiday-name"
              placeholder="e.g. Independence Day"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as 'full' | 'half')}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Full day</SelectItem>
                <SelectItem value="half">Half-day</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleAdd} disabled={saving}>
            <Plus className="mr-2 h-4 w-4" />
            Add holiday
          </Button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>
        ) : rows.length > 0 ? (
          <DataTable columns={columns} data={rows} />
        ) : (
          <div className="py-8 text-center text-muted-foreground text-sm">No holidays yet.</div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Off-days section ────────────────────────────────────────────────────────

export function OffDaysSection({ staffOptions }: { staffOptions: StaffOption[] }) {
  const [staffId, setStaffId] = useState<string>('')
  const [rows, setRows] = useState<OffDayRow[]>([])
  const [loading, setLoading] = useState(false)
  const [savingDow, setSavingDow] = useState<number | null>(null)
  const [overview, setOverview] = useState<OffDayOverviewRow[]>([])
  const [overviewLoading, setOverviewLoading] = useState(true)

  const selectedStaff = useMemo(
    () => staffOptions.find((s) => s.id === staffId),
    [staffOptions, staffId]
  )

  const loadStaff = useCallback(async (sid: string) => {
    setLoading(true)
    const res = await getStaffOffDays(sid)
    if (res.success) setRows(res.data)
    else toast.error(res.error || 'Failed to load off-days')
    setLoading(false)
  }, [])

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true)
    const res = await getAllStaffOffDays()
    if (res.success) setOverview(res.data)
    else toast.error(res.error || 'Failed to load overview')
    setOverviewLoading(false)
  }, [])

  useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  useEffect(() => {
    if (staffId) void loadStaff(staffId)
    else setRows([])
  }, [staffId, loadStaff])

  const offDowSet = useMemo(() => new Set(rows.map((r) => r.dayOfWeek)), [rows])
  const savedDayLabels = useMemo(
    () =>
      [...offDowSet]
        .sort((a, b) => a - b)
        .map((d) => DAYS_OF_WEEK.find((x) => x.value === d)?.label ?? '?'),
    [offDowSet]
  )

  const grouped = useMemo(() => {
    const map = new Map<string, { staffId: string; staffName: string | null; days: number[] }>()
    for (const r of overview) {
      const entry = map.get(r.staffId) ?? {
        staffId: r.staffId,
        staffName: r.staffName,
        days: [],
      }
      entry.days.push(r.dayOfWeek)
      map.set(r.staffId, entry)
    }
    for (const v of map.values()) v.days.sort((a, b) => a - b)
    return [...map.values()].sort((a, b) => (a.staffName ?? '').localeCompare(b.staffName ?? ''))
  }, [overview])

  async function toggle(dow: number) {
    if (!staffId) return
    setSavingDow(dow)
    const isOff = offDowSet.has(dow)
    const res = isOff ? await deleteStaffOffDay(staffId, dow) : await setStaffOffDay(staffId, dow)
    setSavingDow(null)
    if (!res.success) {
      toast.error(res.error || 'Failed to update')
      return
    }
    toast.success(
      `${selectedStaff?.fullName ?? 'Staff'}: ${DAYS_OF_WEEK[dow].label} ${isOff ? 'cleared' : 'set as off'}`
    )
    await Promise.all([loadStaff(staffId), loadOverview()])
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarDays className="h-4 w-4" />
          Per-staff weekly off-days
        </CardTitle>
        <CardDescription>
          Pick a staff and toggle their recurring off-days. Off-days don&apos;t count toward absent
          days in monthly summaries.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <div className="flex flex-col gap-1.5 max-w-md">
            <Label className="text-xs">Staff</Label>
            <Select value={staffId} onValueChange={setStaffId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a staff member" />
              </SelectTrigger>
              <SelectContent>
                {staffOptions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {staffId && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {loading ? 'Loading…' : 'Click a day to toggle.'}
              </p>
              <div className="flex flex-wrap gap-2">
                {DAYS_OF_WEEK.map((d) => {
                  const isOff = offDowSet.has(d.value)
                  return (
                    <Button
                      key={d.value}
                      type="button"
                      variant={isOff ? 'default' : 'outline'}
                      size="sm"
                      disabled={savingDow === d.value || loading}
                      onClick={() => toggle(d.value)}
                      className="min-w-[60px]"
                    >
                      {d.label}
                    </Button>
                  )
                })}
              </div>
              <div className="rounded-md bg-muted/40 px-3 py-2 text-xs">
                <span className="text-muted-foreground">
                  Saved off-days for {selectedStaff?.fullName}:
                </span>{' '}
                {savedDayLabels.length > 0 ? (
                  <span className="font-medium">{savedDayLabels.join(', ')}</span>
                ) : (
                  <span className="italic text-muted-foreground">
                    none — clinic-wide Saturday default still applies
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2 border-t pt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">All staff off-days</p>
            <span className="text-xs text-muted-foreground">
              {overviewLoading ? 'Loading…' : `${grouped.length} staff with off-days set`}
            </span>
          </div>
          {!overviewLoading && grouped.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              Nothing saved yet. Toggle a day above to start.
            </p>
          ) : (
            <div className="rounded-md border divide-y">
              {grouped.map((g) => (
                <div
                  key={g.staffId}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className="font-medium truncate">
                    {g.staffName ?? g.staffId.slice(0, 8)}
                  </span>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {g.days.map((d) => (
                      <TagBadge key={d}>
                        {DAYS_OF_WEEK.find((x) => x.value === d)?.label ?? '?'}
                      </TagBadge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ── Excuses (per-staff per-date) section ────────────────────────────────────

export function ExcusesSection({ staffOptions }: { staffOptions: StaffOption[] }) {
  const [rows, setRows] = useState<ExceptionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [staffId, setStaffId] = useState('')
  const [date, setDate] = useState('')
  const [type, setType] = useState<ExceptionRow['type']>('excused_absence')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  // Range bulk-exclude — remove all dates in a span that shouldn't have
  // attendance records for a staff (e.g. pre-hire days, extended leave).
  const [rangeStaffId, setRangeStaffId] = useState('')
  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo, setRangeTo] = useState('')
  const [rangeType, setRangeType] = useState<ExceptionRow['type']>('off_day')
  const [rangeReason, setRangeReason] = useState('')
  const [rangeSaving, setRangeSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await getAttendanceExceptions()
    if (res.success) setRows(res.data)
    else toast.error(res.error || 'Failed to load excuses')
    setLoading(false)
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  async function handleAdd() {
    if (!staffId || !date || !type) {
      toast.error('Staff, date and type are required')
      return
    }
    setSaving(true)
    const res = await upsertAttendanceException({
      staffId,
      date,
      type,
      reason: reason || undefined,
    })
    setSaving(false)
    if (res.success) {
      toast.success('Excuse saved')
      setDate('')
      setReason('')
      await load()
    } else {
      toast.error(res.error || 'Failed to save')
    }
  }

  const handleDelete = useCallback(async (id: string) => {
    const res = await deleteAttendanceException(id)
    if (res.success) {
      toast.success('Removed')
      setRows((prev) => prev.filter((r) => r.id !== id))
    } else {
      toast.error(res.error || 'Failed to delete')
    }
  }, [])

  async function handleAddRange() {
    if (!rangeStaffId || !rangeFrom || !rangeTo || !rangeType) {
      toast.error('Staff, from, to and type are required')
      return
    }
    if (rangeTo < rangeFrom) {
      toast.error('“To” must be on or after “From”')
      return
    }
    setRangeSaving(true)
    const res = await upsertAttendanceExceptionRange({
      staffId: rangeStaffId,
      from: rangeFrom,
      to: rangeTo,
      type: rangeType,
      reason: rangeReason || undefined,
    })
    setRangeSaving(false)
    if (res.success) {
      toast.success(`Excluded ${res.data?.count ?? ''} date(s)`.replace('  ', ' '))
      setRangeFrom('')
      setRangeTo('')
      setRangeReason('')
      await load()
    } else {
      toast.error(res.error || 'Failed to exclude range')
    }
  }

  const columns = useMemo<ColumnDef<ExceptionRow>[]>(
    () => [
      {
        accessorKey: 'staffName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Staff" />,
        cell: ({ row }) => (
          <span>{row.original.staffName ?? row.original.staffId.slice(0, 8)}</span>
        ),
      },
      {
        accessorKey: 'date',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.date}</span>,
      },
      {
        accessorKey: 'type',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
        cell: ({ row }) => (
          <TagBadge label={row.original.type} className="capitalize">
            {row.original.type.replace(/_/g, ' ')}
          </TagBadge>
        ),
      },
      {
        accessorKey: 'reason',
        header: 'Reason',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground line-clamp-2 max-w-md">
            {row.original.reason || '—'}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Button variant="ghost" size="sm" onClick={() => handleDelete(row.original.id)}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        ),
      },
    ],
    [handleDelete]
  )

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarDays className="h-4 w-4" />
          Ad-hoc excuses
        </CardTitle>
        <CardDescription>
          One-off excused dates for a specific staff. Approved leave requests apply automatically
          and don&apos;t need entries here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Staff</Label>
            <Select value={staffId} onValueChange={setStaffId}>
              <SelectTrigger>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {staffOptions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exc-date" className="text-xs">
              Date
            </Label>
            <Input
              id="exc-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as ExceptionRow['type'])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXCEPTION_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5 md:col-span-1">
            <Label htmlFor="exc-reason" className="text-xs">
              Reason (optional)
            </Label>
            <Input
              id="exc-reason"
              placeholder="e.g. Sick leave"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <Button onClick={handleAdd} disabled={saving}>
            <Plus className="mr-2 h-4 w-4" />
            Add
          </Button>
        </div>

        {/* Bulk range exclusion — remove all dates in a span for one staff. */}
        <div className="space-y-3 rounded-md border bg-muted/20 p-4">
          <div>
            <p className="text-sm font-medium">Exclude a date range</p>
            <p className="text-xs text-muted-foreground">
              Remove all dates in a span that shouldn&apos;t have attendance records for a staff —
              e.g. days before they were hired or an extended leave. Off-day excludes them from
              scoring and absent counts.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <Label className="text-xs">Staff</Label>
              <Select value={rangeStaffId} onValueChange={setRangeStaffId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {staffOptions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="range-from" className="text-xs">
                From
              </Label>
              <Input
                id="range-from"
                type="date"
                value={rangeFrom}
                onChange={(e) => setRangeFrom(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="range-to" className="text-xs">
                To
              </Label>
              <Input
                id="range-to"
                type="date"
                value={rangeTo}
                onChange={(e) => setRangeTo(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Type</Label>
              <Select
                value={rangeType}
                onValueChange={(v) => setRangeType(v as ExceptionRow['type'])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXCEPTION_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleAddRange} disabled={rangeSaving}>
              <Plus className="mr-2 h-4 w-4" />
              {rangeSaving ? 'Excluding…' : 'Exclude range'}
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="range-reason" className="text-xs">
              Reason (optional)
            </Label>
            <Input
              id="range-reason"
              placeholder="e.g. Joined mid-month"
              value={rangeReason}
              onChange={(e) => setRangeReason(e.target.value)}
              className="max-w-md"
            />
          </div>
        </div>

        {loading ? (
          <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>
        ) : rows.length > 0 ? (
          <DataTable columns={columns} data={rows} />
        ) : (
          <div className="py-8 text-center text-muted-foreground text-sm">No excuses yet.</div>
        )}
      </CardContent>
    </Card>
  )
}
