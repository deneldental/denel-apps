import { ArrowDown, ArrowUp } from 'lucide-react'
import type { PeriodSummary } from '@/lib/actions/period-report'
import { Card, CardContent } from '@/shared/components/ui/card'
import { formatPct, GHS } from '../report-utils'

interface Props {
  data: PeriodSummary['executive']
}

export function ExecutiveSummarySection({ data }: Props) {
  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">Executive Summary</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Payments"
          value={GHS(data.totalPayments)}
          trend={data.vsPrior.totalPayments}
        />
        <StatCard
          label="Total Expenses"
          value={GHS(data.totalExpenses)}
          trend={data.vsPrior.totalExpenses}
          inverted
        />
        <StatCard
          label="Net Income"
          value={GHS(data.netIncome)}
          sub={`${formatPct(data.marginPct)} margin`}
        />
        <StatCard
          label="New Patients"
          value={String(data.newPatients)}
          trend={data.vsPrior.newPatients}
        />
        <StatCard label="New Cases" value={String(data.newCases)} trend={data.vsPrior.newCases} />
        <StatCard label="Completed Cases" value={String(data.completedCases)} />
        <StatCard label="Avg Revenue / Patient" value={GHS(data.avgRevenuePerPatient)} />
        <StatCard
          label="Collection Rate"
          value={formatPct(data.collectionRate)}
          sub="paid ÷ invoiced (this period)"
        />
      </div>
    </section>
  )
}

interface StatCardProps {
  label: string
  value: string
  trend?: number
  sub?: string
  /** When true, a positive trend renders red and negative renders green (e.g. expenses). */
  inverted?: boolean
}

function StatCard({ label, value, trend, sub, inverted }: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
        {trend !== undefined && <Trend value={trend} inverted={inverted} />}
        {sub && !trend && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function Trend({ value, inverted }: { value: number; inverted?: boolean }) {
  if (value === 0) {
    return <p className="mt-1 text-xs text-muted-foreground">No change vs prior</p>
  }
  const up = value > 0
  const Icon = up ? ArrowUp : ArrowDown
  const positive = inverted ? !up : up
  const color = positive ? 'text-emerald-600' : 'text-rose-600'
  return (
    <p className={`mt-1 inline-flex items-center gap-1 text-xs font-medium ${color}`}>
      <Icon className="h-3 w-3" />
      {Math.abs(value).toFixed(1)}% vs prior
    </p>
  )
}
