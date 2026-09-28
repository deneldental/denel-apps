import { format, parseISO } from 'date-fns'
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
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
import { EXPENSE_COLORS, GHS, METHOD_COLORS, TREATMENT_COLORS } from '../report-utils'

interface Props {
  data: PeriodSummary['finance']
}

export function FinanceSection({ data }: Props) {
  const peakExpenseDay = pickPeak(data.expensesByDay, 'amount')
  const peakPaymentDay = pickPeak(data.paymentsByDay, 'amount')

  return (
    <section className="space-y-6">
      <h2 className="text-lg font-semibold">Finance</h2>

      <div className="grid gap-4 lg:grid-cols-2">
        <SubCard title="Expenses by Category">
          {data.expensesByCategory.length === 0 ? (
            <Empty />
          ) : (
            <CategoryPie data={data.expensesByCategory} colors={EXPENSE_COLORS} />
          )}
        </SubCard>

        <SubCard
          title="Expenses by Day"
          subtitle={
            peakExpenseDay
              ? `Peak: ${format(parseISO(peakExpenseDay.date), 'MMM d')} · ${GHS(peakExpenseDay.amount)}`
              : undefined
          }
        >
          {data.expensesByDay.length === 0 ? (
            <Empty />
          ) : (
            <DayBars data={data.expensesByDay} color="#ea580c" />
          )}
        </SubCard>

        <SubCard title="Payments by Method">
          {data.paymentsByMethod.length === 0 ? (
            <Empty />
          ) : (
            <CategoryPie
              data={data.paymentsByMethod.map((m) => ({ category: m.method, amount: m.amount }))}
              colors={METHOD_COLORS}
            />
          )}
        </SubCard>

        <SubCard
          title="Payments by Day"
          subtitle={
            peakPaymentDay
              ? `Peak: ${format(parseISO(peakPaymentDay.date), 'MMM d')} · ${GHS(peakPaymentDay.amount)}`
              : undefined
          }
        >
          {data.paymentsByDay.length === 0 ? (
            <Empty />
          ) : (
            <DayBars data={data.paymentsByDay} color="#2563eb" />
          )}
        </SubCard>
      </div>

      {data.paymentsByTreatment.length > 0 && (
        <SubCard title="Payments by Treatment">
          <SimpleTable
            headers={['Treatment', 'Count', 'Amount']}
            rows={data.paymentsByTreatment.map((r) => [
              r.treatment,
              String(r.count),
              GHS(r.amount),
            ])}
            colorIndexHeader
            colors={TREATMENT_COLORS}
          />
        </SubCard>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <SubCard title="Payment Plans">
          <div className="grid grid-cols-2 gap-3 p-4">
            <Stat label="Received this period" value={GHS(data.paymentPlans.totalReceived)} />
            <Stat
              label="Outstanding (all time)"
              value={GHS(data.paymentPlans.totalOutstanding)}
              muted
            />
          </div>
          {data.paymentsByPlan.length > 0 && (
            <SimpleTable
              headers={['Plan', 'Received']}
              rows={data.paymentsByPlan.map((p) => [p.planName, GHS(p.amount)])}
            />
          )}
        </SubCard>

        <SubCard title="Outstanding by Treatment">
          {data.outstandingByTreatment.length === 0 ? (
            <Empty />
          ) : (
            <SimpleTable
              headers={['Treatment', 'Outstanding']}
              rows={data.outstandingByTreatment.map((r) => [r.treatment, GHS(r.amount)])}
            />
          )}
        </SubCard>
      </div>
    </section>
  )
}

function pickPeak<T extends Record<string, any>>(rows: T[], key: keyof T) {
  if (rows.length === 0) return null
  return rows.reduce((peak, r) => ((r[key] as number) > (peak[key] as number) ? r : peak), rows[0])
}

function SubCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">{title}</p>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        <div className="min-h-[80px]">{children}</div>
      </CardContent>
    </Card>
  )
}

function Empty() {
  return (
    <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
      No data for this period.
    </div>
  )
}

function CategoryPie({
  data,
  colors,
}: {
  data: Array<{ category: string; amount: number }>
  colors: string[]
}) {
  return (
    <div className="p-4">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            dataKey="amount"
            nameKey="category"
            outerRadius={80}
            label={(entry: any) => entry.category}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={colors[i % colors.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(v) => GHS(Number(v))} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

function DayBars({
  data,
  color,
}: {
  data: Array<{ date: string; amount: number }>
  color: string
}) {
  const formatted = data.map((d) => ({ ...d, label: format(parseISO(d.date), 'MMM d') }))
  return (
    <div className="p-4">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={formatted}>
          <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} />
          <YAxis
            stroke="#94a3b8"
            fontSize={11}
            tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip formatter={(v) => GHS(Number(v))} />
          <Bar dataKey="amount" fill={color} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function SimpleTable({
  headers,
  rows,
  colorIndexHeader,
  colors,
}: {
  headers: string[]
  rows: string[][]
  colorIndexHeader?: boolean
  colors?: string[]
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {headers.map((h, i) => (
            <TableHead key={i} className={i === headers.length - 1 ? 'text-right' : ''}>
              {h}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => (
          <TableRow key={i}>
            {row.map((cell, j) => (
              <TableCell
                key={j}
                className={
                  j === row.length - 1
                    ? 'text-right tabular-nums'
                    : j === 0
                      ? 'font-medium'
                      : 'tabular-nums'
                }
              >
                {colorIndexHeader && j === 0 && colors ? (
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: colors[i % colors.length] }}
                    />
                    {cell}
                  </span>
                ) : (
                  cell
                )}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function Stat({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${muted ? 'text-muted-foreground' : ''}`}>
        {value}
      </p>
    </div>
  )
}
