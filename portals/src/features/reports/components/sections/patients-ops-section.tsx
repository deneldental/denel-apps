import { format, parseISO } from 'date-fns'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PeriodSummary } from '@/lib/actions/period-report'
import { Card, CardContent } from '@/shared/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { formatPct } from '../report-utils'

interface Props {
  data: PeriodSummary['ops']
}

export function PatientsOpsSection({ data }: Props) {
  const peakDay =
    data.appointmentsByDay.length === 0
      ? null
      : data.appointmentsByDay.reduce(
          (p, r) => (r.count > p.count ? r : p),
          data.appointmentsByDay[0]
        )

  return (
    <section className="space-y-6">
      <h2 className="text-lg font-semibold">Patients &amp; Ops</h2>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Appointments Booked" value={String(data.appointmentsBooked)} />
        <Stat label="Checked-in" value={String(data.appointmentsCheckedIn)} />
        <Stat
          label="No-show Rate"
          value={formatPct(data.noShowRate)}
          sub={`${data.appointmentsNoShow} of ${data.appointmentsBooked}`}
        />
        <Stat
          label="Cancellation Rate"
          value={formatPct(data.cancellationRate)}
          sub={`${data.appointmentsCancelled} cancelled`}
        />
        <Stat label="New Patients" value={String(data.newPatients)} />
        <Stat label="Returning Patients" value={String(data.returningPatients)} />
        <Stat label="New Cases" value={String(data.totalCases)} />
        <Stat label="Completed Cases" value={String(data.completedCases)} />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">Appointments by Day</p>
            {peakDay && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Peak: {format(parseISO(peakDay.date), 'MMM d')} · {peakDay.count}{' '}
                {peakDay.count === 1 ? 'appointment' : 'appointments'}
              </p>
            )}
          </div>
          {data.appointmentsByDay.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              No appointments in this period.
            </div>
          ) : (
            <div className="p-4">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={data.appointmentsByDay.map((d) => ({
                    ...d,
                    label: format(parseISO(d.date), 'MMM d'),
                  }))}
                >
                  <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} />
                  <YAxis stroke="#94a3b8" fontSize={11} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#16a34a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">Doctor Utilization</p>
          </div>
          {data.doctorUtilization.length === 0 ? (
            <div className="flex h-20 items-center justify-center text-sm text-muted-foreground">
              No appointments in this period.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Doctor</TableHead>
                  <TableHead className="text-right">Appointments</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.doctorUtilization.map((d) => (
                  <TableRow key={d.doctorId ?? d.doctorName}>
                    <TableCell className="font-medium">{d.doctorName}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.appointmentCount}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(d.hours).toFixed(1)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}
