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
import { GHS } from '../report-utils'

interface Props {
  data: PeriodSummary['clinical']
}

export function ClinicalSection({ data }: Props) {
  return (
    <section className="space-y-6">
      <h2 className="text-lg font-semibold">Clinical</h2>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="X-rays Taken" value={String(data.xraysTaken)} />
        <Stat label="Prescriptions Issued" value={String(data.prescriptionsIssued)} />
        <Stat
          label="Consent Forms Signed"
          value={String(data.consentForms.completed)}
          sub="this period"
        />
        <Stat
          label="Consent Forms Outstanding"
          value={String(data.consentForms.outstanding)}
          sub="all time"
          muted
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">Procedures Performed by Type</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Sourced from completed payments tagged with treatments.
            </p>
          </div>
          {data.proceduresByType.length === 0 ? (
            <div className="flex h-20 items-center justify-center text-sm text-muted-foreground">
              No procedures recorded in this period.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.proceduresByType.map((p) => (
                  <TableRow key={p.type}>
                    <TableCell className="font-medium">{p.type}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.count}</TableCell>
                    <TableCell className="text-right tabular-nums">{GHS(p.revenue)}</TableCell>
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

function Stat({
  label,
  value,
  sub,
  muted,
}: {
  label: string
  value: string
  sub?: string
  muted?: boolean
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p
          className={`mt-1 text-2xl font-bold tabular-nums ${muted ? 'text-muted-foreground' : ''}`}
        >
          {value}
        </p>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}
