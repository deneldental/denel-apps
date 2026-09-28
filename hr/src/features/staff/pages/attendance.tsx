// PR-18 — Attendance page now hosts both the monthly records grid and the
// per-staff attendance configuration (holidays, off-days, ad-hoc excuses)
// that previously lived under HR Settings. Records is the default tab; the
// config sections are one click away in the same place HR is already looking.
//
// PR-20 — Type column dropped (attendance is internal-only after PR-14
// folded specialists into HR). Replaced with a show/hide-attendance toggle
// that's only rendered for admins who themselves have an attendance ID —
// the column header is suppressed entirely otherwise. The toggle flips
// `staff.tracksAttendance` inline; the row stays in the grid so the admin
// can put it back without leaving the page.

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@denel/ui'
import type { ColumnDef } from '@tanstack/react-table'
import {
  AlertTriangle,
  Calendar,
  CalendarDays,
  CalendarRange,
  Clock,
  LayoutGrid,
  List,
  Settings2,
  SlidersHorizontal,
  Upload,
  UserMinus,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ExcusesSection,
  HolidaysSection,
  OffDaysSection,
  type StaffOption,
} from '@/features/staff/components/attendance-config-sections'
import {
  AttendanceCalendarView,
  AttendanceSingleDayView,
} from '@/features/staff/components/attendance-records-views'
import { AttendanceScoringSection } from '@/features/staff/components/attendance-scoring-section'
import { AttendanceSubmissionsSection } from '@/features/staff/components/attendance-submissions-section'
import { LatenessLogSection } from '@/features/staff/components/lateness-log-section'
import {
  type AttendanceMonthlyRow,
  type DailyAttendanceRecord,
  getAttendance,
  getDailyAttendance,
  getStaff,
  updateStaff,
  uploadAttendanceCsv,
} from '@/lib/actions/staff'
import { authClient } from '@/lib/auth'
import { DataTable } from '@/shared/components/data-table/data-table'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { TagBadge } from '@/shared/components/tag-badge'
import { usePermissions } from '@/shared/hooks/use-permissions'

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function AttendancePage() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { isAdmin } = usePermissions()

  const [activeTab, setActiveTab] = useState('records')
  const [month, setMonth] = useState(currentMonth())
  const [rows, setRows] = useState<AttendanceMonthlyRow[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([])
  // PR-20 — current session user id + whether their staff row has an
  // attendance ID. Both are needed to decide if the per-row hide toggle
  // appears in the columns array.
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [currentUserHasAttendanceId, setCurrentUserHasAttendanceId] = useState(false)
  const [savingToggleFor, setSavingToggleFor] = useState<string | null>(null)

  // Records sub-view (list / calendar / single-day) + the shared daily dataset
  // the calendar and single-day views read from.
  const [recordsView, setRecordsView] = useState<'list' | 'calendar' | 'single-day'>('list')
  const [dailyRecords, setDailyRecords] = useState<DailyAttendanceRecord[]>([])
  const [dailyLoading, setDailyLoading] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  )

  const load = useCallback(async () => {
    setLoading(true)
    // Attendance is internal-only since specialists folded into HR (PR-14);
    // the backend defaults to internal scope when no staffType is passed.
    const res = await getAttendance(month, 'internal')
    if (res.success) setRows(res.data)
    else {
      toast.error(res.error || 'Failed to load attendance')
      setRows([])
    }
    setLoading(false)
  }, [month])

  const loadDaily = useCallback(async () => {
    setDailyLoading(true)
    const res = await getDailyAttendance(month)
    if (res.success) setDailyRecords(res.data)
    else {
      toast.error(res.error || 'Failed to load daily attendance')
      setDailyRecords([])
    }
    setDailyLoading(false)
  }, [month])

  useEffect(() => {
    void load()
  }, [load])

  // Load the daily dataset once the calendar / single-day view is in use, and
  // whenever the month changes while it's showing.
  useEffect(() => {
    if (activeTab === 'records' && recordsView !== 'list') {
      void loadDaily()
    }
  }, [activeTab, recordsView, loadDaily])

  useEffect(() => {
    void getStaff().then((res) => {
      if (res.success) {
        const opts: StaffOption[] = (res.data as Array<{ id: string; fullName: string }>).map(
          (s) => ({ id: s.id, fullName: s.fullName })
        )
        opts.sort((a, b) => a.fullName.localeCompare(b.fullName))
        setStaffOptions(opts)
      }
    })
  }, [])

  // Resolve current user → their staff row → does it have a deviceUserId?
  // Done from the same rows we already have on screen, so no extra fetch.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data } = await authClient.getSession()
      if (cancelled) return
      setCurrentUserId(data?.user?.id ?? null)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!currentUserId) {
      setCurrentUserHasAttendanceId(false)
      return
    }
    const me = rows.find((r) => r.userId === currentUserId)
    setCurrentUserHasAttendanceId(!!me?.deviceUserId)
  }, [currentUserId, rows])

  const showAdminToggle = isAdmin && currentUserHasAttendanceId

  const handleToggleVisible = useCallback(async (row: AttendanceMonthlyRow, next: boolean) => {
    setSavingToggleFor(row.staffId)
    // Optimistic flip so the Switch responds immediately. Roll back on error.
    setRows((prev) =>
      prev.map((r) => (r.staffId === row.staffId ? { ...r, tracksAttendance: next } : r))
    )
    const res = await updateStaff(row.staffId, { tracksAttendance: next } as Record<
      string,
      unknown
    >)
    setSavingToggleFor(null)
    if (!res.success) {
      toast.error(res.error || 'Failed to update visibility')
      setRows((prev) =>
        prev.map((r) => (r.staffId === row.staffId ? { ...r, tracksAttendance: !next } : r))
      )
      return
    }
    toast.success(next ? `${row.fullName} now tracked` : `${row.fullName} hidden from attendance`)
  }, [])

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const res = await uploadAttendanceCsv(file)
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!res.success) {
      toast.error(res.error || 'Upload failed')
      return
    }
    const { inserted, skippedDuplicate, unmappedDeviceUserIds } = res
    let summary = `Uploaded ${inserted} new event${inserted === 1 ? '' : 's'}`
    if (skippedDuplicate)
      summary += ` · ${skippedDuplicate} duplicate${skippedDuplicate === 1 ? '' : 's'} skipped`
    if (unmappedDeviceUserIds.length) {
      summary += ` · ${unmappedDeviceUserIds.length} unmapped device IDs`
      toast.warning(summary, {
        description: `Set deviceUserId on staff: ${unmappedDeviceUserIds.join(', ')}`,
      })
    } else {
      toast.success(summary)
    }
    await load()
  }

  const columns = useMemo<ColumnDef<AttendanceMonthlyRow>[]>(() => {
    const base: ColumnDef<AttendanceMonthlyRow>[] = [
      {
        accessorKey: 'fullName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.original.fullName}</span>
            {!row.original.tracksAttendance && <TagBadge className="text-[10px]">Hidden</TagBadge>}
          </div>
        ),
      },
      {
        accessorKey: 'role',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Role" />,
        cell: ({ row }) => <span className="capitalize text-sm">{row.original.role}</span>,
      },
      {
        accessorKey: 'daysPresent',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Present" />,
        cell: ({ row }) => <span className="tabular-nums">{row.original.daysPresent}</span>,
      },
      {
        accessorKey: 'daysLate',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Late" />,
        cell: ({ row }) => <span className="tabular-nums">{row.original.daysLate}</span>,
      },
      {
        accessorKey: 'daysAbsent',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Absent" />,
        cell: ({ row }) => (
          <span className="tabular-nums text-destructive">{row.original.daysAbsent}</span>
        ),
      },
      {
        accessorKey: 'attendancePct',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Attendance %" />,
        cell: ({ row }) => (
          <span className="font-medium tabular-nums">
            {Number(row.original.attendancePct).toFixed(1)}%
          </span>
        ),
      },
    ]

    if (showAdminToggle) {
      base.push({
        id: 'visibility',
        header: 'Visible',
        cell: ({ row }) => (
          <Switch
            checked={row.original.tracksAttendance}
            onCheckedChange={(next) => {
              // Prevent the row-click navigation from firing as well.
              void handleToggleVisible(row.original, next)
            }}
            disabled={savingToggleFor === row.original.staffId}
            aria-label={`Toggle attendance visibility for ${row.original.fullName}`}
            // Stop the surrounding row's onRowClick from firing too.
            onClick={(e) => e.stopPropagation()}
          />
        ),
      })
    }

    return base
  }, [showAdminToggle, savingToggleFor, handleToggleVisible])

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Attendance</h1>
          <p className="text-muted-foreground mt-1">
            Monthly records plus the configuration — holidays, off-days, and ad-hoc excuses — that
            shapes how attendance is computed.
          </p>
        </div>
        <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          <Upload className="mr-2 h-4 w-4" />
          {uploading ? 'Uploading…' : 'Upload CSV'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          <TabsTrigger value="records" className="gap-2">
            <Calendar className="h-4 w-4" />
            Records
          </TabsTrigger>
          <TabsTrigger value="lateness" className="gap-2">
            <AlertTriangle className="h-4 w-4" />
            Lateness Log
          </TabsTrigger>
          <TabsTrigger value="holidays" className="gap-2">
            <CalendarDays className="h-4 w-4" />
            Holidays
          </TabsTrigger>
          <TabsTrigger value="submissions" className="gap-2">
            <Clock className="h-4 w-4" />
            Fix Requests
          </TabsTrigger>
          <TabsTrigger value="off-days" className="gap-2">
            <Settings2 className="h-4 w-4" />
            Off-days
          </TabsTrigger>
          <TabsTrigger value="excuses" className="gap-2">
            <UserMinus className="h-4 w-4" />
            Excuses
          </TabsTrigger>
          <TabsTrigger value="scoring" className="gap-2">
            <SlidersHorizontal className="h-4 w-4" />
            Scoring
          </TabsTrigger>
        </TabsList>

        <TabsContent value="records">
          <Card>
            <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Calendar className="h-5 w-5" />
                  {month}
                </CardTitle>
                <CardDescription>
                  {recordsView === 'list'
                    ? `${rows.length} staff · click a row to see daily breakdown`
                    : recordsView === 'calendar'
                      ? 'Clock-in → clock-out per person, per day · click a day for details'
                      : "Everyone's clock-in and clock-out for a single date"}
                </CardDescription>
              </div>
              <div className="flex items-end gap-3">
                {/* View switcher: list (current) / calendar / single-day */}
                <div className="inline-flex rounded-md border p-0.5">
                  {(
                    [
                      { id: 'list', label: 'List', icon: List },
                      { id: 'calendar', label: 'Calendar', icon: LayoutGrid },
                      { id: 'single-day', label: 'Day', icon: CalendarRange },
                    ] as const
                  ).map((v) => (
                    <Button
                      key={v.id}
                      type="button"
                      size="sm"
                      variant={recordsView === v.id ? 'default' : 'ghost'}
                      className="h-8 gap-1.5 px-3"
                      onClick={() => setRecordsView(v.id)}
                    >
                      <v.icon className="h-4 w-4" />
                      <span className="hidden sm:inline">{v.label}</span>
                    </Button>
                  ))}
                </div>
                {recordsView !== 'single-day' && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="att-month" className="text-xs">
                      Month
                    </Label>
                    <Input
                      id="att-month"
                      type="month"
                      value={month}
                      onChange={(e) => setMonth(e.target.value || currentMonth())}
                      className="w-[150px]"
                    />
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {recordsView === 'list' ? (
                loading ? (
                  <div className="py-12 text-center text-muted-foreground">Loading…</div>
                ) : rows.length > 0 ? (
                  <DataTable
                    columns={columns}
                    data={rows}
                    meta={{
                      onRowClick: (row: AttendanceMonthlyRow) =>
                        navigate(`/attendance/${row.staffId}?month=${month}`),
                    }}
                  />
                ) : (
                  <div className="py-12 text-center text-muted-foreground">
                    No attendance data for {month}. Upload a CSV to get started.
                  </div>
                )
              ) : dailyLoading ? (
                <div className="py-12 text-center text-muted-foreground">Loading…</div>
              ) : recordsView === 'calendar' ? (
                <AttendanceCalendarView
                  month={month}
                  records={dailyRecords}
                  onSelectDate={(date) => {
                    setSelectedDate(date)
                    setRecordsView('single-day')
                  }}
                />
              ) : (
                <AttendanceSingleDayView
                  date={selectedDate}
                  records={dailyRecords}
                  onDateChange={(date) => {
                    setSelectedDate(date)
                    // Picking a date in another month reloads that month's dataset.
                    const dm = date.slice(0, 7)
                    if (dm !== month) setMonth(dm)
                  }}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="lateness">
          <LatenessLogSection />
        </TabsContent>

        <TabsContent value="holidays">
          <HolidaysSection />
        </TabsContent>

        <TabsContent value="submissions">
          <AttendanceSubmissionsSection />
        </TabsContent>

        <TabsContent value="off-days">
          <OffDaysSection staffOptions={staffOptions} />
        </TabsContent>

        <TabsContent value="excuses">
          <ExcusesSection staffOptions={staffOptions} />
        </TabsContent>

        <TabsContent value="scoring">
          <AttendanceScoringSection />
        </TabsContent>
      </Tabs>
    </div>
  )
}
