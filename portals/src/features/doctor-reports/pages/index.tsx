import { format, parseISO } from 'date-fns'
import {
  CalendarCheck,
  CalendarX,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileText,
  Loader2,
  Pill,
  Receipt,
  Slash,
  Stethoscope,
  Users,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { useState } from 'react'
import { getDoctorWeeklySummary } from '@/lib/actions/doctor-reports'
import { useApiQuery } from '@/lib/query'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'

/** Monday-anchored ISO date for the week containing `d`. */
function mondayIso(d: Date): string {
  const day = d.getDay() // 0 = Sunday
  const offset = day === 0 ? -6 : 1 - day
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset)
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-${String(m.getDate()).padStart(2, '0')}`
}

function shiftWeeks(iso: string, weeks: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return mondayIso(new Date(y, m - 1, d + weeks * 7))
}

function fmtDay(iso: string): string {
  try {
    return format(parseISO(iso), 'EEE d MMM')
  } catch {
    return iso
  }
}

function Tile({
  label,
  value,
  icon: Icon,
  hint,
}: {
  label: string
  value: number
  icon: ComponentType<{ className?: string }>
  hint?: string
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

/**
 * Doctor Reports — a weekly compilation of the signed-in doctor's own clinical
 * activity. Deliberately volume-only: no revenue figures, matching the fact that
 * Finance is not part of the doctor's portal surface.
 */
export default function DoctorReportsPage() {
  const [weekStart, setWeekStart] = useState(() => mondayIso(new Date()))

  const summaryQuery = useApiQuery(['doctor-reports', 'weekly-summary', weekStart] as const, () =>
    getDoctorWeeklySummary(weekStart)
  )
  const data = summaryQuery.data ?? null
  const loading = summaryQuery.isLoading
  const error = summaryQuery.isError
    ? summaryQuery.error.message || 'Failed to load the weekly report'
    : null

  const thisWeek = mondayIso(new Date())
  const isCurrentWeek = weekStart === thisWeek
  const t = data?.totals

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground">
            Your week at a glance
            {data?.weekStart ? ` — ${fmtDay(data.weekStart)} to ${fmtDay(data.weekEnd)}` : ''}.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous week"
            onClick={() => setWeekStart((w) => shiftWeeks(w, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <input
            type="date"
            value={weekStart}
            onChange={(e) => setWeekStart(mondayIso(new Date(`${e.target.value}T00:00:00`)))}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          />
          <Button
            variant="outline"
            size="icon"
            aria-label="Next week"
            disabled={isCurrentWeek}
            onClick={() => setWeekStart((w) => shiftWeeks(w, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {!isCurrentWeek && (
            <Button variant="ghost" size="sm" onClick={() => setWeekStart(thisWeek)}>
              This week
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void summaryQuery.refetch()}>
            <Loader2 className="mr-1.5 h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      ) : !data?.doctorId ? (
        <div className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
          No doctor profile is linked to your account, so there's nothing to report on yet.
        </div>
      ) : (
        <>
          {/* Volume tiles */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Patients seen" value={t?.uniquePatients ?? 0} icon={Users} />
            <Tile
              label="Appointments"
              value={t?.appointments ?? 0}
              icon={CalendarCheck}
              hint={`${t?.remaining ?? 0} still upcoming`}
            />
            <Tile label="Completed" value={t?.completed ?? 0} icon={CalendarCheck} />
            <Tile
              label="No-shows"
              value={t?.noShow ?? 0}
              icon={CalendarX}
              hint={`${t?.cancelled ?? 0} cancelled`}
            />
            <Tile
              label="Estimates requested"
              value={t?.estimatesRequested ?? 0}
              icon={Receipt}
              hint={`${t?.estimatesReady ?? 0} ready · ${t?.estimatesInvoiced ?? 0} invoiced`}
            />
            <Tile label="Clinical notes" value={t?.clinicalNotes ?? 0} icon={FileText} />
            <Tile label="Prescriptions" value={t?.prescriptions ?? 0} icon={Pill} />
            <Tile
              label="Treatment plans"
              value={t?.treatmentPlans ?? 0}
              icon={Stethoscope}
              hint={`${t?.treatmentPlansAccepted ?? 0} accepted`}
            />
          </div>

          {/* Day-by-day */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-3">
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Day by day</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Day</TableHead>
                    <TableHead className="text-right">Appointments</TableHead>
                    <TableHead className="text-right">Completed</TableHead>
                    <TableHead className="text-right">No-show</TableHead>
                    <TableHead className="text-right">Cancelled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.days.map((d) => (
                    <TableRow key={d.date} className={d.appointments === 0 ? 'opacity-60' : ''}>
                      <TableCell className="font-medium">{fmtDay(d.date)}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.appointments}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.completed}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.noShow}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.cancelled}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {data.totals.appointments === 0 && (
            <p className="flex items-center justify-center gap-2 rounded-lg border border-dashed py-8 text-sm text-muted-foreground">
              <Slash className="h-4 w-4" />
              No appointments were booked with you this week.
            </p>
          )}
        </>
      )}
    </div>
  )
}
