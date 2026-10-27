import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from '@denel/ui'
import type { ColumnDef } from '@tanstack/react-table'
import { CalendarCheck, GraduationCap, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { getMonthlyPerformance, type MonthlyPerformanceRow } from '@/lib/actions/staff'
import { DataTable } from '@/shared/components/data-table/data-table'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { TagBadge } from '@/shared/components/tag-badge'

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${Number(value).toFixed(1)}%`
}

/** Combined score: 60% attendance + 40% training (attendance-only when no training). */
function combinedScore(row: MonthlyPerformanceRow): number {
  const att = row.attendancePct ?? 0
  const tr = row.trainingScorePct
  if (tr === null || tr === undefined) return att
  return att * 0.6 + tr * 0.4
}

function scoreGrade(pct: number): { label: string; color: string } {
  if (pct >= 90) return { label: 'Excellent', color: 'text-emerald-600' }
  if (pct >= 75) return { label: 'Good', color: 'text-sky-600' }
  if (pct >= 60) return { label: 'Fair', color: 'text-amber-600' }
  return { label: 'Needs improvement', color: 'text-rose-600' }
}

export default function PerformancePage() {
  const navigate = useNavigate()
  const [month, setMonth] = useState(currentMonth())
  const [rows, setRows] = useState<MonthlyPerformanceRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getMonthlyPerformance(month, 'internal')
      .then((res) => {
        if (cancelled) return
        if (res.success) setRows(res.data)
        else {
          toast.error(res.error || 'Failed to load performance data')
          setRows([])
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [month])

  const columns = useMemo<ColumnDef<MonthlyPerformanceRow>[]>(
    () => [
      {
        accessorKey: 'fullName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => <span className="font-medium">{row.original.fullName}</span>,
      },
      {
        accessorKey: 'role',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Role" />,
        cell: ({ row }) => (
          <TagBadge label={row.original.role} className="capitalize">
            {row.original.role}
          </TagBadge>
        ),
      },
      {
        id: 'combinedScore',
        accessorFn: (row) => combinedScore(row),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Combined Score" />,
        cell: ({ row }) => {
          const pct = combinedScore(row.original)
          const { label, color } = scoreGrade(pct)
          return (
            <div className="flex flex-col">
              <span className={`font-bold tabular-nums ${color}`}>{pct.toFixed(1)}%</span>
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
          )
        },
      },
      {
        accessorKey: 'attendancePct',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Attendance (60%)" />,
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium tabular-nums">
              {formatPct(row.original.attendancePct)}
            </span>
            <span className="text-xs text-muted-foreground">
              {row.original.daysPresent} present · {row.original.daysLate} late ·{' '}
              {row.original.daysAbsent} absent
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'trainingScorePct',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Training (40%)" />,
        cell: ({ row }) => {
          const v = row.original.trainingScorePct
          return (
            <div className="flex flex-col">
              <span className="font-medium tabular-nums">{formatPct(v)}</span>
              <span className="text-xs text-muted-foreground">
                {row.original.trainingsCompleted} completed
              </span>
            </div>
          )
        },
      },
    ],
    []
  )

  // Quick aggregate stats for the month
  const stats = useMemo(() => {
    if (rows.length === 0) return null
    const combined = rows.map(combinedScore)
    const avg = combined.reduce((s, v) => s + v, 0) / combined.length
    const excellent = combined.filter((v) => v >= 90).length
    const needsWork = combined.filter((v) => v < 60).length
    return { avg, excellent, needsWork, total: rows.length }
  }, [rows])

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Performance</h1>
        <p className="text-muted-foreground mt-1">
          Monthly combined score: attendance (60%) + training (40%) — internal staff only.
        </p>
      </div>

      {/* Quick-stat summary row */}
      {stats && (
        <div className="grid gap-3 sm:grid-cols-4">
          <SummaryCard
            label="Staff reviewed"
            value={stats.total}
            icon={<CalendarCheck className="h-4 w-4" />}
          />
          <SummaryCard
            label="Avg combined score"
            value={`${stats.avg.toFixed(1)}%`}
            icon={<Sparkles className="h-4 w-4" />}
            accent
          />
          <SummaryCard
            label="Excellent (≥ 90%)"
            value={stats.excellent}
            icon={<GraduationCap className="h-4 w-4" />}
          />
          <SummaryCard
            label="Needs improvement (< 60%)"
            value={stats.needsWork}
            icon={<GraduationCap className="h-4 w-4" />}
            warn={stats.needsWork > 0}
          />
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-end justify-between gap-4 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="h-5 w-5" />
              {month}
            </CardTitle>
            <CardDescription>
              Combined score = attendance × 60% + training avg × 40%. Click a row to view the
              monthly performance breakdown for that staff member.
            </CardDescription>
          </div>
          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="perf-month" className="text-xs">
                Month
              </Label>
              <Input
                id="perf-month"
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value || currentMonth())}
                className="w-[150px]"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-muted-foreground">Loading…</div>
          ) : rows.length > 0 ? (
            <DataTable
              columns={columns}
              data={rows}
              meta={{
                onRowClick: (row: MonthlyPerformanceRow) => navigate(`/performance/${row.staffId}`),
              }}
            />
          ) : (
            <div className="py-12 text-center text-muted-foreground">
              No performance data for {month}.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  icon,
  accent,
  warn,
}: {
  label: string
  value: string | number
  icon?: React.ReactNode
  accent?: boolean
  warn?: boolean
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-2">
          {icon}
          <p className="text-xs uppercase tracking-wide">{label}</p>
        </div>
        <p
          className={`text-2xl font-bold tabular-nums ${
            accent ? 'text-primary' : warn ? 'text-rose-600' : 'text-foreground'
          }`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  )
}
